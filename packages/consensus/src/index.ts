/**
 * `@koinonia/consensus` — análisis de opinión tipo Pol.is.
 *
 * Toma una matriz dispersa de votos (participantes × afirmaciones) y devuelve, en forma
 * determinista, uno de estos dos desenlaces:
 *
 *  - **grupos de opinión** con la asignación de cada participante, las **afirmaciones puente**
 *    —las que concitan acuerdo transversal entre todos los grupos— y las **afirmaciones
 *    divisivas**;
 *  - o bien **`FaccionesNoDetectadas`**: no hay grupos claros que dibujar, y se publica sólo el
 *    acuerdo general. No es un fallo, es un resultado (ADR-0038, umbral de no-facción).
 *
 * Pipeline:
 *  `prepararMatriz` → `factorizarEnmascarada` → `kmeansDeterminista` → umbral de no-facción →
 *  `probabilidadesConLaplace` → `puntuarAfirmaciones` → filtro `z₁` → `afirmacionesDivisivas`.
 *
 * # Frontera con el punto flotante (ADR-0027 y ADR-0048)
 *
 * Este proyecto prohíbe el punto flotante en **umbrales de decisión**: toda comparación de
 * umbral se hace con enteros o fracciones exactas, porque en coma flotante `2/3` no existe
 * y una supermayoría que se cumplía exactamente podría rechazarse por un error de
 * representación.
 *
 * La salida de **este paquete es agenda, no veredicto**: orienta la deliberación humana pero
 * **nunca** debe alimentar una comparación de umbral ni un conteo de votos. Por eso el
 * paquete puede permitirse punto flotante en cálculos intermedios (factorización, agrupamiento,
 * GIC) sin entrar en el sistema de decisión. Quien lo cruce hacia un umbral **debe** convertirlo
 * a fracción exacta primero.
 *
 * En concreto, los consumidores de esta salida **NO deben**:
 *
 *  - comparar ningún valor aquí calculado contra un umbral para "aprobar" o "rechazar";
 *  - contar votos a partir de los grupos aquí producidos;
 *  - tratar `p̂`, `GIC`, `z₁`, los ejes de variación ni la separación entre grupos como
 *    magnitudes con valor normativo. Son insumos descriptivos.
 *
 * Los tres umbrales internos del paquete —no-facción, mejora clara del número de grupos y
 * significación `z₁`— son de esa misma naturaleza: eligen **qué se muestra**, no qué se aprueba.
 *
 * # Determinismo
 *
 * La salida es estructuralmente idéntica sobre la misma entrada. Las invariantes que lo
 * garantizan están en `matrix.ts`, `pca.ts`, `factorizacion.ts` y `kmeans.ts`; los tests de
 * propiedad viven en `test/props/determinismo.test.ts`.
 *
 * # Interfaz sin jerga (ADR-0041)
 *
 * Los textos visibles al usuario están en castellano llano y no mencionan la maquinaria del
 * cálculo. Ver `TEXTOS` más abajo.
 */

import { factorizarEnmascarada } from './factorizacion.js';
import { kmeansDeterminista, kMaximoPara, type OpcionesAgrupamiento } from './kmeans.js';
import { prepararMatriz, contarPorGrupo } from './matrix.js';
import {
  afirmacionesDivisivas,
  afirmacionesPuente,
  probabilidadesConLaplace,
  puntuarAfirmaciones,
} from './statements.js';
import type {
  AfirmacionPuntuada,
  FaccionesNoDetectadas,
  Grupo,
  MatrizVotos,
  OpcionesAnalisis,
  ResultadoAnalisis,
} from './types.js';

export type {
  AfirmacionPuntuada,
  Celda,
  FaccionesNoDetectadas,
  Grupo,
  Instantanea,
  MatrizVotos,
  OpcionesAnalisis,
  ResultadoAnalisis,
  ResultadoConsenso,
  VotoObservado,
} from './types.js';

/**
 * Los errores se exportan como VALOR, no como tipo.
 *
 * Estaban en el bloque `export type` de arriba, que el compilador borra al emitir: quien
 * importara `PcaNoConvergente` para hacer `instanceof` se encontraba con que no existe en
 * tiempo de ejecución. La promesa de «error tipado, nunca un valor aproximado» sólo sirve de
 * algo si quien llama puede distinguir ese error de cualquier otro.
 *
 * `FaccionesNoDetectadas` **no** está aquí a propósito: no es un error, es un desenlace normal, y
 * viaja como variante del resultado para que el compilador obligue a contemplarlo.
 */
export { PcaNoConvergente, SinVariacion } from './types.js';

/**
 * Umbral de no-facción (ADR-0038): «silueta máxima < ~0,25 ⇒ se publica `FaccionesNoDetectadas`».
 *
 * Por debajo de esta separación, el mejor agrupamiento posible no distingue bandos: reparte a la
 * gente por dónde cae el redondeo. Publicarlo igualmente sería **fabricar facciones**, y el mapa
 * de facciones es justamente lo que ADR-0038 advierte que la gente leerá como veredicto.
 *
 * No es un umbral de decisión de los que prohíbe ADR-0027 —no aprueba ni rechaza nada—, sino la
 * frontera entre dos maneras de contar lo mismo. El propio ADR lo escribe con una tilde de
 * aproximación («~0,25»), señal de que lo que importa es el orden de magnitud y no el dígito.
 */
export const UMBRAL_NO_FACCION = 0.25;

/**
 * Textos de la interfaz, en castellano llano, separados del cálculo (ADR-0041).
 *
 * Las claves son los nombres que verá la persona en pantalla. Los textos se exportan para
 * que la capa de presentación los pueda probar como cadenas literales, sin reescribirlos.
 */
export const TEXTOS = {
  gruposTitulo: 'Grupos de opinión',
  gruposDescripcion:
    'Las personas quedaron repartidas en grupos según cómo reaccionaron a las afirmaciones.',
  grupoNumero: (n: number): string => `Grupo ${n.toString()}`,
  afirmacionesPuenteTitulo: 'Afirmaciones en las que todos los grupos están de acuerdo',
  afirmacionesPuenteDescripcion:
    'Estas afirmaciones concitan acuerdo en todos los grupos. Pueden ser un buen punto de partida.',
  afirmacionesDivisivasTitulo: 'Afirmaciones que generan más desacuerdo entre grupos',
  afirmacionesDivisivasDescripcion:
    'Estas afirmaciones separan a los grupos: son las que más dan que hablar.',
  pEstimada: (p: number): string => `${(p * 100).toFixed(1)} %`,
  /**
   * El texto que `PRODUCT.md` §4 promete literalmente para la pantalla «Consenso» cuando no hay
   * agrupamientos. Se escribe aquí, palabra por palabra, y una prueba lo comprueba: es la única
   * forma de que la promesa del producto no se quede en el documento.
   */
  sinGruposTitulo: 'No hay grupos claros',
  sinGruposDescripcion:
    'Las respuestas no separan a las personas en bandos distinguibles. No es un fallo del ' +
    'cálculo ni una falta de participación: es un resultado, y quiere decir que en este asunto ' +
    'no hay posturas enfrentadas que dibujar.',
  acuerdoGeneralTitulo: 'En lo que coincide la gente',
  acuerdoGeneralDescripcion:
    'Aunque no haya grupos que distinguir, estas afirmaciones sí concitan acuerdo, y con ' +
    'suficientes respuestas detrás como para no ser casualidad.',
  sinAcuerdoDestacable:
    'Ninguna afirmación reunió acuerdo suficiente como para destacarla con confianza.',
} as const;

/**
 * Resultado enriquecido con textos en castellano listos para mostrar, cuando hay grupos.
 *
 * Esto es la salida "para pantalla": incluye los textos del módulo aparte y los datos
 * numéricos que la UI necesita. La capa de presentación no debería añadir jerga.
 */
export interface ResultadoConsensoPantalla {
  readonly tipo: 'GruposDetectados';
  readonly titulo: string;
  readonly descripcion: string;
  readonly grupos: ReadonlyArray<Grupo>;
  readonly asignaciones: ReadonlyArray<number>;
  readonly k: number;
  readonly kMaximo: number;
  readonly participantesConsiderados: number;
  readonly afirmacionesPuente: ReadonlyArray<AfirmacionParaPantalla>;
  readonly afirmacionesDivisivas: ReadonlyArray<AfirmacionParaPantalla>;
  readonly textos: typeof TEXTOS;
}

/** Salida para pantalla cuando no hay grupos claros. Es un resultado, no un hueco. */
export interface SinGruposPantalla {
  readonly tipo: 'FaccionesNoDetectadas';
  readonly titulo: string;
  readonly descripcion: string;
  readonly participantesConsiderados: number;
  /** Título de la lista de acuerdo general (vacío de grupos, no de contenido). */
  readonly acuerdoGeneralTitulo: string;
  readonly acuerdoGeneralDescripcion: string;
  /** Afirmaciones con acuerdo general que superaron el filtro de significación. */
  readonly acuerdoGeneral: ReadonlyArray<AfirmacionParaPantalla>;
  /** Aviso a mostrar cuando ni siquiera hay acuerdo general destacable. `''` si sí lo hay. */
  readonly aviso: string;
  readonly textos: typeof TEXTOS;
}

export type ResultadoPantalla = ResultadoConsensoPantalla | SinGruposPantalla;

export interface AfirmacionParaPantalla {
  readonly texto: string;
  readonly metrica: number;
  readonly pPorGrupo: ReadonlyArray<number>;
  readonly observaciones: number;
  /** Identificador textual del grupo con menor probabilidad (o "" si nadie observó). */
  readonly grupoMinimo: string;
}

/**
 * Ejecuta el pipeline completo y devuelve uno de los dos desenlaces normales.
 *
 * Lanza `SinVariacion` si nadie discrepa de nadie y `PcaNoConvergente` si los datos no
 * determinan un eje de variación: en ninguno de los dos casos hay nada que publicar.
 */
export function analizarConsenso(
  matriz: MatrizVotos,
  textos: ReadonlyArray<string>,
  opciones: OpcionesAnalisis = {},
): ResultadoAnalisis {
  if (textos.length !== (matriz[0]?.length ?? 0)) {
    throw new Error('textos debe tener una entrada por columna de la matriz (afirmaciones)');
  }
  // 1. Residuos enmascarados + orden canónico. No se imputa nada (ADR-0038).
  const preparada = prepararMatriz(matriz);

  // 2. Factorización enmascarada de 2 factores: la pérdida se evalúa sólo sobre lo observado, así
  //    que quien votó poco no queda arrastrado al centro del mapa por no haber votado.
  const factorizacion = factorizarEnmascarada(preparada.Y, preparada.mascara);

  // 3. Agrupamiento sobre las coordenadas, con la histéresis de ADR-0038 si hay instantánea.
  const km = kmeansDeterminista(factorizacion.coordenadas, opcionesDeAgrupamiento(opciones));

  const indicesDeEntrada = Array.from({ length: textos.length }, (_, j) => j);

  // 4. Umbral de no-facción. Se comprueba ANTES de publicar grupos porque, por debajo de él, los
  //    grupos no son un hallazgo: son el reparto que deja el redondeo.
  if (!(km.separacionMaxima >= UMBRAL_NO_FACCION)) {
    return sinFacciones(
      matriz,
      preparada.filas,
      indicesDeEntrada,
      textos,
      km.kExaminados,
      km.separacionMaxima,
    );
  }

  // 5. Conteos por grupo en el orden de la matriz ORIGINAL (usamos la permutación de filas).
  const conteos = contarPorGrupo(matriz, km.asignaciones, preparada.filas);
  // 6. Probabilidades con suavizado de Laplace.
  const stats = probabilidadesConLaplace(conteos.acuerdos, conteos.observaciones);
  // 7. Rankings.
  //
  //    `contarPorGrupo` recorre la matriz de ENTRADA columna a columna, así que la columna `c`
  //    de `stats` YA es la columna `c` de la entrada. Aquí se pasaba `preparada.columnas`, que
  //    va de canónico a original: aplicarla equivalía a permutar por segunda vez unos índices
  //    que nunca se habían permutado. Cada afirmación del ranking salía etiquetada con el
  //    índice de otra —y por tanto con el texto de otra— siempre que el orden canónico de
  //    columnas no fuera la identidad, es decir en cuanto las afirmaciones tuvieran distinto
  //    número de respuestas. El caso más común, y silencioso: los números eran correctos y
  //    estaban bien ordenados, sólo colgaban de la afirmación equivocada.
  const puntuadas = puntuarAfirmaciones(stats, indicesDeEntrada);
  const puente = afirmacionesPuente(puntuadas);
  const divisivas = afirmacionesDivisivas(stats, indicesDeEntrada);

  const grupos: Grupo[] = [];
  for (let g = 0; g < km.centroides.length; g++) {
    grupos.push({
      id: g + 1,
      tamano: conteos.tamanoGrupo[g] ?? 0,
    });
  }

  // 8. Traducir las asignaciones del orden canónico al orden de ENTRADA, y a identificadores
  //    de grupo desde 1 (ADR-0041: a las personas se les numeran los grupos desde 1).
  //    `km.asignaciones[i]` es el grupo de la i-ésima fila CANÓNICA; `preparada.filas[i]` dice
  //    de qué participante de entrada venía esa fila. Sin esta vuelta atrás el consumidor no
  //    tiene forma de saber en qué grupo quedó cada persona: el array parecía estar indexado
  //    por participante y no lo estaba.
  const asignacionesPorParticipante = new Array<number>(matriz.length).fill(0);
  for (let i = 0; i < preparada.filas.length; i++) {
    const participante = preparada.filas[i] ?? 0;
    asignacionesPorParticipante[participante] = (km.asignaciones[i] ?? 0) + 1;
  }

  return {
    tipo: 'GruposDetectados',
    grupos,
    asignaciones: asignacionesPorParticipante,
    ordenCanonicoFilas: preparada.filas,
    k: km.k,
    afirmacionesPuente: puente,
    afirmacionesPuntuadas: puntuadas,
    afirmacionesDivisivas: divisivas,
    primeraComponente: factorizacion.primerEje,
    segundaComponente: factorizacion.segundoEje,
    ordenCanonicoColumnas: preparada.columnas,
    kMaximo: kMaximoPara(matriz.length),
    participantesConsiderados: matriz.length,
    separacionMaxima: km.separacionMaxima,
    kConservadoPorHisteresis: km.kConservadoPorHisteresis,
    instantanea: { k: km.k, centros: km.centroides },
    textos,
  };
}

/** Traduce las opciones públicas a las del agrupamiento, sin inventar valores por defecto. */
function opcionesDeAgrupamiento(opciones: OpcionesAnalisis): OpcionesAgrupamiento {
  const anterior = opciones.anterior;
  if (anterior === undefined) return {};
  return { kAnterior: anterior.k, centrosAnteriores: anterior.centros };
}

/**
 * Construye el desenlace «no hay grupos claros».
 *
 * Se sigue publicando el consenso, como pide la investigación de origen: sin facciones, la
 * población entera **es** el único grupo, y el `GIC` sobre un grupo único es exactamente el
 * acuerdo general. El filtro `z₁` se aplica igual, así que la lista sigue sin admitir
 * afirmaciones que vieron cuatro personas.
 */
function sinFacciones(
  matriz: MatrizVotos,
  permutacionFilas: ReadonlyArray<number>,
  indicesDeEntrada: ReadonlyArray<number>,
  textos: ReadonlyArray<string>,
  kExaminados: ReadonlyArray<number>,
  separacionMaxima: number,
): FaccionesNoDetectadas {
  const unSoloGrupo = new Array<number>(matriz.length).fill(0);
  const conteos = contarPorGrupo(matriz, unSoloGrupo, permutacionFilas);
  const stats = probabilidadesConLaplace(conteos.acuerdos, conteos.observaciones);
  const puntuadas = puntuarAfirmaciones(stats, indicesDeEntrada);
  return {
    tipo: 'FaccionesNoDetectadas',
    separacionMaxima,
    umbral: UMBRAL_NO_FACCION,
    kExaminados,
    participantesConsiderados: matriz.length,
    afirmacionesPuente: afirmacionesPuente(puntuadas),
    afirmacionesPuntuadas: puntuadas,
    textos,
  };
}

/** Convierte el resultado crudo al formato enriquecido para pantalla. */
export function aPantalla(resultado: ResultadoAnalisis): ResultadoPantalla {
  if (resultado.tipo === 'FaccionesNoDetectadas') {
    const acuerdo = resultado.afirmacionesPuente.map((af) =>
      aAfirmacionParaPantalla(af, resultado.textos),
    );
    return {
      tipo: 'FaccionesNoDetectadas',
      titulo: TEXTOS.sinGruposTitulo,
      descripcion: TEXTOS.sinGruposDescripcion,
      participantesConsiderados: resultado.participantesConsiderados,
      acuerdoGeneralTitulo: TEXTOS.acuerdoGeneralTitulo,
      acuerdoGeneralDescripcion: TEXTOS.acuerdoGeneralDescripcion,
      acuerdoGeneral: acuerdo,
      aviso: acuerdo.length === 0 ? TEXTOS.sinAcuerdoDestacable : '',
      textos: TEXTOS,
    };
  }
  return {
    tipo: 'GruposDetectados',
    titulo: TEXTOS.gruposTitulo,
    descripcion: TEXTOS.gruposDescripcion,
    grupos: resultado.grupos,
    asignaciones: resultado.asignaciones,
    k: resultado.k,
    kMaximo: resultado.kMaximo,
    participantesConsiderados: resultado.participantesConsiderados,
    afirmacionesPuente: resultado.afirmacionesPuente.map((af) =>
      aAfirmacionParaPantalla(af, resultado.textos),
    ),
    afirmacionesDivisivas: resultado.afirmacionesDivisivas.map((af) =>
      aAfirmacionParaPantalla(af, resultado.textos),
    ),
    textos: TEXTOS,
  };
}

function aAfirmacionParaPantalla(
  af: AfirmacionPuntuada,
  textos: ReadonlyArray<string>,
): AfirmacionParaPantalla {
  return {
    texto: textos[af.indiceOriginal] ?? '',
    metrica: af.metrica,
    pPorGrupo: af.probabilidadesPorGrupo,
    observaciones: af.observaciones,
    grupoMinimo: af.grupoMinimo > 0 ? TEXTOS.grupoNumero(af.grupoMinimo) : '',
  };
}
