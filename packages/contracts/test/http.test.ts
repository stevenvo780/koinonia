import { describe, expect, it } from 'vitest';

import {
  crearPropuesta,
  decisionDetalle,
  ofrecerTarea,
  planificarHito,
  ratificarDecision,
  reofrecerTarea,
  responderOfertaTarea,
  iniciativaDetalle,
  miembroCirculo,
  miembrosCirculo,
  planEjecucion,
  resultadoDecision,
  solicitarSupresion,
  supresionSolicitada,
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
  it('proyecta integrantes del círculo sin datos personales ni roles', () => {
    const parsed = miembroCirculo.parse({
      id,
      alias: 'Estudiante de filosofía',
      correo: 'no-debe-salir@udea.edu.co',
      roles: ['facilitator'],
      semestre: 7,
    });
    expect(parsed).toEqual({ id, alias: 'Estudiante de filosofía' });
    expect(miembrosCirculo.parse([parsed])).toEqual([parsed]);
    expect(miembroCirculo.safeParse({ id, alias: '' }).success).toBe(false);
  });

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
      activa: false,
      esResponsableInicial: false,
      hitos: [],
      tareas: [],
    };

    expect(iniciativaDetalle.parse(iniciativa)).toEqual(iniciativa);
    expect(
      resultadoDecision.parse({
        decisionId: id,
        iniciativaId: id,
        // El resultado dice siempre de qué es: la pantalla encabezaba con «Resultado» a secas.
        titulo: 'Abrir la sala de estudio hasta las nueve',
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

describe('contrato de solicitud propia de supresión', () => {
  const requestId = '123e4567-e89b-42d3-a456-426614174000';

  it('exige confirmación irreversible y rechaza cualquier selector de otra persona', () => {
    const ownRequest = {
      requestId,
      baseLegal: 'ley-1581-art-8e',
      confirmacionIrreversible: true,
    } as const;
    expect(solicitarSupresion.parse(ownRequest)).toEqual(ownRequest);
    expect(solicitarSupresion.safeParse({ ...ownRequest, subjectId: id }).success).toBe(false);
    expect(
      solicitarSupresion.safeParse({ ...ownRequest, confirmacionIrreversible: false }).success,
    ).toBe(false);
    expect(
      solicitarSupresion.safeParse({ ...ownRequest, baseLegal: 'porque-lo-dice-admin' }).success,
    ).toBe(false);
  });

  it('expone sólo radicado, solicitud, instante y estado pendiente', () => {
    const response = {
      solicitudId: id,
      radicado: id,
      solicitadaEn: 1_700_000_000_000,
      estado: 'pendiente',
    } as const;
    expect(supresionSolicitada.parse(response)).toEqual(response);
    expect(supresionSolicitada.safeParse({ ...response, subjectId: id }).success).toBe(false);
  });
});

describe('contrato HTTP ADR-0044: ratificación, hitos y ofertas', () => {
  const requestId = '123e4567-e89b-42d3-a456-426614174000';
  const hitoId = '1123456789abcdef0123456789abcdef';
  const offerId = '2123456789abcdef0123456789abcdef';

  it('ratifica sólo con una clave de petición válida y planifica hitos acotados', () => {
    expect(ratificarDecision.parse({ requestId })).toEqual({ requestId });
    expect(ratificarDecision.safeParse({ requestId: 'no-es-uuid' }).success).toBe(false);

    const hito = {
      requestId,
      titulo: 'Publicar el horario piloto de la sala nocturna',
      criterioDeTerminacion:
        'El horario está publicado en un canal institucional y puede consultarse sin pedirlo.',
      venceEn: 1_800_000_000_000,
    };
    expect(planificarHito.parse(hito)).toEqual(hito);
    expect(planificarHito.safeParse({ ...hito, titulo: 'Corto' }).success).toBe(false);
    expect(
      planificarHito.safeParse({ ...hito, criterioDeTerminacion: 'Insuficiente' }).success,
    ).toBe(false);
  });

  it('acepta una oferta concreta y rechaza esfuerzo o dependencias inválidas', () => {
    const offer = {
      requestId,
      hitoId,
      destinatarioId: id,
      titulo: 'Confirmar la publicación del horario piloto',
      descripcion:
        'Verificar que el horario publicado corresponde al piloto aprobado y guardar el enlace como evidencia.',
      venceEn: 1_799_000_000_000,
      esfuerzoMinutos: 45,
      dependeDe: [offerId],
    };
    expect(ofrecerTarea.parse(offer)).toEqual(offer);
    expect(ofrecerTarea.safeParse({ ...offer, esfuerzoMinutos: 0 }).success).toBe(false);
    expect(ofrecerTarea.safeParse({ ...offer, dependeDe: [offerId, offerId] }).success).toBe(false);
  });

  it('distingue aceptar de rechazar o pedir reasignación y exige su justificación', () => {
    expect(
      responderOfertaTarea.parse({ requestId, offerId, revision: 4, tipo: 'aceptar' }).tipo,
    ).toBe('aceptar');
    expect(
      responderOfertaTarea.parse({
        requestId,
        offerId,
        revision: 4,
        tipo: 'rechazar',
        motivo: 'sin-disponibilidad',
      }).tipo,
    ).toBe('rechazar');
    expect(
      responderOfertaTarea.safeParse({
        requestId,
        offerId,
        revision: 4,
        tipo: 'pedir-reasignacion',
      }).success,
    ).toBe(false);
    expect(
      responderOfertaTarea.safeParse({
        requestId,
        offerId,
        revision: 4,
        tipo: 'rechazar',
        motivo: 'salud-personal',
      }).success,
    ).toBe(false);
    expect(responderOfertaTarea.safeParse({ requestId, offerId, tipo: 'aceptar' }).success).toBe(
      false,
    );
    expect(reofrecerTarea.parse({ requestId, offerId, destinatarioId: id })).toEqual({
      requestId,
      offerId,
      destinatarioId: id,
    });
    expect(reofrecerTarea.safeParse({ requestId, destinatarioId: id }).success).toBe(false);
  });

  it('proyecta ejecución sin nombres y conserva el plazo de ratificación derivado', () => {
    const initiative = iniciativaDetalle.parse({
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
      activa: true,
      activadaEn: 1_700_003_600_000,
      ratificableEn: 1_700_003_600_000,
      esResponsableInicial: true,
      hitos: [
        {
          id: hitoId,
          titulo: 'Publicar horario',
          criterioDeTerminacion:
            'El horario se consulta en el canal institucional de la comunidad.',
          venceEn: 1_799_000_000_000,
          planificadoEn: 1_700_003_600_000,
        },
      ],
      tareas: [
        {
          id: offerId,
          hitoId,
          destinatarioId: id,
          responsableId: id,
          ofertaId: offerId,
          revision: 5,
          titulo: 'Confirmar horario',
          descripcion:
            'Comprobar que el horario publicado coincide con el piloto aprobado por la comunidad.',
          venceEn: 1_799_000_000_000,
          esfuerzoMinutos: 45,
          dependeDe: [],
          estado: 'aceptada',
          pausas: [],
          solicitudesDeAyuda: [],
          evidencias: [],
          entregas: [],
          esMia: true,
        },
      ],
    });
    expect(initiative.activa).toBe(true);
    expect(initiative.tareas?.[0]?.ofertaId).toBe(offerId);
    expect(initiative.tareas?.[0]).not.toHaveProperty('nombreResponsable');
  });
});
