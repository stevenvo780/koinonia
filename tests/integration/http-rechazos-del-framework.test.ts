/**
 * Los rechazos que emite el propio servidor web antes de llegar a una ruta.
 *
 * ═══ Qué se rompía ═══
 *
 * `setErrorHandler` no ve estos: nacen en el enrutador, antes de que exista ruta a la que
 * asociarlos. Salían con la forma del framework y no con la de `ApiError`. Medido contra
 * producción el 2026-08-25, pidiendo `/decisiones/aaa…` con 300 caracteres:
 *
 *     {"error":"Bad Request","code":"FST_ERR_MAX_PARAM_LENGTH",
 *      "message":"'/decisiones/aaaaaa…(300 letras)…' is exceeding the max param length",
 *      "statusCode":414}
 *
 * Tres cosas mal a la vez, y la tercera es la que más importa: un cliente que espera
 * `codigo`/`mensaje` no puede leer eso; está en inglés y nombra la mecánica del framework; y
 * **devuelve la entrada entera en la respuesta**.
 *
 * Comprobado rompiéndolo: quitando `frameworkErrors` de las opciones de Fastify, los tres casos
 * fallan — vuelve la forma del framework, con el código interno y con la dirección reflejada.
 */

import { afterAll, describe, expect, it } from 'vitest';

import { apiError, forbiddenTermsIn } from '@koinonia/contracts';

import { apiEnv, listo, skipNote } from './helpers/api-env.js';

const env = await apiEnv();

afterAll(async () => {
  if (env.ok) await env.stop();
});

/** Bastante más de lo que admite el enrutador, y reconocible si se colara en la respuesta. */
const IDENTIFICADOR_ABSURDO = 'z'.repeat(300);

describe.skipIf(!env.ok)(`los rechazos del servidor web${skipNote(env)}`, () => {
  it('un identificador imposible se rechaza con la forma del contrato, no con la del framework', async () => {
    const e = listo(env);
    const res = await e.app.inject({
      method: 'GET',
      url: `/decisiones/${IDENTIFICADOR_ABSURDO}`,
    });
    // El estado se conserva: 414 es, de verdad, «esa dirección es demasiado larga».
    expect(res.statusCode).toBe(414);
    // Y el cuerpo es el que cualquier cliente de esta API sabe leer.
    const cuerpo: unknown = res.json();
    expect(apiError.safeParse(cuerpo).success).toBe(true);
  });

  it('no devuelve lo que llegó, ni el código interno del framework', async () => {
    const e = listo(env);
    const res = await e.app.inject({
      method: 'GET',
      url: `/decisiones/${IDENTIFICADOR_ABSURDO}`,
    });
    expect(res.body).not.toContain(IDENTIFICADOR_ABSURDO);
    expect(res.body).not.toMatch(/FST_ERR|exceeding|max param length/u);
  });

  it('lo que se lee está en español, sin jerga y con una salida', async () => {
    const e = listo(env);
    const res = await e.app.inject({
      method: 'GET',
      url: `/decisiones/${IDENTIFICADOR_ABSURDO}`,
    });
    const cuerpo = res.json<{ mensaje: string; queHacer?: string }>();
    expect(forbiddenTermsIn(`${cuerpo.mensaje} ${cuerpo.queHacer ?? ''}`)).toEqual([]);
    // Un rechazo sin salida es un callejón: la propia cabecera de `errors.ts` lo pone como regla.
    expect(cuerpo.queHacer).toBeDefined();
  });

  it('un cuerpo que no es JSON válido también se rechaza con la forma del contrato', async () => {
    const e = listo(env);
    const res = await e.app.inject({
      method: 'POST',
      url: '/auth/enlace',
      headers: { 'content-type': 'application/json' },
      payload: '{esto no es json',
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    expect(apiError.safeParse(res.json()).success).toBe(true);
  });
});
