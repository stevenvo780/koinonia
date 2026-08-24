/**
 * Dos topes más contra la captura por el grupo mejor organizado (T-19, `docs/THREAT_MODEL.md`),
 * hermanos de los de `window-guard.ts`: el tope de objeciones por actor y proceso, y el umbral de
 * postulación que decide si un sorteo tiene de dónde sortear.
 *
 * ═══ Por qué son funciones sueltas y no un cambio en `engine.ts` / `tally/sortition.ts` ═══
 *
 * Las dos reglas que T-19 promete son, en su núcleo, comparaciones puras: «¿cuántas objeciones
 * lleva ya este actor en este proceso, y trae respaldo la que sigue?» y «¿hay al menos tres
 * postulantes por plaza?». Ese núcleo es lo que este fichero fija y prueba. **Aplicarlas** —contar
 * las objeciones previas de un actor recorriendo `DecisionState.objections`, y decidir si
 * `stratifiedSortition` se ejecuta o la convocatoria se reabre— es trabajo de quien ya sostiene esos
 * dos ficheros existentes, y no de este encargo (T-25/T-19): mover esa integración a `engine.ts` o
 * a `tally/sortition.ts` sin coordinarlo es exactamente el riesgo que el reparto del trabajo de esta
 * ronda busca evitar. El informe de la tarea deja anotado dónde engancha cada una.
 */

/** El tope de objeciones libres, antes de necesitar respaldo (T-19). */
export const TOPE_OBJECIONES_LIBRES_POR_ACTOR = 2;

/**
 * ¿Puede este actor levantar una objeción más en este proceso?
 *
 * Las dos primeras (`objecionesPreviasDelActor < 2`) son libres — preservan ADR-0032 tal cual. De
 * la tercera en adelante hace falta el respaldo explícito de otro miembro: le quita el filo de arma
 * de desgaste sin quitarle a nadie el derecho a objetar cuando de verdad hay con quién compartirlo.
 */
export function objecionAdmisiblePorTope(
  objecionesPreviasDelActor: number,
  tieneRespaldo: boolean,
): boolean {
  if (!Number.isInteger(objecionesPreviasDelActor) || objecionesPreviasDelActor < 0) {
    throw new RangeError('objecionesPreviasDelActor debe ser un entero no negativo');
  }
  if (objecionesPreviasDelActor < TOPE_OBJECIONES_LIBRES_POR_ACTOR) return true;
  return tieneRespaldo;
}

/** Cuántas veces tienen que superar los postulantes a las plazas para que el sorteo se ejecute. */
export const FACTOR_MINIMO_DE_POSTULACION = 3;

/**
 * ¿Hay de dónde sortear?
 *
 * El sorteo estratificado (ADR-0031) sólo resiste si la postulación es amplia: si el grupo mejor
 * organizado es el único que se postula en masa, «aleatorio» reparte igual entre sus miembros y
 * produce un cuerpo capturado con apariencia de imparcialidad. Con menos de `3×` postulantes que
 * plazas, el sorteo no se ejecuta y la convocatoria se reabre.
 */
export function cumpleUmbralDePostulacion(postulantes: number, plazas: number): boolean {
  if (!Number.isInteger(postulantes) || postulantes < 0) {
    throw new RangeError('postulantes debe ser un entero no negativo');
  }
  if (!Number.isInteger(plazas) || plazas <= 0) {
    throw new RangeError('plazas debe ser un entero positivo');
  }
  return postulantes >= FACTOR_MINIMO_DE_POSTULACION * plazas;
}
