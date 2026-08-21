/**
 * La aplicación HTTP.
 *
 * ═══ Qué hace esta capa y qué NO hace ═══
 *
 * Hace tres cosas: traduce JSON a tipos con Zod, resuelve quién es quien llama, y traduce los
 * errores del dominio a estados HTTP y a frases en español. **No decide permisos.** Todas las rutas
 * de escritura llaman a órdenes del dominio, y esas órdenes autorizan por dentro. Si mañana alguien
 * añade una ruta y se olvida de comprobar el permiso, la orden lo comprueba igual.
 *
 * Ese reparto es deliberado y es la respuesta al fallo más repetido del software de gobernanza: la
 * comprobación en el `preHandler`, que protege la ruta que existía el día que se escribió.
 *
 * ═══ Sobre las direcciones IP ═══
 *
 * No se leen, no se registran y no se pasan a ningún sitio. El registro de peticiones va con
 * `redact` sobre `remoteAddress` y sobre las cabeceras de proxy, y el control de abuso usa el
 * contador con pimienta rotada de `rate-limit.ts`. En una comunidad de 300 personas que se conectan
 * desde la misma facultad, una IP con marca temporal es un dato de ubicación de una persona
 * identificable.
 */

import cookie from '@fastify/cookie';
import {
  type ApiError,
  abrirDecision as abrirDecisionSchema,
  aportarEvidencia as aportarEvidenciaSchema,
  canjeEnlace as canjeEnlaceSchema,
  crearProblema as crearProblemaSchema,
  crearPropuesta as crearPropuestaSchema,
  emitirPapeleta as emitirPapeletaSchema,
  enmendarPropuesta as enmendarPropuestaSchema,
  type InformeIntegridad,
  mensajeDe,
  type Portada,
  retirarEvidencia as retirarEvidenciaSchema,
  type Sesion,
  solicitudEnlace as solicitudEnlaceSchema,
} from '@koinonia/contracts';
import { DomainError, type MemberId, UnauthorizedError } from '@koinonia/domain';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { PgPool } from '../db/client.js';
import { CIRCULOS_LISTA, existeCirculo } from './circles.js';
import {
  ENLACE_VIGENCIA_MS,
  findMember,
  issueMagicLink,
  openSession,
  redeemMagicLink,
  resolveSession,
  revokeSession,
  upsertMember,
} from './identity.js';
import type { AuthenticatedMember, Ports } from './ports.js';
import {
  decisionDetalleDto,
  decisionResumenDto,
  problemaDetalleDto,
  problemaResumenDto,
  propuestaDetalleDto,
  propuestaResumenDto,
  resultadoDto,
} from './presenters.js';
import { consume, type RateRule, REGLA_ENLACE, REGLA_ESCRITURA } from './rate-limit.js';
import {
  ACTOR_ANONIMO,
  abrirDecision,
  aportarEvidencia,
  cerrarDecision,
  crearProblema,
  crearPropuesta,
  emitirPapeleta,
  enmendarPropuesta,
  exportarTodo,
  listarDecisiones,
  listarProblemas,
  listarPropuestas,
  mePasaLoMismo,
  resultadoDeDecision,
  retirarEvidencia,
  ServicioError,
  type ServicioDeps,
  verDecision,
  verificarTodo,
  verProblema,
  verPropuesta,
} from './service.js';

export const COOKIE_SESION = 'koinonia_sesion';

export interface AppOptions {
  readonly pool: PgPool;
  readonly ports: Ports;
  /** Secreto del despliegue del que se deriva la pimienta diaria del control de abuso. */
  readonly ratePepper: string;
  /** Base pública de la web, para armar el enlace del correo. */
  readonly webBaseUrl: string;
  /**
   * Modo de desarrollo: el enlace mágico viaja también en la respuesta, para poder levantar el
   * proyecto sin servidor de correo. **Nunca** en producción.
   */
  readonly modoDesarrollo: boolean;
  /**
   * Límites del control de abuso.
   *
   * Son configuración del despliegue y no una constante del código: un instituto de 300 personas y
   * uno de 3000 no tienen el mismo umbral, y el entorno de pruebas de extremo a extremo hace en un
   * minuto los inicios de sesión que una persona hace en un semestre. Los valores por defecto son
   * los de `rate-limit.ts`.
   */
  readonly reglas?: {
    readonly enlace?: RateRule;
    readonly escritura?: RateRule;
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    quien: AuthenticatedMember | undefined;
    sesionToken: string | undefined;
  }
}

function errorDe(error: unknown): { estado: number; cuerpo: ApiError } {
  if (error instanceof UnauthorizedError) {
    // 401 si falta identidad, 403 si la identidad no alcanza. La diferencia importa: la primera se
    // arregla entrando, la segunda no se arregla de ninguna manera y hay que decirlo.
    const estado = error.reason === 'NOT_AUTHENTICATED' ? 401 : 403;
    return {
      estado,
      cuerpo: {
        codigo: error.code,
        mensaje: mensajeDe(error.code, error.message),
        queHacer:
          error.reason === 'NOT_AUTHENTICATED'
            ? 'Entrá con tu correo institucional; tu borrador se conserva.'
            : error.reason === 'NOT_THE_OWNER'
              ? 'Podés proponer una enmienda, que queda como texto tuyo y con tu nombre.'
              : 'Si creés que es un error, cualquier miembro puede llevarlo al Círculo de Garantías.',
      },
    };
  }
  if (error instanceof ServicioError) {
    return {
      estado: error.estado,
      cuerpo: { codigo: error.codigo, mensaje: mensajeDe(error.codigo, error.message) },
    };
  }
  if (error instanceof DomainError) {
    // Un rechazo del dominio es una respuesta, no un fallo: 422.
    return {
      estado: 422,
      cuerpo: { codigo: error.code, mensaje: mensajeDe(error.code, error.message) },
    };
  }
  if (error instanceof z.ZodError) {
    const primero = error.issues[0];
    return {
      estado: 400,
      cuerpo: {
        codigo: 'DATOS_INVALIDOS',
        mensaje: primero?.message ?? mensajeDe('DATOS_INVALIDOS'),
        ...(primero === undefined ? {} : { campo: primero.path.join('.') }),
      },
    };
  }
  return { estado: 500, cuerpo: { codigo: 'ERROR_INTERNO', mensaje: mensajeDe('ERROR_INTERNO') } };
}

/** Parsea con Zod y lanza el `ZodError` para que lo traduzca `errorDe`. */
function parse<T>(schema: { parse: (value: unknown) => T }, value: unknown): T {
  return schema.parse(value);
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const deps: ServicioDeps = { pool: options.pool, ports: options.ports };
  const reglaEnlace = options.reglas?.enlace ?? REGLA_ENLACE;
  const reglaEscritura = options.reglas?.escritura ?? REGLA_ESCRITURA;

  const app = Fastify({
    logger: {
      level: process.env['KOINONIA_LOG'] ?? 'warn',
      // Sin IP en el registro. `redact` con `remove` no la oculta: la borra del objeto.
      redact: {
        paths: [
          'req.remoteAddress',
          'req.remotePort',
          'req.hostname',
          'req.headers["x-forwarded-for"]',
          'req.headers["x-real-ip"]',
          'req.headers.cookie',
          'req.headers.authorization',
        ],
        remove: true,
      },
    },
    // El cuerpo más grande admisible: una propuesta larga y poco más. Un límite generoso es una
    // invitación a llenar el historial, que es para siempre.
    bodyLimit: 128 * 1024,
    // `trustProxy: false` no es un detalle: con `true`, Fastify leería `X-Forwarded-For` para
    // calcular `request.ip`, es decir, reintroduciría la dirección de la persona por la puerta de
    // atrás justo después de que hayamos decidido no tenerla.
    trustProxy: false,
  });

  await app.register(cookie);

  app.decorateRequest('quien', undefined);
  app.decorateRequest('sesionToken', undefined);

  // ── Quién llama ────────────────────────────────────────────────────────────────────────────
  //
  // Resuelve la identidad y NADA más. No decide si puede hacer lo que va a hacer: eso lo decide el
  // dominio, en la orden.
  app.addHook('onRequest', async (request: FastifyRequest) => {
    const cabecera = request.headers.authorization;
    const bearer = cabecera?.startsWith('Bearer ') === true ? cabecera.slice(7) : undefined;
    const token = bearer ?? request.cookies[COOKIE_SESION];
    request.sesionToken = token;
    if (token === undefined || token === '') return;
    const client = await options.pool.connect();
    try {
      request.quien = await resolveSession(client, token, options.ports.clock);
    } finally {
      client.release();
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    const { estado, cuerpo } = errorDe(error);
    void reply.status(estado).send(cuerpo);
  });

  app.setNotFoundHandler((_request, reply) => {
    void reply.status(404).send({ codigo: 'NO_ENCONTRADO', mensaje: mensajeDe('NO_ENCONTRADO') });
  });

  function actorDe(request: FastifyRequest): Parameters<typeof crearProblema>[1] {
    const quien = request.quien;
    if (quien === undefined) return ACTOR_ANONIMO;
    return { memberId: quien.memberId, roles: quien.roles, circles: quien.circles };
  }

  function idDe(request: FastifyRequest): MemberId | undefined {
    return request.quien?.memberId;
  }

  /** Cupo de escritura por persona. Sin IP: el sujeto es el `MemberId`. */
  async function cupoDeEscritura(request: FastifyRequest): Promise<void> {
    const quien = request.quien;
    if (quien === undefined) return;
    const client = await options.pool.connect();
    try {
      const veredicto = await consume(client, {
        secret: options.ratePepper,
        regla: reglaEscritura,
        sujeto: quien.memberId,
        clock: options.ports.clock,
      });
      if (!veredicto.permitido) {
        throw new ServicioError(
          'DEMASIADOS_INTENTOS',
          429,
          'escribiste muchas cosas seguidas; esperá un momento',
        );
      }
    } finally {
      client.release();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // Salud
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  app.get('/salud', () => ({ bien: true, motor: 'koinonia' }));

  app.get('/circulos', () =>
    CIRCULOS_LISTA.map((c) => ({
      id: c.id,
      nombre: c.nombre,
      decideSinConsultar: c.decideSinConsultar,
    })),
  );

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // Sesión
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  app.post('/auth/enlace', async (request, reply) => {
    const cuerpo = parse(solicitudEnlaceSchema, request.body);
    const correo = cuerpo.correo.trim().toLowerCase();

    const client = await options.pool.connect();
    try {
      // Cupo ANTES de verificar el correo: si se hiciera después, el propio límite diría si el
      // dominio del correo es válido, y sería un oráculo gratis.
      const veredicto = await consume(client, {
        secret: options.ratePepper,
        regla: reglaEnlace,
        sujeto: correo,
        clock: options.ports.clock,
      });
      if (!veredicto.permitido) {
        return await reply.status(429).send({
          codigo: 'DEMASIADOS_INTENTOS',
          mensaje: mensajeDe('DEMASIADOS_INTENTOS'),
          queHacer: `Volvé a intentarlo después de las ${new Date(veredicto.liberaEn).toISOString().slice(11, 16)} UTC.`,
        } satisfies ApiError);
      }

      const identidad = await options.ports.identity.verify(correo);
      if (!identidad.ok) {
        return await reply.status(422).send({
          codigo: identidad.code,
          mensaje: mensajeDe(identidad.code, identidad.detail),
          campo: 'correo',
        } satisfies ApiError);
      }

      const miembro = await upsertMember(client, identidad.claim, options.ports.random);
      const enlace = await issueMagicLink(client, miembro, options.ports);
      const url = `${options.webBaseUrl}/entrar/confirmar?token=${encodeURIComponent(enlace.token)}`;

      await options.ports.mailer.send({
        to: correo,
        subject: 'Tu enlace para entrar a Koinonía',
        text:
          `Hola.\n\nEste enlace te deja entrar a Koinonía. Sirve UNA sola vez y vence en ` +
          `${String(ENLACE_VIGENCIA_MS / 60000)} minutos:\n\n${url}\n\n` +
          `Si no lo pediste vos, no hace falta que hagas nada: sin abrirlo, no pasa nada.\n\n` +
          `Koinonía no es un órgano de la Universidad de Antioquia ni la representa.\n`,
      });

      return await reply.status(202).send({
        enviado: true as const,
        duraMinutos: ENLACE_VIGENCIA_MS / 60000,
        ...(options.modoDesarrollo ? { enlaceDeDesarrollo: url } : {}),
      });
    } finally {
      client.release();
    }
  });

  app.post('/auth/sesion', async (request, reply) => {
    const cuerpo = parse(canjeEnlaceSchema, request.body);
    const client = await options.pool.connect();
    try {
      const canje = await redeemMagicLink(client, cuerpo.token, options.ports.clock);
      if (!canje.ok) {
        return await reply
          .status(401)
          .send({ codigo: canje.code, mensaje: mensajeDe(canje.code) } satisfies ApiError);
      }
      const miembro = await findMember(client, canje.memberId);
      if (miembro === undefined) {
        return await reply.status(401).send({
          codigo: 'ENLACE_INVALIDO',
          mensaje: mensajeDe('ENLACE_INVALIDO'),
        } satisfies ApiError);
      }
      const sesion = await openSession(client, miembro.memberId, options.ports);
      void reply.setCookie(COOKIE_SESION, sesion.token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: !options.modoDesarrollo,
        maxAge: Math.floor((sesion.expiraEn - options.ports.clock.now()) / 1000),
      });
      return await reply.status(200).send({
        miembroId: miembro.memberId,
        alias: miembro.alias,
        roles: [...miembro.roles],
        circulos: [...miembro.circles],
        expiraEn: sesion.expiraEn,
        // El testigo también en el cuerpo: es lo que permite que las pruebas de extremo a extremo
        // llamen a la API **saltándose la interfaz**, que es justamente lo que hay que demostrar.
        testigo: sesion.token,
      });
    } finally {
      client.release();
    }
  });

  app.get('/auth/yo', async (request, reply) => {
    const quien = request.quien;
    if (quien === undefined) {
      return await reply.status(401).send({
        codigo: 'UNAUTHORIZED_NOT_AUTHENTICATED',
        mensaje: mensajeDe('UNAUTHORIZED_NOT_AUTHENTICATED'),
      } satisfies ApiError);
    }
    return {
      miembroId: quien.memberId,
      alias: quien.alias,
      roles: [...quien.roles],
      circulos: [...quien.circles],
      expiraEn: quien.expiresAt,
    } satisfies Sesion;
  });

  app.post('/auth/salir', async (request, reply) => {
    const token = request.sesionToken;
    if (token !== undefined) {
      const client = await options.pool.connect();
      try {
        await revokeSession(client, token, options.ports.clock);
      } finally {
        client.release();
      }
    }
    void reply.clearCookie(COOKIE_SESION, { path: '/' });
    return { salio: true };
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // Problemas
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  async function propuestasPorProblema(): Promise<ReadonlyMap<string, number>> {
    const cuenta = new Map<string, number>();
    for (const { state } of await listarPropuestas(deps)) {
      const problema = state.problemId;
      if (problema === undefined) continue;
      cuenta.set(problema, (cuenta.get(problema) ?? 0) + 1);
    }
    return cuenta;
  }

  app.get('/problemas', async () => {
    const cuenta = await propuestasPorProblema();
    return (await listarProblemas(deps)).map(({ id, state }) =>
      problemaResumenDto(id, state, cuenta.get(id) ?? 0),
    );
  });

  app.post('/problemas', async (request, reply) => {
    await cupoDeEscritura(request);
    const cuerpo = parse(crearProblemaSchema, request.body);
    if (!existeCirculo(cuerpo.circuloId)) {
      throw new ServicioError('NO_ENCONTRADO', 404, 'ese grupo no existe');
    }
    const creado = await crearProblema(deps, actorDe(request), cuerpo);
    return await reply
      .status(201)
      .send(problemaDetalleDto(creado.id, creado.state, 0, idDe(request)));
  });

  app.get('/problemas/:id', async (request) => {
    const { id } = parse(z.object({ id: z.string() }), request.params);
    const { state } = await verProblema(deps, id);
    const cuenta = await propuestasPorProblema();
    return problemaDetalleDto(id, state, cuenta.get(id) ?? 0, idDe(request));
  });

  app.post('/problemas/:id/evidencia', async (request, reply) => {
    await cupoDeEscritura(request);
    const { id } = parse(z.object({ id: z.string() }), request.params);
    const cuerpo = parse(aportarEvidenciaSchema, request.body);
    const state = await aportarEvidencia(deps, actorDe(request), id, cuerpo);
    return await reply.status(201).send(problemaDetalleDto(id, state, 0, idDe(request)));
  });

  /**
   * Retirar un aporte. **Autorización horizontal.** El autor se lee del historial dentro de la
   * orden; esta ruta no le pasa ningún dato de propiedad al dominio, precisamente para que no pueda
   * equivocarse.
   */
  app.post('/problemas/:id/evidencia/:evidenciaId/retirar', async (request) => {
    await cupoDeEscritura(request);
    const { id, evidenciaId } = parse(
      z.object({ id: z.string(), evidenciaId: z.string() }),
      request.params,
    );
    const cuerpo = parse(retirarEvidenciaSchema, request.body);
    const state = await retirarEvidencia(deps, actorDe(request), id, evidenciaId, cuerpo);
    return problemaDetalleDto(id, state, 0, idDe(request));
  });

  app.post('/problemas/:id/me-pasa', async (request) => {
    await cupoDeEscritura(request);
    const { id } = parse(z.object({ id: z.string() }), request.params);
    const cuerpo = parse(z.object({ requestId: z.uuid() }), request.body);
    const state = await mePasaLoMismo(deps, actorDe(request), id, cuerpo);
    return problemaDetalleDto(id, state, 0, idDe(request));
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // Propuestas
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  async function tituloDelProblema(problemaId: string): Promise<string> {
    try {
      return (await verProblema(deps, problemaId)).state.title;
    } catch {
      return 'Un problema que ya no está';
    }
  }

  app.get('/propuestas', async (request) => {
    const query = parse(z.object({ problema: z.string().optional() }), request.query);
    const todas = await listarPropuestas(deps);
    const filtradas =
      query.problema === undefined
        ? todas
        : todas.filter(({ state }) => state.problemId === query.problema);
    return filtradas.map(({ id, state }) => propuestaResumenDto(id, state, idDe(request)));
  });

  app.post('/propuestas', async (request, reply) => {
    await cupoDeEscritura(request);
    const cuerpo = parse(crearPropuestaSchema, request.body);
    const creada = await crearPropuesta(deps, actorDe(request), cuerpo);
    return await reply
      .status(201)
      .send(
        propuestaDetalleDto(
          creada.id,
          creada.state,
          idDe(request),
          await tituloDelProblema(cuerpo.problemaId),
        ),
      );
  });

  app.get('/propuestas/:id', async (request) => {
    const { id } = parse(z.object({ id: z.string() }), request.params);
    const { state } = await verPropuesta(deps, id);
    return propuestaDetalleDto(
      id,
      state,
      idDe(request),
      await tituloDelProblema(state.problemId ?? ''),
    );
  });

  /** Enmendar: crea la versión siguiente. **Autorización horizontal**: sólo quien la escribió. */
  app.post('/propuestas/:id/enmiendas', async (request, reply) => {
    await cupoDeEscritura(request);
    const { id } = parse(z.object({ id: z.string() }), request.params);
    const cuerpo = parse(enmendarPropuestaSchema, request.body);
    const enmendada = await enmendarPropuesta(deps, actorDe(request), id, cuerpo);
    return await reply
      .status(201)
      .send(
        propuestaDetalleDto(
          id,
          enmendada.state,
          idDe(request),
          await tituloDelProblema(enmendada.state.problemId ?? ''),
        ),
      );
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // Decisiones
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  async function tituloDeDecision(propuestaId: string, huella: string): Promise<[string, string]> {
    try {
      const { state } = await verPropuesta(deps, propuestaId);
      const version = state.versions.find((v) => v.versionHash === huella);
      return [version?.title ?? 'Un texto que ya no está', version?.body ?? ''];
    } catch {
      return ['Un texto que ya no está', ''];
    }
  }

  app.get('/decisiones', async () => {
    const salida = [];
    for (const { id, state } of await listarDecisiones(deps)) {
      const [titulo] = await tituloDeDecision(
        state.config?.proposalId ?? '',
        state.proposalVersionHash ?? '',
      );
      salida.push(decisionResumenDto(id, state, titulo));
    }
    return salida;
  });

  app.post('/decisiones', async (request, reply) => {
    await cupoDeEscritura(request);
    const cuerpo = parse(abrirDecisionSchema, request.body);
    const abierta = await abrirDecision(deps, actorDe(request), cuerpo);
    const [titulo, texto] = await tituloDeDecision(
      cuerpo.propuestaId,
      abierta.config.proposalVersionHash,
    );
    return await reply
      .status(201)
      .send(decisionDetalleDto(abierta.id, abierta.state, titulo, texto, idDe(request)));
  });

  app.get('/decisiones/:id', async (request) => {
    const { id } = parse(z.object({ id: z.string() }), request.params);
    const { state } = await verDecision(deps, id);
    const [titulo, texto] = await tituloDeDecision(
      state.config?.proposalId ?? '',
      state.proposalVersionHash ?? '',
    );
    return decisionDetalleDto(id, state, titulo, texto, idDe(request));
  });

  app.post('/decisiones/:id/papeletas', async (request, reply) => {
    await cupoDeEscritura(request);
    const { id } = parse(z.object({ id: z.string() }), request.params);
    const cuerpo = parse(emitirPapeletaSchema, request.body);
    const emitida = await emitirPapeleta(deps, actorDe(request), id, {
      requestId: cuerpo.requestId,
      huellaVersion: cuerpo.huellaVersion,
      respuesta: cuerpo.respuesta,
    });
    const [titulo, texto] = await tituloDeDecision(
      emitida.state.config?.proposalId ?? '',
      emitida.state.proposalVersionHash ?? '',
    );
    return await reply
      .status(201)
      .send(decisionDetalleDto(id, emitida.state, titulo, texto, idDe(request)));
  });

  app.post('/decisiones/:id/cerrar', async (request) => {
    await cupoDeEscritura(request);
    const { id } = parse(z.object({ id: z.string() }), request.params);
    const cuerpo = parse(z.object({ requestId: z.uuid() }), request.body);
    const cerrada = await cerrarDecision(deps, actorDe(request), id, cuerpo);
    return resultadoDto(cerrada.resultado);
  });

  app.get('/decisiones/:id/resultado', async (request) => {
    const { id } = parse(z.object({ id: z.string() }), request.params);
    return resultadoDto(await resultadoDeDecision(deps, id));
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // Integridad
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  app.get('/integridad', async (): Promise<InformeIntegridad> => {
    const v = await verificarTodo(deps);
    const comprobaciones = [
      {
        id: 'cadena',
        queSeComprobo:
          'Que el historial está completo y en orden: que no falta nada, que nada se metió en ' +
          'medio y que nada se reordenó después.',
        bien: v.ledger.ok,
        queSignifica: v.ledger.ok
          ? 'Cada hecho registrado apunta al anterior. Si alguien hubiera cambiado, borrado o ' +
            'movido uno solo, esta comprobación estaría en rojo.'
          : 'Algo en el historial no cuadra. Esto no debería pasar nunca. Las decisiones ' +
            'afectadas quedan en cuarentena y el hecho se publica: un fallo así es una alarma ' +
            'pública, nunca un arreglo silencioso.',
        ...(v.ledger.ok
          ? {}
          : { detalle: v.ledger.findings.map((f) => `${f.code}: ${f.detail}`).join(' · ') }),
      },
      {
        id: 'textos',
        queSeComprobo:
          'Que el texto de cada versión de cada propuesta es exactamente el que estaba cuando se ' +
          'votó, incluidas las versiones viejas.',
        bien: v.propuestasRotas.length === 0,
        queSignifica:
          v.propuestasRotas.length === 0
            ? `Se revisaron ${String(v.propuestasVerificadas)} propuestas con todas sus versiones. ` +
              'La versión 1 sigue siendo palabra por palabra la que era, aunque exista una versión 2.'
            : 'El texto de alguna versión no es el que se votó. Eso invalida las respuestas que se ' +
              'dieron sobre ella.',
        ...(v.propuestasRotas.length === 0
          ? {}
          : { detalle: v.propuestasRotas.map((p) => `${p.id}: ${p.motivo}`).join(' · ') }),
      },
      {
        id: 'resultados',
        queSeComprobo:
          'Que cada resultado publicado es el que sale de volver a contar las respuestas, una por una.',
        bien: v.decisionesRotas.length === 0,
        queSignifica:
          v.decisionesRotas.length === 0
            ? `Se volvieron a contar ${String(v.decisionesVerificadas)} decisiones y dieron lo ` +
              'mismo. El resultado no es algo que nosotros guardemos: es algo que cualquiera ' +
              'puede volver a calcular.'
            : 'Un resultado publicado no coincide con lo que producen las respuestas emitidas. La ' +
              'decisión entra en cuarentena.',
        ...(v.decisionesRotas.length === 0
          ? {}
          : { detalle: v.decisionesRotas.map((d) => `${d.id}: ${d.motivo}`).join(' · ') }),
      },
    ];

    return {
      todoBien: comprobaciones.every((c) => c.bien),
      comprobadoEn: options.ports.clock.now(),
      ...(v.desde === undefined ? {} : { historialDesde: v.desde }),
      hechosRevisados: v.hechos,
      comprobaciones,
      comoComprobarloVosMismo: {
        explicacion:
          'Si sólo comprobamos nosotros, no probamos nada: te estaríamos pidiendo que nos creas. ' +
          'Descargá el historial completo y pasalo por la herramienta de comprobación, que es ' +
          'código abierto y no es este servidor. Si te da lo mismo que dice esta página, es ' +
          'porque es verdad, no porque lo digamos.',
        comando: 'npx @koinonia/verificador historial.json',
        urlDeDescarga: '/integridad/exportar',
      },
    };
  });

  app.get('/integridad/exportar', async (_request, reply) => {
    void reply.header('content-disposition', 'attachment; filename="historial-koinonia.json"');
    return exportarTodo(deps);
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // Portada
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  app.get('/portada', async (request): Promise<Portada> => {
    const problemas = await listarProblemas(deps);
    const propuestas = await listarPropuestas(deps);
    const decisiones = await listarDecisiones(deps);

    const resumenes = [];
    for (const { id, state } of decisiones) {
      const [titulo] = await tituloDeDecision(
        state.config?.proposalId ?? '',
        state.proposalVersionHash ?? '',
      );
      resumenes.push({ resumen: decisionResumenDto(id, state, titulo), state });
    }

    const abiertas = resumenes.filter((r) => r.state.status === 'Open').map((r) => r.resumen);
    const cerradas = resumenes
      .filter((r) => r.state.status !== 'Open' && r.state.status !== 'Draft')
      .map((r) => r.resumen)
      .slice(-3);

    const quien = idDe(request);
    // **Una sola** cosa pendiente (PRODUCT §4). Si hay varias, la que cierra antes.
    const pendiente = resumenes
      .filter(
        (r) =>
          r.state.status === 'Open' &&
          quien !== undefined &&
          (r.state.config?.electorate.members.some((m) => m.memberId === quien) ?? false) &&
          !r.state.ballots.some((b) => b.voter === quien && b.round === r.state.round),
      )
      .sort((a, b) => a.resumen.cierraEn - b.resumen.cierraEn)[0];

    return {
      // El estado vacío es la pantalla más importante y la que todos olvidan: es lo único que ve la
      // comunidad el primer día. Aquí se decide, y se decide con un booleano explícito para que la
      // interfaz no tenga que adivinarlo contando ceros.
      primerDia: problemas.length === 0 && propuestas.length === 0 && decisiones.length === 0,
      problemas: problemas.length,
      propuestas: propuestas.length,
      decisionesAbiertas: abiertas,
      ultimasCerradas: cerradas,
      ...(pendiente === undefined
        ? {}
        : {
            loQueTeToca: {
              que: `Falta tu respuesta en «${pendiente.resumen.titulo}»`,
              enlace: `/decisiones/${pendiente.resumen.id}`,
              cierraEn: pendiente.resumen.cierraEn,
            },
          }),
    };
  });

  return app;
}
