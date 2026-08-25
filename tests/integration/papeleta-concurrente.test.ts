/**
 * El pico del último minuto: mucha gente votando la MISMA decisión casi a la vez.
 *
 * ═══ Por qué existe esta prueba ═══
 *
 * Las pruebas de carga del 2026-08-24 y 2026-08-25 (`docs/TESTING.md` §11.2) midieron esto contra la
 * API real con 300 personas y encontraron algo peor que lentitud: de 300 papeletas, **2 quedaron
 * contadas**, 124 recibieron un 500, y **174 de las 176 que recibieron un `201`** —«tu voto se
 * registró»— nunca llegaron a la base. Quien recibe un 201 no tiene ninguna señal de que su voto no
 * cuenta. En un sistema de gobernanza eso no es un problema de rendimiento: es una falla de
 * integridad electoral, y no hace falta llegar a 300 personas para dispararla.
 *
 * El mecanismo tiene dos caras y una sola raíz —`emitirPapeleta` lee el log, construye la papeleta
 * contra esa lectura y escribe una vez, sin reintentar:
 *
 *   · **El 500.** Si para cuando escribe el ledger ya avanzó MÁS de lo que esta papeleta esperaba,
 *     `append()` lanza `HeadConflictError`. Que no se reintente sola es correcto y está argumentado
 *     en `event-store.ts`: un conflicto con expectativa explícita es una respuesta del dominio. Lo
 *     que faltaba era que alguien lo atrapara y volviera a intentar con el estado fresco.
 *   · **La papeleta fantasma, la peor.** Si el ledger avanzó EXACTAMENTE lo mismo que el largo del
 *     log de esta papeleta —la papeleta de otra persona ocupó por casualidad ese mismo número—,
 *     `persistDecisionLog` entraba en su rama de «nada pendiente que escribir» sin comparar el
 *     CONTENIDO, y devolvía éxito sobre una escritura que nunca ocurrió.
 *
 * ═══ Qué comprueba, y por qué así ═══
 *
 * La afirmación es una sola y es la que le importa a quien vota: **cada `201` es un voto contado**.
 * No se exige que las diez papeletas entren —bajo un pico, rechazar es legítimo—; se exige que el
 * sistema no le mienta a nadie sobre si su voto existe. Y se exige que ese rechazo, cuando ocurra,
 * no sea un `500 ERROR_INTERNO`: votar a la vez que otra persona es tráfico normal, no una avería.
 *
 * Corre con `app.inject` en un solo proceso, como el resto de `tests/integration`. No hace falta
 * red real para reproducir la carrera: basta con que las diez lecturas del log ocurran antes de que
 * la primera escritura termine, que es exactamente lo que hace `Promise.all` sobre diez `inject`.
 */

import { afterAll, describe, expect, it } from 'vitest';

import { CIRCULOS } from '@koinonia/api';

import { apiEnv, como, entrar, FACILITADORA, listo, planDe, skipNote } from './helpers/api-env.js';

const env = await apiEnv();

afterAll(async () => {
  if (env.ok) await env.stop();
});

/** Suficientes para que la carrera sea segura y pocas para que la prueba siga siendo rápida. */
const VOTANTES = 10;

let contador = 0;
function req(): string {
  contador += 1;
  return `00000000-0000-4000-8000-${String(contador).padStart(12, '0')}`;
}

describe.skipIf(!env.ok)(`el pico de cierre de una votación${skipNote(env)}`, () => {
  it('cada papeleta aceptada es un voto contado, y nadie recibe un 500 por votar a la vez', async () => {
    const e = listo(env);
    const lucia = await entrar(e, FACILITADORA);
    const votantes = await Promise.all(
      Array.from({ length: VOTANTES }, (_, i) =>
        entrar(e, `pico${String(i).padStart(3, '0')}.concurrente@udea.edu.co`),
      ),
    );
    const primera = votantes[0];
    if (primera === undefined) throw new Error('sin votantes no hay pico que medir');

    const problema = await e.app.inject({
      method: 'POST',
      url: '/problemas',
      headers: como(primera.testigo),
      payload: {
        requestId: req(),
        titulo: 'El pico del último minuto de una votación',
        cuerpo:
          'Escenario de la prueba de concurrencia: mucha gente votando la misma decisión casi al ' +
          'mismo tiempo, que es como se vota de verdad cuando la ventana está por cerrar.',
        circuloId: CIRCULOS.espacios.id,
      },
    });
    expect(problema.statusCode).toBe(201);

    const propuesta = await e.app.inject({
      method: 'POST',
      url: '/propuestas',
      headers: como(primera.testigo),
      payload: {
        requestId: req(),
        problemaId: problema.json<{ id: string }>().id,
        titulo: 'Propuesta de referencia para el pico del último minuto',
        cuerpo:
          'Texto congelado sobre el que abrir una votación y medir qué le pasa al sistema cuando ' +
          'diez personas responden a la vez.',
        plan: planDe(primera.miembroId),
      },
    });
    expect(propuesta.statusCode).toBe(201);

    const decision = await e.app.inject({
      method: 'POST',
      url: '/decisiones',
      headers: como(lucia.testigo),
      payload: {
        requestId: req(),
        propuestaId: propuesta.json<{ id: string }>().id,
        metodo: 'simple-majority',
        duracionHoras: 1,
      },
    });
    expect(decision.statusCode).toBe(201);
    const abierta = decision.json<{ id: string; huellaVersion: string; cierraEn: number }>();

    // Al último minuto de la ventana: el reloj es un puerto (ADR-0001), así que esto no duerme el
    // proceso — la votación de verdad está a punto de cerrar.
    e.reloj.avanzar(abierta.cierraEn - 60_000 - e.reloj.now());

    const respuestas = await Promise.all(
      votantes.map((votante, i) =>
        e.app.inject({
          method: 'POST',
          url: `/decisiones/${abierta.id}/papeletas`,
          headers: como(votante.testigo),
          payload: {
            requestId: req(),
            huellaVersion: abierta.huellaVersion,
            respuesta: { tipo: 'binary', aprueba: i % 2 === 0 },
          },
        }),
      ),
    );

    const aceptadas = respuestas.filter((r) => r.statusCode === 201);
    const rotas = respuestas.filter((r) => r.statusCode >= 500);

    // Votar a la vez que otra persona es tráfico normal de una asamblea. Que el sistema conteste
    // «algo se rompió de nuestro lado» ante lo más previsible que le puede pasar no es aceptable.
    expect(
      rotas.map((r) => ({ estado: r.statusCode, cuerpo: r.json<{ codigo?: string }>().codigo })),
    ).toEqual([]);

    // Cuántos votos hay de verdad no lo dice la pantalla de la votación abierta: lo dice el
    // escrutinio, que vuelve a leer el log persistido. Es la única cuenta que no puede venir de lo
    // que `emitirPapeleta` creía tener en memoria, y por eso es la que sirve de testigo acá.
    e.reloj.avanzar(120_000);
    // Entre abrir la votación y cerrarla pasó más de una hora de reloj, y una hora sin actividad
    // cierra la sesión (ADR-0050). Renovarla es lo que haría cualquier persona que vuelve justo
    // para el cierre; no renovarla haría fallar la prueba por algo que no está midiendo.
    const luciaAlCierre = await entrar(e, FACILITADORA);
    const cierre = await e.app.inject({
      method: 'POST',
      url: `/decisiones/${abierta.id}/cerrar`,
      headers: como(luciaAlCierre.testigo),
      payload: { requestId: req() },
    });
    expect(cierre.statusCode).toBe(200);

    const resultado = await e.app.inject({
      method: 'GET',
      url: `/decisiones/${abierta.id}/resultado`,
      headers: como(luciaAlCierre.testigo),
    });
    expect(resultado.statusCode).toBe(200);
    const emitidas = resultado.json<{ participacion: { emitidas: number } }>().participacion
      .emitidas;

    // La afirmación entera de esta prueba: ni un solo «tu voto se registró» sobre un voto que no
    // existe. Si `emitidas` es menor que los 201, hay papeletas fantasma.
    expect({ aceptadas: aceptadas.length, contadas: emitidas }).toEqual({
      aceptadas: aceptadas.length,
      contadas: aceptadas.length,
    });

    // Y que la prueba esté ejerciendo el pico de verdad, no una cola: si sólo una persona llegara a
    // votar, todo lo de arriba pasaría sin haber comprobado nada.
    expect(aceptadas.length).toBeGreaterThan(1);
  });
});
