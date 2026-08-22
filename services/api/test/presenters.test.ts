import {
  circleId,
  decisionId,
  eventId,
  hash,
  initiativeId,
  instant,
  memberId,
  milestoneId,
  proposalId,
  ratio,
  taskId,
  toPrivateMaterialCommitment,
  type DecisionResult,
  type InitiativeState,
} from '@koinonia/domain';
import { describe, expect, it } from 'vitest';

import { iniciativaDto, resultadoDto } from '../src/http/presenters.js';

const OBJECTION_ID = 'abcdef0123456789abcdef0123456789';
const INITIATIVE_ID = initiativeId('1'.repeat(32));
const INITIATIVE_DECISION_ID = decisionId('2'.repeat(32));
const PROPOSAL_ID = proposalId('3'.repeat(32));
const CIRCLE_ID = circleId('4'.repeat(32));
const RESPONSIBLE = memberId('5'.repeat(32));
const DELIVERER = memberId('6'.repeat(32));
const CURRENT_RECIPIENT = memberId('7'.repeat(32));
const MILESTONE_ID = milestoneId('8'.repeat(32));
const TASK_ID = taskId('9'.repeat(32));
const OLD_OFFER_ID = eventId('a'.repeat(32));
const EVIDENCE_ID = eventId('b'.repeat(32));
const DELIVERY_ID = eventId('c'.repeat(32));
const PAUSE_ID = eventId('d'.repeat(32));
const HELP_ID = eventId('e'.repeat(32));
const CURRENT_OFFER_ID = eventId('f'.repeat(32));
const RATIFICATION_ID = eventId('0'.repeat(32));
const PRIVATE_COMMITMENT = toPrivateMaterialCommitment('d'.repeat(64));

function resultadoConObjecion(): DecisionResult {
  return {
    decisionId: decisionId('0123456789abcdef0123456789abcdef'),
    configHash: hash('a'.repeat(64)),
    rollHash: hash('b'.repeat(64)),
    engineVersion: 'test',
    computedFromSeq: 4,
    outcome: { kind: 'needs-new-round', nextRound: 2 },
    turnout: { cast: 1, represented: 1, census: 2, fraction: ratio(1, 2) },
    weights: { totalWeight: 1, hhi: ratio(1, 1), gini: ratio(0, 1) },
    quorumCheck: { passed: true, detail: { general: true } },
    proof: {
      narrative: 'Quedó una objeción en pie y hace falta otra ronda.',
      steps: [
        {
          id: 'S4',
          claim: `Queda una objeción admitida sin integrar: ${OBJECTION_ID}.`,
          evidence: { objecionesBloqueantes: 1 },
          supportingSeqs: [3],
        },
      ],
      tables: [
        {
          title: 'Objeciones',
          columns: ['Objeción', 'Ronda', 'Estado', '¿Integrada?'],
          rows: [[OBJECTION_ID, 1, 'admitida', 'no']],
        },
      ],
    },
    resultHash: hash('c'.repeat(64)),
  };
}

function iniciativaConHistoria(): InitiativeState {
  return {
    initiativeId: INITIATIVE_ID,
    decisionId: INITIATIVE_DECISION_ID,
    proposalId: PROPOSAL_ID,
    proposalVersionHash: hash('1'.repeat(64)),
    decisionResultHash: hash('2'.repeat(64)),
    circleId: CIRCLE_ID,
    executionPlan: {
      objective: 'Ejecutar el acuerdo y conservar evidencia verificable.',
      responsibleId: RESPONSIBLE,
      reviewAt: instant(1_800_000_000_000),
      successCriteria: [
        {
          description: 'La comunidad puede comprobar el resultado acordado.',
          evidenceSource: 'Registro institucional publicado',
        },
      ],
    },
    status: 'por-empezar',
    createdAt: instant(1_799_000_000_000),
    activatedAt: instant(1_799_000_100_000),
    ratificationEventId: RATIFICATION_ID,
    ratificationEventHash: hash('3'.repeat(64)),
    milestones: [
      {
        milestoneId: MILESTONE_ID,
        title: 'Publicar el resultado verificable',
        completionCriterion: 'El resultado queda publicado con evidencia suficiente.',
        dueAt: instant(1_800_000_000_000),
        plannedAt: instant(1_799_001_000_000),
        seq: 2,
      },
    ],
    tasks: [
      {
        taskId: TASK_ID,
        milestoneId: MILESTONE_ID,
        title: 'Preparar el resultado verificable',
        description: 'Reunir y publicar la evidencia que exige el acuerdo colectivo.',
        effortMinutes: 90,
        dueAt: instant(1_800_000_000_000),
        dependsOn: [],
        status: 'ofrecida',
        offeredTo: CURRENT_RECIPIENT,
        currentOfferId: CURRENT_OFFER_ID,
        assigneeId: undefined,
        offers: [
          {
            offerId: OLD_OFFER_ID,
            offeredTo: DELIVERER,
            offeredAt: instant(1_799_002_000_000),
            seq: 3,
          },
          {
            offerId: CURRENT_OFFER_ID,
            offeredTo: CURRENT_RECIPIENT,
            offeredAt: instant(1_799_009_000_000),
            seq: 14,
          },
        ],
        responses: [],
        starts: [],
        startedAt: instant(1_799_003_000_000),
        pauses: [
          {
            pauseId: PAUSE_ID,
            kind: 'blocked',
            category: 'recurso',
            privateDetailCommitment: PRIVATE_COMMITMENT,
            startedAt: instant(1_799_007_000_000),
            startedSeq: 11,
            endedAt: instant(1_799_008_000_000),
            endedSeq: 13,
            endedBy: 'reassignment',
          },
        ],
        currentPause: undefined,
        helpRequests: [
          {
            helpRequestId: HELP_ID,
            pauseId: PAUSE_ID,
            category: 'revision',
            privateDetailCommitment: PRIVATE_COMMITMENT,
            requestedAt: instant(1_799_007_500_000),
            seq: 12,
          },
        ],
        evidence: [
          {
            evidenceId: EVIDENCE_ID,
            offerId: OLD_OFFER_ID,
            objectCommitment: PRIVATE_COMMITMENT,
            kindCode: 'texto',
            sizeClass: 'pequena',
            visibility: 'restricted',
            addedBy: DELIVERER,
            addedAt: instant(1_799_004_000_000),
            seq: 6,
          },
        ],
        deliveries: [
          {
            deliveryId: DELIVERY_ID,
            offerId: OLD_OFFER_ID,
            evidenceIds: [EVIDENCE_ID],
            summaryCommitment: PRIVATE_COMMITMENT,
            deliveredBy: DELIVERER,
            deliveredAt: instant(1_799_005_000_000),
            seq: 8,
            review: {
              type: 'changes-requested',
              by: RESPONSIBLE,
              reason: 'evidencia-insuficiente',
              privateDetailCommitment: PRIVATE_COMMITMENT,
              at: instant(1_799_006_000_000),
              seq: 9,
            },
          },
        ],
        currentDeliveryId: undefined,
        completedAt: undefined,
        createdAt: instant(1_799_002_000_000),
        lastSeq: 14,
      },
    ],
    eventIds: [
      RATIFICATION_ID,
      OLD_OFFER_ID,
      EVIDENCE_ID,
      DELIVERY_ID,
      PAUSE_ID,
      HELP_ID,
      CURRENT_OFFER_ID,
    ],
    lastSeq: 14,
  };
}

describe('presentación pública de objeciones', () => {
  it('conserva la prueba sin exponer identificadores internos en la interfaz', () => {
    const dto = resultadoDto(resultadoConObjecion());
    expect(dto.pasos[0]?.explicacion).toBe('Queda 1 objeción admitida sin integrar.');
    expect(dto.tablas[0]?.columnas[0]).toBe('Referencia');
    expect(dto.tablas[0]?.filas[0]?.[0]).toBe('Objeción 1');
    expect(JSON.stringify(dto)).not.toContain(OBJECTION_ID);
  });
});

describe('presentación de la historia de tareas', () => {
  it('proyecta pausas y ayudas completas sin compromisos ni atribuciones privadas', () => {
    const dto = iniciativaDto(INITIATIVE_ID, iniciativaConHistoria(), DELIVERER);
    const task = dto.tareas[0]!;

    expect(task.pausas).toStrictEqual([
      {
        id: PAUSE_ID,
        tipo: 'bloqueo',
        categoria: 'recurso',
        iniciadaEn: 1_799_007_000_000,
        finalizadaEn: 1_799_008_000_000,
        causaDeFin: 'reasignacion',
      },
    ]);
    expect(task.solicitudesDeAyuda).toStrictEqual([
      {
        id: HELP_ID,
        pausaId: PAUSE_ID,
        categoria: 'revision',
        solicitadaEn: 1_799_007_500_000,
      },
    ]);
    expect(JSON.stringify(task)).not.toContain(PRIVATE_COMMITMENT);
    expect(task.solicitudesDeAyuda[0]).not.toHaveProperty('solicitadaPor');
    expect(task.entregas[0]).not.toHaveProperty('entregadaPor');
  });

  it('autoriza cada resumen por quien entregó, no por la asignación vigente', () => {
    const state = iniciativaConHistoria();
    const paraQuienEntrego = iniciativaDto(INITIATIVE_ID, state, DELIVERER).tareas[0]!;
    const paraOfertaVigente = iniciativaDto(INITIATIVE_ID, state, CURRENT_RECIPIENT).tareas[0]!;
    const paraResponsable = iniciativaDto(INITIATIVE_ID, state, RESPONSIBLE).tareas[0]!;

    expect(paraQuienEntrego.esMia).toBe(false);
    expect(paraQuienEntrego.entregas[0]?.puedeAbrirse).toBe(true);
    expect(paraOfertaVigente.esMia).toBe(true);
    expect(paraOfertaVigente.entregas[0]?.puedeAbrirse).toBe(false);
    expect(paraResponsable.entregas[0]?.puedeAbrirse).toBe(true);
    expect(iniciativaDto(INITIATIVE_ID, state).tareas[0]?.entregas[0]?.puedeAbrirse).toBe(false);
  });
});
