/**
 * Regresiones nacidas de la sesión exploratoria del enjambre (docs/TESTING.md §8).
 *
 * Foco: el plan de ejecución que toda propuesta y toda enmienda deben traer. Probado a mano contra
 * la interfaz real primero; acá queda como prueba permanente sobre PostgreSQL real, sin dobles.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  apiEnv,
  type ApiListo,
  como,
  entrar,
  listo,
  planDe,
  skipNote,
} from '../integration/helpers/api-env.js';

const env = await apiEnv();

afterAll(async () => {
  if (env.ok) await env.stop();
});

const CIRCULO_ESPACIOS = 'e5bac105b1e00000000000000000000b';

let n = 0;
function req(): string {
  const hex = (++n + 0xa000).toString(16).padStart(32, '0');
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-` +
    `8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  );
}

// `REGLA_PROPUESTA` limita a 3 propuestas por persona y por semana (`rate-limit.ts`), y el cupo se
// consume ANTES de validar el cuerpo (`app.ts`: "El cupo específico primero"): incluso un intento
// que termina rechazado por el plan cuenta contra el cupo de quien lo mandó. Cuatro pruebas de este
// archivo mandan un POST /propuestas cada una, así que cada una usa una persona distinta — si
// compartieran una sola autora, la CUARTA prueba fallaría por cupo agotado y no por lo que dice
// probar, que es exactamente lo que le pasó a la primera versión de este archivo.
async function nuevaAutora(
  e: ApiListo,
  etiqueta: string,
): Promise<{ testigo: string; miembroId: string }> {
  return entrar(e, `autora-plan-${etiqueta}@udea.edu.co`);
}

async function problemaDe(
  e: ApiListo,
  autora: { testigo: string; miembroId: string },
): Promise<string> {
  const problema = await e.app.inject({
    method: 'POST',
    url: '/problemas',
    headers: como(autora.testigo),
    payload: {
      requestId: req(),
      titulo: 'Problema base para probar los límites del plan de ejecución',
      cuerpo: 'Cualquier problema real sirve de percha; lo que se prueba acá es el plan, no esto.',
      circuloId: CIRCULO_ESPACIOS,
    },
  });
  return problema.json<{ id: string }>().id;
}

describe.skipIf(!env.ok)(`exploratoria — propuestas: el plan de ejecución${skipNote(env)}`, () => {
  let e: ApiListo;

  beforeAll(() => {
    e = listo(env);
  });

  it('EXPLORATORIA — una fecha de revisión en el PASADO se rechaza: revisar algo que ya pasó no es un plan', async () => {
    const autora = await nuevaAutora(e, 'pasado');
    const problemaId = await problemaDe(e, autora);
    const respuesta = await e.app.inject({
      method: 'POST',
      url: '/propuestas',
      headers: como(autora.testigo),
      payload: {
        requestId: req(),
        problemaId,
        titulo: 'Una propuesta cuyo plan revisa el pasado',
        cuerpo:
          'El plan de esta propuesta dice que hay que revisar el resultado antes de que la ' +
          'propuesta siquiera exista, lo que no tiene sentido y debe rechazarse.',
        plan: { ...planDe(autora.miembroId), revisarEn: Date.UTC(2020, 0, 1) },
      },
    });
    expect(respuesta.statusCode).toBe(422);
    expect(respuesta.json<{ codigo: string }>().codigo).toBe('EXECUTION_PLAN_REVIEW_NOT_FUTURE');
  });

  it('EXPLORATORIA — revisarEn = 0 (el epoch) también se rechaza igual, no como caso especial', async () => {
    const autora = await nuevaAutora(e, 'epoch');
    const problemaId = await problemaDe(e, autora);
    const respuesta = await e.app.inject({
      method: 'POST',
      url: '/propuestas',
      headers: como(autora.testigo),
      payload: {
        requestId: req(),
        problemaId,
        titulo: 'Una propuesta cuyo plan revisa en el instante cero',
        cuerpo: 'El plan pone revisarEn en 0, el epoch de Unix, que también es un instante pasado.',
        plan: { ...planDe(autora.miembroId), revisarEn: 0 },
      },
    });
    expect(respuesta.statusCode).toBe(422);
    expect(respuesta.json<{ codigo: string }>().codigo).toBe('EXECUTION_PLAN_REVIEW_NOT_FUTURE');
  });

  it('EXPLORATORIA — criteriosDeExito vacío ([]) se rechaza en el contrato, antes de llegar al dominio', async () => {
    const autora = await nuevaAutora(e, 'vacio');
    const problemaId = await problemaDe(e, autora);
    const respuesta = await e.app.inject({
      method: 'POST',
      url: '/propuestas',
      headers: como(autora.testigo),
      payload: {
        requestId: req(),
        problemaId,
        titulo: 'Una propuesta sin ningún criterio de éxito declarado',
        cuerpo: 'El plan trae un arreglo vacío de criterios de éxito, que no debería aceptarse.',
        plan: { ...planDe(autora.miembroId), criteriosDeExito: [] },
      },
    });
    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.json<{ codigo: string }>().codigo).toBe('DATOS_INVALIDOS');
  });

  it('EXPLORATORIA — enmendar con el MISMO contenido exacto (requestId nuevo) no crea una versión repetida', async () => {
    const autora = await nuevaAutora(e, 'enmienda');
    const problemaId = await problemaDe(e, autora);
    const creada = await e.app.inject({
      method: 'POST',
      url: '/propuestas',
      headers: como(autora.testigo),
      payload: {
        requestId: req(),
        problemaId,
        titulo: 'Propuesta base para probar la enmienda idéntica',
        cuerpo:
          'Texto original de la propuesta, que luego se va a intentar "enmendar" sin cambiarlo.',
        plan: planDe(autora.miembroId),
      },
    });
    expect(creada.statusCode).toBe(201);
    const propuestaId = creada.json<{ id: string }>().id;
    // La V1 y la enmienda tienen que ser DISTINTAS entre sí (si no, la propia V1→V2 ya sería
    // "sin cambios"); lo que se prueba es repetir la V2 una segunda vez, no la primera enmienda.
    const cuerpoEnmienda = {
      titulo: 'Propuesta base para probar la enmienda idéntica, V2',
      cuerpo: 'Texto nuevo de la V2, distinto del original, que luego se repetirá tal cual.',
      motivo: 'Cambio real y concreto respecto de la V1, para poder llegar a una V2 de verdad.',
      plan: planDe(autora.miembroId),
    };

    const primeraVez = await e.app.inject({
      method: 'POST',
      url: `/propuestas/${propuestaId}/enmiendas`,
      headers: como(autora.testigo),
      payload: { requestId: req(), ...cuerpoEnmienda },
    });
    expect(primeraVez.statusCode).toBe(201);
    expect(primeraVez.json<{ versiones: unknown[] }>().versiones).toHaveLength(2);

    // Repetir el MISMO contenido (texto y plan idénticos) con un requestId NUEVO: no hay nada
    // nuevo que guardar, así que debe rechazarse en vez de crear una V3 idéntica a la V2.
    const segundaVez = await e.app.inject({
      method: 'POST',
      url: `/propuestas/${propuestaId}/enmiendas`,
      headers: como(autora.testigo),
      payload: { requestId: req(), ...cuerpoEnmienda },
    });
    expect(segundaVez.statusCode).toBe(422);
    expect(segundaVez.json<{ codigo: string }>().codigo).toBe('VERSION_UNCHANGED');

    const final = await e.app.inject({ method: 'GET', url: `/propuestas/${propuestaId}` });
    expect(final.json<{ versiones: unknown[] }>().versiones).toHaveLength(2);
  });
});
