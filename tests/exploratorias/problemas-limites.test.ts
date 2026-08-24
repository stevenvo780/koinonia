/**
 * Regresiones nacidas de la sesión exploratoria del enjambre (docs/TESTING.md §8).
 *
 * Todo lo que hay acá se probó primero A MANO contra la interfaz de desarrollo real (web :3199,
 * API :3001, PostgreSQL real detrás) con `curl`, exactamente como pide el guion de §8: camino feliz
 * una vez, después valores límite, dobles envíos, campos con emoji y texto de derecha a izquierda.
 * Cada hallazgo se reprodujo DOS veces antes de convertirse en la prueba de abajo. Ninguno resultó
 * ser un fallo del producto: todos confirman que la protección ya existe. Se dejan como pruebas
 * permanentes igual, porque eso es justamente lo que impide que alguien la rompa sin darse cuenta.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  apiEnv,
  type ApiListo,
  como,
  entrar,
  listo,
  skipNote,
} from '../integration/helpers/api-env.js';

const env = await apiEnv();

afterAll(async () => {
  if (env.ok) await env.stop();
});

const CIRCULO_ESPACIOS = 'e5bac105b1e00000000000000000000b';

let n = 0;
function req(): string {
  const hex = (++n + 0x9000).toString(16).padStart(32, '0');
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-` +
    `8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  );
}

describe.skipIf(!env.ok)(`exploratoria — problemas: valores límite${skipNote(env)}`, () => {
  let e: ApiListo;
  let daniela: { testigo: string; miembroId: string };
  let julian: { testigo: string; miembroId: string };

  beforeAll(async () => {
    e = listo(env);
    daniela = await entrar(e, 'daniela.explora@udea.edu.co');
    julian = await entrar(e, 'julian.explora@udea.edu.co');
  });

  it('EXPLORATORIA — un círculo inventado (32 hex que no existe) se rechaza con 404, no con un problema fantasma', async () => {
    const respuesta = await e.app.inject({
      method: 'POST',
      url: '/problemas',
      headers: como(daniela.testigo),
      payload: {
        requestId: req(),
        titulo: 'Un problema colgado de un círculo que nadie creó',
        cuerpo:
          'Este problema no debería poder existir: el círculo que declara es un id inventado.',
        circuloId: 'f'.repeat(32),
      },
    });
    expect(respuesta.statusCode).toBe(404);
  });

  it('EXPLORATORIA — un título de 10 000 caracteres se rechaza con 400 y un mensaje humano, nunca con un 500', async () => {
    const respuesta = await e.app.inject({
      method: 'POST',
      url: '/problemas',
      headers: como(daniela.testigo),
      payload: {
        requestId: req(),
        titulo: 'a'.repeat(10_000),
        cuerpo:
          'Cuerpo válido y suficientemente largo para pasar su propia validación de longitud.',
        circuloId: CIRCULO_ESPACIOS,
      },
    });
    expect(respuesta.statusCode).toBe(400);
    const cuerpo = respuesta.json<{ codigo: string; campo?: string }>();
    expect(cuerpo.codigo).toBe('DATOS_INVALIDOS');
    expect(cuerpo.campo).toBe('titulo');
  });

  it('EXPLORATORIA — emoji y texto de derecha a izquierda (árabe) se aceptan intactos, sin corromperse', async () => {
    const titulo = 'Problema con emoji 🎉🔥 y texto مرحبا بالعالم';
    const cuerpo =
      'Cuerpo con emoji 😀😀 y árabe مرحبا هذا اختبار للنص من اليمين لليسار في النظام.';
    const respuesta = await e.app.inject({
      method: 'POST',
      url: '/problemas',
      headers: como(daniela.testigo),
      payload: { requestId: req(), titulo, cuerpo, circuloId: CIRCULO_ESPACIOS },
    });
    expect(respuesta.statusCode).toBe(201);
    const creado = respuesta.json<{ titulo: string; cuerpo: string }>();
    // Bytea de ida y vuelta por PostgreSQL: si algo normaliza o trunca en el camino, esto lo nota.
    expect(creado.titulo).toBe(titulo);
    expect(creado.cuerpo).toBe(cuerpo);
  });

  it('EXPLORATORIA — "me pasa lo mismo" dos veces con la MISMA persona no cuenta dos veces, ni con requestId repetido ni con uno nuevo', async () => {
    const problema = await e.app.inject({
      method: 'POST',
      url: '/problemas',
      headers: como(daniela.testigo),
      payload: {
        requestId: req(),
        titulo: 'Problema para probar el doble "me pasa lo mismo"',
        cuerpo:
          'Un solo problema, sobre el que Julián va a intentar manifestarse dos veces seguidas.',
        circuloId: CIRCULO_ESPACIOS,
      },
    });
    const problemaId = problema.json<{ id: string }>().id;

    const primeraVez = await e.app.inject({
      method: 'POST',
      url: `/problemas/${problemaId}/me-pasa`,
      headers: como(julian.testigo),
      payload: { requestId: req() },
    });
    expect(primeraVez.statusCode).toBe(200);
    expect(primeraVez.json<{ lesPasaLoMismo: number }>().lesPasaLoMismo).toBe(1);

    // Primer intento de duplicar: MISMO requestId que ya se usó en otra operación (repetido a mano).
    const mismoRequestId = req();
    await e.app.inject({
      method: 'POST',
      url: `/problemas/${problemaId}/me-pasa`,
      headers: como(julian.testigo),
      payload: { requestId: mismoRequestId },
    });
    const repiteMismoId = await e.app.inject({
      method: 'POST',
      url: `/problemas/${problemaId}/me-pasa`,
      headers: como(julian.testigo),
      payload: { requestId: mismoRequestId },
    });
    // (la primera de este par ya cuenta como el segundo "me pasa" real de Julián, y debe rechazarse)

    // Segundo intento: requestId NUEVO cada vez (alguien que hace doble clic, no un reintento de red).
    const conRequestIdNuevo = await e.app.inject({
      method: 'POST',
      url: `/problemas/${problemaId}/me-pasa`,
      headers: como(julian.testigo),
      payload: { requestId: req() },
    });
    expect(conRequestIdNuevo.statusCode).toBe(422);
    expect(conRequestIdNuevo.json<{ codigo: string }>().codigo).toBe('ALREADY_ME_TOO');
    expect(repiteMismoId.statusCode).toBe(422);

    const final = await e.app.inject({ method: 'GET', url: `/problemas/${problemaId}` });
    // Pase lo que pase con los reintentos, Julián sólo cuenta UNA vez.
    expect(final.json<{ lesPasaLoMismo: number }>().lesPasaLoMismo).toBe(1);
  });
});
