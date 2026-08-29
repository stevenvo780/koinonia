import { describe, expect, it } from 'vitest';

import {
  crearPropuesta,
  decisionDetalle,
  iniciativaDetalle,
  miembroCirculo,
  miembrosCirculo,
  ofrecerTarea,
  planEjecucion,
  planificarHito,
  ratificarDecision,
  rectificacionAplicada,
  reofrecerTarea,
  responderOfertaTarea,
  resultadoDecision,
  solicitarRectificacion,
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
        yaVotaste: false,
      }).plan,
    ).toBeUndefined();
  });

  it('escalaDeMenciones es opcional, y cuando viene trae id + etiqueta por mención', () => {
    const base = {
      id,
      propuestaId: id,
      titulo: 'Valorar cuatro propuestas de reforma',
      estado: 'Open' as const,
      metodo: 'majority-judgment' as const,
      abreEn: 1_700_000_000_000,
      cierraEn: 1_700_003_600_000,
      huellaVersion: huella,
      podianDecidir: 5,
      seManifestaron: 0,
      queHaceFaltaParaQuePase: 'La mejor mención mayoritaria.',
      cuerpoVersion: 'El texto de la propuesta.',
      puedoDecidir: true,
      yaVotaste: false,
    };

    // Ausente: una decisión que no es de valoración por menciones, o una en borrador sin
    // configuración congelada todavía.
    expect(decisionDetalle.parse(base).escalaDeMenciones).toBeUndefined();

    const conEscala = decisionDetalle.parse({
      ...base,
      escalaDeMenciones: [
        { id: 'excelente', etiqueta: 'Excelente' },
        { id: 'rechazar', etiqueta: 'Rechazar' },
      ],
    });
    expect(conEscala.escalaDeMenciones).toEqual([
      { id: 'excelente', etiqueta: 'Excelente' },
      { id: 'rechazar', etiqueta: 'Rechazar' },
    ]);
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

describe('contrato de rectificación propia (la hermana de la supresión)', () => {
  const requestId = '123e4567-e89b-42d3-a456-426614174000';

  it('a diferencia de la supresión, no pide ni base legal ni confirmación de irreversibilidad', () => {
    const pedido = {
      requestId,
      campo: 'alias',
      valorNuevo: 'Alias que sí elegí',
    } as const;
    expect(solicitarRectificacion.parse(pedido)).toEqual(pedido);
    // Tampoco acepta un selector de sujeto: el mismo patrón que `solicitarSupresion` de arriba.
    expect(solicitarRectificacion.safeParse({ ...pedido, subjectId: id }).success).toBe(false);
  });

  it('el correo NO es uno de los campos rectificables: es la credencial de acceso', () => {
    expect(
      solicitarRectificacion.safeParse({ requestId, campo: 'correo', valorNuevo: 'x@udea.edu.co' })
        .success,
    ).toBe(false);
  });

  it('semestre y jornada sólo aceptan uno de un conjunto cerrado, nunca texto libre', () => {
    expect(
      solicitarRectificacion.safeParse({ requestId, campo: 'semestre', valorNuevo: 's8' }).success,
    ).toBe(true);
    expect(
      solicitarRectificacion.safeParse({ requestId, campo: 'jornada', valorNuevo: 'nocturna' })
        .success,
    ).toBe(true);
    // Ni «octavo» (texto libre de verdad) ni el identificador de un miembro: los dos son
    // exactamente el agujero que tumbó el primer intento de esta tarea (`FugaDeIdentidadError`
    // en la métrica de cobertura, cuando el estrato es el identificador de alguien).
    expect(
      solicitarRectificacion.safeParse({ requestId, campo: 'semestre', valorNuevo: 'octavo' })
        .success,
    ).toBe(false);
    expect(
      solicitarRectificacion.safeParse({
        requestId,
        campo: 'semestre',
        valorNuevo: '0123456789abcdef0123456789abcdef',
      }).success,
    ).toBe(false);
    expect(
      solicitarRectificacion.safeParse({ requestId, campo: 'jornada', valorNuevo: 'mixta' })
        .success,
    ).toBe(false);
  });

  it('el alias rechaza el vacío, el exceso y un carácter de control disfrazado de texto', () => {
    // `.trim()` corre ANTES que `.min(1)`: un valor de puros espacios no cuela como «no vacío».
    expect(
      solicitarRectificacion.safeParse({ requestId, campo: 'alias', valorNuevo: '   ' }).success,
    ).toBe(false);
    expect(
      solicitarRectificacion.safeParse({ requestId, campo: 'alias', valorNuevo: 'a'.repeat(121) })
        .success,
    ).toBe(false);
    // Un carácter NUL en medio del texto: PostgreSQL rechaza la fila entera con «invalid byte
    // sequence», y esto tiene que rechazarse acá, con un mensaje, antes de llegar a la base.
    expect(
      solicitarRectificacion.safeParse({ requestId, campo: 'alias', valorNuevo: 'Ana\u0000Gómez' })
        .success,
    ).toBe(false);
    expect(
      solicitarRectificacion.safeParse({ requestId, campo: 'alias', valorNuevo: '  Ana Gómez  ' })
        .success,
    ).toBe(true);
  });

  it('expone radicado, campo e instante, y el estado siempre es «aplicada» — nunca «pendiente»', () => {
    const respuesta = {
      solicitudId: id,
      radicado: id,
      campo: 'semestre',
      aplicadaEn: 1_700_000_000_000,
      estado: 'aplicada',
    } as const;
    expect(rectificacionAplicada.parse(respuesta)).toEqual(respuesta);
    expect(rectificacionAplicada.safeParse({ ...respuesta, estado: 'pendiente' }).success).toBe(
      false,
    );
    // El valor rectificado no viaja en la respuesta: sólo qué campo cambió, nunca el dato en sí.
    expect(
      rectificacionAplicada.safeParse({ ...respuesta, valorNuevo: 'lo que sea' }).success,
    ).toBe(false);
  });
});
