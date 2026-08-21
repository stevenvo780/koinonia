/**
 * El enlace mágico: un solo uso, con caducidad y **resistente a la reproducción**.
 *
 * La tercera es la que casi nadie prueba, y es la que importa. «Un solo uso» implementado como
 * «leer la fila, ver que no está consumida, escribir que sí» tiene un hueco entre la lectura y la
 * escritura: dos peticiones que entren a la vez leen las dos «no consumida» y abren dos sesiones.
 * Aquí el consumo es un `UPDATE … WHERE consumed_at IS NULL RETURNING`, una comparación-y-cambio
 * atómica, y esta prueba lanza los dos canjes **en paralelo de verdad** para que el hueco, si
 * existiera, se manifieste.
 *
 * Y se comprueba también lo que NO se guarda: ni una dirección IP, en ninguna tabla.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { apiEnv, type ApiListo, listo, skipNote, tokenDelCorreo } from './helpers/api-env.js';

const env = await apiEnv();

afterAll(async () => {
  if (env.ok) await env.stop();
});

const MINUTO = 60_000;

async function pedirEnlace(e: ApiListo, correo: string): Promise<string> {
  const respuesta = await e.app.inject({
    method: 'POST',
    url: '/auth/enlace',
    payload: { correo },
  });
  expect(respuesta.statusCode).toBe(202);
  const mensaje = e.correo.ultimoPara(correo);
  expect(mensaje).toBeDefined();
  return tokenDelCorreo(mensaje!.text);
}

describe.skipIf(!env.ok)(`enlace mágico${skipNote(env)}`, () => {
  let e: ApiListo;

  beforeAll(() => {
    e = listo(env);
  });

  it('sólo entran los correos institucionales, y se dice por qué', async () => {
    const respuesta = await e.app.inject({
      method: 'POST',
      url: '/auth/enlace',
      payload: { correo: 'alguien@gmail.com' },
    });
    expect(respuesta.statusCode).toBe(422);
    const cuerpo = respuesta.json<{ codigo: string; mensaje: string; campo?: string }>();
    expect(cuerpo.codigo).toBe('CORREO_NO_INSTITUCIONAL');
    expect(cuerpo.mensaje).toMatch(/@udea\.edu\.co/u);
    expect(cuerpo.campo).toBe('correo');
  });

  it('el correo lleva el enlace, dice que sirve una vez y dice cuánto dura', async () => {
    await pedirEnlace(e, 'sara.munoz@udea.edu.co');
    const mensaje = e.correo.ultimoPara('sara.munoz@udea.edu.co');
    expect(mensaje?.text).toMatch(/UNA sola vez/u);
    expect(mensaje?.text).toMatch(/vence en 15 minutos/u);
    // Y la nota de no afiliación, que va al pie de todo (GOVERNANCE §9).
    expect(mensaje?.text).toMatch(/no es un órgano de la Universidad de Antioquia/u);
  });

  it('un enlace sirve UNA vez: el segundo canje se rechaza y lo dice con esas palabras', async () => {
    const token = await pedirEnlace(e, 'andres.villa@udea.edu.co');

    const primero = await e.app.inject({ method: 'POST', url: '/auth/sesion', payload: { token } });
    expect(primero.statusCode).toBe(200);

    const segundo = await e.app.inject({ method: 'POST', url: '/auth/sesion', payload: { token } });
    expect(segundo.statusCode).toBe(401);
    const cuerpo = segundo.json<{ codigo: string; mensaje: string }>();
    expect(cuerpo.codigo).toBe('ENLACE_YA_USADO');
    expect(cuerpo.mensaje).toMatch(/ya se usó/u);
  });

  it('REPRODUCCIÓN — dos canjes simultáneos del mismo enlace: exactamente una sesión', async () => {
    const token = await pedirEnlace(e, 'carrera@udea.edu.co');

    // En paralelo de verdad: si el consumo no fuera atómico, las dos lecturas verían «no consumida»
    // y las dos escribirían. Es exactamente el hueco que explota un ataque de reproducción.
    const [a, b, c] = await Promise.all([
      e.app.inject({ method: 'POST', url: '/auth/sesion', payload: { token } }),
      e.app.inject({ method: 'POST', url: '/auth/sesion', payload: { token } }),
      e.app.inject({ method: 'POST', url: '/auth/sesion', payload: { token } }),
    ]);

    const exitosas = [a, b, c].filter((r) => r.statusCode === 200);
    const fallidas = [a, b, c].filter((r) => r.statusCode === 401);
    expect(exitosas).toHaveLength(1);
    expect(fallidas).toHaveLength(2);
    for (const fallo of fallidas) {
      expect(fallo.json<{ codigo: string }>().codigo).toBe('ENLACE_YA_USADO');
    }
  });

  it('el enlace vence a los 15 minutos, y el minuto 14 todavía sirve', async () => {
    const aTiempo = await pedirEnlace(e, 'a.tiempo@udea.edu.co');
    e.reloj.avanzar(14 * MINUTO);
    const dentro = await e.app.inject({
      method: 'POST',
      url: '/auth/sesion',
      payload: { token: aTiempo },
    });
    expect(dentro.statusCode).toBe(200);

    const tarde = await pedirEnlace(e, 'muy.tarde@udea.edu.co');
    e.reloj.avanzar(15 * MINUTO + 1);
    const fuera = await e.app.inject({
      method: 'POST',
      url: '/auth/sesion',
      payload: { token: tarde },
    });
    expect(fuera.statusCode).toBe(401);
    expect(fuera.json<{ codigo: string }>().codigo).toBe('ENLACE_VENCIDO');
  });

  it('un enlace inventado no dice si el correo existe: siempre el mismo rechazo', async () => {
    const respuesta = await e.app.inject({
      method: 'POST',
      url: '/auth/sesion',
      payload: { token: 'a'.repeat(43) },
    });
    expect(respuesta.statusCode).toBe(401);
    expect(respuesta.json<{ codigo: string }>().codigo).toBe('ENLACE_INVALIDO');
  });

  it('del testigo NO se guarda el testigo: en la base sólo hay su huella', async () => {
    const token = await pedirEnlace(e, 'huella@udea.edu.co');
    const client = await e.superPool.connect();
    try {
      const { rows } = await client.query<{ token_hash: string }>(
        'SELECT token_hash FROM identity.magic_link',
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/u);
        expect(row.token_hash).not.toContain(token);
      }
      // Y el token en claro no aparece en ninguna columna de texto de la bóveda.
      const busqueda = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM identity.magic_link WHERE token_hash = $1`,
        [token],
      );
      expect(busqueda.rows[0]?.n).toBe('0');
    } finally {
      client.release();
    }
  });

  it('NO se registra ninguna dirección IP: no hay ni una columna donde ponerla', async () => {
    const client = await e.superPool.connect();
    try {
      // Ninguna columna de ningún esquema nuestro se llama como una dirección.
      const { rows } = await client.query<{ tabla: string; columna: string }>(
        `SELECT table_name AS tabla, column_name AS columna
           FROM information_schema.columns
          WHERE table_schema IN ('identity', 'governance')
            AND (column_name ~* '(^|_)(ip|addr|address|remote|client_host|user_agent)($|_)'
                 OR column_name ILIKE '%ip_address%')`,
      );
      expect(rows).toEqual([]);

      // Y ninguna columna de tipo `inet` o `cidr`, que es la otra forma de guardarla.
      const tipos = await client.query<{ tabla: string; columna: string }>(
        `SELECT table_name AS tabla, column_name AS columna
           FROM information_schema.columns
          WHERE table_schema IN ('identity', 'governance')
            AND data_type IN ('inet', 'cidr', 'macaddr')`,
      );
      expect(tipos.rows).toEqual([]);
    } finally {
      client.release();
    }
  });

  it('el control de abuso cuenta por sujeto con pimienta del día, no por dirección', async () => {
    const correo = 'insistente@udea.edu.co';
    const respuestas = [];
    for (let i = 0; i < 6; i++) {
      respuestas.push(
        await e.app.inject({ method: 'POST', url: '/auth/enlace', payload: { correo } }),
      );
    }
    // Cinco por hora; el sexto se frena.
    expect(respuestas.slice(0, 5).every((r) => r.statusCode === 202)).toBe(true);
    expect(respuestas[5]?.statusCode).toBe(429);
    const cuerpo = respuestas[5]!.json<{ codigo: string; queHacer?: string }>();
    expect(cuerpo.codigo).toBe('DEMASIADOS_INTENTOS');
    // Un «esperá» sin plazo es un muro: se dice cuándo se libera.
    expect(cuerpo.queHacer).toBeDefined();

    // Y lo que quedó guardado es una huella, no el correo.
    const client = await e.superPool.connect();
    try {
      const { rows } = await client.query<{ bucket_key: string }>(
        'SELECT bucket_key FROM identity.rate_bucket',
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row.bucket_key).toMatch(/^[0-9a-f]{64}$/u);
    } finally {
      client.release();
    }
  });

  it('la pimienta rota a diario: el mismo sujeto produce claves sin relación de un día a otro', async () => {
    const { bucketKey } = await import('@koinonia/api');
    const hoy = Date.UTC(2026, 7, 21, 10, 0, 0);
    const manana = hoy + 24 * 60 * 60 * 1000;
    const a = bucketKey('secreto', 'enlace', 'daniela@udea.edu.co', hoy);
    const b = bucketKey('secreto', 'enlace', 'daniela@udea.edu.co', manana);
    const mismoDia = bucketKey('secreto', 'enlace', 'daniela@udea.edu.co', hoy + 3_600_000);
    expect(a).toBe(mismoDia);
    expect(a).not.toBe(b);
  });

  it('salir revoca la sesión: el mismo testigo deja de valer', async () => {
    const token = await pedirEnlace(e, 'que.sale@udea.edu.co');
    const sesion = await e.app.inject({ method: 'POST', url: '/auth/sesion', payload: { token } });
    const testigo = sesion.json<{ testigo: string }>().testigo;
    const cabeceras = { authorization: `Bearer ${testigo}` };

    expect(
      (await e.app.inject({ method: 'GET', url: '/auth/yo', headers: cabeceras })).statusCode,
    ).toBe(200);
    await e.app.inject({ method: 'POST', url: '/auth/salir', headers: cabeceras });
    expect(
      (await e.app.inject({ method: 'GET', url: '/auth/yo', headers: cabeceras })).statusCode,
    ).toBe(401);
  });
});
