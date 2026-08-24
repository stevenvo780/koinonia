/**
 * Rutas HTTP de lectura de aprendizajes (ADR-0053): «¿esto ya se intentó?», pero preguntado con un
 * problema nuevo en la mano en vez de con una etiqueta exacta.
 *
 * ═══ Lo que ya existía y lo que faltaba ═══
 *
 * `GET /aprendizajes` (`rutas-evaluacion.ts`, ya integrada en `app.ts`) lista y filtra la memoria
 * institucional por etiqueta, tipo, desenlace, círculo o decisión — coincidencia exacta. Lo que
 * faltaba, y es lo que el pliego pide, es la otra pregunta: alguien tiene un problema nuevo, no una
 * etiqueta, y quiere saber si el colectivo ya aprendió algo parecido. Este fichero añade
 * exactamente eso, sin tocar una línea de `rutas-evaluacion.ts` ni de `app.ts`.
 *
 * ═══ Por qué esta ruta no vuelve a leer el ledger ═══
 *
 * Decodificar el agregado de evaluación (verificar la cadena, congelar los criterios de cada
 * iniciativa, recorrer los seis tipos de evento) ya está escrito, ya está probado, y es
 * deliberadamente privado a `rutas-evaluacion.ts` — su propia cabecera lo dice: es un formato de
 * cable congelado (`EVALUATION_EVENT_VERSION`), calcado a mano y sin la abstracción genérica de
 * `workspace/repository.ts` porque sólo hay un tipo de agregado que leer ahí. Copiarlo aquí
 * duplicaría la única pieza fina de esa ruta por una razón de organización de ficheros, no de
 * diseño: el día que ese decodificador cambie, esta ruta tendría que cambiar exactamente igual y en
 * silencio, o divergir.
 *
 * En cambio, esta ruta llama a `GET /aprendizajes` **por dentro**, con `app.inject(...)`: mismo
 * enrutador, mismos `hooks`, misma validación — cero bytes por un socket, porque `inject` no abre
 * uno. Lo único que este fichero añade encima de esa lista ya filtrada es la capa de parecido
 * léxico. Consecuencia directa y que hay que decir en voz alta: esta ruta **exige que
 * `registrarRutasDeEvaluacion` esté registrada en la MISMA instancia de Fastify** antes de que
 * llegue la primera petición — el orden de registro no importa (`inject` resuelve en tiempo de
 * petición, con el enrutador ya completo), pero la presencia sí. Si no lo está, la ruta lo dice con
 * un error claro en vez de devolver una lista vacía que parecería «no hay memoria todavía».
 *
 * ═══ Léxico, no semántico, y sin autoría ═══
 *
 * `similitud` es coincidencia de palabras después de bajar a minúscula y quitar tildes
 * (`normalizeForGlossary`, el mismo normalizador que ya usa el saneador del léxico prohibido) —
 * nada de IA: no hay proveedor de lenguaje conectado y el puerto está deliberadamente vacío. Un
 * aprendizaje que comparte cero palabras con el problema nuevo no aparece: no se inventa un puntaje
 * de «tal vez». Y, como toda esta memoria, ninguna fila lleva quién escribió el aprendizaje: viene
 * intacta de `entradaDeMemoria`, que ya no tiene dónde poner un `MemberId` (ADR-0040).
 *
 * ═══ Por qué el cuerpo de la petición no se valida importando `@koinonia/contracts/aprendizajes` ═══
 *
 * `packages/contracts/src/aprendizajes.ts` (mismo incremento, propiedad del mismo agente) es el
 * contrato público de esta ruta y define exactamente el mismo esquema — pero `index.ts` del
 * paquete todavía no lo re-exporta (lo hace el integrador en una fase posterior, igual que
 * `evaluacion.ts` hasta hace poco, ver la cabecera histórica de `rutas-evaluacion.ts`). Importar
 * hoy un nombre que el barril no exporta rompe el build. Así que, mientras tanto, este fichero
 * valida con una copia local del mismo esquema — no una versión distinta, la misma, calcada a
 * mano — y dejará de necesitarla el día que `index.ts` incorpore `aprendizajes.ts`.
 */

import { LEARNING_KINDS, EVALUATION_OUTCOMES } from '@koinonia/domain';
import { normalizeForGlossary } from '@koinonia/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Cuerpo de la petición — copia local de `@koinonia/contracts/aprendizajes.ts`, ver la cabecera
// ═════════════════════════════════════════════════════════════════════════════════════════════

const MIN_LONGITUD_TITULO_PROBLEMA = 3;
const MAX_LONGITUD_TITULO_PROBLEMA = 200;
const MAX_LONGITUD_CUERPO_PROBLEMA = 4000;
const LIMITE_RESULTADOS_POR_DEFECTO = 20;
const LIMITE_RESULTADOS_MAXIMO = 50;

const OPAQUE_ID = z.string().regex(/^[0-9a-f]{32}$/u);
const ETIQUETA = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/u);

const consultaBusquedaDeAprendizajes = z.object({
  titulo: z.string().min(MIN_LONGITUD_TITULO_PROBLEMA).max(MAX_LONGITUD_TITULO_PROBLEMA),
  cuerpo: z.string().max(MAX_LONGITUD_CUERPO_PROBLEMA).optional(),
  limite: z.coerce.number().int().positive().max(LIMITE_RESULTADOS_MAXIMO).optional(),
  etiqueta: ETIQUETA.optional(),
  tipo: z.enum(LEARNING_KINDS).optional(),
  desenlace: z.enum(EVALUATION_OUTCOMES).optional(),
  circuloId: OPAQUE_ID.optional(),
  decisionId: OPAQUE_ID.optional(),
});
type ConsultaBusquedaDeAprendizajes = z.infer<typeof consultaBusquedaDeAprendizajes>;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Lo que esta ruta necesita del ámbito de `buildApp`, y nada más
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface ContextoAprendizajes {
  /**
   * Techo y valor por defecto de `limite`, separados del contrato a propósito: un despliegue
   * puede apretar el tope (la búsqueda recorre TODA la memoria institucional antes de puntuar,
   * el mismo costo N+1 que `rutas-evaluacion.ts` ya declara como deuda aceptada) sin tocar código.
   * Ausente ⇒ los valores de `@koinonia/contracts`.
   */
  readonly limites?: {
    readonly porDefecto: number;
    readonly maximo: number;
  };
}

function parse<T>(schema: { parse: (value: unknown) => T }, value: unknown): T {
  return schema.parse(value);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// El parecido: léxico y auditable — ver la cabecera del fichero
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Palabras function del castellano. Lista corta y a propósito: esto no es un motor de búsqueda, es
 * coincidencia de palabras, y una lista larga sólo disfrazaría lo simple que es. No pretende ser
 * exhaustiva; lo que se le escapa simplemente no puntúa ni a favor ni en contra.
 */
const PALABRAS_VACIAS: ReadonlySet<string> = new Set([
  'de',
  'la',
  'el',
  'en',
  'y',
  'a',
  'que',
  'un',
  'una',
  'los',
  'las',
  'se',
  'no',
  'por',
  'con',
  'para',
  'su',
  'al',
  'lo',
  'como',
  'pero',
  'sus',
  'le',
  'este',
  'esta',
  'entre',
  'cuando',
  'sin',
  'sobre',
  'tambien',
  'hasta',
  'hay',
  'donde',
  'desde',
  'todo',
  'todos',
  'toda',
  'todas',
  'uno',
  'les',
  'ni',
  'contra',
  'otros',
  'otras',
  'ese',
  'esa',
  'esos',
  'esas',
  'eso',
  'esto',
  'estos',
  'estas',
  'mi',
  'mis',
  'tu',
  'tus',
  'antes',
  'algunos',
  'algunas',
  'unos',
  'unas',
  'yo',
  'otro',
  'otra',
  'tanto',
  'mucho',
  'muchos',
  'muchas',
  'cual',
  'cuales',
  'poco',
  'pocos',
  'pocas',
  'ella',
  'ellas',
  'ellos',
  'algo',
  'nosotros',
  'nosotras',
  'muy',
  'mas',
  'ya',
  'si',
  'porque',
  'es',
  'son',
  'fue',
  'ser',
  'estar',
  'han',
  'ha',
  'hemos',
  'fueron',
  'sea',
  'sido',
  'del',
  'nada',
  'quien',
  'quienes',
  'cada',
  'ante',
  'bajo',
  'durante',
  'nos',
  'me',
  'te',
]);

/**
 * El vocabulario significativo de un texto: minúscula, sin tildes, sin puntuación, sin palabras
 * function y sin tokens de menos de tres letras (demasiado genéricos para decir nada por sí
 * solos). Exportada para que la prueba unitaria la ejerza sin levantar Postgres.
 */
export function palabrasSignificativas(texto: string): ReadonlySet<string> {
  const normalizado = normalizeForGlossary(texto);
  const crudas = normalizado.split(/[^\p{L}\p{N}]+/u);
  const significativas = crudas.filter(
    (palabra) => palabra.length >= 3 && !PALABRAS_VACIAS.has(palabra),
  );
  return new Set(significativas);
}

export interface Parecido {
  readonly similitud: number;
  readonly palabrasCoincidentes: readonly string[];
}

/**
 * `similitud` = cuánto del vocabulario del problema nuevo aparece en este aprendizaje, en `[0, 1]`.
 * Deliberadamente asimétrico (no Jaccard): a quien pregunta le importa «¿esto habla de lo que le
 * pasa a mí?», no cuánto del aprendizaje —que puede ser mucho más largo que la pregunta— sobra.
 */
export function compararParecido(
  palabrasProblema: ReadonlySet<string>,
  textoAprendizaje: string,
): Parecido {
  if (palabrasProblema.size === 0) return { similitud: 0, palabrasCoincidentes: [] };
  const palabrasAprendizaje = palabrasSignificativas(textoAprendizaje);
  const palabrasCoincidentes = [...palabrasProblema]
    .filter((palabra) => palabrasAprendizaje.has(palabra))
    .sort();
  return {
    similitud: palabrasCoincidentes.length / palabrasProblema.size,
    palabrasCoincidentes,
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// La memoria ya filtrada, traída por dentro desde `GET /aprendizajes` — ver la cabecera del fichero
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** Exactamente la forma de `entradaDeMemoria` (`@koinonia/contracts/evaluacion.ts`). */
interface EntradaDeMemoriaCruda {
  readonly evaluacionId: string;
  readonly iniciativaId: string;
  readonly decisionId: string;
  readonly propuestaId: string;
  readonly circuloId: string;
  readonly desenlace: string;
  readonly disposicion?: string;
  readonly aprendizaje: {
    readonly id: string;
    readonly tipo: string;
    readonly enunciado: string;
    readonly etiquetas: readonly string[];
    readonly en: number;
  };
}

async function memoriaFiltrada(
  app: FastifyInstance,
  query: ConsultaBusquedaDeAprendizajes,
): Promise<readonly EntradaDeMemoriaCruda[]> {
  const parametros = new URLSearchParams();
  if (query.etiqueta !== undefined) parametros.set('etiqueta', query.etiqueta);
  if (query.tipo !== undefined) parametros.set('tipo', query.tipo);
  if (query.desenlace !== undefined) parametros.set('desenlace', query.desenlace);
  if (query.circuloId !== undefined) parametros.set('circuloId', query.circuloId);
  if (query.decisionId !== undefined) parametros.set('decisionId', query.decisionId);
  const cadena = parametros.toString();
  const respuesta = await app.inject({
    method: 'GET',
    url: cadena === '' ? '/aprendizajes' : `/aprendizajes?${cadena}`,
  });
  if (respuesta.statusCode === 404) {
    // No es «no hay memoria todavía»: es que esta instancia de Fastify no tiene registrada
    // `registrarRutasDeEvaluacion`. Fallar con un mensaje claro es mejor que devolver `[]` y que
    // parezca que el colectivo nunca aprendió nada.
    throw new Error(
      'GET /aprendizajes/parecidos depende de que registrarRutasDeEvaluacion esté registrada en ' +
        'la misma instancia de Fastify (ver la cabecera de rutas-aprendizajes.ts); esta petición ' +
        'de dentro hacia GET /aprendizajes devolvió 404.',
    );
  }
  if (respuesta.statusCode !== 200) {
    throw new Error(
      `GET /aprendizajes devolvió ${String(respuesta.statusCode)}: ${respuesta.body}`,
    );
  }
  return respuesta.json<readonly EntradaDeMemoriaCruda[]>();
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// La ruta
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Registra las rutas de este incremento sobre un `FastifyInstance` ya existente.
 *
 * `registrarRutasDeAprendizajes(app: FastifyInstance, ctx: ContextoAprendizajes): void`
 *
 * Requiere que `registrarRutasDeEvaluacion` esté (o vaya a estar, antes de la primera petición)
 * registrada en la misma instancia — ver «Por qué esta ruta no vuelve a leer el ledger» arriba.
 */
export function registrarRutasDeAprendizajes(
  app: FastifyInstance,
  ctx: ContextoAprendizajes,
): void {
  app.get('/aprendizajes/parecidos', async (request: FastifyRequest) => {
    const query = parse(consultaBusquedaDeAprendizajes, request.query);
    const candidatas = await memoriaFiltrada(app, query);

    const palabrasProblema = palabrasSignificativas(`${query.titulo} ${query.cuerpo ?? ''}`);
    const puntuadas = candidatas
      .map((entrada) => {
        const textoAprendizaje = `${entrada.aprendizaje.enunciado} ${entrada.aprendizaje.etiquetas.join(' ')}`;
        return { entrada, ...compararParecido(palabrasProblema, textoAprendizaje) };
      })
      // Un aprendizaje que no comparte ni una palabra con el problema nuevo no es un parecido: no
      // se lista con un puntaje de cero para no fingir una relación que no hay.
      .filter((puntuada) => puntuada.similitud > 0);

    // `Array.prototype.sort` es estable (ES2019): a igualdad de `similitud` se conserva el orden
    // que ya traía `GET /aprendizajes` — instante descendente y, a igualdad de instante, por
    // identificador (`findLearnings`, `packages/domain/src/evaluation/types.ts`).
    puntuadas.sort((a, b) => b.similitud - a.similitud);

    const porDefecto = ctx.limites?.porDefecto ?? LIMITE_RESULTADOS_POR_DEFECTO;
    const maximo = ctx.limites?.maximo ?? LIMITE_RESULTADOS_MAXIMO;
    const limite = Math.min(query.limite ?? porDefecto, maximo);

    return puntuadas.slice(0, limite).map(({ entrada, similitud, palabrasCoincidentes }) => ({
      ...entrada,
      similitud,
      palabrasCoincidentes,
    }));
  });
}
