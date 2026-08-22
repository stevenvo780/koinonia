import { describe, expect, it } from 'vitest';

import {
  append,
  buildDecisionConfig,
  type DecisionConfig,
  type DecisionLog,
  type DraftConfig,
  draftDecision,
  hash,
  initiativeId,
  instant,
  openDecision,
  PreconditionError,
  proposalId,
  replay,
  verifyLog,
} from '../src/index.js';
import {
  buildConfig,
  buildElectorate,
  DECISION_ID,
  eventIdAt,
  hex32,
  PROPOSAL_ID,
  PROPOSAL_V1,
  PROPOSAL_V2,
  planToMethod,
  T0,
} from './arbitraries.js';

const BASE_DRAFT: DraftConfig = {
  proposalId: PROPOSAL_ID,
  proposalVersionHash: PROPOSAL_V1,
  summary: 'Aprobar el plan de trabajo',
};

async function configForOpening(): Promise<DecisionConfig> {
  return buildConfig({
    electorate: await buildElectorate(3),
    method: planToMethod({ kind: 'simple-majority', abstentionPolicy: 'exclude' }),
  });
}

async function rebuildConfig(
  config: DecisionConfig,
  overrides: Partial<Pick<DecisionConfig, 'proposalId' | 'proposalVersionHash'>>,
): Promise<DecisionConfig> {
  const { configHash: _configHash, ...draft } = config;
  return buildDecisionConfig({ ...draft, ...overrides });
}

async function draftedLog(draft: DraftConfig = BASE_DRAFT): Promise<DecisionLog> {
  return draftDecision([], {
    eventId: eventIdAt(1),
    at: instant(T0 - 1),
    actor: 'system',
    decisionId: DECISION_ID,
    draft,
  });
}

async function adversarialOpening(
  draft: DraftConfig,
  config: DecisionConfig,
): Promise<DecisionLog> {
  return append(await draftedLog(draft), {
    eventId: eventIdAt(2),
    decisionId: DECISION_ID,
    occurredAt: T0,
    actor: 'system',
    payload: { type: 'DecisionOpened', config },
  });
}

function expectReplayCode(log: DecisionLog, code: string): void {
  expect(() => replay(log)).toThrow(PreconditionError);
  try {
    replay(log);
  } catch (error: unknown) {
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`replay debió rechazar el log con ${code}`);
}

describe('DecisionEngine — invariantes de DecisionOpened', () => {
  it.each([
    {
      field: 'proposalId',
      code: 'DRAFT_PROPOSAL_ID_MISMATCH',
      mutate: async (config: DecisionConfig) =>
        rebuildConfig(config, { proposalId: proposalId(hex32(0x99)) }),
    },
    {
      field: 'proposalVersionHash',
      code: 'DRAFT_PROPOSAL_VERSION_MISMATCH',
      mutate: async (config: DecisionConfig) =>
        rebuildConfig(config, { proposalVersionHash: PROPOSAL_V2 }),
    },
  ])('rechaza un log encadenado cuyo $field diverge del borrador', async ({ code, mutate }) => {
    const log = await adversarialOpening(BASE_DRAFT, await mutate(await configForOpening()));

    expectReplayCode(log, code);
    await expect(verifyLog(log)).rejects.toMatchObject({ code });
  });

  it.each([
    {
      missing: 'executionPlanHash',
      draft: { ...BASE_DRAFT, plannedInitiativeId: initiativeId(hex32(0x71)) },
    },
    {
      missing: 'plannedInitiativeId',
      draft: { ...BASE_DRAFT, executionPlanHash: hash('44'.repeat(32)) },
    },
  ])('rechaza ADR-0043 si falta $missing durante replay y verificación', async ({ draft }) => {
    const log = await adversarialOpening(draft, await configForOpening());

    expectReplayCode(log, 'DRAFT_EXECUTION_PLAN_INCOMPLETE');
    await expect(verifyLog(log)).rejects.toMatchObject({
      code: 'DRAFT_EXECUTION_PLAN_INCOMPLETE',
    });
  });

  it('abre y verifica decisiones ADR-0043 cuando la referencia está completa', async () => {
    const config = await configForOpening();
    const drafted = await draftedLog({
      ...BASE_DRAFT,
      plannedInitiativeId: initiativeId(hex32(0x72)),
      executionPlanHash: hash('55'.repeat(32)),
    });
    const log = await openDecision(drafted, {
      eventId: eventIdAt(2),
      at: T0,
      actor: 'system',
      config,
    });

    await expect(verifyLog(log)).resolves.toMatchObject({ status: 'Open' });
  });

  it('mantiene compatibilidad de replay con decisiones históricas sin campos ADR-0043', async () => {
    const config = await configForOpening();
    const log = await openDecision(await draftedLog(), {
      eventId: eventIdAt(2),
      at: T0,
      actor: 'system',
      config,
    });

    expect(replay(log)).toMatchObject({ status: 'Open', draft: BASE_DRAFT });
    await expect(verifyLog(log)).resolves.toMatchObject({ status: 'Open' });
  });
});
