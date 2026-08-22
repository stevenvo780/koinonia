/**
 * `@koinonia/metrics` — las cinco métricas de salud democrática.
 *
 * `03-deliberativa-sistemas-antipatrones.md` §6 define cinco y ninguna medía «engagement». Aquí
 * están las cinco, y siguen sin medirlo:
 *
 *  1. **Cumplimiento de acuerdos** y su stock complementario, la **deuda** (`acuerdos.ts`).
 *  2. **Reparto de la voz** sobre autoría (`concentracion.ts`).
 *  3. **Cobertura del padrón desagregada por estrato** (`cobertura.ts`).
 *  4. **Rotación del núcleo activo** (`rotacion.ts`).
 *  5. **Razón deliberación/votación** con la tasa de unanimidad (`deliberacion.ts`).
 *
 * *«Las plataformas participativas mueren sanas de engagement y muertas de consecuencia.»*
 *
 * # Este paquete no puede nombrar a nadie (ADR-0040)
 *
 * El ADR-0040 prohíbe el artefacto, no el mal uso: «no existe endpoint que ordene miembros por
 * cumplimiento». Se sostiene con tres capas descritas en `types.ts`, y hay que romper las tres para
 * colar una lista de personas: el tipo de retorno de toda función pública es `Agregado<…>`, que
 * vale `never` si el tipo puede transportar una identidad; `sellar()` recorre cada salida real
 * buscando los identificadores que venían en la entrada —también dentro de claves y de frases— y
 * revienta si encuentra alguno; y donde la métrica no necesita saber quién es quién, la persona
 * directamente **no está en el tipo de entrada**.
 *
 * No hay aquí ninguna función que ordene personas por actividad, y no por disciplina: no se puede
 * escribir. `test/adr-0040.test.ts` llama al compilador de TypeScript para demostrarlo, en vez de
 * confiar en que la revisión de código lo note.
 *
 * # Este paquete no lee la base de datos
 *
 * La entrada son **datos ya proyectados**: conteos, instantes y etiquetas. Sin dependencias de
 * tiempo de ejecución fuera del propio monorepo, sin módulos de Node, sin red. El único vecino del
 * que depende es `@koinonia/domain`, y sólo por su aritmética exacta de fracciones y por
 * `herfindahl` / `normalizedHerfindahl` / `concentrationRatio`, que ya existen ahí, están probadas
 * contra INV-31 y no tenía ningún sentido reescribir: dos implementaciones de la misma fórmula son
 * dos números que un día no coinciden.
 *
 * # El tiempo entra como dato
 *
 * No hay un `Date.now()` ni un `Math.random()` en todo el paquete (ADR-0004). Las ventanas y el
 * instante del informe llegan en la entrada. El mismo informe calculado dos veces sobre los mismos
 * datos es, byte a byte, el mismo informe; y en otra máquina, con otra locale, también —de ahí que
 * no se use `localeCompare` en ninguna ordenación.
 *
 * # Frontera con el punto flotante (ADR-0027)
 *
 * **En este paquete no hay ningún cálculo en coma flotante.** Toda proporción, razón y umbral se
 * expresa como `Fraction` exacta con `bigint`, y toda comparación de umbral —el 0,5 del
 * cumplimiento, el 3/20 del reparto de la voz— se hace con `cmpFraction`. La razón es que dos de
 * las cinco métricas alimentan **alarmas con consecuencia**: encienden un aviso que una asamblea
 * puede acabar usando para convocar una revisión. Un umbral con consecuencia comparado en coma
 * flotante es un umbral que un día se cumple exactamente y se declara incumplido.
 *
 * Los únicos números en coma flotante que salen de aquí son conteos enteros —cuántas personas,
 * cuántos acuerdos— y el corte del núcleo, que también es un entero.
 *
 * Y en la otra dirección, la que importa de verdad:
 *
 * > **Ninguna salida de este paquete puede alimentar un conteo de votos ni una regla de decisión.**
 *
 * Estas cinco cifras son un diagnóstico para que 300 personas miren cómo está lo común. No
 * determinan quién gana una votación, ni el peso de nadie, ni la validez de nada. En concreto,
 * quien las consuma **no debe**: ponderar votos con ellas, condicionar la apertura o el cierre de
 * una decisión a su valor, ni derivar de ellas ninguna sanción. Que estén en fracciones exactas
 * hace la cifra reproducible; **no** la convierte en una norma. La alarma del reparto de la voz, en
 * particular, marca —no invalida—, igual que la de C.6.a en el dominio.
 *
 * # Sin jerga en pantalla (ADR-0041)
 *
 * Los textos visibles están en `textos.ts`, separados del cálculo, en castellano llano y sin una
 * sola palabra de la maquinaria. El rótulo de la segunda métrica es literalmente el que fija la
 * tabla normativa del ADR-0041: «qué tan repartida está la voz».
 */

import { informeDeAcuerdos } from './acuerdos.js';
import { informeDeCobertura } from './cobertura.js';
import { informeDeVoz } from './concentracion.js';
import { informeDeDeliberacion } from './deliberacion.js';
import { informeDeRotacion } from './rotacion.js';
import type { Agregado, EntradaSalud, InformeSalud } from './types.js';

export { CUMPLIMIENTO_MINIMO, informeDeAcuerdos } from './acuerdos.js';
export { informeDeCobertura, validarEstratos } from './cobertura.js';
export { informeDeVoz, REPARTO_EN_ALARMA } from './concentracion.js';
export { informeDeDeliberacion } from './deliberacion.js';
export { informeDeRotacion } from './rotacion.js';
export { comoPorcentaje, comoRazon, medidaEnPorcentaje, TEXTOS } from './textos.js';

/**
 * Los errores se exportan como VALOR, no sólo como tipo: quien quiera distinguir una fuga de
 * identidad de un fallo cualquiera necesita hacer `instanceof`, y un `export type` se borra al
 * emitir. Es la misma errata que `@koinonia/consensus` ya pagó una vez.
 */
export {
  EjeProhibidoError,
  EntradaInvalidaError,
  FugaDeIdentidadError,
  MetricaError,
} from './types.js';

export {
  agruparPorEtiqueta,
  compararEtiquetas,
  dentroDe,
  EJES_ESTRATO,
  identidadMiembro,
  K_MAXIMO_INDIVIDUAL,
  K_NO_SE_PUBLICA,
  K_SE_ADVIERTE,
  medida,
  NO_SE_PUBLICA,
  publicarSiHayGente,
  sellar,
  SIN_DATOS,
  validarVentana,
  VENTANA_DE_30_DIAS_MS,
} from './types.js';

export type {
  AcuerdoProyectado,
  Agregado,
  Aporte,
  ActoSignificativo,
  CambioDelNucleo,
  CeldaDeCruce,
  CeldaDeEje,
  CoberturaDeGrupo,
  ContieneIdentidad,
  CuentaDeAcuerdos,
  CumplimientoDeCirculo,
  CumplimientoDeTipo,
  DeliberacionProyectada,
  Desglose,
  EjeEstrato,
  EntradaAcuerdos,
  EntradaCobertura,
  EntradaDeliberacion,
  EntradaRotacion,
  EntradaSalud,
  EntradaVoz,
  Estratos,
  IdentidadMiembro,
  InformeAcuerdos,
  InformeCobertura,
  InformeDeliberacion,
  InformeRotacion,
  InformeSalud,
  InformeVoz,
  Instante,
  Medida,
  MiembroDelPadron,
  MotivoNoPublicado,
  RepartoDeVoz,
  TamanoDeCirculo,
  Ventana,
  VotacionProyectada,
} from './types.js';

/**
 * El panel completo: las cinco métricas sobre la misma proyección.
 *
 * Es una comodidad, no una capa: cada métrica se puede pedir por separado, y ninguna depende del
 * resultado de otra. Que sean cinco números independientes es parte del diseño —§6 pide mirarlas
 * juntas precisamente porque cada una tapa el punto ciego de las demás: la rotación es lo que
 * delata a una asamblea capturada cuando el resto está en verde.
 */
export function informeDeSalud(entrada: EntradaSalud): Agregado<InformeSalud> {
  return {
    acuerdos: informeDeAcuerdos(entrada.acuerdos),
    voz: informeDeVoz(entrada.voz),
    cobertura: informeDeCobertura(entrada.cobertura),
    rotacion: informeDeRotacion(entrada.rotacion),
    deliberacion: informeDeDeliberacion(entrada.deliberacion),
  };
}
