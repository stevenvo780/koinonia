/**
 * Las dos tablas de la deliberación, recorridas enteras.
 *
 * Lo que se prueba aquí no es «el camino feliz avanza»: es que **toda** pareja ausente de la tabla
 * se rechaza. Por eso los recorridos son productos cartesianos completos y no una lista de casos
 * elegidos a mano: un caso elegido a mano prueba lo que quien lo escribió ya sospechaba.
 *
 * ═══ Prueba retirada en ADR-0049, y por qué ═══
 *
 * Una: «la autoría sólo se sella en `perspectivas`». Ya no hay sellado, y la tabla de etapas dejó de
 * declarar nada sobre autoría a propósito —esa regla vive entera en `access.ts`, para que no haya
 * dos fuentes de verdad que puedan contradecirse—. Lo que aquella prueba defendía se prueba ahora en
 * `deliberation-authorship.test.ts` y en `access.test.ts`, sobre la regla de autorización.
 *
 * Las demás siguen aquí, con los números actualizados a **seis** etapas: desapareció
 * `perspectivas_revelando`, que sólo existía para destapar autorías.
 */

import { describe, expect, it } from 'vitest';

import { IllegalTransitionError } from '../src/errors.js';
import {
  assertBodyAllowedInStage,
  assertStageTransition,
  CONTRIBUTION_KINDS,
  type ContributionBody,
  type ContributionId,
  contributionId,
  type ContributionKind,
  DELIBERATION_STAGES,
  type DeliberationStage,
  isLegalStageTransition,
  isTerminalStage,
  nextStage,
  STAGE_RULES,
  STAGE_TRANSITIONS,
  stageAdmits,
  stageRule,
  stagesWithoutWriting,
  TERMINAL_STAGE,
} from '../src/deliberation/index.js';

const hex32 = (n: number): string => n.toString(16).padStart(32, '0');
const cid = (n: number): ContributionId => contributionId(hex32(0x7000 + n));

const TEXT = 'Un aporte de prueba con longitud más que suficiente para el mínimo del historial.';

/** Un cuerpo mínimo válido de cada tipo. Las aristas apuntan a identificadores cualesquiera: esta
 *  tabla no mira el estado, sólo el permiso de etapa. */
function bodyOf(
  kind: ContributionKind,
  mode: 'pregunta_aclaratoria' | 'afirmacion',
): ContributionBody {
  switch (kind) {
    case 'posicion':
      return { kind: 'posicion', mode, text: TEXT };
    case 'razon':
      return {
        kind: 'razon',
        relation: mode === 'pregunta_aclaratoria' ? 'responde' : 'sostiene',
        positionId: cid(1),
        text: TEXT,
      };
    case 'evidencia':
      return { kind: 'evidencia', supportsReasonId: cid(2), text: TEXT };
    case 'supuesto':
      return { kind: 'supuesto', appliesToContributionIds: [cid(1)], text: TEXT };
    case 'riesgo':
      return {
        kind: 'riesgo',
        alternativeId: cid(3),
        severity: 3,
        impact: TEXT,
        mitigation: TEXT,
      };
    case 'alternativa':
      return {
        kind: 'alternativa',
        problemId: hex32(0xb1),
        sourcePositionIds: [cid(1)],
        text: TEXT,
      };
  }
}

describe('máquina de etapas', () => {
  it('la cadena es exactamente la del diseño, sin atajos ni vueltas', () => {
    expect(STAGE_TRANSITIONS.map((t) => [t.from, t.to])).toEqual([
      ['preguntas_aclaratorias', 'perspectivas'],
      ['perspectivas', 'construccion_alternativas'],
      ['construccion_alternativas', 'objeciones'],
      ['objeciones', 'enmiendas'],
      ['enmiendas', 'listo_para_decidir'],
    ]);
  });

  it('las seis etapas son las del diseño y en ese orden', () => {
    expect(DELIBERATION_STAGES).toEqual([
      'preguntas_aclaratorias',
      'perspectivas',
      'construccion_alternativas',
      'objeciones',
      'enmiendas',
      'listo_para_decidir',
    ]);
  });

  it('sólo el sucesor exacto es legal: producto cartesiano completo Etapa × Etapa', () => {
    for (const from of DELIBERATION_STAGES) {
      for (const to of DELIBERATION_STAGES) {
        const expected = nextStage(from) === to;
        expect(isLegalStageTransition(from, to)).toBe(expected);
        if (expected) {
          expect(() => {
            assertStageTransition(from, to);
          }).not.toThrow();
        } else {
          expect(() => {
            assertStageTransition(from, to);
          }).toThrow(IllegalTransitionError);
        }
      }
    }
  });

  it('ninguna transición ilegal se acepta, y todas dan el mismo código estable', () => {
    const ilegales: [DeliberationStage, DeliberationStage][] = [];
    for (const from of DELIBERATION_STAGES) {
      for (const to of DELIBERATION_STAGES) {
        if (nextStage(from) !== to) ilegales.push([from, to]);
      }
    }
    // 6 × 6 = 36 parejas, de las cuales 5 son legales.
    expect(ilegales).toHaveLength(31);
    for (const [from, to] of ilegales) {
      expect(() => {
        assertStageTransition(from, to);
      }).toThrow(expect.objectContaining({ code: 'ILLEGAL_TRANSITION' }));
    }
  });

  it('`listo_para_decidir` es terminal: no tiene sucesor y no sale de ahí', () => {
    expect(TERMINAL_STAGE).toBe('listo_para_decidir');
    expect(isTerminalStage('listo_para_decidir')).toBe(true);
    expect(nextStage('listo_para_decidir')).toBeUndefined();
    for (const to of DELIBERATION_STAGES) {
      expect(isLegalStageTransition('listo_para_decidir', to)).toBe(false);
    }
  });

  it('no se puede volver atrás ni saltar dos etapas', () => {
    expect(isLegalStageTransition('perspectivas', 'preguntas_aclaratorias')).toBe(false);
    expect(isLegalStageTransition('perspectivas', 'objeciones')).toBe(false);
    expect(isLegalStageTransition('preguntas_aclaratorias', 'listo_para_decidir')).toBe(false);
  });
});

describe('tabla de qué admite cada etapa', () => {
  it('reproduce literalmente la tabla del diseño', () => {
    expect(STAGE_RULES.preguntas_aclaratorias.kinds).toEqual(['posicion', 'razon', 'evidencia']);
    expect(STAGE_RULES.preguntas_aclaratorias.positionModes).toEqual(['pregunta_aclaratoria']);
    expect(STAGE_RULES.preguntas_aclaratorias.reasonRelations).toEqual(['responde']);

    expect(STAGE_RULES.perspectivas.kinds).toEqual(['posicion', 'razon', 'evidencia', 'supuesto']);
    expect(STAGE_RULES.perspectivas.positionModes).toEqual(['afirmacion']);
    expect(STAGE_RULES.perspectivas.reasonRelations).toEqual(['sostiene']);

    expect(STAGE_RULES.construccion_alternativas.kinds).toEqual([
      'alternativa',
      'posicion',
      'razon',
      'evidencia',
      'supuesto',
    ]);

    expect(STAGE_RULES.objeciones.kinds).toEqual(['riesgo', 'razon', 'evidencia', 'supuesto']);

    expect(STAGE_RULES.enmiendas.kinds).toEqual(['alternativa', 'razon', 'evidencia', 'supuesto']);
    expect(STAGE_RULES.enmiendas.alternativeMustSupersede).toBe(true);

    expect(STAGE_RULES.listo_para_decidir.kinds).toEqual([]);
  });

  it('la única etapa sin escritura es la terminal', () => {
    expect(stagesWithoutWriting()).toEqual(['listo_para_decidir']);
  });

  it('la tabla está congelada: nadie le añade un tipo en tiempo de ejecución', () => {
    expect(Object.isFrozen(STAGE_RULES)).toBe(true);
    expect(Object.isFrozen(STAGE_RULES.objeciones.kinds)).toBe(true);
    expect(() => {
      (STAGE_RULES.objeciones.kinds as ContributionKind[]).push('alternativa');
    }).toThrow(TypeError);
  });

  it('producto cartesiano completo Etapa × TipoDeAporte: sólo pasa lo tabulado', () => {
    let admitidos = 0;
    for (const stage of DELIBERATION_STAGES) {
      for (const kind of CONTRIBUTION_KINDS) {
        // Se elige el modo/relación que la etapa admite, para aislar la comprobación de TIPO.
        const rule = stageRule(stage);
        const mode = rule.positionModes.includes('afirmacion')
          ? ('afirmacion' as const)
          : ('pregunta_aclaratoria' as const);
        const body = bodyOf(kind, mode);
        const supersedes = kind === 'alternativa' ? cid(9) : undefined;
        if (stageAdmits(stage, kind)) {
          admitidos += 1;
          expect(() => {
            assertBodyAllowedInStage(stage, body, supersedes);
          }).not.toThrow();
        } else {
          expect(() => {
            assertBodyAllowedInStage(stage, body, supersedes);
          }).toThrow(expect.objectContaining({ code: 'CONTRIBUTION_KIND_NOT_ALLOWED' }));
        }
      }
    }
    // 3 + 4 + 5 + 4 + 4 + 0 = 20 combinaciones admitidas de 36.
    expect(admitidos).toBe(20);
  });

  it('preguntar y afirmar no son intercambiables aunque ambas sean `posicion`', () => {
    expect(() => {
      assertBodyAllowedInStage(
        'preguntas_aclaratorias',
        bodyOf('posicion', 'afirmacion'),
        undefined,
      );
    }).toThrow(expect.objectContaining({ code: 'POSITION_MODE_NOT_ALLOWED' }));

    expect(() => {
      assertBodyAllowedInStage(
        'perspectivas',
        bodyOf('posicion', 'pregunta_aclaratoria'),
        undefined,
      );
    }).toThrow(expect.objectContaining({ code: 'POSITION_MODE_NOT_ALLOWED' }));
  });

  it('una razón que `sostiene` no cabe en la etapa de preguntas, y al revés', () => {
    expect(() => {
      assertBodyAllowedInStage('preguntas_aclaratorias', bodyOf('razon', 'afirmacion'), undefined);
    }).toThrow(expect.objectContaining({ code: 'REASON_RELATION_NOT_ALLOWED' }));

    expect(() => {
      assertBodyAllowedInStage('perspectivas', bodyOf('razon', 'pregunta_aclaratoria'), undefined);
    }).toThrow(expect.objectContaining({ code: 'REASON_RELATION_NOT_ALLOWED' }));
  });

  it('en `enmiendas` una alternativa que no enmienda nada se rechaza', () => {
    expect(() => {
      assertBodyAllowedInStage('enmiendas', bodyOf('alternativa', 'afirmacion'), undefined);
    }).toThrow(expect.objectContaining({ code: 'AMENDMENT_MUST_SUPERSEDE' }));

    expect(() => {
      assertBodyAllowedInStage('enmiendas', bodyOf('alternativa', 'afirmacion'), cid(9));
    }).not.toThrow();
  });

  it('en `construccion_alternativas` una alternativa NO necesita superseder a nadie', () => {
    expect(() => {
      assertBodyAllowedInStage(
        'construccion_alternativas',
        bodyOf('alternativa', 'afirmacion'),
        undefined,
      );
    }).not.toThrow();
  });

  it('la etapa terminal rechaza los seis tipos', () => {
    for (const kind of CONTRIBUTION_KINDS) {
      expect(() => {
        assertBodyAllowedInStage('listo_para_decidir', bodyOf(kind, 'afirmacion'), cid(9));
      }).toThrow(expect.objectContaining({ code: 'CONTRIBUTION_KIND_NOT_ALLOWED' }));
    }
  });
});
