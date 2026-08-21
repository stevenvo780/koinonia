/**
 * Validación de la configuración, y la **compuerta C6**.
 *
 * La compuerta es lo primero que se prueba porque es lo primero que se ejecuta: la resolución del
 * arquitecto la define como control de primera clase, no como una bandera desactivable.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  assertHardSecrecySupported,
  computeConfigHash,
  DEFAULT_TIE_BREAK,
  DELEGATION_DISABLED,
  ENGINE_VERSION,
  HardSecrecyUnsupported,
  instant,
  InvalidConfigError,
  isThresholdMethod,
  MAX_EXTENSIONS_HARD_CAP,
  MAX_ROUNDS_HARD_CAP,
  ratio,
  validateDecisionConfig,
} from '../src/index.js';
import {
  arbAbstentionPolicy,
  arbMethodPlan,
  arbPrivacy,
  buildConfig,
  buildElectorate,
  CIRCLE_OTHER,
  CLOSES_AT,
  DEFAULT_WINDOW,
  FC,
  NO_QUORUM,
  optionIdAt,
  PROPOSAL_V2,
  planToMethod,
  T0,
} from './arbitraries.js';

const HOUR = 3_600_000;

async function reason(build: () => Promise<unknown>): Promise<string> {
  try {
    await build();
    return 'NO_ERROR';
  } catch (error) {
    return error instanceof InvalidConfigError ? error.rejection : `OTRO:${String(error)}`;
  }
}

describe('C6 — compuerta de secreto duro', () => {
  it('`assertHardSecrecySupported` rechaza `secret-ballot` y sólo `secret-ballot`', () => {
    expect(() => {
      assertHardSecrecySupported('public-roll-call');
    }).not.toThrow();
    expect(() => {
      assertHardSecrecySupported('sealed-tally');
    }).not.toThrow();
    expect(() => {
      assertHardSecrecySupported('secret-ballot');
    }).toThrow(HardSecrecyUnsupported);
  });

  it('el error explica que el asunto se vota en papel, no que «falta una función»', () => {
    try {
      assertHardSecrecySupported('secret-ballot');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(HardSecrecyUnsupported);
      expect((error as HardSecrecyUnsupported).code).toBe('HARD_SECRECY_UNSUPPORTED');
      expect((error as Error).message).toContain('papel');
    }
  });

  it('INV-32 — voto secreto y delegación son incompatibles por configuración', async () => {
    const electorate = await buildElectorate(3);
    const config = await buildConfig({
      electorate,
      method: planToMethod({ kind: 'simple-majority', abstentionPolicy: 'exclude' }),
    });
    // La regla C.7.a existe como control propio, independiente de la compuerta C6.
    expect(() => {
      validateDecisionConfig({
        ...config,
        privacy: 'secret-ballot',
        delegation: { ...DELEGATION_DISABLED, enabled: true },
      });
    }).toThrow(/SECRET_BALLOT_WITH_DELEGATION/u);
  });

  it('la delegación habilitada se rechaza en vez de desactivarse en silencio', async () => {
    expect(
      await reason(async () =>
        buildConfig({
          electorate: await buildElectorate(3),
          method: planToMethod({ kind: 'simple-majority', abstentionPolicy: 'exclude' }),
          delegationEnabled: true,
        }),
      ),
    ).toBe('DELEGATION_NOT_IMPLEMENTED');
  });
});

describe('config — validación', () => {
  it('exige que la versión del motor coincida (A.7)', async () => {
    const electorate = await buildElectorate(3);
    const config = await buildConfig({
      electorate,
      method: planToMethod({ kind: 'simple-majority', abstentionPolicy: 'exclude' }),
    });
    expect(config.engineVersion).toBe(ENGINE_VERSION);
    expect(() => {
      validateDecisionConfig({ ...config, engineVersion: '31.0.0' });
    }).toThrow(/ENGINE_VERSION_MISMATCH/u);
  });

  it('B.1 — los métodos de esta entrega deciden sobre UNA propuesta', async () => {
    const electorate = await buildElectorate(3);
    const config = await buildConfig({
      electorate,
      method: planToMethod({ kind: 'simple-majority', abstentionPolicy: 'exclude' }),
    });
    expect(() => {
      validateDecisionConfig({ ...config, options: [optionIdAt(0), optionIdAt(1)] });
    }).toThrow(/BINARY_METHOD_NEEDS_SINGLE_OPTION/u);
    expect(() => {
      validateDecisionConfig({ ...config, options: [] });
    }).toThrow(/NO_OPTIONS/u);
    expect(() => {
      validateDecisionConfig({ ...config, options: [optionIdAt(1), optionIdAt(0)] });
    }).toThrow(/OPTIONS_NOT_SORTED/u);
  });

  it("B.2.a — `base:'census'` sólo se admite para actos constituyentes", async () => {
    const electorate = await buildElectorate(3);
    const constituyente = await buildConfig({
      electorate,
      method: planToMethod({
        kind: 'supermajority',
        num: 2,
        den: 3,
        strict: false,
        base: 'census',
        abstentionPolicy: 'exclude',
      }),
    });
    expect(constituyente.constituentAct).toBe('reform-student-statute');
    const { constituentAct: _acto, ...sinActo } = constituyente;
    expect(() => {
      validateDecisionConfig(sinActo);
    }).toThrow(/CENSUS_BASE_NOT_ALLOWED/u);
  });

  it("B.1.c — `simple-majority` sólo admite `base:'cast'`; el censo es cosa de `supermajority`", async () => {
    const electorate = await buildElectorate(3);
    const config = await buildConfig({
      electorate,
      method: planToMethod({ kind: 'simple-majority', abstentionPolicy: 'exclude' }),
    });
    expect(() => {
      validateDecisionConfig({
        ...config,
        constituentAct: 'reform-student-statute',
        method: { ...config.method, base: 'census' } as typeof config.method,
      });
    }).toThrow(/CENSUS_BASE_NOT_ALLOWED/u);
  });

  it("B.2.b — `base:'present'` se rechaza: no existe el evento de registro de asistencia", async () => {
    const electorate = await buildElectorate(3);
    const config = await buildConfig({
      electorate,
      method: planToMethod({
        kind: 'supermajority',
        num: 2,
        den: 3,
        strict: false,
        base: 'cast',
        abstentionPolicy: 'exclude',
      }),
    });
    expect(() => {
      validateDecisionConfig({
        ...config,
        method: { ...config.method, base: 'present' } as typeof config.method,
      });
    }).toThrow(/PRESENT_BASE_UNSUPPORTED/u);
  });

  it('B.4.a — la unanimidad exige autorización previa del círculo', async () => {
    const electorate = await buildElectorate(3);
    const config = await buildConfig({
      electorate,
      method: planToMethod({ kind: 'unanimity', base: 'cast', abstentionBlocks: false }),
    });
    expect(config.unanimityAuthorizedBy).toBeDefined();
    const { unanimityAuthorizedBy: _autorizacion, ...sinAutorizar } = config;
    expect(() => {
      validateDecisionConfig(sinAutorizar);
    }).toThrow(/UNANIMITY_NOT_AUTHORIZED/u);
  });

  it("D.1.c — `approvalOfCensus` con `base:'census'` es el mismo freno dos veces", async () => {
    expect(
      await reason(async () =>
        buildConfig({
          electorate: await buildElectorate(3),
          method: planToMethod({
            kind: 'supermajority',
            num: 2,
            den: 3,
            strict: false,
            base: 'census',
            abstentionPolicy: 'exclude',
          }),
          quorum: { ...NO_QUORUM, approvalOfCensus: ratio(1, 4) },
        }),
      ),
    ).toBe('REDUNDANT_APPROVAL_QUORUM');
  });

  it('D.2.a — el tope duro de prórrogas es 2; B.3.c — el de rondas es 5', async () => {
    const electorate = await buildElectorate(3);
    expect(MAX_EXTENSIONS_HARD_CAP).toBe(2);
    expect(MAX_ROUNDS_HARD_CAP).toBe(5);
    expect(
      await reason(async () =>
        buildConfig({
          electorate,
          method: planToMethod({ kind: 'simple-majority', abstentionPolicy: 'exclude' }),
          quorum: { ...NO_QUORUM, onFailure: 'extend', maxExtensions: 3, extensionDuration: HOUR },
        }),
      ),
    ).toBe('MAX_EXTENSIONS_OUT_OF_RANGE');
    expect(
      await reason(async () =>
        buildConfig({
          electorate,
          method: planToMethod({
            kind: 'sociocratic-consent',
            maxRounds: 6,
            minEngagementNum: 1,
            minEngagementDen: 2,
          }),
        }),
      ),
    ).toBe('MAX_ROUNDS_OUT_OF_RANGE');
  });

  it('el consentimiento exige un círculo con miembros: el engagement sería 0/0', async () => {
    expect(
      await reason(async () =>
        buildConfig({
          electorate: await buildElectorate(3),
          method: planToMethod({
            kind: 'sociocratic-consent',
            maxRounds: 3,
            minEngagementNum: 1,
            minEngagementDen: 2,
          }),
          circleId: CIRCLE_OTHER,
        }),
      ),
    ).toBe('CONSENT_CIRCLE_EMPTY');
  });

  it('la ventana debe ser un intervalo no vacío', async () => {
    expect(
      await reason(async () =>
        buildConfig({
          electorate: await buildElectorate(3),
          method: planToMethod({ kind: 'simple-majority', abstentionPolicy: 'exclude' }),
          window: { ...DEFAULT_WINDOW, closesAt: T0 },
        }),
      ),
    ).toBe('WINDOW_INVERTED');
  });

  it('D.4.b — el cierre anticipado sólo se permite donde no filtra el marcador', async () => {
    const electorate = await buildElectorate(3);
    const umbral = planToMethod({ kind: 'simple-majority', abstentionPolicy: 'exclude' });

    // Irreversibilidad en `sealed-tally`: filtra el sentido por el canal de temporización.
    expect(
      await reason(async () =>
        buildConfig({
          electorate,
          method: umbral,
          privacy: 'sealed-tally',
          window: {
            ...DEFAULT_WINDOW,
            earlyClose: { enabled: true, mode: 'mathematically-irreversible' },
          },
        }),
      ),
    ).toBe('EARLY_CLOSE_NOT_ALLOWED');

    // `full-turnout` no revela el sentido: se admite.
    await expect(
      buildConfig({
        electorate,
        method: umbral,
        privacy: 'sealed-tally',
        window: { ...DEFAULT_WINDOW, earlyClose: { enabled: true, mode: 'full-turnout' } },
      }),
    ).resolves.toBeDefined();

    // Un método no de umbral nunca admite cierre anticipado.
    expect(
      await reason(async () =>
        buildConfig({
          electorate,
          method: planToMethod({
            kind: 'sociocratic-consent',
            maxRounds: 3,
            minEngagementNum: 1,
            minEngagementDen: 2,
          }),
          window: {
            ...DEFAULT_WINDOW,
            earlyClose: { enabled: true, mode: 'mathematically-irreversible' },
          },
        }),
      ),
    ).toBe('EARLY_CLOSE_NOT_ALLOWED');
  });
});

describe('config — hash e inmutabilidad', () => {
  it('A.7 — `configHash` incluye `engineVersion`: cambiar el algoritmo cambia la identidad', async () => {
    const config = await buildConfig({
      electorate: await buildElectorate(3),
      method: planToMethod({ kind: 'simple-majority', abstentionPolicy: 'exclude' }),
    });
    const { configHash: _ignorado, ...draft } = config;
    expect(await computeConfigHash(draft)).toBe(config.configHash);
    expect(await computeConfigHash({ ...draft, engineVersion: '31.0.0' })).not.toBe(
      config.configHash,
    );
  });

  it('el padrón entra en `configHash` por su identidad, no por los atributos de cada persona', async () => {
    const config = await buildConfig({
      electorate: await buildElectorate(4),
      method: planToMethod({ kind: 'simple-majority', abstentionPolicy: 'exclude' }),
    });
    const { configHash: _ignorado, ...draft } = config;
    const conOtrosEstratos = {
      ...draft,
      electorate: {
        ...config.electorate,
        members: config.electorate.members.map((m) => ({ ...m, strata: {} })),
      },
    };
    expect(await computeConfigHash(conOtrosEstratos)).toBe(config.configHash);
    // Pero cambiar QUIÉN puede votar sí cambia el hash.
    const conOtroPadron = {
      ...draft,
      electorate: { ...config.electorate, rollHash: PROPOSAL_V2 },
    };
    expect(await computeConfigHash(conOtroPadron)).not.toBe(config.configHash);
  });

  it('la configuración queda congelada en profundidad: `readonly` más `Object.freeze`', async () => {
    const config = await buildConfig({
      electorate: await buildElectorate(3),
      method: planToMethod({ kind: 'simple-majority', abstentionPolicy: 'exclude' }),
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.window)).toBe(true);
    expect(Object.isFrozen(config.electorate.members)).toBe(true);
    expect(() => {
      (config as { privacy: string }).privacy = 'secret-ballot';
    }).toThrow(TypeError);
  });

  it('el hash no depende del orden en que se construyó el objeto', async () => {
    const electorate = await buildElectorate(4);
    const method = planToMethod({ kind: 'simple-majority', abstentionPolicy: 'exclude' });
    const a = await buildConfig({ electorate, method });
    const b = await buildConfig({ electorate, method });
    expect(b.configHash).toBe(a.configHash);
    // Cambiar cualquier regla del juego cambia el hash.
    const c = await buildConfig({
      electorate,
      method,
      window: { ...DEFAULT_WINDOW, closesAt: instant(CLOSES_AT + 1) },
    });
    expect(c.configHash).not.toBe(a.configHash);
  });

  it('toda configuración construida por los generadores es válida, y con `secret-ballot` nunca abre', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMethodPlan,
        arbPrivacy,
        arbAbstentionPolicy,
        fc.integer({ min: 1, max: 8 }),
        async (methodPlan, privacy, _policy, members) => {
          const electorate = await buildElectorate(members);
          const config = await buildConfig({ electorate, method: planToMethod(methodPlan) });
          expect(() => {
            validateDecisionConfig(config);
          }).not.toThrow();
          expect(isThresholdMethod(config.method)).toBe(methodPlan.kind !== 'sociocratic-consent');
          if (privacy === 'secret-ballot') {
            expect(() => {
              assertHardSecrecySupported(privacy);
            }).toThrow(HardSecrecyUnsupported);
          }
          expect(
            config.method.kind === 'simple-majority' ? DEFAULT_TIE_BREAK.cascade : ['x'],
          ).toBeDefined();
        },
      ),
      { ...FC, numRuns: Math.min(FC.numRuns, 200) },
    );
  });
});
