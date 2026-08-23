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
 *
 * ═══ Sobre el registro de peticiones (quién pidió qué) ═══
 *
 * `KOINONIA_LOG` decide el nivel; por código es `warn` — sin rastro de peticiones — porque así deben
 * quedar las pruebas y el desarrollo local. **En producción el despliegue fija `KOINONIA_LOG=info`**
 * (documentado en `infra/produccion/`), y entonces `onResponse` más abajo escribe una línea por
 * petición: método, **el patrón de la ruta tal como se declaró** (`request.routeOptions.url`, p. ej.
 * `/decisiones/:id/papeletas`), código de estado, duración y el `reqId` que Fastify ya genera. Nunca
 * la URL resuelta: se probó con el serializador por defecto de Fastify (`logger:true`) y esa línea
 * trae la URL **con los identificadores de recurso interpolados** — `/problemas/5c55a9…` — que para
 * una ruta como `/circulos/:id/miembros` es exactamente el «identificador de miembro en claro» que
 * este proyecto prohíbe registrar. Por eso `disableRequestLogging: true` apaga ese registro
 * automático y este módulo escribe el suyo, a mano, sin ese campo.
 *
 * Dos exclusiones deliberadas, no un descuido:
 *
 * 1. **Nunca se registra el cuerpo, las cabeceras (salvo lo que ya redacta la config de abajo) ni la
 *    cadena de consulta.** Un correo o un token de sesión viajan ahí, no en la ruta.
 * 2. **`POST /decisiones/:id/papeletas` — la emisión de una papeleta — no genera línea alguna**, ni
 *    siquiera con el patrón de ruta. THREAT_MODEL.md §3 (T-20, «Correlación votante↔voto por
 *    temporización») exige que ninguna pieza del sistema deje una marca temporal asociada a *que se
 *    emitió una papeleta*: ADR-0014 ya quita el timestamp de la urna y sella por lotes barajados
 *    precisamente para que el momento de inserción no delate quién votó. Una línea de registro con
 *    hora exacta de esa ruta —aunque no lleve `MemberId`— reconstruye ese mismo reloj por la puerta de
 *    atrás: quien tenga el registro y una marca de participación con hora aproximada puede cruzarlos
 *    igual que si la urna tuviera timestamp. THREAT_MODEL.md lo exige explícitamente para el proxy
 *    («registro de rutas de emisión desactivado en el proxy», línea 286); aquí se aplica la misma
 *    regla en la propia API, porque hasta ahora `level: warn` volvía el punto discutible al no existir
 *    registro de peticiones — y este cambio lo hace existir.
 *
 * `redact` sigue activo por si algún día otro código de este archivo llama a `request.log` pasándole
 * el objeto `req` completo; hoy no lo hace nadie, pero la lista cuesta una línea y evita que ese día,
 * si llega, sea silencioso.
 */

import cookie from '@fastify/cookie';
import {
  type ApiError,
  abrirDecision as abrirDecisionSchema,
  abrirDeliberacion as abrirDeliberacionSchema,
  aceptarRevisionTarea as aceptarRevisionTareaSchema,
  agregarEvidenciaTarea as agregarEvidenciaTareaSchema,
  actualizarCapacidad as actualizarCapacidadSchema,
  aportar as aportarSchema,
  aportarEvidencia as aportarEvidenciaSchema,
  avanzarEtapa as avanzarEtapaSchema,
  canjeEnlace as canjeEnlaceSchema,
  type Consenso,
  crearProblema as crearProblemaSchema,
  crearPropuesta as crearPropuestaSchema,
  delegar as delegarSchema,
  emitirPapeleta as emitirPapeletaSchema,
  aprobarReforma as aprobarReformaSchema,
  fundarNormas as fundarNormasSchema,
  proponerReforma as proponerReformaSchema,
  ratificarReforma as ratificarReformaSchema,
  registrarVotacionDeReforma as registrarVotacionDeReformaSchema,
  type Historial,
  type Normas,
  type PanelDeDelegaciones,
  revocarDelegacion as revocarDelegacionSchema,
  enmendarPropuesta as enmendarPropuestaSchema,
  entregarTarea as entregarTareaSchema,
  bloquearTarea as bloquearTareaSchema,
  type InformeIntegridad,
  mensajeDe,
  MENSAJES_DELIBERACION,
  type Portada,
  retirarEvidencia as retirarEvidenciaSchema,
  ratificarDecision as ratificarDecisionSchema,
  planificarHito as planificarHitoSchema,
  ofrecerTarea as ofrecerTareaSchema,
  iniciarTarea as iniciarTareaSchema,
  pedirAyudaTarea as pedirAyudaTareaSchema,
  pedirCambiosTarea as pedirCambiosTareaSchema,
  reanudarTarea as reanudarTareaSchema,
  reofrecerTarea as reofrecerTareaSchema,
  responderOfertaTarea as responderOfertaTareaSchema,
  type AccesoAMiembros,
  type EstadoSesion,
  type Sesion,
  solicitarSupresion as solicitarSupresionSchema,
  type SupresionSolicitada,
  solicitudEnlace as solicitudEnlaceSchema,
} from '@koinonia/contracts';
import {
  DomainError,
  authorize,
  can,
  circleId,
  type ExecutionPlan,
  type MemberId,
  UnauthorizedError,
} from '@koinonia/domain';
import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { z } from 'zod';

import type { PgPool } from '../db/client.js';
import { IdempotencyConflictError } from '../ledger/types.js';
import {
  CapacityServiceUnavailableError,
  readOwnCapacity,
  StaleCapacityRevisionError,
  updateOwnCapacity,
} from './capacity.js';
import { CIRCULOS_LISTA, existeCirculo } from './circles.js';
import {
  allMembers,
  ENLACE_VIGENCIA_MS,
  ErasureAlreadyRequestedError,
  ErasureReauthenticationRequiredError,
  findMember,
  issueMagicLink,
  listActiveCircleMembers,
  openSession,
  redeemMagicLink,
  resolveSession,
  revokeSession,
  requestOwnErasure,
  upsertMember,
} from './identity.js';
import type { AuthenticatedMember, Ports } from './ports.js';
import {
  InvalidPrivateMaterialInputError,
  PrivateMaterialUnavailableError,
} from './private-material-store.js';
import {
  consensoDto,
  decisionDetalleDto,
  decisionResumenDto,
  delegacionesDeDecisionDto,
  deliberacionDetalleDto,
  deliberacionResumenDto,
  historialDto,
  iniciativaDto,
  misTareasDto,
  normasDto,
  panelDeDelegacionesDto,
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
  abrirDeliberacion,
  aceptarRevisionTarea,
  agregarEvidenciaTarea,
  aportarADeliberacion,
  aportarEvidencia,
  avanzarEtapaDeliberacion,
  bloquearTarea,
  calcularConsenso,
  cerrarDecision,
  crearProblema,
  crearPropuesta,
  delegacionesDe,
  type DelegacionesDeUnaDecision,
  delegarVoto,
  emitirPapeleta,
  enmendarPropuesta,
  entregarTarea,
  exportarTodo,
  listarDecisiones,
  listarDelegaciones,
  listarDeliberaciones,
  listarIniciativas,
  listarProblemas,
  listarPropuestas,
  mePasaLoMismo,
  iniciarTarea,
  resultadoDeDecision,
  retirarEvidencia,
  revocarDelegacionDeVoto,
  ratificarDecision,
  verHistorial,
  aprobarReforma,
  fundarNormas,
  leerNormas,
  proponerReforma,
  ratificarReforma,
  registrarVotacionDeReforma,
  planificarHito,
  ofrecerTarea,
  pedirAyudaTarea,
  pedirCambiosTarea,
  reanudarTarea,
  reofrecerTarea,
  responderOfertaTarea,
  ServicioError,
  type ServicioDeps,
  verDecision,
  verDeliberacion,
  verEvidenciaTarea,
  verIniciativa,
  verificarTodo,
  verProblema,
  verPropuesta,
  verResumenEntregaTarea,
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
  if (error instanceof ErasureReauthenticationRequiredError) {
    return {
      estado: 401,
      cuerpo: {
        codigo: 'ERASURE_REAUTHENTICATION_REQUIRED',
        mensaje: mensajeDe('ERASURE_REAUTHENTICATION_REQUIRED'),
        queHacer: 'Volvé a entrar y confirmá la solicitud dentro de los siguientes diez minutos.',
      },
    };
  }
  if (error instanceof ErasureAlreadyRequestedError) {
    return {
      estado: 409,
      cuerpo: {
        codigo: 'ERASURE_ALREADY_REQUESTED',
        mensaje: mensajeDe('ERASURE_ALREADY_REQUESTED'),
        queHacer: 'Usá el radicado de la solicitud ya registrada.',
      },
    };
  }
  if (error instanceof StaleCapacityRevisionError) {
    return {
      estado: 409,
      cuerpo: {
        codigo: error.code,
        mensaje: mensajeDe(error.code),
        queHacer: 'Volvé a leer tu capacidad y guardá de nuevo sobre esa revisión.',
      },
    };
  }
  if (error instanceof CapacityServiceUnavailableError) {
    return {
      estado: 503,
      cuerpo: {
        codigo: error.code,
        mensaje: mensajeDe(error.code),
        queHacer: 'Probá de nuevo más tarde; no se guardó ningún valor sin cifrar.',
      },
    };
  }
  if (error instanceof InvalidPrivateMaterialInputError) {
    return {
      estado: 400,
      cuerpo: {
        codigo: 'DATOS_INVALIDOS',
        mensaje: mensajeDe('DATOS_INVALIDOS'),
        queHacer: 'Reducí el texto y volvé a intentarlo; no se guardó contenido parcial.',
      },
    };
  }
  if (error instanceof PrivateMaterialUnavailableError) {
    return {
      estado: 503,
      cuerpo: {
        codigo: 'PRIVATE_MATERIAL_UNAVAILABLE',
        mensaje: mensajeDe('PRIVATE_MATERIAL_UNAVAILABLE'),
        queHacer: 'Probá de nuevo más tarde; el historial no se modificó.',
      },
    };
  }
  if (error instanceof IdempotencyConflictError) {
    return {
      estado: 409,
      cuerpo: {
        codigo: 'IDEMPOTENCY_KEY_REUSED',
        mensaje: mensajeDe('IDEMPOTENCY_KEY_REUSED'),
        queHacer: 'Reintentá la acción original o empezá una acción distinta con una clave nueva.',
      },
    };
  }
  if (error instanceof UnauthorizedError) {
    // 401 si falta identidad, 403 si la identidad no alcanza. La diferencia importa: la primera se
    // arregla entrando, la segunda no se arregla de ninguna manera y hay que decirlo.
    const estado = error.reason === 'NOT_AUTHENTICATED' ? 401 : 403;
    return {
      estado,
      cuerpo: {
        codigo: error.code,
        mensaje: mensajeDe(error.code, MENSAJES_DELIBERACION[error.code] ?? error.message),
        queHacer:
          error.reason === 'NOT_AUTHENTICATED'
            ? 'Entrá con tu correo institucional; tu borrador se conserva.'
            : error.reason === 'NOT_THE_OWNER'
              ? 'Esta acción le corresponde a otra persona; podés aportar por los canales abiertos.'
              : // La denegación por etapa no es un problema de papeles y decirlo así sería mentir:
                // no hay nadie en el grupo que pueda concederla, sólo el paso del tiempo (ADR-0049).
                error.reason === 'STAGE_STILL_OPEN'
                ? 'Esperá a que cierre la etapa: entonces aparece, para todo el mundo a la vez.'
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
    // Una oferta reemplazada es una carrera semántica: reintentarla no la vuelve válida.
    const semanticConflict =
      error.code === 'STALE_TASK_OFFER' ||
      error.code === 'STALE_TASK_REVISION' ||
      error.code === 'STALE_TASK_PAUSE' ||
      error.code === 'STALE_TASK_DELIVERY' ||
      error.code === 'TASK_OFFER_ALREADY_ANSWERED';
    return {
      estado: semanticConflict ? 409 : 422,
      cuerpo: {
        codigo: error.code,
        mensaje: mensajeDe(error.code, MENSAJES_DELIBERACION[error.code] ?? error.message),
      },
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
    // Apaga el «incoming request» / «request completed» automáticos de Fastify: van con la URL ya
    // resuelta (identificadores de recurso incluidos) y sin forma de excluir una ruta. El registro
    // propio va más abajo, en el hook `onResponse`. Ver el comentario de cabecera del archivo.
    // `LogController` y no el viejo `disableRequestLogging` de nivel superior: ese está obsoleto
    // desde Fastify 5.12 y desaparece en Fastify 6 (aviso `FSTDEP023`).
    logController: new LogController({ disableRequestLogging: true }),
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

  // ── Quién pidió qué ────────────────────────────────────────────────────────────────────────
  //
  // El registro de acceso propio: una línea por petición, sin nada que identifique a una persona
  // ni revele un voto. Ver el comentario de cabecera del archivo para el porqué de cada exclusión.
  const RUTAS_SIN_REGISTRO = new Set<string>([
    // Emisión de papeleta (THREAT_MODEL.md T-20, ADR-0014): ni la hora de esta ruta se registra.
    'POST /decisiones/:id/papeletas',
  ]);
  app.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    const patron = request.routeOptions.url;
    if (patron !== undefined && RUTAS_SIN_REGISTRO.has(`${request.method} ${patron}`)) return;
    request.log.info(
      {
        metodo: request.method,
        // El patrón de la ruta (`/decisiones/:id`), nunca `request.url`: esa trae el identificador
        // de recurso ya resuelto.
        ruta: patron ?? 'sin_ruta_registrada',
        estado: reply.statusCode,
        ms: Math.round(reply.elapsedTime),
      },
      'peticion',
    );
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

  function sujetoPropioDe(request: FastifyRequest): MemberId {
    const subjectId = idDe(request);
    if (subjectId === undefined) {
      throw new ServicioError('UNAUTHORIZED_NOT_AUTHENTICATED', 401, 'falta una sesión vigente');
    }
    return subjectId;
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

      const miembro = await upsertMember(client, identidad.claim, options.ports);
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

  /**
   * ¿Hay sesión? **Siempre 200**, con una unión discriminada.
   *
   * Esta ruta NO autoriza nada y no sustituye ninguna comprobación: contesta una observación sobre
   * la credencial que trae la propia petición. Todo lo demás sigue autorizándose dentro de cada
   * operación, y quien se invente un `abierta: true` en el cliente se estrella igual contra el 401
   * de la operación real —hay una prueba que lo hace a propósito—.
   *
   * Tres cosas que parecen detalles y son la ruta entera:
   *
   *  · **No lee nada de la petición salvo la credencial.** Ni cuerpo, ni cadena de consulta. Un
   *    `?correo=` o un `?miembroId=` no cambian la respuesta porque no se miran: la ruta no tiene
   *    manera de nombrar a otra persona, que es lo que la separa de un oráculo de padrón.
   *  · **Un solo `false`.** Sin cookie, con cookie vacía, con un testigo inventado, con una sesión
   *    vencida o revocada y con el testigo de una cuenta inexistente sale el mismo cuerpo. El hook
   *    de identidad ya devuelve `undefined` «sin decir por qué», y acá eso se conserva en vez de
   *    traducirse a matices.
   *  · **`no-store`.** Una respuesta de sesión guardada por un intermediario es la sesión de una
   *    persona servida a otra. `/auth/yo` no la lleva porque nadie la pide sin credencial; ésta la
   *    va a pedir todo el mundo en cada carga, incluido quien no ha entrado.
   */
  app.get('/auth/estado', (request, reply) => {
    void reply.header('cache-control', 'no-store');
    const quien = request.quien;
    if (quien === undefined) return { abierta: false } satisfies EstadoSesion;
    return {
      abierta: true,
      sesion: {
        miembroId: quien.memberId,
        alias: quien.alias,
        roles: [...quien.roles],
        circulos: [...quien.circles],
        expiraEn: quien.expiresAt,
      },
    } satisfies EstadoSesion;
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
  // Supresión propia: la solicitud se sella; un ejecutor técnico sólo consume ese agregado
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  app.post('/mi/supresion', async (request, reply) => {
    await cupoDeEscritura(request);
    parse(z.object({}).strict(), request.query);
    const cuerpo = parse(solicitarSupresionSchema, request.body);
    const token = request.sesionToken;
    if (token === undefined || token === '') {
      throw new ServicioError('UNAUTHORIZED_NOT_AUTHENTICATED', 401, 'falta una sesión vigente');
    }
    const receipt = await requestOwnErasure(options.pool, token, {
      clock: options.ports.clock,
      random: options.ports.random,
      requestId: cuerpo.requestId,
      legalBasis: cuerpo.baseLegal,
      confirmationIrreversible: cuerpo.confirmacionIrreversible,
    });
    return await reply.status(202).send({
      solicitudId: receipt.erasureId,
      radicado: receipt.claimRef,
      solicitadaEn: receipt.requestedAt,
      estado: 'pendiente',
    } satisfies SupresionSolicitada);
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // Capacidad propia privada
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  app.get('/mi/capacidad', async (request) => {
    // No hay selector de sujeto, tampoco escondido como query param.
    parse(z.object({}).strict(), request.query);
    return await readOwnCapacity(options.pool, options.ports.vault, sujetoPropioDe(request));
  });

  app.put('/mi/capacidad', async (request) => {
    await cupoDeEscritura(request);
    parse(z.object({}).strict(), request.query);
    const cuerpo = parse(actualizarCapacidadSchema, request.body);
    return await updateOwnCapacity(
      options.pool,
      options.ports.vault,
      sujetoPropioDe(request),
      cuerpo,
      options.ports.clock.now(),
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // Tareas propias
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  /**
   * Sólo lo tuyo, decidido en el servidor.
   *
   * «Mis tareas» pedía `/iniciativas` —el detalle completo de todas— y filtraba en el navegador. El
   * título y la descripción del trabajo de cualquiera llegaban al teléfono de cualquiera. Acá el
   * sujeto no se puede elegir: sale de la sesión, igual que en `/mi/capacidad`, y sin sesión esto
   * es un 401 y no una lista vacía —que sería la respuesta que invita a probar.
   */
  app.get('/mi/tareas', async (request) => {
    // No hay selector de sujeto, tampoco escondido como query param.
    parse(z.object({}).strict(), request.query);
    const yo = sujetoPropioDe(request);
    return misTareasDto(await listarIniciativas(deps), yo);
  });

  /**
   * ¿Puede esta sesión pedir la lista de integrantes? **Siempre 200**, siempre el mismo esquema.
   *
   * La colección de abajo no cambia —sigue en 401 y 403—; esto es la pregunta previa, para que la
   * pantalla no la invoque cuando ya sabe que no puede verla. El booleano sale de `can()`, la misma
   * matriz que `authorize()` aplica dos líneas más abajo: no es una segunda regla que pueda
   * desincronizarse, es la misma consultada sin lanzar.
   *
   * **Un grupo inexistente y un grupo ajeno contestan lo mismo.** El `existeCirculo` va dentro del
   * booleano y no antes con un 404: si el «no existe» saliera por otro camino, esta ruta sería un
   * detector de grupos, y aunque hoy la lista de grupos sea pública —`GET /circulos` no pide nada—,
   * una consulta de capacidad que distingue «no está» de «no es tuyo» es la forma exacta en que
   * mañana se filtra lo que sí es privado.
   *
   * Tampoco mira la cadena de consulta: sin selector de sujeto no hay «¿y esta otra persona puede?».
   */
  app.get('/circulos/:id/miembros/acceso', (request) => {
    const { id } = parse(z.object({ id: z.string() }), request.params);
    return {
      puedoVer: existeCirculo(id)
        ? can(actorDe(request), 'circle:members-read', { kind: 'circle', circleId: circleId(id) })
        : false,
    } satisfies AccesoAMiembros;
  });

  /** Selector acotado: sólo integrantes vigentes del círculo que la persona ya puede consultar. */
  app.get('/circulos/:id/miembros', async (request) => {
    const { id } = parse(z.object({ id: z.string() }), request.params);
    if (!existeCirculo(id)) throw new ServicioError('NO_ENCONTRADO', 404, 'ese grupo no existe');
    const circle = circleId(id);
    authorize(actorDe(request), 'circle:members-read', { kind: 'circle', circleId: circle });
    const client = await options.pool.connect();
    try {
      return await listActiveCircleMembers(client, circle, options.ports.clock.now());
    } finally {
      client.release();
    }
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

  async function tituloDeDecision(
    propuestaId: string,
    huella: string,
  ): Promise<[string, string, ExecutionPlan | undefined]> {
    try {
      const { state } = await verPropuesta(deps, propuestaId);
      const version = state.versions.find((v) => v.versionHash === huella);
      return [
        version?.title ?? 'Un texto que ya no está',
        version?.body ?? '',
        version?.executionPlan,
      ];
    } catch {
      return ['Un texto que ya no está', '', undefined];
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
    const [titulo, texto, plan] = await tituloDeDecision(
      cuerpo.propuestaId,
      abierta.config.proposalVersionHash,
    );
    return await reply
      .status(201)
      .send(decisionDetalleDto(abierta.id, abierta.state, titulo, texto, idDe(request), plan));
  });

  app.get('/decisiones/:id', async (request) => {
    const { id } = parse(z.object({ id: z.string() }), request.params);
    const { state } = await verDecision(deps, id);
    const [titulo, texto, plan] = await tituloDeDecision(
      state.config?.proposalId ?? '',
      state.proposalVersionHash ?? '',
    );
    return decisionDetalleDto(id, state, titulo, texto, idDe(request), plan);
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
    const [titulo, texto, plan] = await tituloDeDecision(
      emitida.state.config?.proposalId ?? '',
      emitida.state.proposalVersionHash ?? '',
    );
    return await reply
      .status(201)
      .send(decisionDetalleDto(id, emitida.state, titulo, texto, idDe(request), plan));
  });

  app.post('/decisiones/:id/cerrar', async (request) => {
    await cupoDeEscritura(request);
    const { id } = parse(z.object({ id: z.string() }), request.params);
    const cuerpo = parse(z.object({ requestId: z.uuid() }), request.body);
    const cerrada = await cerrarDecision(deps, actorDe(request), id, cuerpo);
    const [tituloCerrada] = await tituloDeDecision(
      cerrada.state.config?.proposalId ?? '',
      cerrada.state.proposalVersionHash ?? '',
    );
    return resultadoDto(cerrada.resultado, tituloCerrada, cerrada.iniciativaId);
  });

  app.post('/decisiones/:id/ratificar', async (request, reply) => {
    await cupoDeEscritura(request);
    const { id } = parse(z.object({ id: z.string() }), request.params);
    const cuerpo = parse(ratificarDecisionSchema, request.body);
    const ratificada = await ratificarDecision(deps, actorDe(request), id, cuerpo);
    const initiativeId = ratificada.draft?.plannedInitiativeId;
    if (initiativeId === undefined) return await reply.status(204).send();
    const initiative = await verIniciativa(deps, initiativeId);
    return await reply
      .status(200)
      .send(
        iniciativaDto(initiative.id, initiative.state, idDe(request), initiative.ratificableEn),
      );
  });

  app.get('/decisiones/:id/resultado', async (request) => {
    const { id } = parse(z.object({ id: z.string() }), request.params);
    const found = await resultadoDeDecision(deps, id);
    const [titulo] = await tituloDeDecision(
      found.state.config?.proposalId ?? '',
      found.state.proposalVersionHash ?? '',
    );
    return resultadoDto(found.resultado, titulo, found.iniciativaId);
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // Delegaciones: prestarle tu voto a alguien
  //
  // Las dos escrituras las autoriza el DOMINIO —`grantDelegationBy` y `revokeDelegationBy` llaman
  // a `authorize(..., 'decision:cast-ballot', { subject })` por dentro— con el sujeto puesto desde
  // la sesión. Aquí no hay ni una comprobación de permiso, y ése es el punto: si mañana alguien
  // añade otra ruta que conceda delegaciones, la orden se lo impide igual.
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  /** Los alias de un padrón congelado, para no enseñar identificadores en pantalla. */
  async function aliasDe(ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
    if (ids.length === 0) return new Map();
    const client = await options.pool.connect();
    try {
      const miembros = await allMembers(client, options.ports.clock.now());
      const buscados = new Set(ids);
      return new Map(
        miembros.filter((m) => buscados.has(m.memberId)).map((m) => [m.memberId, m.alias]),
      );
    } finally {
      client.release();
    }
  }

  async function delegacionesDto(
    datos: DelegacionesDeUnaDecision,
    request: FastifyRequest,
  ): Promise<ReturnType<typeof delegacionesDeDecisionDto>> {
    const [titulo] = await tituloDeDecision(
      datos.state.config?.proposalId ?? '',
      datos.state.proposalVersionHash ?? '',
    );
    const alias = await aliasDe(
      (datos.config?.electorate.members ?? []).map((miembro) => miembro.memberId),
    );
    return delegacionesDeDecisionDto(
      datos,
      titulo,
      alias,
      idDe(request),
      options.ports.clock.now(),
    );
  }

  app.get('/delegaciones', async (request): Promise<PanelDeDelegaciones> => {
    parse(z.object({}).strict(), request.query);
    const votaciones = [];
    for (const datos of await listarDelegaciones(deps, idDe(request))) {
      votaciones.push(await delegacionesDto(datos, request));
    }
    return panelDeDelegacionesDto(votaciones);
  });

  app.post('/decisiones/:id/delegaciones', async (request, reply) => {
    await cupoDeEscritura(request);
    const { id } = parse(z.object({ id: z.string() }), request.params);
    const cuerpo = parse(delegarSchema, request.body);
    const decision = await delegarVoto(deps, actorDe(request), id, cuerpo);
    const datos = delegacionesDe(deps, decision, idDe(request));
    return await reply.status(201).send(await delegacionesDto(datos, request));
  });

  app.post('/decisiones/:id/delegaciones/:delegacionId/revocar', async (request) => {
    await cupoDeEscritura(request);
    const { id, delegacionId } = parse(
      z.object({ id: z.string(), delegacionId: z.string() }),
      request.params,
    );
    const cuerpo = parse(revocarDelegacionSchema, request.body);
    const decision = await revocarDelegacionDeVoto(
      deps,
      actorDe(request),
      id,
      delegacionId,
      cuerpo,
    );
    const datos = delegacionesDe(deps, decision, idDe(request));
    return await delegacionesDto(datos, request);
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // Consenso, normas e historial
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  app.get('/consenso', async (request): Promise<Consenso> => {
    parse(z.object({}).strict(), request.query);
    return consensoDto(
      await calcularConsenso(
        deps,
        async (propuestaId, huella) => (await tituloDeDecision(propuestaId, huella))[0],
        idDe(request),
      ),
    );
  });

  // ── Las reglas del juego ───────────────────────────────────────────────────────────────────
  //
  // Leer no exige cuenta (`constitution:read` es abierto: son las normas del colectivo). Escribir
  // exige lo que diga la matriz, y lo comprueba la orden del dominio, no esta ruta. `tech-admin`
  // no aparece en ninguna de las cinco reglas de escritura, así que no puede fundar, ni proponer,
  // ni transcribir una votación, ni firmar, ni ratificar. No hay ruta que se lo conceda porque no
  // es la ruta la que lo concede.

  app.get('/normas', async (request): Promise<Normas> => {
    parse(z.object({}).strict(), request.query);
    return normasDto(await leerNormas(deps, actorDe(request)));
  });

  app.post('/normas/fundacion', async (request, reply) => {
    await cupoDeEscritura(request);
    const cuerpo = parse(fundarNormasSchema, request.body);
    return await reply
      .status(201)
      .send(normasDto(await fundarNormas(deps, actorDe(request), cuerpo)));
  });

  app.post('/normas/reformas', async (request, reply) => {
    await cupoDeEscritura(request);
    const cuerpo = parse(proponerReformaSchema, request.body);
    return await reply
      .status(201)
      .send(normasDto(await proponerReforma(deps, actorDe(request), cuerpo)));
  });

  app.post('/normas/reformas/:id/votaciones', async (request, reply) => {
    await cupoDeEscritura(request);
    const { id } = parse(z.object({ id: z.string() }), request.params);
    const cuerpo = parse(registrarVotacionDeReformaSchema, request.body);
    const normas = await registrarVotacionDeReforma(deps, actorDe(request), id, cuerpo);
    return await reply.status(201).send(normasDto(normas));
  });

  app.post('/normas/reformas/:id/aprobaciones', async (request, reply) => {
    await cupoDeEscritura(request);
    const { id } = parse(z.object({ id: z.string() }), request.params);
    const cuerpo = parse(aprobarReformaSchema, request.body);
    const normas = await aprobarReforma(deps, actorDe(request), id, cuerpo);
    return await reply.status(201).send(normasDto(normas));
  });

  app.post('/normas/reformas/:id/ratificacion', async (request, reply) => {
    await cupoDeEscritura(request);
    const { id } = parse(z.object({ id: z.string() }), request.params);
    const cuerpo = parse(ratificarReformaSchema, request.body);
    const normas = await ratificarReforma(deps, actorDe(request), id, cuerpo);
    return await reply.status(201).send(normasDto(normas));
  });

  app.get('/historial', async (request): Promise<Historial> => {
    // El tamaño de página es del servidor. Si viniera del cliente, `?cuantos=1000000` sería una
    // forma gratuita de hacer trabajar a la base todo lo que uno quiera.
    parse(z.object({}).strict(), request.query);
    return historialDto(await verHistorial(deps, actorDe(request), { cuantos: 60 }));
  });

  app.get('/iniciativas', async (request) => {
    return (await listarIniciativas(deps)).map(({ id, state, ratificableEn }) =>
      iniciativaDto(id, state, idDe(request), ratificableEn),
    );
  });

  app.get('/iniciativas/:id', async (request) => {
    const { id } = parse(z.object({ id: z.string() }), request.params);
    const found = await verIniciativa(deps, id);
    return iniciativaDto(found.id, found.state, idDe(request), found.ratificableEn);
  });

  app.post('/iniciativas/:id/hitos', async (request, reply) => {
    await cupoDeEscritura(request);
    const { id } = parse(z.object({ id: z.string() }), request.params);
    const body = parse(planificarHitoSchema, request.body);
    const state = await planificarHito(deps, actorDe(request), id, body);
    return await reply.status(201).send(iniciativaDto(id, state, idDe(request)));
  });

  app.post('/iniciativas/:id/tareas', async (request, reply) => {
    await cupoDeEscritura(request);
    const { id } = parse(z.object({ id: z.string() }), request.params);
    const body = parse(ofrecerTareaSchema, request.body);
    const state = await ofrecerTarea(deps, actorDe(request), id, body);
    return await reply.status(201).send(iniciativaDto(id, state, idDe(request)));
  });

  app.post('/iniciativas/:id/tareas/:taskId/respuestas', async (request, reply) => {
    await cupoDeEscritura(request);
    const { id, taskId } = parse(z.object({ id: z.string(), taskId: z.string() }), request.params);
    const body = parse(responderOfertaTareaSchema, request.body);
    const state = await responderOfertaTarea(deps, actorDe(request), id, taskId, body);
    return await reply.status(200).send(iniciativaDto(id, state, idDe(request)));
  });

  app.post('/iniciativas/:id/tareas/:taskId/iniciar', async (request, reply) => {
    await cupoDeEscritura(request);
    const { id, taskId } = parse(z.object({ id: z.string(), taskId: z.string() }), request.params);
    const body = parse(iniciarTareaSchema, request.body);
    const state = await iniciarTarea(deps, actorDe(request), id, taskId, body);
    return await reply.status(200).send(iniciativaDto(id, state, idDe(request)));
  });

  app.post('/iniciativas/:id/tareas/:taskId/bloquear', async (request, reply) => {
    await cupoDeEscritura(request);
    const { id, taskId } = parse(z.object({ id: z.string(), taskId: z.string() }), request.params);
    const body = parse(bloquearTareaSchema, request.body);
    const state = await bloquearTarea(deps, actorDe(request), id, taskId, body);
    return await reply.status(200).send(iniciativaDto(id, state, idDe(request)));
  });

  app.post('/iniciativas/:id/tareas/:taskId/ayuda', async (request, reply) => {
    await cupoDeEscritura(request);
    const { id, taskId } = parse(z.object({ id: z.string(), taskId: z.string() }), request.params);
    const body = parse(pedirAyudaTareaSchema, request.body);
    const state = await pedirAyudaTarea(deps, actorDe(request), id, taskId, body);
    return await reply.status(200).send(iniciativaDto(id, state, idDe(request)));
  });

  app.post('/iniciativas/:id/tareas/:taskId/reanudar', async (request, reply) => {
    await cupoDeEscritura(request);
    const { id, taskId } = parse(z.object({ id: z.string(), taskId: z.string() }), request.params);
    const body = parse(reanudarTareaSchema, request.body);
    const state = await reanudarTarea(deps, actorDe(request), id, taskId, body);
    return await reply.status(200).send(iniciativaDto(id, state, idDe(request)));
  });

  app.post('/iniciativas/:id/tareas/:taskId/evidencias', async (request, reply) => {
    await cupoDeEscritura(request);
    const { id, taskId } = parse(z.object({ id: z.string(), taskId: z.string() }), request.params);
    const body = parse(agregarEvidenciaTareaSchema, request.body);
    const state = await agregarEvidenciaTarea(deps, actorDe(request), id, taskId, body);
    return await reply.status(201).send(iniciativaDto(id, state, idDe(request)));
  });

  app.get('/iniciativas/:id/tareas/:taskId/evidencias/:evidenceId', async (request) => {
    parse(z.object({}).strict(), request.query);
    const { id, taskId, evidenceId } = parse(
      z.object({ id: z.string(), taskId: z.string(), evidenceId: z.string() }),
      request.params,
    );
    return await verEvidenciaTarea(deps, actorDe(request), id, taskId, evidenceId);
  });

  app.post('/iniciativas/:id/tareas/:taskId/entregas', async (request, reply) => {
    await cupoDeEscritura(request);
    const { id, taskId } = parse(z.object({ id: z.string(), taskId: z.string() }), request.params);
    const body = parse(entregarTareaSchema, request.body);
    const state = await entregarTarea(deps, actorDe(request), id, taskId, body);
    return await reply.status(201).send(iniciativaDto(id, state, idDe(request)));
  });

  app.get('/iniciativas/:id/tareas/:taskId/entregas/:deliveryId/resumen', async (request) => {
    parse(z.object({}).strict(), request.query);
    const { id, taskId, deliveryId } = parse(
      z.object({ id: z.string(), taskId: z.string(), deliveryId: z.string() }),
      request.params,
    );
    return await verResumenEntregaTarea(deps, actorDe(request), id, taskId, deliveryId);
  });

  app.post('/iniciativas/:id/tareas/:taskId/revisiones/cambios', async (request, reply) => {
    await cupoDeEscritura(request);
    const { id, taskId } = parse(z.object({ id: z.string(), taskId: z.string() }), request.params);
    const body = parse(pedirCambiosTareaSchema, request.body);
    const state = await pedirCambiosTarea(deps, actorDe(request), id, taskId, body);
    return await reply.status(200).send(iniciativaDto(id, state, idDe(request)));
  });

  app.post('/iniciativas/:id/tareas/:taskId/revisiones/aceptar', async (request, reply) => {
    await cupoDeEscritura(request);
    const { id, taskId } = parse(z.object({ id: z.string(), taskId: z.string() }), request.params);
    const body = parse(aceptarRevisionTareaSchema, request.body);
    const state = await aceptarRevisionTarea(deps, actorDe(request), id, taskId, body);
    return await reply.status(200).send(iniciativaDto(id, state, idDe(request)));
  });

  app.post('/iniciativas/:id/tareas/:taskId/reofertas', async (request, reply) => {
    await cupoDeEscritura(request);
    const { id, taskId } = parse(z.object({ id: z.string(), taskId: z.string() }), request.params);
    const body = parse(reofrecerTareaSchema, request.body);
    const state = await reofrecerTarea(deps, actorDe(request), id, taskId, body);
    return await reply.status(201).send(iniciativaDto(id, state, idDe(request)));
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // Deliberación
  //
  // Ninguna de estas rutas comprueba un permiso, y no es un olvido: `openDeliberation`,
  // `submitContribution` y `advanceStage` llaman a `authorize` antes de construir el evento, y
  // `readContributionAuthor` es la única puerta por la que sale una autoría. Un `preHandler` aquí
  // protegería exactamente las rutas que existan hoy.
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  async function deliberacionDetalle(
    request: FastifyRequest,
    id: string,
    state: Parameters<typeof deliberacionDetalleDto>[1],
  ): Promise<ReturnType<typeof deliberacionDetalleDto>> {
    return deliberacionDetalleDto(
      id,
      state,
      actorDe(request),
      await tituloDelProblema(state.problemId ?? ''),
    );
  }

  app.get('/deliberaciones', async (request) => {
    const query = parse(z.object({ problema: z.string().optional() }), request.query);
    const todas = await listarDeliberaciones(deps);
    const filtradas =
      query.problema === undefined
        ? todas
        : todas.filter(({ state }) => state.problemId === query.problema);
    const salida = [];
    for (const { id, state } of filtradas) {
      salida.push(
        deliberacionResumenDto(id, state, await tituloDelProblema(state.problemId ?? '')),
      );
    }
    return salida;
  });

  app.post('/deliberaciones', async (request, reply) => {
    await cupoDeEscritura(request);
    const cuerpo = parse(abrirDeliberacionSchema, request.body);
    const abierta = await abrirDeliberacion(deps, actorDe(request), cuerpo);
    return await reply
      .status(201)
      .send(await deliberacionDetalle(request, abierta.id, abierta.state));
  });

  app.get('/deliberaciones/:id', async (request) => {
    const { id } = parse(z.object({ id: z.string() }), request.params);
    const { state } = await verDeliberacion(deps, id);
    return await deliberacionDetalle(request, id, state);
  });

  app.post('/deliberaciones/:id/aportes', async (request, reply) => {
    await cupoDeEscritura(request);
    const { id } = parse(z.object({ id: z.string() }), request.params);
    const cuerpo = parse(aportarSchema, request.body);
    const escrita = await aportarADeliberacion(deps, actorDe(request), id, cuerpo);
    return await reply.status(201).send(await deliberacionDetalle(request, id, escrita.state));
  });

  /**
   * Avanzar de etapa. Cierra una ventana de escritura **para siempre** y, al salir de Perspectivas,
   * es además lo que concede la lectura de la autoría. No lleva cuerpo más allá de la clave de
   * idempotencia: no hay nada que elegir, sólo el sucesor exacto.
   */
  app.post('/deliberaciones/:id/etapa', async (request) => {
    await cupoDeEscritura(request);
    const { id } = parse(z.object({ id: z.string() }), request.params);
    const cuerpo = parse(avanzarEtapaSchema, request.body);
    const avanzada = await avanzarEtapaDeliberacion(deps, actorDe(request), id, cuerpo);
    return await deliberacionDetalle(request, id, avanzada.state);
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // Integridad
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  app.get('/integridad', async (): Promise<InformeIntegridad> => {
    const v = await verificarTodo(deps);
    const fallosPrivados = new Map<string, number>();
    for (const finding of v.materialPrivado.findings) {
      fallosPrivados.set(finding.code, (fallosPrivados.get(finding.code) ?? 0) + 1);
    }
    const detallePrivado = [...fallosPrivados]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, count]) => `${code}: ${String(count)}`)
      .join(' · ');
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
        id: 'material-privado',
        queSeComprobo:
          'Que cada apertura privada todavía disponible corresponde a un único hecho del historial, ' +
          'se autentica con su clave y reproduce exactamente el compromiso público, sin mostrar su contenido.',
        bien: v.materialPrivado.ok,
        queSignifica: v.materialPrivado.ok
          ? `Se autenticaron ${String(v.materialPrivado.openedCount)} aperturas privadas y ` +
            `${String(v.materialPrivado.suppressedCount)} supresiones autorizadas por una ` +
            'solicitud propia, que se anotaron sin borrar nada de lo anterior. Sus textos ' +
            'no se publicaron ni se incluyeron en este informe. Esta comprobación es local: lo que ' +
            'se descarga para comprobar por tu cuenta no lleva esos textos cifrados.'
          : 'Falta, sobra o no se puede autenticar material privado comprometido por el historial. ' +
            'El historial público sigue siendo comprobable, pero esta parte, que sí puede cambiar, ' +
            'no debe mostrarse en verde.',
        ...(v.materialPrivado.ok
          ? {}
          : {
              detalle:
                `${detallePrivado || 'verification-unavailable: 1'} · ` +
                `esperadas=${String(v.materialPrivado.expectedCount)} · ` +
                `almacenadas=${String(v.materialPrivado.storedCount)} · ` +
                `autenticadas=${String(v.materialPrivado.openedCount)} · ` +
                `suprimidas=${String(v.materialPrivado.suppressedCount)}`,
            }),
      },
      {
        id: 'textos',
        queSeComprobo:
          'Que el texto y el plan de ejecución de cada versión son exactamente los que estaban ' +
          'cuando se votó, incluidas las versiones viejas.',
        bien: v.propuestasRotas.length === 0,
        queSignifica:
          v.propuestasRotas.length === 0
            ? `Se revisaron ${String(v.propuestasVerificadas)} propuestas con todas sus versiones. ` +
              'La versión 1 conserva sus palabras, responsable, fecha y criterios, aunque exista una versión 2.'
            : 'El texto o el plan de alguna versión no es el que se votó. Eso invalida las ' +
              'respuestas que se dieron sobre ella.',
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
      {
        id: 'conversaciones',
        queSeComprobo:
          'Que cada conversación por etapas se puede volver a armar entera desde el historial: que ' +
          'ningún aporte cambió de etapa, que cada uno sigue a nombre de quien lo escribió, y que ' +
          'ninguno responde a algo que no está.',
        bien: v.deliberacionesRotas.length === 0,
        queSignifica:
          v.deliberacionesRotas.length === 0
            ? `Se volvieron a armar ${String(v.deliberacionesVerificadas)} conversaciones. Nadie ` +
              'puede atribuirle a otra persona algo que no escribió: el historial lo rechazaría al ' +
              'volver a leerlo, no sólo al escribirlo.'
            : 'Alguna conversación no se puede volver a armar desde el historial. Mientras eso pase ' +
              'no se publica entera, y esta fila no se pone en verde.',
        ...(v.deliberacionesRotas.length === 0
          ? {}
          : { detalle: v.deliberacionesRotas.map((d) => `${d.id}: ${d.motivo}`).join(' · ') }),
      },
      {
        id: 'ejecucion',
        queSeComprobo:
          'Que cada decisión aprobada creó exactamente una iniciativa con el plan que se mostró, y ninguna otra decisión la creó.',
        bien: v.iniciativasRotas.length === 0 && v.ejecucionRotas.length === 0,
        queSignifica:
          v.iniciativasRotas.length === 0 && v.ejecucionRotas.length === 0
            ? `Se revisaron ${String(v.iniciativasVerificadas)} iniciativas y todas conservan el vínculo con su decisión, versión y resultado.`
            : 'Alguna decisión y su ejecución no corresponden exactamente. La relación entra en cuarentena.',
        ...(v.iniciativasRotas.length === 0 && v.ejecucionRotas.length === 0
          ? {}
          : {
              detalle: [...v.iniciativasRotas, ...v.ejecucionRotas]
                .map((item) => `${item.id}: ${item.motivo}`)
                .join(' · '),
            }),
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
          'Descargá el historial público y pasalo por la herramienta independiente para comprobar ' +
          'cadenas, resultados, referencias y anclajes sin confiar en este servidor. El material ' +
          'privado no sale en esa descarga: su fila de esta página es una revisión hecha acá mismo ' +
          '—que el material está y que cuadra con el compromiso público que quedó anotado—, y no ' +
          'una prueba independiente de sus textos cifrados.',
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
    const iniciativas = await listarIniciativas(deps);

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
      primerDia:
        problemas.length === 0 &&
        propuestas.length === 0 &&
        decisiones.length === 0 &&
        iniciativas.length === 0,
      problemas: problemas.length,
      propuestas: propuestas.length,
      iniciativasActivas: iniciativas.length,
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
