/**
 * Regresiones nacidas de la sesión exploratoria del enjambre (docs/TESTING.md §8).
 *
 * Foco: votación — quién puede votar, qué pasa antes de cerrar, y qué ve la propia persona de su
 * propio voto mientras la votación sigue abierta. El último punto es el hallazgo más serio de esta
 * sesión: ver el ANÁLISIS en el comentario de la prueba correspondiente, más abajo.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  apiEnv,
  type ApiListo,
  como,
  entrar,
  FACILITADORA,
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
  const hex = (++n + 0xb000).toString(16).padStart(32, '0');
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-` +
    `8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  );
}

let autoras = 0;

/**
 * Arma una decisión abierta lista para votar, y devuelve su id y la huella de la versión vigente.
 *
 * Cada llamada usa una autora NUEVA (correo distinto) a propósito: `REGLA_PROPUESTA` limita a 3
 * propuestas por persona y por semana (`rate-limit.ts`), y esta prueba confirmó esa misma regla
 * cuando reutilizaba una sola autora entre varios `it()` del archivo — reutilizar personas entre
 * pruebas independientes termina probando el cupo sin querer, en vez de lo que cada prueba dice
 * probar. Una autora nueva por decisión es lo mismo que haría un tester real: no todo el mundo que
 * propone algo es la misma persona.
 */
async function decisionAbierta(
  e: ApiListo,
  lucia: { testigo: string; miembroId: string },
): Promise<{ decisionId: string; huellaVersion: string }> {
  const autora = await entrar(e, `autora-decision-${(++autoras).toString()}@udea.edu.co`);
  const problema = await e.app.inject({
    method: 'POST',
    url: '/problemas',
    headers: como(autora.testigo),
    payload: {
      requestId: req(),
      titulo: 'Problema base para una votación de prueba exploratoria',
      cuerpo: 'Cualquier problema real sirve de percha para poder abrir una votación de prueba.',
      circuloId: CIRCULO_ESPACIOS,
    },
  });
  const problemaId = problema.json<{ id: string }>().id;

  const propuesta = await e.app.inject({
    method: 'POST',
    url: '/propuestas',
    headers: como(autora.testigo),
    payload: {
      requestId: req(),
      problemaId,
      titulo: 'Propuesta base para una votación de prueba exploratoria',
      cuerpo: 'Texto de la propuesta que se va a someter a votación en esta prueba exploratoria.',
      plan: planDe(autora.miembroId),
    },
  });
  const propuestaJson = propuesta.json<{ id: string; versiones: { huella: string }[] }>();

  const decision = await e.app.inject({
    method: 'POST',
    url: '/decisiones',
    headers: como(lucia.testigo),
    payload: {
      requestId: req(),
      propuestaId: propuestaJson.id,
      metodo: 'simple-majority',
      duracionHoras: 1,
    },
  });
  expect(decision.statusCode).toBe(201);
  const decisionJson = decision.json<{ id: string; huellaVersion: string }>();
  return { decisionId: decisionJson.id, huellaVersion: decisionJson.huellaVersion };
}

describe.skipIf(!env.ok)(`exploratoria — decisiones: secreto y límites${skipNote(env)}`, () => {
  let e: ApiListo;
  let daniela: { testigo: string; miembroId: string };
  let julian: { testigo: string; miembroId: string };
  let lucia: { testigo: string; miembroId: string };

  beforeAll(async () => {
    e = listo(env);
    daniela = await entrar(e, 'daniela.decide@udea.edu.co');
    julian = await entrar(e, 'julian.decide@udea.edu.co');
    lucia = await entrar(e, FACILITADORA);
  });

  it('EXPLORATORIA — votar sin sesión (sin Authorization) se rechaza con 401, nunca se cuenta como abstención silenciosa', async () => {
    const { decisionId, huellaVersion } = await decisionAbierta(e, lucia);
    const respuesta = await e.app.inject({
      method: 'POST',
      url: `/decisiones/${decisionId}/papeletas`,
      // Sin cabecera Authorization: exactamente lo que probaría alguien saltándose la interfaz.
      payload: {
        requestId: req(),
        huellaVersion,
        respuesta: { tipo: 'binary', aprueba: true },
      },
    });
    expect(respuesta.statusCode).toBe(401);
  });

  it('EXPLORATORIA — un correo común (rol member) no puede abrir una votación: 403 en el servidor, no sólo botón oculto', async () => {
    const problema = await e.app.inject({
      method: 'POST',
      url: '/problemas',
      headers: como(daniela.testigo),
      payload: {
        requestId: req(),
        titulo: 'Problema base para probar quién puede abrir una votación',
        cuerpo: 'Este problema existe sólo para colgarle una propuesta y probar la autorización.',
        circuloId: CIRCULO_ESPACIOS,
      },
    });
    const propuesta = await e.app.inject({
      method: 'POST',
      url: '/propuestas',
      headers: como(daniela.testigo),
      payload: {
        requestId: req(),
        problemaId: problema.json<{ id: string }>().id,
        titulo: 'Propuesta que Daniela va a intentar someter a votación ella misma',
        cuerpo: 'Daniela no tiene el rol de facilitación y no debería poder abrir esto a votación.',
        plan: planDe(daniela.miembroId),
      },
    });

    const intento = await e.app.inject({
      method: 'POST',
      url: '/decisiones',
      // Daniela es una cuenta 'member' común: probar por API directa, saltándose la interfaz.
      headers: como(daniela.testigo),
      payload: {
        requestId: req(),
        propuestaId: propuesta.json<{ id: string }>().id,
        metodo: 'simple-majority',
        duracionHoras: 24,
      },
    });
    expect(intento.statusCode).toBe(403);
  });

  it('EXPLORATORIA — leer el resultado ANTES de cerrar no revela ni desglose ni desenlace', async () => {
    const { decisionId, huellaVersion } = await decisionAbierta(e, lucia);
    await e.app.inject({
      method: 'POST',
      url: `/decisiones/${decisionId}/papeletas`,
      headers: como(julian.testigo),
      payload: { requestId: req(), huellaVersion, respuesta: { tipo: 'binary', aprueba: true } },
    });

    const resumen = await e.app.inject({ method: 'GET', url: `/decisiones/${decisionId}` });
    const cuerpoResumen = resumen.json<Record<string, unknown>>();
    // Cuenta cuántos se manifestaron, pero nunca en qué sentido, mientras sigue abierta.
    expect(cuerpoResumen['seManifestaron']).toBe(1);
    expect(cuerpoResumen).not.toHaveProperty('desenlace');
    expect(cuerpoResumen).not.toHaveProperty('tablas');

    const resultado = await e.app.inject({
      method: 'GET',
      url: `/decisiones/${decisionId}/resultado`,
    });
    expect(resultado.statusCode).not.toBe(200);
  });

  it('EXPLORATORIA — doble voto de la misma persona: la ÚLTIMA papeleta es la que manda (INV-07)', async () => {
    const { decisionId, huellaVersion } = await decisionAbierta(e, lucia);

    await e.app.inject({
      method: 'POST',
      url: `/decisiones/${decisionId}/papeletas`,
      headers: como(julian.testigo),
      payload: { requestId: req(), huellaVersion, respuesta: { tipo: 'binary', aprueba: false } },
    });
    await e.app.inject({
      method: 'POST',
      url: `/decisiones/${decisionId}/papeletas`,
      headers: como(julian.testigo),
      payload: { requestId: req(), huellaVersion, respuesta: { tipo: 'binary', aprueba: true } },
    });

    const resumen = await e.app.inject({ method: 'GET', url: `/decisiones/${decisionId}` });
    // Dos papeletas, UNA sola persona manifestada: la segunda reemplaza a la primera, no se suma.
    expect(resumen.json<{ seManifestaron: number }>().seManifestaron).toBe(1);
  });

  /**
   * ═══ HALLAZGO S1 — confirmado, no corregido acá (fuera de la propiedad de esta sesión) ═══
   *
   * ADR-0010 describe el recibo del voto como algo que NO debe traer la opción elegida, para que
   * nadie pueda usar la pantalla de otra persona como prueba de cómo votó (coerción, C6-GATE).
   *
   * Lo que el servidor hace en realidad: `GET /decisiones/:id` trae `miRespuesta` con la opción
   * elegida EN TEXTO PLANO («Sí» / «No»), y la trae en CUALQUIER lectura posterior mientras la
   * votación sigue abierta — no sólo en la confirmación inmediata del envío. Esta prueba lo
   * reproduce con dos lecturas separadas, la segunda simulando que la persona vuelve a abrir la
   * pantalla más tarde (o que alguien le pide que la abra delante suyo).
   *
   * Esto NO es cosmético: toca el secreto del voto y la coerción del votante (T-10 del modelo de
   * amenazas), así que el piso de severidad es S1 aunque el defecto viva en presentación
   * (`presenters.ts` / `apps/web/app/decisiones/[id]/page.tsx`), no en el ledger. Corregirlo excede
   * la propiedad de esta sesión (que es sólo `tests/exploratorias/**` y la sección exploratoria de
   * `docs/TESTING.md`); queda documentado en `docs/TESTING.md` §8 y en el resumen de esta sesión
   * para quien tenga esos ficheros.
   *
   * La prueba queda en rojo A PROPÓSITO (`it.fails`): así el CI se mantiene verde sin fingir que el
   * problema no existe, y el día que alguien corrija la exposición, esta prueba empieza a fallar
   * "al revés" (pasó cuando se esperaba que fallara) y eso es la señal exacta de que hay que
   * quitarle `.fails` y dejarla en verde normal.
   */
  it.fails(
    'EXPLORATORIA/S1 — miRespuesta NO debería revelar la opción elegida en lecturas posteriores (ADR-0010)',
    async () => {
      const { decisionId, huellaVersion } = await decisionAbierta(e, lucia);
      await e.app.inject({
        method: 'POST',
        url: `/decisiones/${decisionId}/papeletas`,
        headers: como(julian.testigo),
        payload: { requestId: req(), huellaVersion, respuesta: { tipo: 'binary', aprueba: false } },
      });

      // Segunda lectura, independiente de la primera: "Julián vuelve a abrir la pantalla más tarde".
      const segundaLectura = await e.app.inject({
        method: 'GET',
        url: `/decisiones/${decisionId}`,
        headers: como(julian.testigo),
      });
      const cuerpo = segundaLectura.json<{ miRespuesta?: string }>();
      expect(cuerpo.miRespuesta).toBeUndefined();
    },
  );
});
