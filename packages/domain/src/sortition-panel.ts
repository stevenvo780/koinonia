/**
 * Sorteo del panel que desestima una objeción (B.3.a, ADR-0031, ADR-0032).
 *
 * ═══ El hueco que esto cierra ═══
 *
 * `packages/domain/src/engine.ts`, caso `ObjectionDismissed`, ya exige un panel del tamaño exacto
 * que excluye a quien objeta y que se pronuncia por dos tercios (B.3.a). Lo que **no** existía era
 * cómo se saca ese panel: `panelSelection: 'sortition'` (`config.ts`) era sólo una etiqueta, y quien
 * llamara a `ObjectionDismissed` tenía que inventarse la lista de miembros a mano. Un panel que
 * cualquiera arma a mano no es un sorteo: es una elección disfrazada, y quien decide quién dictamina
 * termina decidiendo el veredicto.
 *
 * ═══ Por qué es EXACTAMENTE el patrón de `tally/sortition.ts` (ADR-0031) ═══
 *
 * El sorteo deliberativo ya resuelve el mismo problema —«de una lista de personas, sacar un
 * subconjunto de forma verificable»— con ticket HMAC: `t = hmac(semilla, "etiqueta|memberId")`, se
 * ordena por ticket y se toman los primeros `n`. Es **reproducible** (misma semilla, mismo orden,
 * mismo panel: cualquiera lo recalcula) y **verificable individualmente** (cada persona calcula su
 * propio ticket sin reimplementar el sorteo ni confiar en el orden interno de esta función). Inventar
 * un segundo mecanismo de sorteo —Fisher-Yates sembrado, por ejemplo— para el panel de objeciones
 * introduciría una segunda superficie de auditoría sin ganar nada; `hmacOrder` de `tally/common.ts`
 * ya es esa pieza y este módulo la reusa tal cual, sin reimplementarla.
 *
 * ═══ Qué excluye y qué no (todavía) ═══
 *
 * ADR-0032 pide excluir del sorteo a quien objeta, a quien propuso y a quien tenga vínculo declarado
 * con ambos, además de admitir una recusación sin motivar. El motor (`engine.ts:480-514`) sólo
 * comprueba la primera exclusión —`payload.panel.includes(record.by)`—: no existe todavía un campo
 * «quién propuso» en `DecisionConfig` ni un registro de vínculos declarados ni de recusaciones. Este
 * sorteo excluye lo único que el dominio sabe modelar hoy: a quien objeta. Las otras dos exclusiones
 * y la recusación quedan pendientes de que exista el dato que las sostenga; no se simulan aquí con
 * una lista inventada, porque un campo fantasma sería peor que no tenerlo.
 *
 * ═══ De qué círculo sale el panel ═══
 *
 * B.3 mide el consentimiento «contra el círculo» (ver `tally/consent.ts:consentEngagement`); el
 * panel que arbitra una objeción de ese círculo sale del mismo conjunto, no del censo entero de la
 * decisión. Sortear del censo completo pondría a arbitrar una disputa de *Estética* a alguien que
 * nunca pisó ese círculo.
 *
 * ═══ De dónde sale `seed` (nota para quien llame, no para esta función) ═══
 *
 * Esta función es agnóstica de dónde salió la semilla: recibe una cadena y sortea, punto —así es
 * como el dominio se mantiene sin aleatoriedad propia. Pero vale dejar registrado un hueco que
 * encontré al cablear la ruta HTTP (`services/api/src/http/rutas-objeciones.ts`), para quien la
 * lea con la especificación en la otra mano: ADR-0024 dice que «el mismo mecanismo [`SeedRevealed`,
 * B.0.3] sirve para... el panel de admisibilidad de objeciones», pero
 * `packages/domain/src/state-machine.ts` sólo admite `SeedRevealed` desde `Closed`, mientras que
 * `ObjectionRaised`/`ObjectionDismissed` sólo se admiten desde `Open` — dos ventanas que nunca se
 * tocan. Con la letra estricta de B.0.3, esta función jamás recibiría una semilla válida mientras
 * la objeción todavía se puede desestimar: el mismo «construido e inalcanzable» que este encargo
 * vino a cerrar, reaparecido un evento más adelante. La ruta HTTP documenta y reporta cómo lo
 * resuelve mientras esa tensión de la máquina de estados no se resuelva (no toca `state-machine.ts`,
 * que no es de mi propiedad de escritura en este encargo).
 */

import { PreconditionError } from './errors.js';
import type { Electorate } from './electorate.js';
import { compareIds, type CircleId, type MemberId, type ObjectionId } from './ids.js';
import { hmacOrder } from './tally/common.js';

/** Lo que devuelve el sorteo: el panel y el ticket de cada persona del panel, para auditar. */
export interface ObjectionPanelSortition {
  /** Ordenado por `MemberId`, no por ticket: el orden de publicación no debe filtrar el ranking. */
  readonly panel: readonly MemberId[];
  /** Ticket HMAC de cada seleccionado. Cualquiera del círculo recalcula el suyo y lo compara. */
  readonly tickets: ReadonlyMap<MemberId, string>;
  /** Tamaño de la bolsa de la que se sorteó (círculo menos quien objeta). Para la traza. */
  readonly poolSize: number;
}

export interface SortObjectionPanelInput {
  readonly electorate: Electorate;
  /** Círculo competente de la decisión (B.3): el panel sale de ahí, no del censo entero. */
  readonly circleId: CircleId;
  /** Identifica la objeción, para que dos objeciones con la misma semilla no compartan etiqueta. */
  readonly objectionId: ObjectionId;
  /** Quien objeta. Se excluye de la bolsa (B.3.a): «el panel se sortea excluyendo a quien objeta». */
  readonly objector: MemberId;
  /** Tamaño exacto del panel (`config.method.admissibility.panelSize`, impar, default 3). */
  readonly panelSize: number;
  /**
   * Semilla pública con la que se sortea. Esta función no exige ni comprueba de dónde salió —eso
   * es decisión de quien llama—; sólo tiene que ser pública y reproducible para que el sorteo sea
   * verificable. Ver la nota de cabecera sobre la tensión con `SeedRevealed`/B.0.3.
   */
  readonly seed: string;
}

/**
 * Sortea el panel que va a pronunciarse sobre una objeción.
 *
 * Determinista en `(electorate, circleId, objectionId, objector, panelSize, seed)`: la misma semilla
 * produce el mismo panel siempre, porque si no fuera así nadie podría comprobar que el sorteo salió
 * limpio con sólo el padrón publicado y la semilla revelada.
 */
export async function sortObjectionPanel(
  input: SortObjectionPanelInput,
): Promise<ObjectionPanelSortition> {
  const { electorate, circleId, objectionId, objector, panelSize, seed } = input;
  if (!Number.isSafeInteger(panelSize) || panelSize < 1) {
    throw new PreconditionError(
      'OBJECTION_PANEL_SIZE_INVALID',
      `el tamaño del panel debe ser un entero ≥ 1 y es ${String(panelSize)}`,
    );
  }
  // La bolsa: miembros del círculo competente, excluyendo a quien objeta (B.3.a). Se ordena por
  // `MemberId` antes de sortear para que el orden de entrada al sorteo no dependa del orden del
  // padrón tal como llegó a esta función (INV-16/INV-17, el mismo principio que `tally/sortition.ts`).
  const pool = electorate.members
    .filter((member) => member.circles.includes(circleId) && member.memberId !== objector)
    .map((member) => member.memberId)
    .sort(compareIds);
  if (pool.length < panelSize) {
    throw new PreconditionError(
      'OBJECTION_PANEL_POOL_TOO_SMALL',
      `el círculo tiene ${String(pool.length)} miembros elegibles para el panel (excluyendo a ` +
        `quien objeta) y el panel exige ${String(panelSize)}`,
    );
  }
  // Misma pieza que el sorteo estratificado (ADR-0031): ticket HMAC por persona, orden por ticket,
  // los primeros `panelSize` entran. La etiqueta incluye la objeción y quien objeta para que dos
  // objeciones distintas de la misma persona, con la misma semilla, no compartan panel por azar.
  const ordered = await hmacOrder(seed, `panel-objecion|${objectionId}|${objector}`, pool);
  const chosen = ordered.slice(0, panelSize);
  return {
    panel: chosen.map((entry) => entry.value).sort(compareIds),
    tickets: new Map(chosen.map((entry) => [entry.value, entry.ticket])),
    poolSize: pool.length,
  };
}
