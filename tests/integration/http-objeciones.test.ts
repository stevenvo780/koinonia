/**
 * Pruebas de integración de `registrarRutasDeObjeciones`
 * (`services/api/src/http/rutas-objeciones.ts`), contra PostgreSQL real.
 *
 * ═══ Por qué un segundo Fastify, y no `e.app` directamente ═══
 *
 * `registrarRutasDeObjeciones` todavía no está enganchada a `buildApp` —le toca a un agente
 * integrador, igual que a `registrarRutasDeCierreCiclo` en su momento (ver la cabecera de
 * `services/api/src/http/rutas-objeciones.ts`)—, así que no hay manera de llegar a
 * `POST /decisiones/:id/objeciones/:id/desestimar` a través de `e.app`. Este fichero monta un
 * Fastify mínimo aparte que SÍ comparte el mismo `pool` de PostgreSQL real que `e.app` —así que
 * escribe sobre el mismo agregado de decisión—, y llama al registrador tal como lo hará `app.ts`
 * el día que lo enganche (mismo patrón que
 * `tests/integration/http-etapas-objeciones-enmiendas.test.ts`). Todo lo previo a desestimar —crear
 * el problema, la propuesta, abrir la votación, emitir la papeleta que objeta— pasa por `e.app`, que
 * ya tiene esas rutas cableadas de verdad.
 *
 * La identidad en el Fastify nuevo viaja por dos cabeceras de prueba en vez del testigo real (misma
 * nota que los arneses hermanos: la resolución real de sesión no es el trabajo de este arnés, ya la
 * prueban `http-autorizacion.test.ts` y compañía contra la app entera).
 */

import { loadDecisionLog } from '@koinonia/api';
import {
  type Actor,
  blockingObjections,
  circleId as toCircleId,
  type EffectiveBallot,
  mergeObjections,
  type MemberId,
  objectionId as toObjectionId,
  replay,
  type Role,
  sortObjectionPanel,
} from '@koinonia/domain';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type ContextoObjeciones,
  registrarRutasDeObjeciones,
} from '../../services/api/src/http/rutas-objeciones.js';

import {
  apiEnv,
  type ApiListo,
  como,
  entrar,
  FACILITADORA,
  listo,
  planDe,
  skipNote,
} from './helpers/api-env.js';

const env = await apiEnv();

afterAll(async () => {
  if (env.ok) await env.stop();
});

// El mismo círculo fijo que usan los demás escenarios de integración (`circles.ts:CIRCULOS.espacios`).
const CIRCULO = 'e5bac105b1e00000000000000000000b';

let n = 0;
function req(): string {
  const hex = (++n + 0x8000).toString(16).padStart(32, '0');
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-` +
    `8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  );
}

const ARGUMENTO =
  'Esta propuesta deja al seminario permanente sin sala durante todo el semestre siguiente.';

// ── Arnés del segundo Fastify, para la ruta nueva ────────────────────────────────────────────────

const CABECERA_MIEMBRO = 'x-test-member-id';
const CABECERA_ROLES = 'x-test-roles';

function actorDeCabeceras(request: FastifyRequest): Actor {
  const memberId = request.headers[CABECERA_MIEMBRO];
  if (typeof memberId !== 'string' || memberId === '') {
    return { memberId: undefined, roles: ['observer'], circles: [] };
  }
  const rolesRaw = request.headers[CABECERA_ROLES];
  const roles = (typeof rolesRaw === 'string' ? rolesRaw.split(',') : ['member']) as Role[];
  return { memberId: memberId as MemberId, roles, circles: [toCircleId(CIRCULO)] };
}

function comoObjeciones(
  miembroId: string,
  roles: readonly string[] = ['member'],
): Record<string, string> {
  return { [CABECERA_MIEMBRO]: miembroId, [CABECERA_ROLES]: roles.join(',') };
}

interface CodigoDeError {
  readonly codigo: string;
  readonly mensaje: string;
}

interface RespuestaDesestimacion {
  readonly decisionId: string;
  readonly objectionId: string;
  readonly panel: readonly string[];
  readonly tamanoPanel: number;
  readonly votos: number;
  readonly umbral: string;
  readonly motivacion: string;
  readonly desestimadaEn: number;
}

describe.skipIf(!env.ok)(`desestimar una objeción por HTTP${skipNote(env)}`, () => {
  let e: ApiListo;
  let objeciones: FastifyInstance;

  let facilitadora: { testigo: string; miembroId: string };
  let objetor: { testigo: string; miembroId: string };
  let panelista1: { testigo: string; miembroId: string };
  let panelista2: { testigo: string; miembroId: string };
  let panelista3: { testigo: string; miembroId: string };

  beforeAll(async () => {
    e = listo(env);
    facilitadora = await entrar(e, FACILITADORA);
    objetor = await entrar(e, 'objetor.uno@udea.edu.co');
    panelista1 = await entrar(e, 'panelista.uno@udea.edu.co');
    panelista2 = await entrar(e, 'panelista.dos@udea.edu.co');
    panelista3 = await entrar(e, 'panelista.tres@udea.edu.co');

    objeciones = Fastify({ logger: false });
    const ctx: ContextoObjeciones = {
      deps: {
        pool: e.pool,
        ports: {
          clock: { now: () => e.reloj.now() },
          random: {
            bytes: (cantidad) => e.azar.bytes(cantidad),
            opaqueId: () => e.azar.opaqueId(),
            uuid: () => e.azar.uuid(),
          },
          mailer: e.correo,
          identity: {
            nombre: 'sin-uso-en-esta-prueba',
            verify: () =>
              Promise.resolve({
                ok: false,
                code: 'CORREO_NO_INSTITUCIONAL',
                detail: 'este arnés no resuelve identidad: las sesiones ya se abrieron por e.app',
              }),
          },
          vault: e.vault,
        },
      },
      actorDe: actorDeCabeceras,
      cupoDeEscritura: () => Promise.resolve(),
    };
    registrarRutasDeObjeciones(objeciones, ctx);

    // Traductor mínimo: sólo hace falta que un rechazo no tumbe la prueba con un 500 opaco y que el
    // código llegue intacto. La traducción completa a estado HTTP y frase en castellano es trabajo
    // de `errorDe` en `app.ts`, y eso ya lo prueba el resto de la suite.
    objeciones.setErrorHandler((error, _request, reply) => {
      const conCodigo = error as Error & {
        name: string;
        code?: string;
        codigo?: string;
        estado?: number;
      };
      if (conCodigo.name === 'ZodError') {
        void reply.status(400).send({ codigo: 'DATOS_INVALIDOS', mensaje: conCodigo.message });
        return;
      }
      const codigo = conCodigo.codigo ?? conCodigo.code ?? 'ERROR_DE_PRUEBA';
      const estado = conCodigo.estado ?? 422;
      void reply.status(estado).send({ codigo, mensaje: conCodigo.message });
    });
    await objeciones.ready();
  });

  afterAll(async () => {
    await objeciones.close();
  });

  // El cupo de propuestas es de 3 por persona y por semana (THREAT_MODEL.md T-12): con seis
  // escenarios en este fichero, una sola autora agotaría su cupo a mitad de la suite. Se rota
  // entre las cinco personas de la sesión para que ninguna pase de tres.
  let proponenteIndex = 0;
  function siguienteProponente(): { testigo: string; miembroId: string } {
    const disponibles = [facilitadora, objetor, panelista1, panelista2, panelista3];
    const elegido = disponibles[proponenteIndex % disponibles.length];
    proponenteIndex += 1;
    if (elegido === undefined) throw new Error('no hay proponente disponible');
    return elegido;
  }

  /** Arma problema → propuesta → decisión de consentimiento → papeleta que objeta, con `e.app`. */
  async function decisionConObjecion(): Promise<{
    readonly decisionId: string;
    readonly objectionId: string;
    readonly huellaVersion: string;
  }> {
    const proponente = siguienteProponente();
    const problema = await e.app.inject({
      method: 'POST',
      url: '/problemas',
      headers: como(objetor.testigo),
      payload: {
        requestId: req(),
        titulo: 'El seminario permanente necesita sala fija',
        cuerpo:
          'Sin sala fija, la asistencia cae y el seminario pierde continuidad semestre a semestre.',
        circuloId: CIRCULO,
      },
    });
    expect(problema.statusCode, problema.body).toBe(201);
    const problemaId = problema.json<{ id: string }>().id;

    const propuesta = await e.app.inject({
      method: 'POST',
      url: '/propuestas',
      headers: como(proponente.testigo),
      payload: {
        requestId: req(),
        problemaId,
        titulo: 'Reservar una sala fija para el seminario',
        cuerpo: 'La propuesta es reservar la sala 4-108 todos los martes del semestre.',
        plan: planDe(proponente.miembroId),
      },
    });
    expect(propuesta.statusCode, propuesta.body).toBe(201);
    const propuestaId = propuesta.json<{ id: string }>().id;

    const decision = await e.app.inject({
      method: 'POST',
      url: '/decisiones',
      headers: como(facilitadora.testigo),
      payload: {
        requestId: req(),
        propuestaId,
        metodo: 'sociocratic-consent',
        duracionHoras: 48,
      },
    });
    expect(decision.statusCode, decision.body).toBe(201);
    const decisionId = decision.json<{ id: string; huellaVersion: string }>().id;
    const huellaVersion = decision.json<{ huellaVersion: string }>().huellaVersion;

    const papeleta = await e.app.inject({
      method: 'POST',
      url: `/decisiones/${decisionId}/papeletas`,
      headers: como(objetor.testigo),
      payload: {
        requestId: req(),
        huellaVersion,
        respuesta: {
          tipo: 'consent',
          postura: 'object',
          objecion: { argumento: ARGUMENTO, objetivoDanado: 'sostener el seminario permanente' },
        },
      },
    });
    expect(papeleta.statusCode, papeleta.body).toBe(201);

    // El identificador de la objeción lo elige el servidor dentro de la papeleta (`service.ts`):
    // se lee del propio ledger, no se adivina contando llamadas al azar de prueba.
    const log = await loadDecisionLog(e.pool, decisionId);
    const state = replay(log);
    const ballotConObjecion = state.ballots.find(
      (b) =>
        b.voter === objetor.miembroId &&
        b.payload.kind === 'consent' &&
        b.payload.stance === 'object',
    );
    if (ballotConObjecion === undefined || ballotConObjecion.payload.kind !== 'consent') {
      throw new Error('la papeleta que objeta no quedó en el log');
    }
    const objection = ballotConObjecion.payload.objection;
    if (objection === undefined) throw new Error('la papeleta no trae la objeción adjunta');

    return { decisionId, objectionId: objection.objectionId, huellaVersion };
  }

  it('sin sesión, se rechaza antes de sortear nada', async () => {
    const { decisionId, objectionId } = await decisionConObjecion();
    const res = await objeciones.inject({
      method: 'POST',
      url: `/decisiones/${decisionId}/objeciones/${objectionId}/desestimar`,
      payload: {
        requestId: req(),
        votos: 2,
        motivacion: 'Motivación de sobra para pasar el mínimo.',
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it('un miembro sin facilitación ni garantías no puede publicar la desestimación', async () => {
    const { decisionId, objectionId } = await decisionConObjecion();
    const res = await objeciones.inject({
      method: 'POST',
      url: `/decisiones/${decisionId}/objeciones/${objectionId}/desestimar`,
      headers: comoObjeciones(panelista2.miembroId, ['member']),
      payload: {
        requestId: req(),
        votos: 2,
        motivacion: 'Motivación de sobra para pasar el mínimo.',
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json<CodigoDeError>().codigo).toBe('UNAUTHORIZED_ROLE_NOT_GRANTED');
  });

  it('una motivación en blanco no desestima, aunque el rol y los votos alcancen', async () => {
    const { decisionId, objectionId } = await decisionConObjecion();
    const res = await objeciones.inject({
      method: 'POST',
      url: `/decisiones/${decisionId}/objeciones/${objectionId}/desestimar`,
      headers: comoObjeciones(facilitadora.miembroId, ['member', 'facilitator']),
      payload: { requestId: req(), votos: 2, motivacion: '   ' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('sin dos tercios del panel, la objeción sigue admitida y bloqueando', async () => {
    const { decisionId, objectionId } = await decisionConObjecion();
    const res = await objeciones.inject({
      method: 'POST',
      url: `/decisiones/${decisionId}/objeciones/${objectionId}/desestimar`,
      headers: comoObjeciones(facilitadora.miembroId, ['member', 'facilitator']),
      payload: {
        requestId: req(),
        votos: 1, // 1 de 3: no llega a 2/3.
        motivacion: 'El panel no encuentra motivo suficiente, pero no llega a la mayoría exigida.',
      },
    });
    expect(res.statusCode).toBe(422);
    const cuerpo = res.json<CodigoDeError>();
    expect(cuerpo.codigo).toBe('DISMISS_THRESHOLD_NOT_MET');

    // Todo o nada: el intento fallido no dejó NI el `ObjectionDismissed` NI el `ObjectionRaised`
    // implícito que esta ruta hubiera publicado antes (ver la cabecera de `rutas-objeciones.ts`),
    // porque los dos se escriben juntos en una sola llamada a `persistDecisionLog` y ésta nunca se
    // alcanzó. La objeción sigue viva sólo donde ya vivía: dentro de la papeleta que la trajo, y
    // sigue contando como admitida y bloqueante ahí (B.3.a).
    const log = await loadDecisionLog(e.pool, decisionId);
    const state = replay(log);
    expect(state.objections.find((o) => o.objectionId === objectionId)).toBeUndefined();
    const efectivas: readonly EffectiveBallot[] = state.ballots.map((b) => ({
      voter: b.voter,
      payload: b.payload,
      weight: 1,
      seq: b.seq,
      onBehalfOf: [],
    }));
    const merged = mergeObjections([], efectivas);
    expect(blockingObjections(merged).some((o) => o.objectionId === objectionId)).toBe(true);
  });

  it('con panel sorteado y 2/3, la objeción se desestima — y el panel es verificable', async () => {
    const { decisionId, objectionId } = await decisionConObjecion();
    const motivacion = 'El objetivo dañado ya está cubierto por el plan aprobado del círculo.';

    const res = await objeciones.inject({
      method: 'POST',
      url: `/decisiones/${decisionId}/objeciones/${objectionId}/desestimar`,
      headers: comoObjeciones(facilitadora.miembroId, ['member', 'facilitator']),
      payload: { requestId: req(), votos: 2, motivacion },
    });
    expect(res.statusCode, res.body).toBe(200);
    const cuerpo = res.json<RespuestaDesestimacion>();

    expect(cuerpo.decisionId).toBe(decisionId);
    expect(cuerpo.objectionId).toBe(objectionId);
    expect(cuerpo.tamanoPanel).toBe(3);
    expect(cuerpo.votos).toBe(2);
    expect(cuerpo.umbral).toBe('2/3');
    expect(cuerpo.motivacion).toBe(motivacion);
    expect(cuerpo.panel).toHaveLength(3);
    // Quien objeta jamás aparece en su propio panel (B.3.a), incluso a través de la ruta HTTP.
    expect(cuerpo.panel).not.toContain(objetor.miembroId);
    // La bolsa disponible es el círculo (5 personas) menos quien objeta: facilitadora y los tres
    // panelistas. El sorteo elige 3 de esos 4; comprobar la pertenencia (y no una terna fija) es lo
    // que corresponde, porque cuál sale exactamente lo decide la semilla, no esta prueba.
    const bolsa = new Set([
      facilitadora.miembroId,
      panelista1.miembroId,
      panelista2.miembroId,
      panelista3.miembroId,
    ]);
    for (const miembro of cuerpo.panel) expect(bolsa.has(miembro)).toBe(true);

    // El log quedó escrito: releerlo y plegarlo confirma el mismo veredicto.
    const log = await loadDecisionLog(e.pool, decisionId);
    const state = replay(log);
    const objecion = state.objections.find((o) => o.objectionId === objectionId);
    expect(objecion?.status).toBe('dismissed');

    // Reproducibilidad (ADR-0031): cualquiera que tenga el padrón congelado y el compromiso de la
    // semilla puede recalcular el mismo panel sin confiar en el servidor.
    const config = state.config;
    if (config === undefined) throw new Error('la decisión no tiene configuración congelada');
    const recalculado = await sortObjectionPanel({
      electorate: config.electorate,
      circleId: config.circleId,
      objectionId: toObjectionId(objectionId),
      objector: objetor.miembroId as MemberId,
      panelSize: 3,
      seed: config.seedCommitment,
    });
    expect([...recalculado.panel].sort()).toEqual([...cuerpo.panel].sort());
  });

  it('la pantalla de la decisión enseña la objeción que la está frenando', async () => {
    // Sin esto, el motor sabía desestimar una objeción y no había forma de llegar ahí desde
    // ninguna pantalla: construido e inalcanzable, que es peor que faltante.
    const { decisionId } = await decisionConObjecion();
    const res = await e.app.inject({
      method: 'GET',
      url: `/decisiones/${decisionId}`,
      headers: como(objetor.testigo),
    });
    expect(res.statusCode).toBe(200);
    const detalle = res.json<{
      objeciones: readonly {
        id: string;
        argumento: string;
        objetivoDanado: string;
        ronda: number;
      }[];
    }>();
    expect(detalle.objeciones).toHaveLength(1);
    const objecion = detalle.objeciones[0];
    expect(objecion?.argumento.length).toBeGreaterThan(0);
    expect(objecion?.objetivoDanado.length).toBeGreaterThan(0);
    expect(objecion?.ronda).toBe(1);
  });

  it('y NO enseña quién objetó, que es el sentido de ese voto', async () => {
    /*
     * La mitad que no se puede perder. Una objeción vive dentro de una papeleta, y objetar **es**
     * el sentido del voto: devolver el autor en una lectura de pantalla sería publicar cómo votó
     * esa persona, que es justo lo que ADR-0010 y la coerción del votante (T-10) prohíben — y lo
     * mismo por lo que esta misma respuesta dice «ya votaste» y nunca «votaste que sí».
     *
     * Se comprueba sobre el cuerpo entero y no sobre una clave concreta: el identificador de quien
     * objetó no puede aparecer por ningún camino, ni en un campo nuevo que alguien agregue mañana.
     */
    const { decisionId } = await decisionConObjecion();
    const res = await e.app.inject({
      method: 'GET',
      url: `/decisiones/${decisionId}`,
      headers: como(objetor.testigo),
    });
    expect(res.statusCode).toBe(200);
    // Sobre `objeciones` y no sobre el cuerpo entero: el plan de ejecución nombra a quien queda
    // como responsable, y eso es público a propósito. En este escenario resulta ser la misma
    // persona que objetó, que es una coincidencia del montaje y no una fuga.
    expect(JSON.stringify(res.json<{ objeciones: unknown }>().objeciones)).not.toContain(
      objetor.miembroId,
    );
  });

  it('desestimar una objeción de un método sin consentimiento se rechaza', async () => {
    const problema = await e.app.inject({
      method: 'POST',
      url: '/problemas',
      headers: como(objetor.testigo),
      payload: {
        requestId: req(),
        titulo: 'Otro asunto cualquiera del círculo',
        cuerpo: 'Este problema se decide por mayoría simple, no por consentimiento.',
        circuloId: CIRCULO,
      },
    });
    expect(problema.statusCode, problema.body).toBe(201);
    const problemaId = problema.json<{ id: string }>().id;
    const proponente = siguienteProponente();
    const propuesta = await e.app.inject({
      method: 'POST',
      url: '/propuestas',
      headers: como(proponente.testigo),
      payload: {
        requestId: req(),
        problemaId,
        titulo: 'Resolverlo de una vez',
        cuerpo: 'La propuesta es hacer exactamente esto con estos pasos y estos recursos.',
        plan: planDe(proponente.miembroId),
      },
    });
    expect(propuesta.statusCode, propuesta.body).toBe(201);
    const propuestaId = propuesta.json<{ id: string }>().id;
    const decision = await e.app.inject({
      method: 'POST',
      url: '/decisiones',
      headers: como(facilitadora.testigo),
      payload: { requestId: req(), propuestaId, metodo: 'simple-majority', duracionHoras: 48 },
    });
    expect(decision.statusCode, decision.body).toBe(201);
    const decisionId = decision.json<{ id: string }>().id;

    const res = await objeciones.inject({
      method: 'POST',
      url: `/decisiones/${decisionId}/objeciones/${'0'.repeat(32)}/desestimar`,
      headers: comoObjeciones(facilitadora.miembroId, ['member', 'facilitator']),
      payload: {
        requestId: req(),
        votos: 2,
        motivacion: 'Motivación de sobra para pasar el mínimo.',
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<CodigoDeError>().codigo).toBe('OBJECTIONS_NOT_APPLICABLE');
  });

  /**
   * REGRESIÓN — desestimar mientras alguien vota no puede partir el historial.
   *
   * Esta ruta leía el log fuera del cerrojo y persistía después. Con UNA papeleta interpuesta entre
   * la lectura y la escritura, el tramo pendiente se quedaba sólo con el `ObjectionDismissed` y
   * descartaba el `ObjectionRaised` que lo precede; la comprobación de densidad cuadraba por
   * casualidad —la papeleta había ocupado ese hueco— y el CAS sobre la cabeza acertaba. Resultado:
   * una desestimación sin la objeción que desestima, y una decisión que a partir de ese momento
   * lanza `UNKNOWN_OBJECTION` en CUALQUIER lectura, para siempre, sin reparación posible (el
   * historial es de sólo-anexar y el rol de la aplicación no tiene `UPDATE`).
   *
   * Lo que se afirma acá NO es que la desestimación gane la carrera —puede perderla, y perderla
   * limpio es correcto—. Es que, pase lo que pase, **la decisión se siga pudiendo leer**. Ésa es la
   * propiedad que el fallo rompía y la única que importa.
   *
   * ⚠ HONESTIDAD SOBRE EL ALCANCE DE ESTA PRUEBA
   *
   * Esta prueba **no reproduce la carrera**. Se intentó: primero con las dos peticiones a la vez, y
   * después soltando la papeleta 15 ms después de arrancar la desestimación para caer en el rato
   * del sorteo del panel. En las dos formas la prueba pasa TAMBIÉN contra el código viejo, porque
   * la desestimación entera termina antes de que la papeleta llegue: la ventana real es más
   * estrecha que cualquier retardo que se pueda poner desde fuera. Reproducirla de verdad exige una
   * costura dentro de la ruta que la pause entre la lectura y la escritura, y eso es meter código
   * de prueba en la ruta de producción.
   *
   * Así que esto es un GUARDIÁN DE INVARIANTE, no la demostración del arreglo. Lo que sostiene la
   * corrección es de construcción: la ruta pasó a usar `escribirSobreDecision`, que toma el cerrojo
   * antes de leer y persiste en la misma transacción — el mismo camino que ya usan todos los demás
   * escritores y que sí tienen probado `append-concurrente.test.ts` y `papeleta-concurrente.test.ts`.
   * Si alguien devolviera la ruta al patrón viejo, esta prueba probablemente seguiría en verde: lo
   * que lo impediría es la revisión, no esta línea. Queda escrito para que nadie se confíe.
   */
  it('desestimar a la vez que entra una papeleta no deja la decisión ilegible', async () => {
    const { decisionId, objectionId, huellaVersion } = await decisionConObjecion();

    /*
     * La papeleta sale con un respiro de por medio, no a la vez. Con `Promise.allSettled` de las dos
     * a la vez la carrera casi nunca cae en la ventana mala: se comprobó, y contra el código viejo
     * la prueba pasaba igual, o sea que no probaba nada. La ventana de verdad es el rato que la
     * desestimación pasa sorteando el panel —cripto asíncrona— DESPUÉS de haber leído el log y ANTES
     * de escribirlo. Soltar la papeleta unos milisegundos después de arrancar la desestimación es lo
     * que cae dentro de esa ventana.
     */
    const enCurso = objeciones.inject({
      method: 'POST',
      url: `/decisiones/${decisionId}/objeciones/${objectionId}/desestimar`,
      headers: comoObjeciones(facilitadora.miembroId, ['member', 'facilitator']),
      payload: {
        requestId: req(),
        votos: 3,
        motivacion: 'El panel se pronunció y la motivación queda publicada para el registro.',
      },
    });
    await new Promise((listo) => setTimeout(listo, 15));

    const [desestimacion, papeleta] = await Promise.allSettled([
      enCurso,
      e.app.inject({
        method: 'POST',
        url: `/decisiones/${decisionId}/papeletas`,
        headers: como(panelista1.testigo),
        payload: {
          requestId: req(),
          huellaVersion,
          respuesta: { tipo: 'consent', postura: 'consent' },
        },
      }),
    ]);

    // Ninguna de las dos puede reventar el proceso; que una falle con un conflicto es aceptable.
    expect(desestimacion.status).toBe('fulfilled');
    expect(papeleta.status).toBe('fulfilled');

    // LA AFIRMACIÓN QUE IMPORTA: el historial se vuelve a plegar sin lanzar.
    const log = await loadDecisionLog(e.pool, decisionId);
    const estado = replay(log);
    expect(estado.decisionId).toBe(decisionId);

    // Y si la desestimación llegó a escribirse, su `ObjectionRaised` tiene que estar ANTES.
    const iDismissed = log.findIndex((ev) => ev.payload.type === 'ObjectionDismissed');
    if (iDismissed >= 0) {
      const iRaised = log.findIndex(
        (ev) =>
          ev.payload.type === 'ObjectionRaised' &&
          ev.payload.objection.objectionId === toObjectionId(objectionId),
      );
      expect(iRaised, 'se escribió una desestimación sin su objeción').toBeGreaterThanOrEqual(0);
      expect(iRaised).toBeLessThan(iDismissed);
    }
  });
});
