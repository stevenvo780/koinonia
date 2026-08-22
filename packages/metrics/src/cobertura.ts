/**
 * Métrica 3 — **cobertura del padrón, desagregada por estrato**.
 *
 * §6: proporción del padrón con al menos un acto significativo en la ventana, por semestre ×
 * jornada. «El agregado engaña, el desagregado delata: 40 % global con la nocturna en 8 % es una
 * plataforma diurna que se cree de todos.»
 *
 * # Los ejes son cuatro, y el género no es uno
 *
 * C11: semestre, jornada, nivel y participación previa, todos derivables de la matrícula. El género
 * **no** es eje: es dato sensible del art. 5 de la Ley 1581, y ligarlo de forma estable a un
 * identificador dentro de un registro publicable expone a sanción de cierre definitivo. La
 * prohibición no se deja en el tipo, porque las proyecciones se arman en tiempo de ejecución y un
 * objeto con una clave de más atraviesa cualquier interfaz sin despeinarse: `validarEstratos()`
 * rechaza toda clave que no esté en `EJES_ESTRATO`, y `genero` con un mensaje propio.
 *
 * # Un desagregado sin k-anonimato es una lista de nombres con pasos intermedios
 *
 * Éste es el punto donde el encargo del ADR-0040 y el de §6 se rozan: §6 pide desagregar y el
 * ADR-0040 prohíbe exponer a nadie. Con 300 personas y estratos pequeños, «de los 4 de décimo
 * nocturno participó 1» es una métrica individual escrita en plural. Se resuelve con el criterio
 * que el proyecto ya usa (RA-10): por debajo de 10 personas la celda **no se publica**, y entre 10
 * y 29 se publica con advertencia. La celda retenida se declara retenida; no se disimula como si no
 * existiera, porque un hueco silencioso se interpreta siempre como el peor número posible.
 *
 * El **cruce** se limita a `semestre × jornada`, que es el que §6 pide y el máximo que C11 admite
 * cruzar. Cruzar tres ejes con 300 personas produce celdas de dos, y una celda de dos no es un
 * estrato: son dos personas.
 */

import { cmpFraction, fraction, normalize, ratio, type Fraction } from '@koinonia/domain';

import {
  compararEtiquetas,
  dentroDe,
  EjeProhibidoError,
  EntradaInvalidaError,
  EJES_ESTRATO,
  medida,
  publicarSiHayGente,
  sellar,
  SIN_DATOS,
  validarVentana,
  type Agregado,
  type CeldaDeCruce,
  type CeldaDeEje,
  type CoberturaDeGrupo,
  type Desglose,
  type EntradaCobertura,
  type Estratos,
  type InformeCobertura,
  type MiembroDelPadron,
} from './types.js';

const EJES_VALIDOS: ReadonlySet<string> = new Set<string>(EJES_ESTRATO);

/**
 * Rechaza cualquier eje que no sea de C11. El caso que importa es `genero`.
 *
 * Se comprueba clave por clave sobre el objeto recibido, y no sólo contra el tipo: un
 * `Object.fromEntries` de una consulta a la base cumple `Estratos` estructuralmente aunque traiga
 * tres claves de más, y una de esas tres puede ser exactamente la que la ley prohíbe.
 */
export function validarEstratos(estratos: Estratos): void {
  const bruto: Record<string, unknown> = estratos;
  for (const [clave, valor] of Object.entries(bruto)) {
    if (!EJES_VALIDOS.has(clave)) throw new EjeProhibidoError(clave);
    if (typeof valor !== 'string' || valor.length === 0) {
      throw new EntradaInvalidaError(`el eje «${clave}» debe ser una etiqueta no vacía`);
    }
  }
  for (const eje of EJES_ESTRATO) {
    if (!(eje in bruto)) throw new EntradaInvalidaError(`falta el eje «${eje}» en el estrato`);
  }
}

/** `a − b`, exacta y no negativa. El llamante garantiza `a ≥ b`. */
function restar(a: Fraction, b: Fraction): Fraction {
  return normalize(fraction(a.num * b.den - b.num * a.den, a.den * b.den));
}

function coberturaDe(
  miembros: readonly MiembroDelPadron[],
  activos: ReadonlySet<string>,
): CoberturaDeGrupo {
  let conAlMenosUnActo = 0;
  for (const { miembro } of miembros) {
    if (activos.has(miembro)) conAlMenosUnActo += 1;
  }
  return { conAlMenosUnActo, cobertura: ratio(conAlMenosUnActo, miembros.length) };
}

function agruparPadron(
  padron: readonly MiembroDelPadron[],
  clave: (m: MiembroDelPadron) => string,
): readonly (readonly [string, readonly MiembroDelPadron[]])[] {
  const grupos = new Map<string, MiembroDelPadron[]>();
  for (const miembro of padron) {
    const k = clave(miembro);
    const actual = grupos.get(k);
    if (actual === undefined) grupos.set(k, [miembro]);
    else actual.push(miembro);
  }
  return [...grupos.entries()].sort((a, b) => compararEtiquetas(a[0], b[0]));
}

/**
 * La brecha: mayor distancia entre dos celdas **del mismo eje**.
 *
 * No se compara una celda de semestre con una de jornada: serían dos particiones distintas del
 * mismo padrón y la diferencia no diría nada. La cifra que interesa es la de §6 —dentro de
 * «jornada», cuánto separa a la diurna de la nocturna—, y ésa es intra-eje.
 */
function brechaMaxima(celdas: readonly CeldaDeEje[]): Fraction | null {
  let mayor: Fraction | null = null;
  for (const eje of EJES_ESTRATO) {
    const valores: Fraction[] = [];
    for (const celda of celdas) {
      if (celda.eje !== eje) continue;
      if (!celda.desglose.publicado) continue;
      valores.push(celda.desglose.valor.cobertura);
    }
    if (valores.length < 2) continue;
    let minimo = valores[0];
    let maximo = valores[0];
    if (minimo === undefined || maximo === undefined) continue;
    for (const valor of valores) {
      if (cmpFraction(valor, minimo) < 0) minimo = valor;
      if (cmpFraction(valor, maximo) > 0) maximo = valor;
    }
    const brecha = restar(maximo, minimo);
    if (mayor === null || cmpFraction(brecha, mayor) > 0) mayor = brecha;
  }
  return mayor;
}

/**
 * Cobertura del padrón en la ventana, global y por estrato.
 *
 * El retorno es `Agregado<InformeCobertura>` y pasa por `sellar()` con **todo** el padrón: si una
 * identidad se colara en una etiqueta de estrato —un estrato llamado como el identificador de
 * alguien, que es justo el tipo de accidente que nadie revisa— la llamada falla aquí.
 */
export function informeDeCobertura(entrada: EntradaCobertura): Agregado<InformeCobertura> {
  validarVentana(entrada.ventana);

  const vistos = new Set<string>();
  for (const miembro of entrada.padron) {
    if (vistos.has(miembro.miembro)) {
      throw new EntradaInvalidaError('el padrón trae a la misma persona dos veces');
    }
    vistos.add(miembro.miembro);
    validarEstratos(miembro.estratos);
  }

  const activos = new Set<string>();
  for (const acto of entrada.actos) {
    if (dentroDe(entrada.ventana, acto.instante)) activos.add(acto.miembro);
  }

  let celdasNoPublicadas = 0;
  const contarSiRetenida = <T>(desglose: Desglose<T>): Desglose<T> => {
    if (!desglose.publicado) celdasNoPublicadas += 1;
    return desglose;
  };

  const global = contarSiRetenida(
    publicarSiHayGente(entrada.padron.length, () => coberturaDe(entrada.padron, activos)),
  );

  const porEje: CeldaDeEje[] = [];
  for (const eje of EJES_ESTRATO) {
    for (const [valor, miembros] of agruparPadron(entrada.padron, (m) => m.estratos[eje])) {
      porEje.push({
        eje,
        valor,
        desglose: contarSiRetenida(
          publicarSiHayGente(miembros.length, () => coberturaDe(miembros, activos)),
        ),
      });
    }
  }

  const cruceSemestreJornada: CeldaDeCruce[] = [];
  interface Celda {
    readonly semestre: string;
    readonly jornada: string;
    readonly miembros: MiembroDelPadron[];
  }
  const pares = new Map<string, Celda>();
  for (const miembro of entrada.padron) {
    const { semestre, jornada } = miembro.estratos;
    // El separador es un carácter que ninguna etiqueta de matrícula contiene; si algún día lo
    // contuviera, dos celdas distintas se fundirían en una y la cifra mentiría en silencio.
    if (semestre.includes('\u0000') || jornada.includes('\u0000')) {
      throw new EntradaInvalidaError('una etiqueta de estrato contiene un carácter no permitido');
    }
    const clave = `${semestre}\u0000${jornada}`;
    const actual = pares.get(clave);
    if (actual === undefined) pares.set(clave, { semestre, jornada, miembros: [miembro] });
    else actual.miembros.push(miembro);
  }
  const ordenadas = [...pares.values()].sort((a, b) => {
    const porSemestre = compararEtiquetas(a.semestre, b.semestre);
    return porSemestre !== 0 ? porSemestre : compararEtiquetas(a.jornada, b.jornada);
  });
  for (const { semestre, jornada, miembros } of ordenadas) {
    cruceSemestreJornada.push({
      semestre,
      jornada,
      desglose: contarSiRetenida(
        publicarSiHayGente(miembros.length, () => coberturaDe(miembros, activos)),
      ),
    });
  }

  const brecha = brechaMaxima(porEje);

  const informe: InformeCobertura = {
    ventana: entrada.ventana,
    padron: entrada.padron.length,
    global,
    porEje,
    cruceSemestreJornada,
    brecha: brecha === null ? SIN_DATOS : medida(brecha),
    celdasNoPublicadas,
  };

  return sellar(
    informe,
    entrada.padron.map((m) => m.miembro),
  );
}
