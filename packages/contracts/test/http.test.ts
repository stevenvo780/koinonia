import { describe, expect, it } from 'vitest';

import {
  crearPropuesta,
  decisionDetalle,
  iniciativaDetalle,
  planEjecucion,
  resultadoDecision,
  versionPropuesta,
} from '../src/http.js';

const id = '0123456789abcdef0123456789abcdef';
const huella = 'a'.repeat(64);

const plan = {
  objetivo: 'Extender el horario de la sala de estudio para la jornada nocturna.',
  responsableId: id,
  revisarEn: 1_800_000_000_000,
  criteriosDeExito: [
    {
      descripcion: 'La sala abre hasta las nueve de la noche tres días por semana.',
      fuenteDeVerificacion: 'Horario publicado',
    },
  ],
};

describe('contrato HTTP de propuestas e iniciativas', () => {
  it('acepta un plan de ejecución verificable', () => {
    expect(planEjecucion.parse(plan)).toEqual(plan);
  });

  it('rechaza un objetivo demasiado corto y un plan sin criterios', () => {
    expect(planEjecucion.safeParse({ ...plan, objetivo: 'Muy corto' }).success).toBe(false);
    expect(planEjecucion.safeParse({ ...plan, criteriosDeExito: [] }).success).toBe(false);
  });

  it('rechaza un responsable inválido', () => {
    expect(planEjecucion.safeParse({ ...plan, responsableId: 'responsable' }).success).toBe(false);
  });

  it('exige un plan al crear una propuesta', () => {
    const propuesta = {
      requestId: '123e4567-e89b-42d3-a456-426614174000',
      problemaId: id,
      titulo: 'Abrir más tiempo la sala de estudio',
      cuerpo: 'Pedimos extender el horario para que quienes estudian de noche tengan dónde leer.',
    };

    expect(crearPropuesta.safeParse(propuesta).success).toBe(false);
    expect(crearPropuesta.parse({ ...propuesta, plan }).plan).toEqual(plan);
  });

  it('mantiene legibles versiones y decisiones históricas sin inventarles un plan', () => {
    expect(
      versionPropuesta.parse({
        version: 1,
        titulo: 'Una versión escrita antes del plan obligatorio',
        cuerpo: 'Este texto histórico sigue siendo legible aunque todavía no incluyera un plan.',
        huella,
        cuando: 1_700_000_000_000,
      }).plan,
    ).toBeUndefined();

    expect(
      decisionDetalle.parse({
        id,
        propuestaId: id,
        titulo: 'Una decisión histórica que conserva su contexto',
        estado: 'Closed',
        metodo: 'simple-majority',
        abreEn: 1_700_000_000_000,
        cierraEn: 1_700_003_600_000,
        huellaVersion: huella,
        podianDecidir: 3,
        seManifestaron: 3,
        queHaceFaltaParaQuePase: 'Más respuestas afirmativas que negativas.',
        cuerpoVersion:
          'La decisión se conserva tal como ocurrió, sin completar retroactivamente lo que faltaba.',
        puedoDecidir: false,
      }).plan,
    ).toBeUndefined();
  });

  it('acepta la iniciativa creada y enlaza opcionalmente el resultado', () => {
    const iniciativa = {
      id,
      decisionId: id,
      propuestaId: id,
      circuloId: id,
      objetivo: plan.objetivo,
      responsableId: id,
      revisarEn: plan.revisarEn,
      criteriosDeExito: plan.criteriosDeExito,
      estado: 'por-empezar',
      creadaEn: 1_700_000_000_000,
      comprobanteDecision: huella,
      comprobanteVersion: huella,
    };

    expect(iniciativaDetalle.parse(iniciativa)).toEqual(iniciativa);
    expect(
      resultadoDecision.parse({
        decisionId: id,
        iniciativaId: id,
        desenlace: 'approved',
        desenlaceEnPalabras: 'Aprobada',
        relato: 'La propuesta alcanzó la participación y el apoyo requeridos.',
        pasos: [],
        tablas: [],
        participacion: { emitidas: 3, representadas: 3, podianDecidir: 4 },
        comprobante: huella,
        comprobanteReglas: huella,
        comprobanteLista: huella,
      }).iniciativaId,
    ).toBe(id);
  });
});
