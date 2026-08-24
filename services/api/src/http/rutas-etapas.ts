/**
 * Rutas dedicadas de las dos etapas de deliberación que hoy sólo se alcanzan a través del `aportar`
 * genérico: `objeciones` y `enmiendas` (`packages/domain/src/deliberation/state-machine.ts`,
 * `STAGE_RULES`). El motor las tiene desde siempre —`STAGE_TRANSITIONS` encadena
 * `construccion_alternativas → objeciones → enmiendas → listo_para_decidir`, y `STAGE_RULES` ya
 * declara qué tipo de aporte cabe en cada una—; lo que faltaba era una ruta por la que llegaran.
 *
 * ═══ Por qué una ruta aparte, y no ampliar `/deliberaciones/:id/aportes` ═══
 *
 * No hace falta —y sería el error contrario al que corrige `state-machine.ts` en su propia
 * cabecera («las dos tablas son datos, no cadenas de if»)— duplicar la máquina de etapas aquí. Este
 * fichero llama exactamente a `aportarADeliberacion`, la misma función de `service.ts` que ya usa
 * `POST /deliberaciones/:id/aportes`, así que la decisión de qué cabe en qué etapa la sigue tomando
 * el motor una sola vez. Lo que este fichero SÍ acota es el CONTRATO de entrada, por dos razones que
 * `packages/contracts/src/etapas.ts` explica en detalle:
 *
 *  1. El tipo del cuerpo admitido es el subconjunto de la etapa, no el de los seis tipos de aporte
 *     que existen en todo el sistema. Un cuerpo `tipo: 'posicion'` no compila contra este contrato;
 *     con `aportar` genérico compila y se rechaza recién en el motor (422 tardío en vez de 400 en
 *     el borde).
 *  2. En `enmiendas`, la rama `alternativa` exige `corrigeA` EN EL TIPO. `aportar` genérico lo deja
 *     opcional para los seis tipos porque sólo uno lo exige; acá, en la única ruta donde ese tipo
 *     puede ir, no hace falta la generalidad.
 *
 * ═══ Las dos aristas de una alternativa en `enmiendas`, y por qué no se confunden ═══
 *
 * `saleDe` (`sourcePositionIds` en el dominio) apunta a las POSICIONES de las que sale la
 * alternativa; `corrigeA` (`supersedesContributionId`) apunta a la ALTERNATIVA que corrige. Son dos
 * aristas de tipo de destino distinto —el motor las valida por separado en
 * `packages/domain/src/deliberation/graph.ts` (`referencesOf`, `assertReferences`) y rechaza con
 * `WRONG_REFERENCE_KIND` si `saleDe` apunta a la alternativa en vez de a una posición—, y este
 * fichero no las junta en un único campo `refiere` que dependería de que quien llama no se
 * equivoque de destino. La prueba de integración de este incremento cubre exactamente esa confusión
 * (una enmienda cuyo `saleDe` apunta a la alternativa que se corrige, en vez de a las posiciones de
 * origen) y comprueba que el servidor la rechaza.
 *
 * ═══ Cómo se integra ═══
 *
 * Este fichero **no toca `app.ts`**. Exporta una única función registradora,
 * `registrarRutasDeEtapas(app, ctx)`, que un agente integrador llama desde dentro de `buildApp` —
 * ahí es donde ya existen, como cierres locales, todo lo que `ContextoEtapas` necesita: `actorDe`,
 * `cupoDeEscritura`, `cupoDeComentario`, `tituloDelProblema` y `deps`. Ninguna pieza nueva de
 * autorización ni de límite de tasa: exactamente las mismas que usa hoy
 * `POST /deliberaciones/:id/aportes` en `app.ts`, en el mismo orden.
 *
 * `packages/contracts/src/index.ts` todavía no reexporta `etapas.ts` (la consigna prohíbe tocar ese
 * fichero desde este incremento), así que este módulo NO importa los esquemas de `objecion` /
 * `enmienda` por `@koinonia/contracts`: los duplica localmente, campo por campo idéntico a
 * `packages/contracts/src/etapas.ts`, exactamente como ya hicieron `rutas-consenso.ts` y
 * `rutas-evaluacion.ts` con este mismo problema de orden de integración. El día que el integrador
 * añada esa línea a `index.ts`, este `import` local se cambia por uno de `@koinonia/contracts` sin
 * tocar la forma de los esquemas — las pruebas de ambos ficheros comprueban por separado que
 * coinciden con `STAGE_RULES`, así que un cambio que los desalinee se ve ahí primero.
 *
 * ═══ Autorización ═══
 *
 * Igual que las rutas ya existentes de deliberación (ver la nota en `app.ts` justo encima de
 * `POST /deliberaciones/:id/aportes`): ninguna ruta de este fichero comprueba un permiso por su
 * cuenta. `submitContribution` llama a `authorize` antes de construir el evento, así que un
 * `preHandler` aquí protegería exactamente lo que el motor ya protege, con una segunda copia de la
 * regla que se puede desalinear.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  MIN_CONTRIBUTION_LENGTH,
  REASON_RELATIONS,
  RISK_SEVERITIES,
  type Actor,
} from '@koinonia/domain';
import { opaqueId, requestId, type DeliberacionDetalle } from '@koinonia/contracts';

import { deliberacionDetalleDto } from './presenters.js';
import { aportarADeliberacion, type ServicioDeps } from './service.js';

/** Exactamente lo que estas rutas necesitan del ámbito de `buildApp`: nada más. */
export interface ContextoEtapas {
  readonly deps: ServicioDeps;
  /** Mismo cierre que `actorDe` en `app.ts`. */
  readonly actorDe: (request: FastifyRequest) => Actor;
  /** Mismo cierre que `cupoDeEscritura` en `app.ts`. */
  readonly cupoDeEscritura: (request: FastifyRequest) => Promise<void>;
  /** Mismo cierre que `cupoDeComentario` en `app.ts` (T-12): topa aportes y comentarios juntos. */
  readonly cupoDeComentario: (request: FastifyRequest) => Promise<void>;
  /** Mismo cierre que `tituloDelProblema` en `app.ts`. */
  readonly tituloDelProblema: (problemaId: string) => Promise<string>;
}

function parse<T>(schema: { parse: (value: unknown) => T }, value: unknown): T {
  return schema.parse(value);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Esquemas — duplicados a propósito de `packages/contracts/src/etapas.ts` (ver nota de cabecera).
// Una prueba de este fichero y otra del fichero de contratos comprueban, cada una desde su lado,
// que estos tipos coinciden con `STAGE_RULES.objeciones.kinds` / `STAGE_RULES.enmiendas.kinds`.
// ═════════════════════════════════════════════════════════════════════════════════════════════

const textoAporte = z
  .string()
  .min(
    MIN_CONTRIBUTION_LENGTH,
    'Contá algo más: con menos de veinte caracteres es una reacción, no un aporte.',
  )
  .max(4000, 'Quedó muy largo para leerlo en un teléfono. Partilo en dos aportes.');

const listaDeAportes = z
  .array(opaqueId)
  .min(1, 'Elegí al menos un aporte al que esto se refiere.')
  .max(20)
  .refine((ids) => new Set(ids).size === ids.length, 'Un aporte sólo se referencia una vez.');

const relacionRazon = z.enum(REASON_RELATIONS);

const gravedadRiesgo = z.union(
  RISK_SEVERITIES.map((n) => z.literal(n)) as [
    z.ZodLiteral<(typeof RISK_SEVERITIES)[number]>,
    z.ZodLiteral<(typeof RISK_SEVERITIES)[number]>,
    ...z.ZodLiteral<(typeof RISK_SEVERITIES)[number]>[],
  ],
);

const razonEnEtapa = z
  .object({
    requestId,
    corrigeA: opaqueId.optional(),
    tipo: z.literal('razon'),
    relacion: relacionRazon,
    posicionId: opaqueId,
    texto: textoAporte,
  })
  .strict();

const evidenciaEnEtapa = z
  .object({
    requestId,
    corrigeA: opaqueId.optional(),
    tipo: z.literal('evidencia'),
    sostieneRazonId: opaqueId,
    texto: textoAporte,
    fuente: z.string().min(1).max(140).optional(),
  })
  .strict();

const supuestoEnEtapa = z
  .object({
    requestId,
    corrigeA: opaqueId.optional(),
    tipo: z.literal('supuesto'),
    aplicaA: listaDeAportes,
    texto: textoAporte,
  })
  .strict();

/** Cabe en `objeciones`: un riesgo de una alternativa, o una razón/evidencia/supuesto sobre él. */
const objecionSchema = z.discriminatedUnion('tipo', [
  z
    .object({
      requestId,
      corrigeA: opaqueId.optional(),
      tipo: z.literal('riesgo'),
      salidaId: opaqueId,
      gravedad: gravedadRiesgo,
      impacto: textoAporte,
      mitigacion: textoAporte,
    })
    .strict(),
  razonEnEtapa,
  evidenciaEnEtapa,
  supuestoEnEtapa,
]);

/** Cabe en `enmiendas`: una alternativa que corrige a otra, o razón/evidencia/supuesto sobre ella. */
const enmiendaSchema = z.discriminatedUnion('tipo', [
  z
    .object({
      requestId,
      tipo: z.literal('alternativa'),
      problemaId: opaqueId,
      saleDe: listaDeAportes,
      texto: textoAporte,
      corrigeA: opaqueId,
    })
    .strict(),
  razonEnEtapa,
  evidenciaEnEtapa,
  supuestoEnEtapa,
]);

/**
 * Registra las rutas de este fichero sobre `app`. No añade `onRequest` ni error handler propios:
 * hereda el de `buildApp`, así que sólo tiene sentido llamarla después de que `buildApp` los instale
 * — igual que el resto de las rutas de `app.ts`.
 */
export function registrarRutasDeEtapas(app: FastifyInstance, ctx: ContextoEtapas): void {
  async function detalle(
    request: FastifyRequest,
    id: string,
    state: Parameters<typeof deliberacionDetalleDto>[1],
  ): Promise<DeliberacionDetalle> {
    return deliberacionDetalleDto(
      id,
      state,
      ctx.actorDe(request),
      await ctx.tituloDelProblema(state.problemId ?? ''),
    );
  }

  /**
   * Escribe un aporte de `objeciones` (riesgo de una alternativa, o razón/evidencia/supuesto sobre
   * ese riesgo). Mismo orden de cupos que `POST /deliberaciones/:id/aportes` en `app.ts`: primero el
   * cupo de comentario (20/día, T-12), después el genérico de escritura (60/hora).
   */
  app.post('/deliberaciones/:id/objeciones', async (request, reply) => {
    await ctx.cupoDeComentario(request);
    await ctx.cupoDeEscritura(request);
    const { id } = parse(z.object({ id: z.string() }), request.params);
    const cuerpo = parse(objecionSchema, request.body);
    const escrita = await aportarADeliberacion(ctx.deps, ctx.actorDe(request), id, cuerpo);
    return await reply.status(201).send(await detalle(request, id, escrita.state));
  });

  /**
   * Escribe un aporte de `enmiendas` (una alternativa que corrige a otra, con sus dos aristas
   * obligatorias y distintas — ver la cabecera del fichero —, o razón/evidencia/supuesto sobre la
   * enmienda). Mismo orden de cupos que arriba.
   */
  app.post('/deliberaciones/:id/enmiendas', async (request, reply) => {
    await ctx.cupoDeComentario(request);
    await ctx.cupoDeEscritura(request);
    const { id } = parse(z.object({ id: z.string() }), request.params);
    const cuerpo = parse(enmiendaSchema, request.body);
    const escrita = await aportarADeliberacion(ctx.deps, ctx.actorDe(request), id, cuerpo);
    return await reply.status(201).send(await detalle(request, id, escrita.state));
  });
}
