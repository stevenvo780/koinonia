/**
 * Contratos dedicados de las dos etapas de deliberación que hoy sólo se alcanzan a través del
 * `aportar` genérico de `http.ts`: `objeciones` y `enmiendas`
 * (`packages/domain/src/deliberation/state-machine.ts`, tabla `STAGE_RULES`).
 *
 * ═══ Por qué un contrato aparte, y no seguir usando `aportar` a secas ═══
 *
 * `aportar` (http.ts) es la unión de los SEIS tipos de aporte que existen en todo el sistema, con
 * `corrigeA` opcional para los seis. Sirve exactamente igual para escribir en cualquier etapa, y
 * eso es correcto para el motor —STAGE_RULES es la única fuente de verdad de qué cabe en cada
 * etapa, no una tabla paralela aquí—, pero dos cosas se pierden al usarlo tal cual para las
 * pantallas de Objeciones y Enmiendas:
 *
 *  1. **El tipo no acota qué puede mandar el cliente.** Nada en el tipo de `Aportar` impide
 *     construir un cuerpo `{ tipo: 'posicion', ... }` y mandarlo al formulario de Objeciones: el
 *     motor lo rechaza en tiempo de ejecución (`CONTRIBUTION_KIND_NOT_ALLOWED`, 422), pero recién
 *     ahí. Acá el subconjunto admitido —`riesgo | razón | evidencia | supuesto` en objeciones;
 *     `alternativa | razón | evidencia | supuesto` en enmiendas, calcado uno a uno de
 *     `STAGE_RULES.objeciones.kinds` / `STAGE_RULES.enmiendas.kinds`— es el TIPO, no una
 *     comprobación adicional: un cuerpo con el tipo equivocado no compila del lado de quien integra
 *     la pantalla, y del lado del servidor se rechaza en el borde con 400, antes de tocar el motor.
 *  2. **`corrigeA` es opcional en `Aportar` para los seis tipos.** Eso es correcto en general —sólo
 *     `enmiendas` exige la corrección— pero deja que a alguien se le olvide justo en el único tipo
 *     donde el motor SÍ la exige (`AlternativeBody` en `enmiendas`,
 *     `STAGE_RULES.enmiendas.alternativeMustSupersede`), y el aviso llega tarde, como un 422 después
 *     de armar el cuerpo entero. Acá, en la rama `alternativa` de `enmienda`, `corrigeA` es
 *     OBLIGATORIO en el tipo.
 *
 * ═══ LA ADVERTENCIA QUE ESTE FICHERO EXISTE PARA NO DEJAR PASAR ═══
 *
 * Una `alternativa` en `enmiendas` declara DOS aristas distintas, a DOS clases de aporte distintas,
 * y confundirlas es el error exacto que el motor rechaza con un código distinto para cada caso
 * (`packages/domain/src/deliberation/graph.ts`, `referencesOf`):
 *
 *   - `saleDe` (`sourcePositionIds` en el dominio): de qué **posiciones** (`kind: 'posicion'`) sale
 *     la alternativa. No vacío. Si un id de esta lista no es una `posicion`, el motor rechaza con
 *     `WRONG_REFERENCE_KIND`.
 *   - `corrigeA` (`supersedesContributionId`): a qué **alternativa anterior** corrige. Tiene que ser
 *     del mismo tipo (`alternativa`) y de la MISMA autora o el mismo autor
 *     (`SUPERSEDES_ANOTHER_AUTHOR` si no). Corregir es un acto de quien escribió el original: nadie
 *     retira de la vista el aporte de otra persona escribiendo uno propio que diga corregirlo.
 *
 * `saleDe` NUNCA apunta a la alternativa que se corrige, y `corrigeA` NUNCA apunta a una posición.
 * Son campos distintos con destinos de tipo distinto, y este contrato los declara como tales — no
 * como un único `refiere` genérico que dejaría la distinción sólo en la cabeza de quien la escribe.
 *
 * ═══ Nota de integración (calcada de `rutas-consenso.ts` / `rutas-evaluacion.ts`) ═══
 *
 * `packages/contracts/src/index.ts` no reexporta este fichero todavía (la consigna prohíbe tocarlo
 * desde este incremento). Hasta que un agente integrador añada `export * from './etapas.js';`,
 * `services/api/src/http/rutas-etapas.ts` NO puede importar estos esquemas por `@koinonia/contracts`
 * ni por una ruta relativa que cruce el paquete: por eso ese fichero duplica localmente estos mismos
 * cuatro-más-cuatro esquemas, campo por campo. Las pruebas de ambos ficheros comprueban por separado
 * que la forma coincide con `STAGE_RULES`; el día que se integre este fichero, ese import relativo
 * se cambia por uno de `@koinonia/contracts` en una línea, sin tocar la forma.
 */

import { z } from 'zod';

import { MIN_CONTRIBUTION_LENGTH, REASON_RELATIONS, RISK_SEVERITIES } from '@koinonia/domain';

import { opaqueId, requestId } from './ids.js';

/** Los tipos de aporte que `STAGE_RULES.objeciones.kinds` admite, en el mismo orden. */
export const TIPOS_ADMITIDOS_EN_OBJECIONES = ['riesgo', 'razon', 'evidencia', 'supuesto'] as const;

/** Los tipos de aporte que `STAGE_RULES.enmiendas.kinds` admite, en el mismo orden. */
export const TIPOS_ADMITIDOS_EN_ENMIENDAS = [
  'alternativa',
  'razon',
  'evidencia',
  'supuesto',
] as const;

const textoAporte = z
  .string()
  .min(
    MIN_CONTRIBUTION_LENGTH,
    'Contá algo más: con menos de veinte caracteres es una reacción, no un aporte.',
  )
  .max(4000, 'Quedó muy largo para leerlo en un teléfono. Partilo en dos aportes.');

/** Un conjunto de referencias a otros aportes: ordenado, sin repetidos, con al menos uno. */
const listaDeAportes = z
  .array(opaqueId)
  .min(1, 'Elegí al menos un aporte al que esto se refiere.')
  .max(20)
  .refine((ids) => new Set(ids).size === ids.length, 'Un aporte sólo se referencia una vez.');

const relacionRazon = z.enum(REASON_RELATIONS);

/** Gravedad declarada de un riesgo. Sin valor por defecto: hay que decirlo. */
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

/**
 * Un aporte de la etapa `objeciones`: un riesgo de una alternativa ya construida, o una razón,
 * evidencia o supuesto que discute ese riesgo. No cabe `posicion` ni `alternativa` — ver
 * `TIPOS_ADMITIDOS_EN_OBJECIONES`, calcado de `STAGE_RULES.objeciones.kinds`.
 */
export const objecion = z.discriminatedUnion('tipo', [
  z
    .object({
      requestId,
      corrigeA: opaqueId.optional(),
      tipo: z.literal('riesgo'),
      /** Arista obligatoria: de qué ALTERNATIVA es riesgo. */
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
export type Objecion = z.infer<typeof objecion>;

/**
 * Un aporte de la etapa `enmiendas`: una alternativa que corrige a otra —con sus DOS aristas
 * obligatorias y distintas, ver la cabecera del fichero—, o una razón, evidencia o supuesto sobre
 * la enmienda. No cabe `posicion` ni una `alternativa` nueva sin `corrigeA` — ver
 * `TIPOS_ADMITIDOS_EN_ENMIENDAS`, calcado de `STAGE_RULES.enmiendas.kinds`.
 */
export const enmienda = z.discriminatedUnion('tipo', [
  z
    .object({
      requestId,
      tipo: z.literal('alternativa'),
      problemaId: opaqueId,
      /** Arista obligatoria: de qué POSICIONES sale. Nunca la alternativa que se corrige. */
      saleDe: listaDeAportes,
      texto: textoAporte,
      /**
       * Arista obligatoria Y NO opcional aquí (a diferencia de `aportar` en http.ts): a qué
       * ALTERNATIVA corrige. `STAGE_RULES.enmiendas.alternativeMustSupersede` lo exige en tiempo de
       * ejecución; este tipo lo exige en tiempo de compilación.
       */
      corrigeA: opaqueId,
    })
    .strict(),
  razonEnEtapa,
  evidenciaEnEtapa,
  supuestoEnEtapa,
]);
export type Enmienda = z.infer<typeof enmienda>;
