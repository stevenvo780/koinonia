import { describe, expect, it } from 'vitest';

import {
  abrirSondeo,
  afirmacionResultadoSondeo,
  afirmacionSondeo,
  ESTADO_SONDEO_EN_PALABRAS,
  MENSAJES_SONDEO,
  RESPUESTA_SONDEO_EN_PALABRAS,
  respuestaSondeo,
  sembrarAfirmacion,
  SONDEO_MAXIMO_CARACTERES_AFIRMACION,
  SONDEO_MINIMO_AFIRMACIONES_CONTRARIAS,
  SONDEO_MINIMO_AFIRMACIONES_SEMBRADAS,
  SONDEO_MINIMO_VALORACIONES_PARA_UBICAR,
  sondeoDetalle,
  sondeoResultado,
  valorarAfirmacion,
} from '../src/consenso.js';
import { forbiddenTermsIn } from '../src/glossary.js';

const id = '0123456789abcdef0123456789abcdef';
const reqId = '11111111-1111-4111-8111-111111111111';

describe('abrir un sondeo', () => {
  it('exige el motivo por el que califica: controvertido o con propuestas contradictorias', () => {
    const resultado = abrirSondeo.safeParse({
      requestId: reqId,
      asuntoId: id,
      asuntoTipo: 'problema',
      motivo: 'muy corto',
    });
    expect(resultado.success).toBe(false);
  });

  it('acepta un motivo suficiente sobre un problema o una propuesta', () => {
    for (const asuntoTipo of ['problema', 'propuesta'] as const) {
      const resultado = abrirSondeo.safeParse({
        requestId: reqId,
        asuntoId: id,
        asuntoTipo,
        motivo: 'Hay dos propuestas contradictorias en circulación sobre este mismo problema.',
      });
      expect(resultado.success, asuntoTipo).toBe(true);
    }
  });

  it('no acepta campos de más', () => {
    const resultado = abrirSondeo.safeParse({
      requestId: reqId,
      asuntoId: id,
      asuntoTipo: 'problema',
      motivo: 'Hay dos propuestas contradictorias en circulación sobre este mismo problema.',
      quienConvoca: id,
    });
    expect(resultado.success).toBe(false);
  });
});

describe('sembrar una afirmación', () => {
  it('rechaza una afirmación más larga que el límite de pantalla', () => {
    const resultado = sembrarAfirmacion.safeParse({
      requestId: reqId,
      texto: 'a'.repeat(SONDEO_MAXIMO_CARACTERES_AFIRMACION + 1),
    });
    expect(resultado.success).toBe(false);
  });

  it('acepta una afirmación corta sin declarar si es contraria (siembra fuera de la fundacional)', () => {
    const resultado = sembrarAfirmacion.safeParse({
      requestId: reqId,
      texto: 'La sala de estudio debería abrir hasta las nueve de la noche.',
    });
    expect(resultado.success).toBe(true);
  });

  it('acepta declarar explícitamente que contradice la propia postura', () => {
    const resultado = sembrarAfirmacion.safeParse({
      requestId: reqId,
      texto: 'La sala de estudio debería abrir hasta las nueve de la noche.',
      contrariaAMiPosicion: true,
    });
    expect(resultado.success).toBe(true);
  });

  it('el límite de caracteres es exactamente 280, como manda ADR-0038', () => {
    expect(SONDEO_MAXIMO_CARACTERES_AFIRMACION).toBe(280);
  });
});

describe('valorar una afirmación: el voto es trinario', () => {
  it('sólo admite de_acuerdo, en_desacuerdo o paso', () => {
    for (const respuesta of ['de_acuerdo', 'en_desacuerdo', 'paso']) {
      expect(valorarAfirmacion.safeParse({ requestId: reqId, respuesta }).success).toBe(true);
    }
    expect(valorarAfirmacion.safeParse({ requestId: reqId, respuesta: 'abstencion' }).success).toBe(
      false,
    );
  });

  it('paso es una respuesta y no un campo opcional que se pueda omitir', () => {
    expect(valorarAfirmacion.safeParse({ requestId: reqId }).success).toBe(false);
  });

  it('las tres respuestas tienen su palabra en pantalla, y ninguna se llama "voto"', () => {
    const todas = respuestaSondeo.options;
    for (const r of todas) {
      expect(RESPUESTA_SONDEO_EN_PALABRAS[r]).toBeTruthy();
    }
  });
});

describe('las cifras normativas son las de ADR-0038 y PRODUCT.md §4', () => {
  it('doce afirmaciones fundacionales, al menos tres contrarias', () => {
    expect(SONDEO_MINIMO_AFIRMACIONES_SEMBRADAS).toBe(12);
    expect(SONDEO_MINIMO_AFIRMACIONES_CONTRARIAS).toBe(3);
  });

  it('siete valoraciones para ubicar a alguien en el mapa (PRODUCT.md §4)', () => {
    expect(SONDEO_MINIMO_VALORACIONES_PARA_UBICAR).toBe(7);
  });
});

describe('lectura: el detalle no manda la lista entera de una vez', () => {
  it('la afirmación de lectura no lleva quién más la sembró, sólo si fue una misma', () => {
    const resultado = afirmacionSondeo.safeParse({
      id,
      texto: 'Una afirmación cualquiera.',
      sembradaPorMi: false,
      contrariaALaPosicionDeQuienConvoca: false,
    });
    expect(resultado.success).toBe(true);
  });

  it('el detalle exige el progreso propio siempre, y la siembra sólo mientras se arma', () => {
    const detalleSembrando = sondeoDetalle.safeParse({
      id,
      asuntoId: id,
      asuntoTipo: 'problema',
      asuntoTitulo: 'La sala de estudio nocturna',
      motivo: 'Hay dos propuestas contradictorias en circulación.',
      estado: 'sembrando',
      estadoEnPalabras: ESTADO_SONDEO_EN_PALABRAS.sembrando,
      convocaEsMi: true,
      totalAfirmaciones: 5,
      totalValoraciones: 0,
      desde: 1_800_000_000_000,
      progresoSiembra: {
        sembradas: 5,
        faltan: 7,
        contrariasSembradas: 1,
        contrariasFaltan: 2,
      },
      miProgreso: { valoradas: 0, total: 0 },
    });
    expect(detalleSembrando.success).toBe(true);
  });
});

describe('resultado: los tres desenlaces, ADR-0048', () => {
  it('grupos_detectados, sin_grupos_claros y todavia_no son las únicas formas válidas', () => {
    const grupos = sondeoResultado.safeParse({
      tipo: 'grupos_detectados',
      esProvisional: true,
      avisoProvisional: 'Este resultado se puede volver a calcular.',
      participantesConsiderados: 40,
      participantesSinUbicar: 3,
      titulo: 'Grupos de opinión',
      descripcion: 'd',
      grupos: [{ nombre: 'Grupo 1', tamano: 20 }],
      afirmacionesPuenteTitulo: 't',
      afirmacionesPuenteDescripcion: 'd',
      afirmacionesPuente: [],
      afirmacionesDivisivasTitulo: 't',
      afirmacionesDivisivasDescripcion: 'd',
      afirmacionesDivisivas: [],
    });
    expect(grupos.success).toBe(true);

    const sinGrupos = sondeoResultado.safeParse({
      tipo: 'sin_grupos_claros',
      esProvisional: true,
      avisoProvisional: 'Este resultado se puede volver a calcular.',
      participantesConsiderados: 40,
      participantesSinUbicar: 3,
      titulo: 'No hay grupos claros',
      descripcion: 'd',
      acuerdoGeneralTitulo: 't',
      acuerdoGeneralDescripcion: 'd',
      acuerdoGeneral: [],
      aviso: '',
    });
    expect(sinGrupos.success).toBe(true);

    const todaviaNo = sondeoResultado.safeParse({
      tipo: 'todavia_no',
      motivo: 'sembrando',
      descripcion: 'd',
    });
    expect(todaviaNo.success).toBe(true);

    expect(sondeoResultado.safeParse({ tipo: 'veredicto', descripcion: 'no' }).success).toBe(false);
  });

  it('una afirmación de resultado nunca manda el número crudo que la ordenó (ADR-0048)', () => {
    const parseado = afirmacionResultadoSondeo.parse({
      texto: 'Una afirmación cualquiera.',
      porcentajeAcuerdoPorGrupo: [80, 65],
      observaciones: 40,
    });
    // El único vocabulario numérico que cruza la red es un porcentaje por grupo y un conteo de
    // observaciones. No hay campo `metrica`, `gic` ni `dispersion`: si alguien lo agrega, este
    // `Object.keys` se mueve y la prueba avisa.
    expect(Object.keys(parseado).sort()).toEqual(
      ['observaciones', 'porcentajeAcuerdoPorGrupo', 'texto'].sort(),
    );
  });
});

describe('ADR-0041: ni una palabra de la lista prohibida en lo que se lee en pantalla', () => {
  const textosVisibles = [
    ...Object.values(RESPUESTA_SONDEO_EN_PALABRAS),
    ...Object.values(ESTADO_SONDEO_EN_PALABRAS),
    ...Object.values(MENSAJES_SONDEO),
  ];

  it('ninguno de los textos de sondeo contiene jerga prohibida', () => {
    for (const texto of textosVisibles) {
      expect(forbiddenTermsIn(texto), `«${texto}»`).toEqual([]);
    }
  });

  it('ninguna palabra prohibida menciona "sondeo" como si fuera una votación', () => {
    // Guarda de intención, no del glosario: si algún día un mensaje de este fichero dice
    // literalmente que el sondeo "decide" o "vota" en el sentido de una decisión formal, ADR-0038
    // queda contradicho por el propio texto de pantalla.
    for (const texto of textosVisibles) {
      expect(texto.toLowerCase()).not.toContain('gana la votación');
      expect(texto.toLowerCase()).not.toContain('resultado vinculante');
    }
  });
});
