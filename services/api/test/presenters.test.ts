import { decisionId, hash, ratio, type DecisionResult } from '@koinonia/domain';
import { describe, expect, it } from 'vitest';

import { resultadoDto } from '../src/http/presenters.js';

const OBJECTION_ID = 'abcdef0123456789abcdef0123456789';

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

describe('presentación pública de objeciones', () => {
  it('conserva la prueba sin exponer identificadores internos en la interfaz', () => {
    const dto = resultadoDto(resultadoConObjecion());
    expect(dto.pasos[0]?.explicacion).toBe('Queda 1 objeción admitida sin integrar.');
    expect(dto.tablas[0]?.columnas[0]).toBe('Referencia');
    expect(dto.tablas[0]?.filas[0]?.[0]).toBe('Objeción 1');
    expect(JSON.stringify(dto)).not.toContain(OBJECTION_ID);
  });
});
