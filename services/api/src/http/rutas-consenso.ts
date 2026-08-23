/**
 * Rutas de sondeo: sembrar afirmaciones y valorarlas (ADR-0038, ADR-0048).
 *
 * ═══ Cómo se integra ═══
 *
 * Este fichero **no toca `app.ts`**. Exporta una única función registradora,
 * `registrarRutasDeConsenso(app, ctx)`, que un agente integrador llama desde dentro de
 * `buildApp` — ahí es donde ya existen, como cierres locales, todo lo que `ContextoConsenso`
 * necesita: `actorDe`, `idDe`, `cupoDeEscritura`, `options.pool`, `options.ports`. No hay
 * middleware nuevo, ni hook nuevo, ni `declare module 'fastify'` nuevo: la aumentación de
 * `FastifyRequest.quien` ya la declara `app.ts` y es ambiental, así que este fichero la usa tal
 * cual.
 *
 * Tres piezas del sistema aún no existen y por eso **no** las asume este fichero:
 *
 *  1. **`packages/contracts/src/index.ts` no reexporta `consenso.ts` todavía.** Hasta que el
 *     integrador agregue `export * from './consenso.js';`, importar estos tipos desde
 *     `@koinonia/contracts` no resuelve. Es una línea, deliberadamente fuera de mi alcance (la
 *     consigna prohíbe tocar ese fichero).
 *  2. **No hay implementación real de `RepositorioSondeos`.** Sólo el puerto (interfaz) y una
 *     referencia en memoria para pruebas, exportada como `repositorioSondeosEnMemoria()` y
 *     marcada sin ambigüedad como no apta para producción. Persistirlo en PostgreSQL —con la
 *     misma forma de invariantes que el resto del sistema: transaccional, con `UNIQUE` real sobre
 *     (sondeo, afirmación, persona) para la valoración— es trabajo del integrador.
 *  3. **Nada de esto escribe al historial encadenado.** HANDOFF.md §8, tarea 15, ya lo declara
 *     abierto: no hay snapshot, no hay huella de la matriz de entrada, no hay
 *     `AgendaDeConsensoCongelada`. Por eso `GET /sondeos/:id/resultado` marca su salida
 *     `esProvisional: true` con una frase que lo dice: es un cálculo recalculable, no todavía un
 *     hecho del historial. Nada en este contrato le impide a esa tarea futura sustituir de dónde
 *     sale la matriz (del historial en vez de `RepositorioSondeos`) sin tocar las rutas de
 *     escritura, que describen el acto de una persona, no la demostración de que quedó escrito.
 *
 * ═══ Lo que SÍ resuelve, y por qué así ═══
 *
 *  - **Trinario con `paso` como dato observado.** Una valoración sólo existe si alguien la envió;
 *    si no existe fila, la persona no vio la afirmación. La matriz que se arma para
 *    `analizarConsenso` usa exactamente esa distinción: `null` para ausente, `0` para `paso`.
 *  - **Siembra fundacional**: mientras el sondeo está `sembrando`, sólo quien convocó puede
 *    sembrar, y tiene que declarar afirmación por afirmación si contradice su propia postura. En
 *    cuanto llega a doce afirmaciones con al menos tres contrarias, el sondeo **abre solo** — no
 *    hay una ruta separada de «abrir a valorar»: la condición de ADR-0038 es la propia apertura.
 *    Abierto el sondeo, cualquier persona puede sembrar afirmaciones nuevas: es el mecanismo
 *    antitrol que describe la cabecera de ADR-0038 y no un descuido de autorización.
 *  - **Ruteo simplificado.** ADR-0038 pide «ruteo con prioridad» y no lo especifica del todo; acá
 *    se implementa la regla más simple que no es aleatoria ni depende del orden de inserción:
 *    entre las afirmaciones que la persona no valoró, la que menos valoraciones totales tiene
 *    hasta ahora, desempatando por antigüedad y por id. **Esto no pretende ser el ruteo final**:
 *    es lo mínimo determinista para que la pantalla pueda mostrar «una afirmación a la vez» sin
 *    inventar aleatoriedad. Si se necesita algo más fino, es una función que se sustituye sola.
 *  - **El mínimo de siete valoraciones para «ubicar en el mapa»** (PRODUCT.md §4) se aplica **acá**,
 *    filtrando filas antes de llamar a `@koinonia/consensus` — el propio ADR-0048 dice que el
 *    paquete no lo implementa y que no es su competencia.
 *  - **Ninguna magnitud cruda del cálculo cruza la red.** `GIC`, dispersión y probabilidad exacta
 *    se quedan en el servidor; lo que viaja es el orden ya resuelto y un porcentaje redondeado. Es
 *    la frontera de ADR-0048 hecha imposible de saltarse por accidente desde un cliente futuro.
 *
 * ═══ Lo que NO resuelve, y por qué ═══
 *
 *  - No hay autorización horizontal de dominio (`authorize`/`can` de `@koinonia/domain`) porque
 *    `Action` es una unión cerrada que no admite una acción de sondeo sin editar `access.ts`, y
 *    editar el dominio no es este encargo. Los únicos controles son de rol, hechos a mano acá, y
 *    quedan escritos para que quien revise pueda verlos enteros en un sitio.
 *  - No hay una cuarta ruta para «cerrar» el sondeo: PRODUCT.md §4 no la pide y no hay una regla
 *    de cuándo cerrar que no sea inventada. `estadoSondeo` incluye `'cerrado'` para que el tipo no
 *    tenga que cambiar el día que exista esa regla, pero ningún camino de este fichero produce ese
 *    estado todavía.
 */

import {
  abrirSondeo as abrirSondeoSchema,
  type AfirmacionResultadoSondeo,
  type AfirmacionSondeo,
  type AsuntoSondeo,
  ESTADO_SONDEO_EN_PALABRAS,
  type EstadoSondeo,
  type GrupoSondeo,
  MENSAJES_SONDEO,
  mensajeDe,
  type RespuestaSondeo,
  sembrarAfirmacion as sembrarAfirmacionSchema,
  SONDEO_MINIMO_AFIRMACIONES_CONTRARIAS,
  SONDEO_MINIMO_AFIRMACIONES_SEMBRADAS,
  SONDEO_MINIMO_VALORACIONES_PARA_UBICAR,
  type SondeoDetalle,
  type SondeoResultado,
  type SondeoResumen,
  opaqueId as opaqueIdSchema,
  valorarAfirmacion as valorarAfirmacionSchema,
} from '@koinonia/contracts';
import {
  aPantalla,
  analizarConsenso,
  type Celda,
  type MatrizVotos,
  PcaNoConvergente,
  SinVariacion,
  TEXTOS as TEXTOS_CONSENSO,
} from '@koinonia/consensus';
import type { Actor, MemberId, Role } from '@koinonia/domain';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// El puerto: lo que estas rutas necesitan de un almacén, y nada más
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface SondeoAlmacenado {
  readonly id: string;
  readonly asuntoId: string;
  readonly asuntoTipo: AsuntoSondeo;
  readonly motivo: string;
  readonly convocaId: MemberId;
  readonly estado: EstadoSondeo;
  readonly creadoEn: number;
}

export interface AfirmacionAlmacenada {
  readonly id: string;
  readonly sondeoId: string;
  readonly texto: string;
  readonly autorId: MemberId;
  /** `true` si es una de las afirmaciones de la siembra fundacional (ADR-0038). */
  readonly esDeLaSiembraFundacional: boolean;
  /** Sólo tiene sentido si `esDeLaSiembraFundacional` es `true`. */
  readonly contrariaALaPosicionDeQuienConvoca: boolean;
  readonly creadoEn: number;
}

export interface ValoracionAlmacenada {
  readonly sondeoId: string;
  readonly afirmacionId: string;
  readonly memberId: MemberId;
  readonly respuesta: RespuestaSondeo;
  readonly cuando: number;
}

/**
 * Puerto de almacenamiento. Sin `pool` ni SQL acá adentro: quien integra decide si esto vive en
 * PostgreSQL, y con qué transacciones. Lo único que este fichero exige es la forma.
 */
export interface RepositorioSondeos {
  crearSondeo: (sondeo: SondeoAlmacenado) => Promise<void>;
  obtenerSondeo: (id: string) => Promise<SondeoAlmacenado | undefined>;
  listarSondeos: () => Promise<readonly SondeoAlmacenado[]>;
  actualizarEstadoSondeo: (id: string, estado: EstadoSondeo) => Promise<void>;

  agregarAfirmacion: (afirmacion: AfirmacionAlmacenada) => Promise<void>;
  listarAfirmaciones: (sondeoId: string) => Promise<readonly AfirmacionAlmacenada[]>;
  obtenerAfirmacion: (
    sondeoId: string,
    afirmacionId: string,
  ) => Promise<AfirmacionAlmacenada | undefined>;

  /**
   * Registra una valoración. **Upsert**: si la persona ya había valorado esa afirmación, la
   * respuesta nueva reemplaza a la anterior — cambiar de opinión no suma una fila, igual que
   * `ultimaPapeletaPorVotante` en `service.ts` para las papeletas de decisión.
   */
  registrarValoracion: (valoracion: ValoracionAlmacenada) => Promise<void>;
  listarValoraciones: (sondeoId: string) => Promise<readonly ValoracionAlmacenada[]>;
}

/**
 * Implementación de referencia, en memoria del proceso.
 *
 * **No es apta para producción**: se pierde al reiniciar el servidor y no es segura entre
 * réplicas. Existe para que las pruebas de este fichero (`tests/integration/http-consenso.test.ts`)
 * puedan ejercitar las rutas de verdad sin esperar a que exista la persistencia real, y para que
 * quien integre tenga un ejemplo concreto de qué invariantes tiene que sostener el reemplazo:
 * sobre todo, que `registrarValoracion` es upsert por `(sondeoId, afirmacionId, memberId)`.
 */
export function repositorioSondeosEnMemoria(): RepositorioSondeos {
  const sondeos = new Map<string, SondeoAlmacenado>();
  const afirmaciones = new Map<string, AfirmacionAlmacenada[]>();
  // Clave: `${sondeoId} ${afirmacionId} ${memberId}` — separador que no puede aparecer
  // en un id de 32 hex ni en un MemberId, así que no hay colisión posible entre claves distintas.
  const valoraciones = new Map<string, ValoracionAlmacenada>();

  function claveValoracion(sondeoId: string, afirmacionId: string, memberId: string): string {
    return `${sondeoId} ${afirmacionId} ${memberId}`;
  }

  return {
    crearSondeo(sondeo) {
      sondeos.set(sondeo.id, sondeo);
      afirmaciones.set(sondeo.id, []);
      return Promise.resolve();
    },
    obtenerSondeo(id) {
      return Promise.resolve(sondeos.get(id));
    },
    listarSondeos() {
      return Promise.resolve([...sondeos.values()]);
    },
    actualizarEstadoSondeo(id, estado) {
      const previo = sondeos.get(id);
      if (previo !== undefined) sondeos.set(id, { ...previo, estado });
      return Promise.resolve();
    },
    agregarAfirmacion(afirmacion) {
      const lista = afirmaciones.get(afirmacion.sondeoId) ?? [];
      lista.push(afirmacion);
      afirmaciones.set(afirmacion.sondeoId, lista);
      return Promise.resolve();
    },
    listarAfirmaciones(sondeoId) {
      return Promise.resolve(afirmaciones.get(sondeoId) ?? []);
    },
    obtenerAfirmacion(sondeoId, afirmacionId) {
      const lista = afirmaciones.get(sondeoId) ?? [];
      return Promise.resolve(lista.find((a) => a.id === afirmacionId));
    },
    registrarValoracion(valoracion) {
      valoraciones.set(
        claveValoracion(valoracion.sondeoId, valoracion.afirmacionId, valoracion.memberId),
        valoracion,
      );
      return Promise.resolve();
    },
    listarValoraciones(sondeoId) {
      return Promise.resolve([...valoraciones.values()].filter((v) => v.sondeoId === sondeoId));
    },
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// El contexto: exactamente lo que estas rutas necesitan del ámbito de `buildApp`
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface ContextoConsenso {
  readonly repositorio: RepositorioSondeos;
  readonly ports: {
    readonly clock: { now: () => number };
    readonly random: { opaqueId: () => string };
  };
  /** Resuelve el título del problema o la propuesta sobre la que se abre un sondeo. */
  readonly tituloDeAsunto: (asuntoId: string, asuntoTipo: AsuntoSondeo) => Promise<string>;
  /** `true` si ese problema o propuesta existe. Falla cerrado: si no se puede saber, `false`. */
  readonly asuntoExiste: (asuntoId: string, asuntoTipo: AsuntoSondeo) => Promise<boolean>;
  /** Mismo cierre que `idDe` en `app.ts`: el `MemberId` de quien llama, o nada si es anónimo. */
  readonly idDe: (request: FastifyRequest) => MemberId | undefined;
  /** Mismo cierre que `actorDe` en `app.ts`. */
  readonly actorDe: (request: FastifyRequest) => Actor;
  /** Mismo cierre que `sujetoPropioDe` en `app.ts`: exige sesión o lanza. */
  readonly sujetoPropioDe: (request: FastifyRequest) => MemberId;
  /** Mismo cierre que `cupoDeEscritura` en `app.ts`. */
  readonly cupoDeEscritura: (request: FastifyRequest) => Promise<void>;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Errores propios, traducidos en el propio handler (no dependen de `errorDe` de `app.ts`)
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Rechazo propio de este fichero, con código estable y estado HTTP.
 *
 * No es `ServicioError` de `service.ts` ni `UnauthorizedError` de `@koinonia/domain`: ambos son
 * ficheros que no me toca editar (el primero es compartido con otras cuatro personas trabajando a
 * la vez; el segundo tiene una unión cerrada de acciones que no incluye ninguna de sondeo). Cada
 * ruta atrapa `SondeoError` y arma la respuesta ella misma; todo lo demás —un `ZodError` de
 * `parse`, por ejemplo— sigue de largo hacia el manejador global que ya instala `app.ts`.
 */
export class SondeoError extends Error {
  readonly codigo: string;
  readonly estado: number;
  readonly campo?: string;

  constructor(codigo: string, estado: number, campo?: string) {
    super(mensajeDe(codigo, MENSAJES_SONDEO[codigo]));
    this.name = 'SondeoError';
    this.codigo = codigo;
    this.estado = estado;
    if (campo !== undefined) this.campo = campo;
  }
}

async function conRespuestaDeError(reply: FastifyReply, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (!(error instanceof SondeoError)) throw error;
    await reply.status(error.estado).send({
      codigo: error.codigo,
      mensaje: error.message,
      ...(error.campo === undefined ? {} : { campo: error.campo }),
    });
  }
}

/** Parsea con Zod y deja que el `ZodError` viaje hacia el manejador global de `app.ts`. */
function parse<T>(schema: { parse: (value: unknown) => T }, value: unknown): T {
  return schema.parse(value);
}

const idParamSchema = z.object({ id: opaqueIdSchema }).strict();
const idsAfirmacionParamSchema = z
  .object({ id: opaqueIdSchema, afirmacionId: opaqueIdSchema })
  .strict();

function esMiembro(actor: Actor): boolean {
  const roles: readonly Role[] = actor.roles;
  return roles.includes('member') || roles.includes('facilitator') || roles.includes('guarantees');
}

function exigirMiembro(actor: Actor): void {
  if (actor.memberId === undefined) throw new SondeoError('UNAUTHORIZED_NOT_AUTHENTICATED', 401);
  if (!esMiembro(actor)) throw new SondeoError('UNAUTHORIZED_ROLE_NOT_GRANTED', 403);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Traducción voto ⇄ celda de la matriz (mismo mapeo que `packages/consensus` espera)
// ═════════════════════════════════════════════════════════════════════════════════════════════

function celdaDeRespuesta(respuesta: RespuestaSondeo): Celda {
  if (respuesta === 'de_acuerdo') return 1;
  if (respuesta === 'en_desacuerdo') return -1;
  return 0;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Construcción de DTOs de lectura
// ═════════════════════════════════════════════════════════════════════════════════════════════

function afirmacionSondeoDto(
  afirmacion: AfirmacionAlmacenada,
  yo: MemberId | undefined,
  miValoracion: RespuestaSondeo | undefined,
): AfirmacionSondeo {
  return {
    id: afirmacion.id,
    texto: afirmacion.texto,
    sembradaPorMi: yo !== undefined && afirmacion.autorId === yo,
    contrariaALaPosicionDeQuienConvoca:
      afirmacion.esDeLaSiembraFundacional && afirmacion.contrariaALaPosicionDeQuienConvoca,
    ...(miValoracion === undefined ? {} : { miValoracion }),
  };
}

function sondeoResumenDto(
  sondeo: SondeoAlmacenado,
  asuntoTitulo: string,
  yo: MemberId | undefined,
  totalAfirmaciones: number,
  totalValoraciones: number,
): SondeoResumen {
  return {
    id: sondeo.id,
    asuntoId: sondeo.asuntoId,
    asuntoTipo: sondeo.asuntoTipo,
    asuntoTitulo,
    motivo: sondeo.motivo,
    estado: sondeo.estado,
    estadoEnPalabras: ESTADO_SONDEO_EN_PALABRAS[sondeo.estado],
    convocaEsMi: yo !== undefined && sondeo.convocaId === yo,
    totalAfirmaciones,
    totalValoraciones,
    desde: sondeo.creadoEn,
  };
}

/**
 * Ruteo simplificado (ver nota de cabecera): entre lo que la persona no valoró, elige lo menos
 * valorado hasta ahora; desempata por antigüedad y, en último caso, por id. Determinista siempre:
 * ni `Math.random()` ni dependencia del orden de inserción del repositorio.
 */
function elegirSiguiente(
  afirmaciones: readonly AfirmacionAlmacenada[],
  totalPorAfirmacion: ReadonlyMap<string, number>,
  yaValoradas: ReadonlySet<string>,
): AfirmacionAlmacenada | undefined {
  let elegida: AfirmacionAlmacenada | undefined;
  let totalElegida = 0;
  for (const candidata of afirmaciones) {
    if (yaValoradas.has(candidata.id)) continue;
    const total = totalPorAfirmacion.get(candidata.id) ?? 0;
    if (elegida === undefined) {
      elegida = candidata;
      totalElegida = total;
      continue;
    }
    if (
      total < totalElegida ||
      (total === totalElegida &&
        (candidata.creadoEn < elegida.creadoEn ||
          (candidata.creadoEn === elegida.creadoEn && candidata.id < elegida.id)))
    ) {
      elegida = candidata;
      totalElegida = total;
    }
  }
  return elegida;
}

async function sondeoDetalleDto(
  ctx: ContextoConsenso,
  sondeo: SondeoAlmacenado,
  yo: MemberId | undefined,
): Promise<SondeoDetalle> {
  const [asuntoTitulo, afirmaciones, valoraciones] = await Promise.all([
    ctx.tituloDeAsunto(sondeo.asuntoId, sondeo.asuntoTipo),
    ctx.repositorio.listarAfirmaciones(sondeo.id),
    ctx.repositorio.listarValoraciones(sondeo.id),
  ]);

  const totalPorAfirmacion = new Map<string, number>();
  const misValoraciones = new Map<string, RespuestaSondeo>();
  for (const v of valoraciones) {
    totalPorAfirmacion.set(v.afirmacionId, (totalPorAfirmacion.get(v.afirmacionId) ?? 0) + 1);
    if (yo !== undefined && v.memberId === yo) misValoraciones.set(v.afirmacionId, v.respuesta);
  }

  const resumen = sondeoResumenDto(
    sondeo,
    asuntoTitulo,
    yo,
    afirmaciones.length,
    valoraciones.length,
  );

  const fundacionales = afirmaciones.filter((a) => a.esDeLaSiembraFundacional);
  const contrarias = fundacionales.filter((a) => a.contrariaALaPosicionDeQuienConvoca);
  const progresoSiembra =
    sondeo.estado === 'sembrando'
      ? {
          sembradas: fundacionales.length,
          faltan: Math.max(0, SONDEO_MINIMO_AFIRMACIONES_SEMBRADAS - fundacionales.length),
          contrariasSembradas: contrarias.length,
          contrariasFaltan: Math.max(0, SONDEO_MINIMO_AFIRMACIONES_CONTRARIAS - contrarias.length),
        }
      : undefined;

  const siguiente =
    sondeo.estado === 'abierto'
      ? elegirSiguiente(afirmaciones, totalPorAfirmacion, new Set(misValoraciones.keys()))
      : undefined;

  return {
    ...resumen,
    ...(progresoSiembra === undefined ? {} : { progresoSiembra }),
    ...(siguiente === undefined
      ? {}
      : { siguienteAfirmacion: afirmacionSondeoDto(siguiente, yo, undefined) }),
    miProgreso: { valoradas: misValoraciones.size, total: afirmaciones.length },
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Resultado: matriz → `@koinonia/consensus` → DTO sin magnitudes crudas (ADR-0048)
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** Con menos personas ubicables que esto, no hay eje sobre el que separar a nadie de verdad. */
const SONDEO_RESULTADO_PARTICIPANTES_MINIMOS = 6;

const AVISO_PROVISIONAL =
  'Este resultado se puede volver a calcular a partir de las valoraciones; todavía no es una ' +
  'agenda que la asamblea haya congelado.';

function afirmacionResultadoDto(
  texto: string,
  probabilidadesPorGrupo: readonly number[],
  observaciones: number,
): AfirmacionResultadoSondeo {
  return {
    texto,
    porcentajeAcuerdoPorGrupo: probabilidadesPorGrupo.map((p) => Math.round(p * 1000) / 10),
    observaciones,
  };
}

async function calcularResultado(
  ctx: ContextoConsenso,
  sondeo: SondeoAlmacenado,
  yo: MemberId | undefined,
): Promise<SondeoResultado> {
  if (sondeo.estado === 'sembrando') {
    return {
      tipo: 'todavia_no',
      motivo: 'sembrando',
      descripcion: TEXTOS_CONSENSO.sinGruposDescripcion,
    };
  }

  const [afirmaciones, valoraciones] = await Promise.all([
    ctx.repositorio.listarAfirmaciones(sondeo.id),
    ctx.repositorio.listarValoraciones(sondeo.id),
  ]);

  const porPersona = new Map<MemberId, Map<string, RespuestaSondeo>>();
  for (const v of valoraciones) {
    let fila = porPersona.get(v.memberId);
    if (fila === undefined) {
      fila = new Map();
      porPersona.set(v.memberId, fila);
    }
    fila.set(v.afirmacionId, v.respuesta);
  }

  // El mínimo de PRODUCT.md §4 («menos de 7 votos, todavía no podemos ubicarte») se aplica ACÁ:
  // ADR-0048 dice que `@koinonia/consensus` no lo implementa y que no es su competencia.
  const ubicables = [...porPersona.entries()].filter(
    ([, fila]) => fila.size >= SONDEO_MINIMO_VALORACIONES_PARA_UBICAR,
  );
  const participantesSinUbicar = porPersona.size - ubicables.length;

  if (ubicables.length < SONDEO_RESULTADO_PARTICIPANTES_MINIMOS) {
    return {
      tipo: 'todavia_no',
      motivo: 'poca_gente',
      descripcion:
        'Todavía no hay suficiente gente ubicada en el mapa para dibujar grupos con sentido.',
    };
  }

  // Orden estable e independiente del `Map` de JS o del repositorio real: por `MemberId`
  // ascendente, mismo criterio que `matrizDeConsenso` en `service.ts` para la otra pantalla que
  // usa este mismo paquete — el análisis promete ser reproducible y una permutación de filas que
  // dependiera del orden de llegada al repositorio lo rompería en silencio.
  ubicables.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const matriz: MatrizVotos = ubicables.map(([, fila]) =>
    afirmaciones.map((a) => {
      const respuesta = fila.get(a.id);
      return respuesta === undefined ? null : celdaDeRespuesta(respuesta);
    }),
  );
  const textos = afirmaciones.map((a) => a.texto);

  let resultado;
  try {
    resultado = analizarConsenso(matriz, textos);
  } catch (error) {
    if (error instanceof SinVariacion) {
      return {
        tipo: 'todavia_no',
        motivo: 'sin_diferencias',
        descripcion:
          'Todo el mundo respondió igual a todas las afirmaciones: no hay ninguna diferencia ' +
          'sobre la que separar a nadie.',
      };
    }
    if (error instanceof PcaNoConvergente) {
      return {
        tipo: 'todavia_no',
        motivo: 'no_se_estabilizo',
        descripcion:
          'Con las valoraciones de hoy el cálculo no se estabiliza en un resultado confiable. ' +
          'Con más valoraciones puede resolverse.',
      };
    }
    throw error;
  }

  const pantalla = aPantalla(resultado);
  const filaDeYo = yo === undefined ? -1 : ubicables.findIndex(([id]) => id === yo);
  const miGrupoId =
    resultado.tipo === 'GruposDetectados' && filaDeYo >= 0
      ? resultado.asignaciones[filaDeYo]
      : undefined;

  if (pantalla.tipo === 'FaccionesNoDetectadas') {
    return {
      tipo: 'sin_grupos_claros',
      esProvisional: true,
      avisoProvisional: AVISO_PROVISIONAL,
      participantesConsiderados: ubicables.length,
      participantesSinUbicar,
      titulo: pantalla.titulo,
      descripcion: pantalla.descripcion,
      acuerdoGeneralTitulo: pantalla.acuerdoGeneralTitulo,
      acuerdoGeneralDescripcion: pantalla.acuerdoGeneralDescripcion,
      acuerdoGeneral: pantalla.acuerdoGeneral.map((a) =>
        afirmacionResultadoDto(a.texto, a.pPorGrupo, a.observaciones),
      ),
      aviso: pantalla.aviso,
    };
  }

  const grupos: GrupoSondeo[] = pantalla.grupos.map((g) => ({
    nombre: TEXTOS_CONSENSO.grupoNumero(g.id),
    tamano: g.tamano,
  }));

  return {
    tipo: 'grupos_detectados',
    esProvisional: true,
    avisoProvisional: AVISO_PROVISIONAL,
    participantesConsiderados: ubicables.length,
    participantesSinUbicar,
    titulo: pantalla.titulo,
    descripcion: pantalla.descripcion,
    grupos,
    ...(miGrupoId === undefined || miGrupoId <= 0
      ? {}
      : { miGrupo: TEXTOS_CONSENSO.grupoNumero(miGrupoId) }),
    afirmacionesPuenteTitulo: TEXTOS_CONSENSO.afirmacionesPuenteTitulo,
    afirmacionesPuenteDescripcion: TEXTOS_CONSENSO.afirmacionesPuenteDescripcion,
    afirmacionesPuente: pantalla.afirmacionesPuente.map((a) =>
      afirmacionResultadoDto(a.texto, a.pPorGrupo, a.observaciones),
    ),
    afirmacionesDivisivasTitulo: TEXTOS_CONSENSO.afirmacionesDivisivasTitulo,
    afirmacionesDivisivasDescripcion: TEXTOS_CONSENSO.afirmacionesDivisivasDescripcion,
    afirmacionesDivisivas: pantalla.afirmacionesDivisivas.map((a) =>
      afirmacionResultadoDto(a.texto, a.pPorGrupo, a.observaciones),
    ),
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Las rutas
// ═════════════════════════════════════════════════════════════════════════════════════════════

export function registrarRutasDeConsenso(app: FastifyInstance, ctx: ContextoConsenso): void {
  app.get('/sondeos', async (request) => {
    parse(z.object({}).strict(), request.query);
    const yo = ctx.idDe(request);
    const lista = await ctx.repositorio.listarSondeos();
    const resumenes: SondeoResumen[] = [];
    for (const sondeo of lista) {
      const [asuntoTitulo, afirmaciones, valoraciones] = await Promise.all([
        ctx.tituloDeAsunto(sondeo.asuntoId, sondeo.asuntoTipo),
        ctx.repositorio.listarAfirmaciones(sondeo.id),
        ctx.repositorio.listarValoraciones(sondeo.id),
      ]);
      resumenes.push(
        sondeoResumenDto(sondeo, asuntoTitulo, yo, afirmaciones.length, valoraciones.length),
      );
    }
    // Más reciente primero: es lo que alguien que entra a la pantalla quiere ver arriba.
    resumenes.sort((a, b) => b.desde - a.desde);
    return resumenes;
  });

  app.post('/sondeos', async (request, reply) => {
    await ctx.cupoDeEscritura(request);
    const cuerpo = parse(abrirSondeoSchema, request.body);
    const quien = ctx.sujetoPropioDe(request);
    const actor = ctx.actorDe(request);
    await conRespuestaDeError(reply, async () => {
      exigirMiembro(actor);
      const existe = await ctx.asuntoExiste(cuerpo.asuntoId, cuerpo.asuntoTipo);
      if (!existe) throw new SondeoError('ASUNTO_NO_ENCONTRADO', 404);
      const sondeo: SondeoAlmacenado = {
        id: ctx.ports.random.opaqueId(),
        asuntoId: cuerpo.asuntoId,
        asuntoTipo: cuerpo.asuntoTipo,
        motivo: cuerpo.motivo,
        convocaId: quien,
        estado: 'sembrando',
        creadoEn: ctx.ports.clock.now(),
      };
      await ctx.repositorio.crearSondeo(sondeo);
      const asuntoTitulo = await ctx.tituloDeAsunto(sondeo.asuntoId, sondeo.asuntoTipo);
      await reply.status(201).send(sondeoResumenDto(sondeo, asuntoTitulo, quien, 0, 0));
    });
  });

  app.get('/sondeos/:id', async (request) => {
    parse(z.object({}).strict(), request.query);
    const { id } = parse(idParamSchema, request.params);
    const yo = ctx.idDe(request);
    const sondeo = await ctx.repositorio.obtenerSondeo(id);
    if (sondeo === undefined) throw new SondeoError('SONDEO_NO_ENCONTRADO', 404);
    return await sondeoDetalleDto(ctx, sondeo, yo);
  });

  app.get('/sondeos/:id/resultado', async (request) => {
    parse(z.object({}).strict(), request.query);
    const { id } = parse(idParamSchema, request.params);
    const yo = ctx.idDe(request);
    const sondeo = await ctx.repositorio.obtenerSondeo(id);
    if (sondeo === undefined) throw new SondeoError('SONDEO_NO_ENCONTRADO', 404);
    return await calcularResultado(ctx, sondeo, yo);
  });

  app.post('/sondeos/:id/afirmaciones', async (request, reply) => {
    await ctx.cupoDeEscritura(request);
    const { id } = parse(idParamSchema, request.params);
    const cuerpo = parse(sembrarAfirmacionSchema, request.body);
    const quien = ctx.sujetoPropioDe(request);
    const actor = ctx.actorDe(request);
    await conRespuestaDeError(reply, async () => {
      exigirMiembro(actor);
      const sondeo = await ctx.repositorio.obtenerSondeo(id);
      if (sondeo === undefined) throw new SondeoError('SONDEO_NO_ENCONTRADO', 404);
      if (sondeo.estado === 'cerrado') throw new SondeoError('SONDEO_CERRADO', 409);

      const esFundacional = sondeo.estado === 'sembrando';
      if (esFundacional && sondeo.convocaId !== quien) {
        throw new SondeoError('SIEMBRA_SOLO_QUIEN_CONVOCA', 403);
      }
      let contraria = false;
      if (esFundacional) {
        if (cuerpo.contrariaAMiPosicion === undefined) {
          throw new SondeoError(
            'SIEMBRA_DEBE_DECLARAR_SI_ES_CONTRARIA',
            422,
            'contrariaAMiPosicion',
          );
        }
        contraria = cuerpo.contrariaAMiPosicion;
      }

      const afirmacion: AfirmacionAlmacenada = {
        id: ctx.ports.random.opaqueId(),
        sondeoId: sondeo.id,
        texto: cuerpo.texto,
        autorId: quien,
        esDeLaSiembraFundacional: esFundacional,
        contrariaALaPosicionDeQuienConvoca: contraria,
        creadoEn: ctx.ports.clock.now(),
      };
      await ctx.repositorio.agregarAfirmacion(afirmacion);

      if (esFundacional) {
        const todas = await ctx.repositorio.listarAfirmaciones(sondeo.id);
        const fundacionales = todas.filter((a) => a.esDeLaSiembraFundacional);
        const contrarias = fundacionales.filter((a) => a.contrariaALaPosicionDeQuienConvoca);
        if (
          fundacionales.length >= SONDEO_MINIMO_AFIRMACIONES_SEMBRADAS &&
          contrarias.length >= SONDEO_MINIMO_AFIRMACIONES_CONTRARIAS
        ) {
          await ctx.repositorio.actualizarEstadoSondeo(sondeo.id, 'abierto');
        }
      }

      await reply.status(201).send(afirmacionSondeoDto(afirmacion, quien, undefined));
    });
  });

  app.post('/sondeos/:id/afirmaciones/:afirmacionId/valoraciones', async (request, reply) => {
    await ctx.cupoDeEscritura(request);
    const { id, afirmacionId } = parse(idsAfirmacionParamSchema, request.params);
    const cuerpo = parse(valorarAfirmacionSchema, request.body);
    const quien = ctx.sujetoPropioDe(request);
    const actor = ctx.actorDe(request);
    await conRespuestaDeError(reply, async () => {
      exigirMiembro(actor);
      const sondeo = await ctx.repositorio.obtenerSondeo(id);
      if (sondeo === undefined) throw new SondeoError('SONDEO_NO_ENCONTRADO', 404);
      if (sondeo.estado === 'cerrado') throw new SondeoError('SONDEO_CERRADO', 409);
      if (sondeo.estado === 'sembrando') throw new SondeoError('SONDEO_TODAVIA_SEMBRANDO', 409);

      const afirmacion = await ctx.repositorio.obtenerAfirmacion(id, afirmacionId);
      if (afirmacion === undefined) throw new SondeoError('AFIRMACION_NO_ENCONTRADA', 404);

      await ctx.repositorio.registrarValoracion({
        sondeoId: id,
        afirmacionId,
        memberId: quien,
        respuesta: cuerpo.respuesta,
        cuando: ctx.ports.clock.now(),
      });

      await reply.status(200).send(afirmacionSondeoDto(afirmacion, quien, cuerpo.respuesta));
    });
  });
}
