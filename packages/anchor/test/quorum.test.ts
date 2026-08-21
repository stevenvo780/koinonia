/**
 * La política de quórum, comprobada por propiedades.
 *
 * Los ejemplos sueltos prueban los casos que se nos ocurrieron. La propiedad prueba **todos**, y la
 * que importa aquí es exactamente el error que hace inútil el anclaje múltiple:
 *
 *     ninguna combinación con menos de DOS clases distintas puede declarar FIRME,
 *     por muchos recibos confirmados que haya.
 *
 * Cinco confirmaciones perfectas de cinco proveedores que son todos `blockchain` siguen siendo un
 * solo modo de falla. Si esta propiedad se rompiera, todo el paquete sería decorado.
 */

import {
  ALERT_HOURS,
  CRITICAL_HOURS,
  evaluateQuorum,
  INDEPENDENCE_CLASSES,
  MIN_INDEPENDENCE_CLASSES,
  type AnchorEvidence,
  type IndependenceClass,
  type VerificationStatus,
} from '@koinonia/anchor';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

const HEX = 'a'.repeat(64);
const OTRO_HEX = 'b'.repeat(64);
const EMISION = '2026-08-21T00:00:00.000Z';

function enHoras(horas: number): string {
  return new Date(Date.parse(EMISION) + horas * 3_600_000).toISOString();
}

function evaluar(
  evidence: readonly AnchorEvidence[],
  horas = 1,
): ReturnType<typeof evaluateQuorum> {
  return evaluateQuorum(evidence, {
    checkpointHash: HEX,
    issuedAt: EMISION,
    now: enHoras(horas),
  });
}

function confirmado(provider: string, independenceClass: IndependenceClass): AnchorEvidence {
  return {
    provider,
    independenceClass,
    status: 'confirmado',
    signingKeyOffHost: true,
    checkpointHash: HEX,
  };
}

const ESTADOS: readonly VerificationStatus[] = [
  'confirmado',
  'pendiente',
  'incompleto',
  'invalido',
];

const arbEvidencia: fc.Arbitrary<AnchorEvidence> = fc.record({
  provider: fc.stringMatching(/^[a-z][a-z0-9_]{0,10}$/u),
  independenceClass: fc.constantFrom(...INDEPENDENCE_CLASSES),
  status: fc.constantFrom(...ESTADOS),
  signingKeyOffHost: fc.boolean(),
  checkpointHash: fc.constantFrom(HEX, OTRO_HEX),
});

describe('quórum — propiedades', () => {
  it('FIRME si y sólo si hay al menos 2 CLASES distintas confirmadas', () => {
    fc.assert(
      fc.property(fc.array(arbEvidencia, { maxLength: 12 }), (evidencia) => {
        const veredicto = evaluar(evidencia);
        expect(veredicto.firm).toBe(veredicto.confirmedClasses.length >= MIN_INDEPENDENCE_CLASSES);
        // Las clases contadas nunca se repiten.
        expect(new Set(veredicto.confirmedClasses).size).toBe(veredicto.confirmedClasses.length);
      }),
      { numRuns: 400 },
    );
  });

  it('NINGUNA cantidad de recibos de UNA SOLA clase declara FIRME', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...INDEPENDENCE_CLASSES),
        fc.array(fc.stringMatching(/^[a-z][a-z0-9_]{0,8}$/u), { minLength: 1, maxLength: 8 }),
        (klass, proveedores) => {
          const evidencia = [...new Set(proveedores)].map((p) => confirmado(p, klass));
          const veredicto = evaluar(evidencia);
          expect(veredicto.firm).toBe(false);
          expect(veredicto.confirmedClasses).toStrictEqual([klass]);
          // Todos los descartes de más son por «clase-repetida», no por otra cosa.
          for (const descarte of veredicto.rejected) {
            expect(descarte.reason).toBe('clase-repetida');
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('un anclaje con la clave en el servidor verificado NUNCA cuenta', () => {
    fc.assert(
      fc.property(fc.array(arbEvidencia, { maxLength: 10 }), (evidencia) => {
        const conClaveDentro = evidencia.map((e) => ({ ...e, signingKeyOffHost: false }));
        const veredicto = evaluar(conClaveDentro);
        expect(veredicto.firm).toBe(false);
        expect(veredicto.confirmedClasses).toStrictEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  it('sólo `confirmado` cuenta: `pendiente`, `incompleto` e `invalido` no', () => {
    fc.assert(
      fc.property(fc.array(arbEvidencia, { maxLength: 10 }), (evidencia) => {
        const veredicto = evaluar(evidencia);
        for (const provider of veredicto.countedProviders) {
          const origen = evidencia.find((e) => e.provider === provider);
          expect(origen?.status).toBe('confirmado');
        }
      }),
      { numRuns: 300 },
    );
  });

  it('un recibo de OTRO checkpoint no cuenta jamás', () => {
    fc.assert(
      fc.property(fc.array(arbEvidencia, { minLength: 1, maxLength: 8 }), (evidencia) => {
        const ajenos = evidencia.map((e) => ({ ...e, checkpointHash: OTRO_HEX }));
        const veredicto = evaluar(ajenos);
        expect(veredicto.firm).toBe(false);
        expect(veredicto.rejected.every((r) => r.reason === 'checkpoint-distinto')).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('el veredicto es determinista y no depende del orden de la evidencia', () => {
    fc.assert(
      fc.property(
        fc.array(arbEvidencia, { maxLength: 8 }),
        fc.array(fc.integer(), { maxLength: 8 }),
        (evidencia, semillas) => {
          const barajada = [...evidencia]
            .map((valor, i) => ({ valor, orden: semillas[i] ?? i }))
            .sort((a, b) => a.orden - b.orden)
            .map((x) => x.valor);
          expect(evaluar(barajada).firm).toBe(evaluar(evidencia).firm);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('todo elemento de la evidencia acaba contado o descartado con motivo, nunca en el limbo', () => {
    fc.assert(
      fc.property(fc.array(arbEvidencia, { maxLength: 12 }), (evidencia) => {
        const veredicto = evaluar(evidencia);
        expect(veredicto.countedProviders.length + veredicto.rejected.length).toBe(
          evidencia.length,
        );
      }),
      { numRuns: 300 },
    );
  });
});

describe('quórum — casos con nombre', () => {
  it('dos clases distintas: FIRME', () => {
    const veredicto = evaluar([confirmado('ots', 'blockchain'), confirmado('git', 'vcs')]);
    expect(veredicto.firm).toBe(true);
    expect(veredicto.state).toBe('FIRME');
    expect(veredicto.confirmedClasses).toStrictEqual(['blockchain', 'vcs']);
    expect(veredicto.explanation).toMatch(/Bitcoin y un repositorio público firmado/u);
  });

  it('dos recibos de la MISMA clase: NO firme, y el motivo lo dice', () => {
    const veredicto = evaluar([
      confirmado('ots_a', 'blockchain'),
      confirmado('ots_b', 'blockchain'),
    ]);
    expect(veredicto.firm).toBe(false);
    expect(veredicto.rejected[0]).toMatchObject({
      provider: 'ots_b',
      reason: 'clase-repetida',
    });
    expect(veredicto.rejected[0]!.detail).toMatch(/comparten modo de falla/u);
  });

  it('el mismo proveedor dos veces es un solo testigo', () => {
    const veredicto = evaluar([confirmado('ots', 'blockchain'), confirmado('ots', 'vcs')]);
    expect(veredicto.firm).toBe(false);
    expect(veredicto.rejected[0]!.reason).toBe('proveedor-repetido');
  });

  it('si el PRIMER recibo de un proveedor es basura, el segundo legítimo sigue contando', () => {
    // Sin esto, bastaría con colar un recibo inválido de `git` delante del bueno para anular el
    // anclaje de git sin tocar nada más. Lo encontró la prueba de propiedad de arriba.
    const veredicto = evaluar([
      { ...confirmado('git', 'vcs'), checkpointHash: OTRO_HEX },
      confirmado('git', 'vcs'),
      confirmado('ots', 'blockchain'),
    ]);
    expect(veredicto.firm).toBe(true);
    expect(veredicto.countedProviders).toStrictEqual(['ots', 'git']);
    expect(veredicto.rejected).toHaveLength(1);
    expect(veredicto.rejected[0]!.reason).toBe('checkpoint-distinto');
  });

  it('sin quórum: NO_ANCLADO desde el primer minuto, no a las 24 h', () => {
    expect(evaluar([], 0.1).state).toBe('NO_ANCLADO');
    expect(evaluar([], 0.1).decisionsPendingIntegrity).toBe(false);
  });

  it(`a las ${String(ALERT_HOURS)} h sin quórum el estado sube a alerta`, () => {
    expect(evaluar([], ALERT_HOURS - 0.01).state).toBe('NO_ANCLADO');
    expect(evaluar([], ALERT_HOURS).state).toBe('NO_ANCLADO_ALERTA');
    expect(evaluar([], ALERT_HOURS).explanation).toMatch(/todavía NO está protegido/u);
  });

  it(`a las ${String(CRITICAL_HOURS)} h las decisiones del lapso quedan pendientes de integridad`, () => {
    const veredicto = evaluar([], CRITICAL_HOURS);
    expect(veredicto.state).toBe('NO_ANCLADO_CRITICO');
    expect(veredicto.decisionsPendingIntegrity).toBe(true);
    expect(veredicto.explanation).toMatch(/PENDIENTES DE CONFIRMACIÓN DE INTEGRIDAD/u);
  });

  it('con quórum, la antigüedad no degrada nada', () => {
    const veredicto = evaluar(
      [confirmado('ots', 'blockchain'), confirmado('correo', 'human-witness')],
      CRITICAL_HOURS * 10,
    );
    expect(veredicto.state).toBe('FIRME');
    expect(veredicto.decisionsPendingIntegrity).toBe(false);
  });

  it('un reloj que va hacia atrás no rejuvenece un checkpoint viejo', () => {
    const veredicto = evaluateQuorum([], {
      checkpointHash: HEX,
      issuedAt: '2026-08-21T00:00:00.000Z',
      now: '2020-01-01T00:00:00.000Z',
    });
    expect(veredicto.hoursSinceIssued).toBe(0);
    expect(veredicto.state).toBe('NO_ANCLADO');
  });

  it('un instante mal formado se rechaza en vez de interpretarse a la ligera', () => {
    expect(() =>
      evaluateQuorum([], { checkpointHash: HEX, issuedAt: '2026-08-21', now: enHoras(1) }),
    ).toThrow(/RFC 3339 UTC exactos/u);
  });
});
