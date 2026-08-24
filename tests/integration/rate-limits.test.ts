/**
 * Los cupos anti-spam de T-12, contra la aplicación real y PostgreSQL real.
 *
 * ═══ Por qué existe este fichero ═══
 *
 * `docs/THREAT_MODEL.md` prometía tres cupos —3 propuestas/7 días, 20 comentarios/24 h, 1 objeción
 * por proceso— y prometía este archivo con el nombre `rate-limits.spec.ts`. Una verificación del
 * 2026-08-24 encontró que **ninguno de los tres existía**: se crearon cinco propuestas seguidas
 * contra la API real sin que nada las rechazara.
 *
 * ═══ Por qué `.test.ts` y no `.spec.ts` ═══
 *
 * `vitest.config.ts` sólo incluye `**\/*.test.ts` bajo `tests/**`; `.spec.ts` es el sufijo que usa
 * Playwright en `tests/e2e/`. Un fichero llamado `rate-limits.spec.ts` en esta carpeta no lo
 * correría NINGÚN runner: quedaría exactamente tan roto como la promesa que vino a cerrar. Este
 * archivo lleva el nombre que el proyecto usa de verdad para que `pnpm test` lo ejecute; el nombre
 * prometido en THREAT_MODEL.md queda como una discrepancia documental para quien lo revise (no es
 * un fichero de esta oleada, así que no se edita acá).
 *
 * ═══ Qué NO cubre este fichero ═══
 *
 * El tercer cupo prometido —«1 objeción por proceso, la segunda exige respaldo de otra persona»—
 * no es una ventana de tiempo: es una regla sobre CUÁNTAS objeciones lleva ya una persona en la
 * vida entera de una decisión, y la segunda depende de un respaldo que hoy no existe como concepto
 * en el contrato de `emitirPapeleta` (`packages/contracts/src/http.ts`) ni en `service.ts`. Meterlo
 * en `rate-limit.ts` con el mecanismo de ventana-y-pimienta de este fichero sería la herramienta
 * equivocada para el trabajo: ese mecanismo purga y correlaciona por VENTANA DE TIEMPO, no por
 * «cuántas objeciones lleva esta persona en este proceso», que hay que leerlo del propio estado de
 * la decisión (`state.objections`, que ya trae `.by`). Queda pendiente, y de quien sea dueño de
 * `service.ts` / `packages/domain` (fuera de la propiedad de este encargo).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { apiEnv, como, entrar, planDe, type ApiListo, listo, skipNote } from './helpers/api-env.js';

const env = await apiEnv();

afterAll(async () => {
  if (env.ok) await env.stop();
});

/** Todo el que entra queda en Asamblea y en Espacios (`udeaIdentityAdapter`). */
const CIRCULO_ESPACIOS = 'e5bac105b1e00000000000000000000b';

function uuid(semilla: number): string {
  const hex = semilla.toString(16).padStart(32, '0');
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-` +
    `8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  );
}

let n = 0;
const req = (): string => uuid(++n + 0x1000);

interface ErrorVisto {
  readonly codigo: string;
  readonly mensaje: string;
  readonly queHacer?: string;
}

describe.skipIf(!env.ok)(`cupos anti-spam de T-12${skipNote(env)}`, () => {
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
        titulo: 'La sala de estudio cierra demasiado temprano para la nocturna',
        cuerpo:
          'Quienes cursamos de noche llegamos cuando ya está por cerrar y no queda tiempo real de ' +
          'estudio en la sala común.',
        circuloId: CIRCULO_ESPACIOS,
      },
    });
    expect(respuesta.statusCode, respuesta.body).toBe(201);
    return respuesta.json<{ id: string }>().id;
  }

  async function postularPropuesta(
    testigo: string,
    problemaId: string,
    responsableId: string,
    numero: number,
  ): Promise<{ readonly statusCode: number; readonly cuerpo: unknown }> {
    const respuesta = await e.app.inject({
      method: 'POST',
      url: '/propuestas',
      headers: como(testigo),
      payload: {
        requestId: req(),
        problemaId,
        titulo: `Abrir la sala hasta más tarde — intento ${String(numero)}`,
        cuerpo:
          `Propuesta número ${String(numero)}: abrir la sala de estudio hasta las nueve de la ` +
          'noche al menos tres días por semana, empezando por la jornada de exámenes.',
        plan: planDe(responsableId),
      },
    });
    return { statusCode: respuesta.statusCode, cuerpo: respuesta.json() };
  }

  it('cuarta_propuesta_en_7_dias_es_rechazada: la cuarta propuesta de la semana se rechaza, y dice cuándo se puede volver a intentar', async () => {
    const mario = await entrar(e, 'mario.propone@udea.edu.co');
    const problemaId = await crearProblema(mario.testigo);

    const primera = await postularPropuesta(mario.testigo, problemaId, mario.miembroId, 1);
    expect(primera.statusCode).toBe(201);
    const segunda = await postularPropuesta(mario.testigo, problemaId, mario.miembroId, 2);
    expect(segunda.statusCode).toBe(201);
    const tercera = await postularPropuesta(mario.testigo, problemaId, mario.miembroId, 3);
    expect(tercera.statusCode).toBe(201);

    // La cuarta, en la misma semana, es la que hoy (2026-08-24) NO rechazaba nada: se crearon
    // cinco propuestas seguidas contra la API real sin que nada las parara. Con el cupo puesto,
    // ésta tiene que caer.
    const cuarta = await postularPropuesta(mario.testigo, problemaId, mario.miembroId, 4);
    expect(cuarta.statusCode).toBe(429);
    const error = cuarta.cuerpo as ErrorVisto;
    expect(error.codigo).toBe('DEMASIADOS_INTENTOS');
    // Nunca un 429 seco: dice qué pasó, en palabras, sin jerga...
    expect(error.mensaje).toMatch(/propuestas/i);
    expect(error.mensaje.toLowerCase()).not.toContain('rate limit');
    expect(error.mensaje.toLowerCase()).not.toContain('bucket');
    // ...y CUÁNDO se puede volver a intentar: un «esperá» sin plazo es un muro.
    expect(error.queHacer).toBeDefined();
    expect(error.queHacer).toMatch(/\d{2}:\d{2} UTC/u);
  });

  it(
    'limites_por_memberid_no_por_cliente: el cupo es de la persona, no de la sesión — dos ' +
      'testigos distintos de la misma cuenta comparten un único cupo',
    async () => {
      const laura1 = await entrar(e, 'laura.doscliente@udea.edu.co');
      const problemaId = await crearProblema(laura1.testigo);

      // Dos propuestas con el primer testigo («primer navegador»).
      expect(
        (await postularPropuesta(laura1.testigo, problemaId, laura1.miembroId, 1)).statusCode,
      ).toBe(201);
      expect(
        (await postularPropuesta(laura1.testigo, problemaId, laura1.miembroId, 2)).statusCode,
      ).toBe(201);

      // La misma persona entra de nuevo: un testigo NUEVO, la misma cuenta («segundo navegador»).
      const laura2 = await entrar(e, 'laura.doscliente@udea.edu.co');
      expect(laura2.miembroId).toBe(laura1.miembroId);
      expect(laura2.testigo).not.toBe(laura1.testigo);

      // La tercera propuesta, con el testigo NUEVO, todavía entra: van 3 en total.
      const tercera = await postularPropuesta(laura2.testigo, problemaId, laura2.miembroId, 3);
      expect(tercera.statusCode).toBe(201);

      // La cuarta, con cualquiera de los dos testigos, tiene que caer: el cupo cuenta por
      // `MemberId`, no por testigo de sesión ni por «cliente». Si contara por sesión, cambiar de
      // testigo sería la forma trivial de esquivarlo.
      const cuarta = await postularPropuesta(laura1.testigo, problemaId, laura1.miembroId, 4);
      expect(cuarta.statusCode).toBe(429);
    },
  );

  it('vigésimo_primer_aporte_en_24h_es_rechazado: el aporte 21 del día se rechaza, repartido entre varias conversaciones', async () => {
    const lucia = await entrar(e, 'lucia.facilita@udea.edu.co');
    const nora = await entrar(e, 'nora.aporta@udea.edu.co');

    // El dominio ya limita a 10 aportes por autor y por ETAPA de una misma deliberación
    // (`DEFAULT_MAX_CONTRIBUTIONS_PER_AUTHOR_PER_STAGE`, packages/domain). Ese control es de OTRA
    // capa y protege OTRA cosa —que una conversación puntual no se ahogue—; el cupo de T-12 protege
    // el día entero de una persona, CRUZANDO conversaciones. Por eso esta prueba abre tres
    // deliberaciones y reparte los aportes entre ellas: así se ejercita el cupo de T-12 sin chocar
    // contra el otro límite, que sigue vigente y es correcto que exista.
    const deliberacionIds: string[] = [];
    for (let c = 0; c < 3; c++) {
      const problemaId = await crearProblema(lucia.testigo);
      const abierta = await e.app.inject({
        method: 'POST',
        url: '/deliberaciones',
        headers: como(lucia.testigo),
        payload: { requestId: req(), problemaId, duracionHoras: 48 },
      });
      expect(abierta.statusCode, abierta.body).toBe(201);
      deliberacionIds.push(abierta.json<{ id: string }>().id);
    }

    async function aportar(deliberacionId: string, numero: number): Promise<number> {
      const respuesta = await e.app.inject({
        method: 'POST',
        url: `/deliberaciones/${deliberacionId}/aportes`,
        headers: como(nora.testigo),
        payload: {
          requestId: req(),
          tipo: 'posicion',
          modo: 'pregunta_aclaratoria',
          texto: `¿Pregunta aclaratoria número ${String(numero)} sobre el horario propuesto?`,
        },
      });
      return respuesta.statusCode;
    }

    // 20 aportes: 7 + 7 + 6, ninguna conversación pasa de 10 en su etapa.
    const reparto = [7, 7, 6];
    let total = 0;
    for (const [conversacion, cuantos] of reparto.entries()) {
      for (let i = 1; i <= cuantos; i++) {
        total += 1;
        const codigo = await aportar(deliberacionIds[conversacion] ?? '', total);
        expect(
          codigo,
          `el aporte ${String(total)} (conversación ${String(conversacion)}) tendría que entrar`,
        ).toBe(201);
      }
    }
    expect(total).toBe(20);

    // El 21, en el mismo día y en una conversación que todavía no llegó a su propio tope de
    // etapa (queda en 7 de 10), es el que hoy no rechazaba nada.
    const veintiuno = await e.app.inject({
      method: 'POST',
      url: `/deliberaciones/${deliberacionIds[0] ?? ''}/aportes`,
      headers: como(nora.testigo),
      payload: {
        requestId: req(),
        tipo: 'posicion',
        modo: 'pregunta_aclaratoria',
        texto: '¿Pregunta aclaratoria número 21 sobre el horario propuesto?',
      },
    });
    expect(veintiuno.statusCode).toBe(429);
    const error = veintiuno.json<ErrorVisto>();
    expect(error.codigo).toBe('DEMASIADOS_INTENTOS');
    expect(error.mensaje).toMatch(/aportes|día/i);
    expect(error.queHacer).toMatch(/\d{2}:\d{2} UTC/u);
  });
});
