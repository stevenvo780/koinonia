/**
 * El contrato de evaluación, resultado y aprendizajes (ADR-0053).
 *
 * Tres cosas se comprueban, y las tres son las que de verdad pueden romperse en silencio:
 *
 *  1. **El vocabulario no se desvía del dominio.** Cada `z.enum` de este contrato repite, a mano,
 *     los mismos literales que `packages/domain/src/evaluation`. Si alguien cambia uno de los dos
 *     lados sin el otro, esta prueba lo dice — no hace falta acordarse de mirarlo.
 *  2. **La asimetría del contrato no se relaja.** `publicarResultado` no tiene forma de llevar un
 *     desenlace: es la firma la que lo impide, y esta prueba comprueba la firma, no una intención.
 *  3. **La regla de oro (ADR-0041).** Ningún literal del vocabulario cae en `FORBIDDEN_UI_TERMS`.
 */

import {
  AGREEMENT_DISPOSITIONS,
  CRITERION_VERDICTS,
  ESCALATION_RUNGS,
  ESCALATION_TARGET_KINDS,
  EVALUATION_OUTCOMES,
  LEARNING_KINDS,
  OUTCOME_CRITERION_EVIDENCE,
} from '@koinonia/domain';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  abrirEvaluacion,
  anotarAprendizaje,
  cerrarEvaluacion,
  consultaDeAprendizajes,
  desenlaceEvaluacion,
  disposicionAcuerdo,
  entradaDeMemoria,
  escalarEvaluacion,
  escalonEvaluacion,
  estadoDeEvaluacion,
  etiquetaDeAprendizaje,
  evidenciaCriterio,
  informeDeEvaluacion,
  objetoDeEscalada,
  publicarResultado,
  tipoDeAprendizaje,
  valorarCriterio,
  veredictoCriterio,
} from '../src/evaluacion.js';
import { forbiddenTermsIn } from '../src/glossary.js';

function ordenados(valores: readonly string[]): readonly string[] {
  return [...valores].sort();
}

describe('vocabulario: el contrato no se desvía del dominio', () => {
  it('veredictoCriterio == CRITERION_VERDICTS', () => {
    expect(ordenados(veredictoCriterio.options)).toEqual(ordenados(CRITERION_VERDICTS));
  });

  it('evidenciaCriterio == OUTCOME_CRITERION_EVIDENCE (ADR-0045)', () => {
    expect(ordenados(evidenciaCriterio.options)).toEqual(ordenados(OUTCOME_CRITERION_EVIDENCE));
  });

  it('desenlaceEvaluacion == EVALUATION_OUTCOMES', () => {
    expect(ordenados(desenlaceEvaluacion.options)).toEqual(ordenados(EVALUATION_OUTCOMES));
  });

  it('disposicionAcuerdo == AGREEMENT_DISPOSITIONS (ADR-0033)', () => {
    expect(ordenados(disposicionAcuerdo.options)).toEqual(ordenados(AGREEMENT_DISPOSITIONS));
  });

  it('escalonEvaluacion == ESCALATION_RUNGS: sólo los dos que no hablan por nadie (ADR-0040)', () => {
    expect(ordenados(escalonEvaluacion.options)).toEqual(ordenados(ESCALATION_RUNGS));
    expect(escalonEvaluacion.options).not.toContain('dominio-suspendido');
  });

  it('objetoDeEscalada == ESCALATION_TARGET_KINDS', () => {
    expect(ordenados(objetoDeEscalada.options)).toEqual(ordenados(ESCALATION_TARGET_KINDS));
  });

  it('tipoDeAprendizaje == LEARNING_KINDS', () => {
    expect(ordenados(tipoDeAprendizaje.options)).toEqual(ordenados(LEARNING_KINDS));
  });

  it('estadoDeEvaluacion trae los tres estados escritos MÁS el que nadie escribe', () => {
    expect(estadoDeEvaluacion.options).toEqual(
      expect.arrayContaining(['en-curso', 'publicada', 'cerrada', 'anulada-por-inconsistencia']),
    );
    expect(estadoDeEvaluacion.options).toHaveLength(4);
  });
});

describe('la regla de oro (ADR-0041): ningún literal cae en el vocabulario prohibido', () => {
  const literales = [
    ...veredictoCriterio.options,
    ...evidenciaCriterio.options,
    ...desenlaceEvaluacion.options,
    ...disposicionAcuerdo.options,
    ...escalonEvaluacion.options,
    ...objetoDeEscalada.options,
    ...tipoDeAprendizaje.options,
    ...estadoDeEvaluacion.options,
  ];

  it.each(literales)('%s no lleva jerga del motor', (literal) => {
    expect(forbiddenTermsIn(literal)).toEqual([]);
  });
});

describe('publicarResultado: la asimetría del ADR-0026 en la firma', () => {
  it('no admite un campo de desenlace ni ningún otro campo extra', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(publicarResultado.parse({ requestId: id })).toEqual({ requestId: id });
    expect(() => publicarResultado.parse({ requestId: id, outcome: 'logrado' })).toThrow(
      z.ZodError,
    );
    expect(() => publicarResultado.parse({ requestId: id, desenlace: 'logrado' })).toThrow(
      z.ZodError,
    );
  });
});

describe('valorarCriterio: la evidencia se recibe, la exigencia la aplica el motor', () => {
  const id = '22222222-2222-4222-8222-222222222222';
  const hecho = 'a'.repeat(32);

  it('acepta un veredicto sin hecho que lo sostenga (el motor decide si eso basta)', () => {
    const resultado = valorarCriterio.parse({
      requestId: id,
      veredicto: 'sin-evidencia',
      evidencia: 'sin-verificar',
    });
    expect(resultado.hechoQueLoSostieneId).toBeUndefined();
  });

  it('acepta el hecho como un identificador opaco de 32 hex', () => {
    const resultado = valorarCriterio.parse({
      requestId: id,
      veredicto: 'cumplido',
      evidencia: 'verificada',
      hechoQueLoSostieneId: hecho,
    });
    expect(resultado.hechoQueLoSostieneId).toBe(hecho);
  });

  it('rechaza un veredicto fuera del vocabulario cerrado', () => {
    expect(() =>
      valorarCriterio.parse({ requestId: id, veredicto: 'aprobado', evidencia: 'verificada' }),
    ).toThrow(z.ZodError);
  });

  it('rechaza campos que el motor no conoce', () => {
    expect(() =>
      valorarCriterio.parse({
        requestId: id,
        veredicto: 'cumplido',
        evidencia: 'verificada',
        hechoQueLoSostieneId: hecho,
        responsableId: hecho,
      }),
    ).toThrow(z.ZodError);
  });
});

describe('escalarEvaluacion: el objeto es la tarea, el acuerdo o la carga, nunca alguien', () => {
  const id = '33333333-3333-4333-8333-333333333333';
  const tarea = 'b'.repeat(32);

  it('acepta una tarea con su identificador', () => {
    const resultado = escalarEvaluacion.parse({
      requestId: id,
      escalon: 'consultada',
      objeto: 'tarea',
      tareaId: tarea,
    });
    expect(resultado.tareaId).toBe(tarea);
  });

  it('acepta el acuerdo o la carga sin tarea', () => {
    expect(
      escalarEvaluacion.parse({ requestId: id, escalon: 'consultada', objeto: 'acuerdo' }).tareaId,
    ).toBeUndefined();
  });

  it('rechaza «dominio-suspendido»: no está en el vocabulario y no debe estarlo (ADR-0040)', () => {
    expect(() =>
      escalarEvaluacion.parse({ requestId: id, escalon: 'dominio-suspendido', objeto: 'tarea' }),
    ).toThrow(z.ZodError);
  });
});

describe('anotarAprendizaje: sin autor, con etiquetas canónicas', () => {
  const id = '44444444-4444-4444-8444-444444444444';
  const enunciadoLargo =
    'Convocar la revisión el mismo día que vence la fecha comprometida deja demasiado poco ' +
    'margen para reunir evidencia a tiempo.';

  it('acepta un enunciado dentro del rango y etiquetas válidas', () => {
    const resultado = anotarAprendizaje.parse({
      requestId: id,
      tipo: 'lo-que-no-funciono',
      enunciado: enunciadoLargo,
      etiquetas: ['convocatoria', 'tiempos'],
    });
    expect(resultado.etiquetas).toEqual(['convocatoria', 'tiempos']);
  });

  it('rechaza un enunciado demasiado corto: por debajo del mínimo del dominio', () => {
    expect(() =>
      anotarAprendizaje.parse({
        requestId: id,
        tipo: 'lo-que-funciono',
        enunciado: 'muy corto',
        etiquetas: [],
      }),
    ).toThrow(z.ZodError);
  });

  it('rechaza una etiqueta con mayúsculas o espacios', () => {
    expect(() =>
      anotarAprendizaje.parse({
        requestId: id,
        tipo: 'lo-que-funciono',
        enunciado: enunciadoLargo,
        etiquetas: ['Con Espacio'],
      }),
    ).toThrow(z.ZodError);
  });
});

describe('cerrarEvaluacion: mantener exige la próxima fecha (el motor la exige; el contrato la deja pasar)', () => {
  it('acepta derogar sin próxima fecha', () => {
    const resultado = cerrarEvaluacion.parse({
      requestId: '55555555-5555-4555-8555-555555555555',
      disposicion: 'derogar',
    });
    expect(resultado.proximaRevisionEn).toBeUndefined();
  });

  it('acepta mantener con próxima fecha', () => {
    const resultado = cerrarEvaluacion.parse({
      requestId: '55555555-5555-4555-8555-555555555555',
      disposicion: 'mantener',
      proximaRevisionEn: 1_800_000_000_000,
    });
    expect(resultado.proximaRevisionEn).toBe(1_800_000_000_000);
  });
});

describe('consultaDeAprendizajes: «¿esto ya se intentó?», del todo opcional', () => {
  it('acepta el objeto vacío', () => {
    expect(consultaDeAprendizajes.parse({})).toEqual({});
  });

  it('acepta filtrar por etiqueta, tipo y desenlace a la vez', () => {
    const resultado = consultaDeAprendizajes.parse({
      etiqueta: 'convocatoria',
      tipo: 'lo-que-no-funciono',
      desenlace: 'fallido',
    });
    expect(resultado).toEqual({
      etiqueta: 'convocatoria',
      tipo: 'lo-que-no-funciono',
      desenlace: 'fallido',
    });
  });
});

describe('etiquetaDeAprendizaje', () => {
  it.each(['convocatoria', 'a', 'con_guion_bajo', 'z'.repeat(32)])('%s es válida', (valor) => {
    expect(() => etiquetaDeAprendizaje.parse(valor)).not.toThrow();
  });

  it.each(['', 'Mayuscula', 'con espacio', 'con-guion', 'ñoño', 'z'.repeat(33)])(
    '%s no es válida',
    (valor) => {
      expect(() => etiquetaDeAprendizaje.parse(valor)).toThrow(z.ZodError);
    },
  );
});

describe('informeDeEvaluacion y entradaDeMemoria: la forma completa no lleva a nadie', () => {
  const opaco = 'c'.repeat(32);

  it('acepta un informe realista, con discrepancia y todo', () => {
    const informe = informeDeEvaluacion.parse({
      evaluacionId: opaco,
      iniciativaId: opaco,
      huellaDelPlan: 'd'.repeat(64),
      estado: 'anulada-por-inconsistencia',
      revisarEn: 1_780_000_000_000,
      desenlace: 'fallido',
      desenlacePublicado: 'logrado',
      discrepancia: {
        motivo: 'resultado-no-coincide',
        publicado: 'logrado',
        recalculado: 'fallido',
        explicacion: 'el resultado guardado no corresponde a los hechos anotados',
      },
      criterios: [
        {
          indice: 0,
          descripcion: 'La sala abre hasta las nueve al menos tres días por semana.',
          fuenteDeVerificacion: 'Horario oficial publicado por el Instituto',
          veredicto: 'incumplido',
        },
      ],
      proporcionCumplida: { numerador: 0, denominador: 1 },
      aprendizajes: [],
      escaladas: [],
      narrativa:
        'No se cumplió lo que se acordó. Además, lo guardado no corresponde a estos hechos.',
    });
    expect(informe.estado).toBe('anulada-por-inconsistencia');
  });

  it('no admite ningún campo de persona: la forma no tiene dónde ponerla', () => {
    const claves = Object.keys(informeDeEvaluacion.shape);
    for (const prohibida of ['actor', 'responsableId', 'autorId', 'miembroId']) {
      expect(claves).not.toContain(prohibida);
    }
  });

  it('acepta una entrada de memoria sin autor', () => {
    const entrada = entradaDeMemoria.parse({
      evaluacionId: opaco,
      iniciativaId: opaco,
      decisionId: opaco,
      propuestaId: opaco,
      circuloId: opaco,
      desenlace: 'parcial',
      disposicion: 'enmendar',
      aprendizaje: {
        id: opaco,
        tipo: 'lo-que-faltaba-saber',
        enunciado: 'Hacía falta saber esto de antemano.',
        etiquetas: [],
        en: 1_780_000_000_000,
      },
    });
    expect(Object.keys(entrada)).not.toContain('autorId');
  });
});

describe('abrirEvaluacion', () => {
  it('sólo lleva requestId: los criterios, el número y la fecha salen del plan, no de quien convoca', () => {
    const claves = Object.keys(abrirEvaluacion.shape);
    expect(claves).toEqual(['requestId']);
  });
});
