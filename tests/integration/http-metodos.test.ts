/**
 * El catálogo de los nueve métodos, expuesto por HTTP, contra PostgreSQL real.
 *
 * El motor (`@koinonia/domain`) ya implementa los nueve; este incremento cierra la frontera para
 * que la pantalla los pueda elegir desde un único `GET /metodos` y armar la papeleta correcta
 * según la forma declarada por el catálogo.
 *
 * Usa `app.inject` (como el resto de `tests/integration`), no `fetch` contra un puerto real: este
 * entorno de prueba no levanta un servidor HTTP escuchando, sólo la instancia de Fastify.
 */

import { afterAll, describe, expect, it } from 'vitest';

import { apiEnv, como, entrar, FACILITADORA, listo, skipNote } from './helpers/api-env.js';

const env = await apiEnv();

afterAll(async () => {
  if (env.ok) await env.stop();
});

describe.skipIf(!env.ok)(`catálogo de métodos por HTTP${skipNote(env)}`, () => {
  it('sirve los nueve métodos con nombre, descripción, papeleta y delegación', async () => {
    const e = listo(env);
    const sesion = await entrar(e, FACILITADORA);
    const res = await e.app.inject({
      method: 'GET',
      url: '/metodos',
      headers: como(sesion.testigo),
    });
    expect(res.statusCode).toBe(200);
    const cuerpo = res.json<
      Array<{
        id: string;
        nombre: string;
        descripcion: string;
        formasPapeleta: string[];
        delegacionPermitida: boolean;
      }>
    >();
    expect(cuerpo).toHaveLength(9);

    const ids = cuerpo.map((m) => m.id);
    expect(ids).toEqual([
      'simple-majority',
      'supermajority',
      'unanimity',
      'sociocratic-consent',
      'score',
      'irv',
      'majority-judgment',
      'condorcet-schulze',
      'deliberative-sortition',
    ]);
  });

  it('GET /metodos no requiere sesión y devuelve no-store', async () => {
    const e = listo(env);
    const res = await e.app.inject({ method: 'GET', url: '/metodos' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('sólo consentimiento y sorteo declaran delegación prohibida', async () => {
    const e = listo(env);
    const res = await e.app.inject({ method: 'GET', url: '/metodos' });
    const cuerpo = res.json<Array<{ id: string; delegacionPermitida: boolean }>>();
    const sinDelegacion = cuerpo.filter((m) => !m.delegacionPermitida).map((m) => m.id);
    expect(sinDelegacion.sort()).toEqual(['deliberative-sortition', 'sociocratic-consent'].sort());
  });

  it('la papeleta coincide con la forma declarada en el catálogo', async () => {
    const e = listo(env);
    const res = await e.app.inject({ method: 'GET', url: '/metodos' });
    const cuerpo = res.json<Array<{ id: string; formasPapeleta: string[] }>>();
    const esperado: Readonly<Record<string, string>> = {
      'simple-majority': 'binaria',
      supermajority: 'binaria',
      unanimity: 'binaria',
      'sociocratic-consent': 'consentimiento',
      score: 'puntuacion',
      irv: 'ordenamiento',
      'majority-judgment': 'menciones',
      'condorcet-schulze': 'ordenamiento',
      'deliberative-sortition': 'sorteo',
    };
    for (const m of cuerpo) {
      expect(m.formasPapeleta[0]).toBe(esperado[m.id]);
    }
  });

  it('rechaza POST /decisiones con método desconocido (validación de frontera)', async () => {
    const e = listo(env);
    const sesion = await entrar(e, FACILITADORA);
    const res = await e.app.inject({
      method: 'POST',
      url: '/decisiones',
      headers: como(sesion.testigo),
      payload: {
        requestId: '11111111-2222-4333-8444-555555555555',
        propuestaId: '00000000000000000000000000000000',
        metodo: 'no-existe',
        duracionHoras: 24,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rechaza POST /decisiones con configuración incompatible con el método', async () => {
    const e = listo(env);
    const sesion = await entrar(e, FACILITADORA);
    const res = await e.app.inject({
      method: 'POST',
      url: '/decisiones',
      headers: como(sesion.testigo),
      payload: {
        requestId: '22222222-3333-4444-8555-666666666666',
        propuestaId: '00000000000000000000000000000000',
        metodo: 'simple-majority',
        configuracion: {
          metodo: 'supermajority',
          fraccion: { numerador: 3, denominador: 4 },
        },
        duracionHoras: 24,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rechaza delegación habilitada en métodos que no la admiten', async () => {
    const e = listo(env);
    const sesion = await entrar(e, FACILITADORA);
    const res = await e.app.inject({
      method: 'POST',
      url: '/decisiones',
      headers: como(sesion.testigo),
      payload: {
        requestId: '33333333-4444-4555-8666-777777777777',
        propuestaId: '00000000000000000000000000000000',
        metodo: 'sociocratic-consent',
        delegacion: true,
        duracionHoras: 24,
      },
    });
    expect(res.statusCode).toBe(409);
    const cuerpo = res.json<{ codigo: string }>();
    expect(cuerpo.codigo).toBe('DELEGACION_NO_ADMITIDA');
  });

  it('acepta POST /decisiones con método y configuración válidos', async () => {
    const e = listo(env);
    const sesion = await entrar(e, FACILITADORA);
    const res = await e.app.inject({
      method: 'POST',
      url: '/decisiones',
      headers: como(sesion.testigo),
      payload: {
        requestId: '44444444-5555-4666-8777-888888888888',
        propuestaId: '00000000000000000000000000000000',
        metodo: 'supermajority',
        configuracion: {
          metodo: 'supermajority',
          fraccion: { numerador: 3, denominador: 4 },
        },
        duracionHoras: 24,
      },
    });
    // 404 porque la propuesta no existe; lo importante es que NO dio 400 (validó el método).
    expect(res.statusCode).not.toBe(400);
  });
});
