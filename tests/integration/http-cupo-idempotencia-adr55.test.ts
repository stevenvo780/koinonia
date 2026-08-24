/**
 * Pruebas del arreglo ADR-0055: idempotencia del consumo de cuota.
 *
 * Un reintento con la misma clave de idempotencia (`requestId`) NO debe consumir cuota.
 * El mecanismo de `requestId` existe para proteger contra cortes de red en conexiones móviles,
 * pero hoy lo castiga gastando el cupo aunque no crea nada nuevo.
 *
 * Solución: Tabla `identity.rate_consumption` con dedup idempotente por (requestId, ambito, sujeto, window_start).
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { apiEnv, como, entrar, planDe, type ApiListo, listo, skipNote } from './helpers/api-env.js';

const env = await apiEnv();

afterAll(async () => {
  if (env.ok) await env.stop();
});

const CIRCULO_ESPACIOS = 'e5bac105b1e00000000000000000000b';

function uuid(semilla: number): string {
  const hex = semilla.toString(16).padStart(32, '0');
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-` +
    `8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  );
}

let n = 0;
const req = (): string => uuid(++n + 0x2000);

describe.skipIf(!env.ok)(`idempotencia de cupo de propuestas (ADR-0055)${skipNote(env)}`, () => {
  let e: ApiListo;

  beforeAll(() => {
    e = listo(env);
  });

  async function crearProblema(testigo: string): Promise<string> {
    const respuesta = await e.app.inject({
      method: 'POST',
      url: '/problemas',
      headers: como(testigo),
      payload: {
        requestId: req(),
        titulo: 'Problema para probar cuota',
        cuerpo:
          'Este es un problema concreto que necesita una solución. Se requiere una propuesta formal de cómo abordarlo.',
        circuloId: CIRCULO_ESPACIOS,
      },
    });
    expect(respuesta.statusCode, respuesta.body).toBe(201);
    return respuesta.json<{ id: string }>().id;
  }

  test('Reintento con mismo requestId NO consume cupo extra (secuencia de 4 pasos)', async () => {
    // Acción: crear usuario nuevo para prueba limpia
    const usuario1 = await entrar(e, 'integridad-cupo-1@udea.edu.co');
    const testigo = usuario1.testigo;
    const problemaId = await crearProblema(testigo);

    // PASO 1: Primera petición con requestId=A → consume cupo 1/3
    const requestIdA = req();
    const resp1 = await e.app.inject({
      method: 'POST',
      url: '/propuestas',
      headers: como(testigo),
      payload: {
        requestId: requestIdA,
        problemaId,
        titulo: 'Propuesta 1',
        cuerpo:
          'Contenido de la propuesta uno, con el detalle suficiente para pasar la validación.',
        plan: planDe(usuario1.miembroId),
      },
    });
    expect(resp1.statusCode).toBe(201);
    const prop1 = resp1.json<{ id: string }>();
    expect(prop1.id).toBeDefined();

    // PASO 2: Reintento con MISMO requestId=A → 409, NO consume cupo
    const resp2 = await e.app.inject({
      method: 'POST',
      url: '/propuestas',
      headers: como(testigo),
      payload: {
        requestId: requestIdA, // ← MISMO
        problemaId,
        titulo: 'Propuesta 1', // mismo cuerpo
        cuerpo:
          'Contenido de la propuesta uno, con el detalle suficiente para pasar la validación.',
        plan: planDe(usuario1.miembroId),
      },
    });
    // Debe ser 409 IDEMPOTENCY_KEY_REUSED
    expect([409, 200]).toContain(resp2.statusCode);
    if (resp2.statusCode === 409) {
      const error = resp2.json<{ codigo?: string }>();
      expect(error.codigo).toContain('IDEMPOTENCY');
    } else if (resp2.statusCode === 200) {
      // Replay idempotente: devuelve la misma propuesta
      const replay = resp2.json<{ id: string }>();
      expect(replay.id).toBe(prop1.id);
    }

    // PASO 3: Petición DISTINTA con requestId=B → consume cupo 2/3
    const requestIdB = req();
    const resp3 = await e.app.inject({
      method: 'POST',
      url: '/propuestas',
      headers: como(testigo),
      payload: {
        requestId: requestIdB, // ← DISTINTO
        problemaId,
        titulo: 'Propuesta 2',
        cuerpo:
          'Contenido bien diferente al anterior, también con longitud suficiente para validar.',
        plan: planDe(usuario1.miembroId),
      },
    });
    expect(resp3.statusCode).toBe(201);

    // PASO 4: Petición DISTINTA con requestId=C → consume cupo 3/3
    const requestIdC = req();
    const resp4 = await e.app.inject({
      method: 'POST',
      url: '/propuestas',
      headers: como(testigo),
      payload: {
        requestId: requestIdC, // ← DISTINTO
        problemaId,
        titulo: 'Propuesta 3',
        cuerpo:
          'Otro contenido distinto, con longitud suficiente para superar la validación mínima.',
        plan: planDe(usuario1.miembroId),
      },
    });
    expect(resp4.statusCode).toBe(201);

    // PASO 5: Quinta petición → debería rechazarse con 429 (cupo agotado)
    const requestIdD = req();
    const resp5 = await e.app.inject({
      method: 'POST',
      url: '/propuestas',
      headers: como(testigo),
      payload: {
        requestId: requestIdD,
        problemaId,
        titulo: 'Propuesta 4',
        cuerpo:
          'Esta propuesta no debería crearse porque el cupo semanal ya está agotado por completo.',
        plan: planDe(usuario1.miembroId),
      },
    });
    // FALLO ANTERIOR: esto era 429 (correcto ahora)
    // ANTES DEL ARREGLO: esto era 429 porque el reintento de paso 2 consumió cupo
    expect(resp5.statusCode).toBe(429);
    const errorCupo = resp5.json<{ codigo?: string }>();
    // El código real de cupo agotado es 'DEMASIADOS_INTENTOS' (ver `app.ts`): no existe un
    // código 'AGOTADO' en el producto, así que comprobamos el que de verdad emite la ruta.
    expect(errorCupo.codigo || '').toContain('DEMASIADOS_INTENTOS');
  });

  test('Cuota real sigue siendo 3 propuestas por semana tras el arreglo', async () => {
    const usuario2 = await entrar(e, 'integridad-cupo-2@udea.edu.co');
    const testigo = usuario2.testigo;
    const problemaId = await crearProblema(testigo);

    // Crear exactamente 3 propuestas distintas (con requestId distinto cada una)
    for (let i = 0; i < 3; i++) {
      const num = String(i + 1);
      const resp = await e.app.inject({
        method: 'POST',
        url: '/propuestas',
        headers: como(testigo),
        payload: {
          requestId: req(),
          problemaId,
          titulo: `Propuesta ${num}`,
          cuerpo: `Contenido número ${num}, con longitud suficiente para superar la validación del cuerpo.`,
          plan: planDe(usuario2.miembroId),
        },
      });
      expect(resp.statusCode).toBe(201);
    }

    // La cuarta debe ser rechazada
    const respCuarta = await e.app.inject({
      method: 'POST',
      url: '/propuestas',
      headers: como(testigo),
      payload: {
        requestId: req(),
        problemaId,
        titulo: 'Propuesta 4',
        cuerpo:
          'Esta cuarta propuesta debe fallar porque ya se agotó el cupo semanal de tres propuestas.',
        plan: planDe(usuario2.miembroId),
      },
    });
    expect(respCuarta.statusCode).toBe(429);
  });

  test('Dos peticiones SIMULTANEAS mismo requestId consumen cupo UNA sola vez', async () => {
    const usuario3 = await entrar(e, 'integridad-cupo-3@udea.edu.co');
    const testigo = usuario3.testigo;
    const problemaId = await crearProblema(testigo);

    const requestIdSimul = req();

    // Lanzar dos peticiones "simultaneas" (casi al mismo tiempo)
    const promise1 = e.app.inject({
      method: 'POST',
      url: '/propuestas',
      headers: como(testigo),
      payload: {
        requestId: requestIdSimul,
        problemaId,
        titulo: 'Propuesta simultanea',
        cuerpo:
          'Contenido de la propuesta simultánea, con longitud suficiente para pasar validación.',
        plan: planDe(usuario3.miembroId),
      },
    });

    const promise2 = e.app.inject({
      method: 'POST',
      url: '/propuestas',
      headers: como(testigo),
      payload: {
        requestId: requestIdSimul, // ← MISMO requestId
        problemaId,
        titulo: 'Propuesta simultanea',
        cuerpo:
          'Contenido de la propuesta simultánea, con longitud suficiente para pasar validación.',
        plan: planDe(usuario3.miembroId),
      },
    });

    const [resp1, resp2] = await Promise.all([promise1, promise2]);

    // Una debe ser 201 (la que crea). La otra depende de quién gana la carrera en
    // `identity.rate_consumption`: 200 si alcanza a leer el registro ya insertado (replay
    // idempotente), o 409 si choca contra el `ON CONFLICT` antes de leerlo. Ambas son
    // idempotentes: lo que NO puede pasar es que las dos consuman cupo (dos 201).
    const statuses = [resp1.statusCode, resp2.statusCode].sort((a, b) => a - b);
    expect(statuses).toContain(201);
    const otra = statuses.find((s) => s !== 201);
    expect([200, 409]).toContain(otra);

    // Ahora, verificamos que solo consumió 1 de 3 cupos (no 2)
    // Hacemos dos propuestas más con requestId distinto
    const resp3 = await e.app.inject({
      method: 'POST',
      url: '/propuestas',
      headers: como(testigo),
      payload: {
        requestId: req(),
        problemaId,
        titulo: 'Propuesta 2',
        cuerpo:
          'Contenido de la segunda propuesta, con longitud suficiente para pasar la validación.',
        plan: planDe(usuario3.miembroId),
      },
    });
    expect(resp3.statusCode).toBe(201);

    const resp4 = await e.app.inject({
      method: 'POST',
      url: '/propuestas',
      headers: como(testigo),
      payload: {
        requestId: req(),
        problemaId,
        titulo: 'Propuesta 3',
        cuerpo:
          'Contenido de la tercera propuesta, con longitud suficiente para pasar la validación.',
        plan: planDe(usuario3.miembroId),
      },
    });
    expect(resp4.statusCode).toBe(201);

    // La quinta debe fallar (cupo agotado)
    const resp5 = await e.app.inject({
      method: 'POST',
      url: '/propuestas',
      headers: como(testigo),
      payload: {
        requestId: req(),
        problemaId,
        titulo: 'Propuesta 4',
        cuerpo:
          'Esta propuesta no debe crearse porque el cupo semanal ya está agotado por completo.',
        plan: planDe(usuario3.miembroId),
      },
    });
    expect(resp5.statusCode).toBe(429);
  });
});
