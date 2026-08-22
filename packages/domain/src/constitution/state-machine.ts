/**
 * Las dos máquinas de estados de la constitución: la del agregado y la de cada reforma.
 *
 * ```
 *   ── Agregado, evaluado contra el instante que entra como dato ──
 *
 *   inexistente ──ConstitutionFounded──▶ vigente ──(at ≥ expiresAt)──▶ caducada
 *                        ▲                                                │
 *                        └──────────── ConstitutionFounded ───────────────┘
 *
 *   ── Reforma ──
 *
 *   (no existe) ──ReformOpened──▶ deliberando ──ReformVoteRecorded──▶ votada ──ReformRatified──▶ ratificada
 *                                      │                               │  └──ReformRejected────▶ rechazada
 *                                      └──ReformRejected───────────────┴───────────────────────▶ rechazada
 * ```
 *
 * ═══ La caducidad es perezosa, y NO degrada nada ═══
 *
 * `vigente → caducada` **no tiene evento**. No lo tiene porque el dominio no lee relojes: si la
 * caducidad exigiera que alguien escribiera «ha caducado», la constitución seguiría vigente
 * mientras nadie se acordara, que es justo al revés de lo que un plazo significa. El estado se
 * calcula con `statusAt(state, at)` contra el instante que trae cada orden como dato, y por eso dos
 * verificadores independientes obtienen el mismo veredicto sin ponerse de acuerdo sobre la hora.
 *
 * Y lo que pasa al caducar es **nada**, deliberadamente. No se bajan umbrales, no se pasa a mayoría
 * simple, no se habilita una vía rápida. Se acepta un solo tipo de evento —la refundación— y todo lo
 * demás se rechaza. Degradar el quórum al vencer sería una puerta trasera perfecta: a una minoría
 * organizada le bastaría con dejar pasar el plazo para gobernar con la mitad de los votos que hoy
 * necesita. Un colectivo inactivo no queda gobernado por una minoría activa; queda **sin reglas**,
 * que es un hecho público y reversible por la puerta principal.
 *
 * ═══ La tabla de la reforma es un dato ═══
 *
 * Igual que `src/state-machine.ts` con la decisión: lo que no está en `REFORM_TRANSITIONS` no
 * existe. Eso permite recorrer el producto cartesiano `Estado × TipoDeEvento` en un test y exigir
 * que **toda** pareja ausente lance. Las prohibiciones que importan salen de ahí sin escribir un
 * solo `if`:
 *
 *  1. **`deliberando + ReformRatified` es ilegal.** No se ratifica lo que no se votó.
 *  2. **`deliberando + ReformApprovedByGuarantor` es ilegal.** Garantías verifica el procedimiento
 *     (§6.6); no hay procedimiento que verificar antes de la votación.
 *  3. **`ratificada` y `rechazada` son absorbentes.** Ni «des-ratificar» ni «reconsiderar»: una
 *     reforma que salió mal se corrige con otra reforma, con su deliberación y su votación.
 */

import { IllegalTransitionError, PreconditionError } from '../errors.js';
import type { Instant } from '../ids.js';
import {
  type ConstitutionEventType,
  type ConstitutionState,
  type ConstitutionStatus,
  currentVersionOf,
  type ReformStatus,
} from './types.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Estado del agregado
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Estado público de la constitución **en un instante**. La caducidad se evalúa aquí y en ningún
 * otro sitio.
 */
export function statusAt(state: ConstitutionState, at: Instant): ConstitutionStatus {
  if (!state.exists) return 'inexistente';
  const version = currentVersionOf(state);
  if (version === undefined) return 'inexistente';
  return at >= version.expiresAt ? 'caducada' : 'vigente';
}

/** El instante en que caduca la versión vigente, o `undefined` si no hay constitución. */
export function expiresAt(state: ConstitutionState): Instant | undefined {
  return currentVersionOf(state)?.expiresAt;
}

/**
 * Los únicos eventos que se aceptan con la constitución caducada.
 *
 * Es una lista de **un** elemento y así debe quedarse. Cada tipo que se añada aquí es una cosa que
 * se puede hacer sin reglas vigentes.
 */
export const EVENTS_ACCEPTED_WHILE_EXPIRED: readonly ConstitutionEventType[] = [
  'ConstitutionFounded',
];

export function isAcceptedWhileExpired(type: ConstitutionEventType): boolean {
  return EVENTS_ACCEPTED_WHILE_EXPIRED.includes(type);
}

/**
 * Compuerta de vigencia. La aplica el pliegue a **todo** evento, antes de mirar su contenido.
 *
 * Con la constitución caducada sólo pasa la refundación; sin constitución, sólo la fundación.
 */
export function assertAcceptedAt(
  state: ConstitutionState,
  type: ConstitutionEventType,
  at: Instant,
): void {
  const status = statusAt(state, at);
  if (status === 'vigente') return;

  if (status === 'inexistente') {
    if (type === 'ConstitutionFounded') return;
    throw new PreconditionError(
      'CONSTITUTION_NOT_FOUNDED',
      `no hay constitución todavía: ${type} exige reglas vigentes, y las reglas no pueden ` +
        'derivar su legitimidad de sí mismas (§6, «el problema del arranque»)',
    );
  }

  if (isAcceptedWhileExpired(type)) return;
  throw new PreconditionError(
    'CONSTITUTION_EXPIRED',
    `la constitución caducó y ${type} no es un acto de refundación. Mientras nadie refunde no se ` +
      'reforma, no se vota y no se ratifica: todo queda suspendido salvo leer y exportar (§6). La ' +
      'caducidad no rebaja ningún umbral —eso convertiría el vencimiento en la vía barata para ' +
      'quien tenga la paciencia de esperarlo—',
  );
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Máquina de estados de una reforma
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** Pseudo-estado previo a `deliberando`: la reforma todavía no existe. */
export type ReformLifecycle = 'inexistente' | ReformStatus;

export const REFORM_LIFECYCLE: readonly ReformLifecycle[] = [
  'inexistente',
  'deliberando',
  'votada',
  'ratificada',
  'rechazada',
];

/** Los eventos que mueven la máquina de una reforma. `ConstitutionFounded` no es uno de ellos. */
export const REFORM_EVENT_TYPES: readonly ConstitutionEventType[] = [
  'ReformOpened',
  'ReformVoteRecorded',
  'ReformApprovedByGuarantor',
  'ReformRatified',
  'ReformRejected',
];

export interface ReformTransition {
  readonly from: ReformLifecycle;
  readonly event: ConstitutionEventType;
  readonly to: ReformStatus;
  /** La precondición normativa que además se comprueba. Referencia al documento, no adorno. */
  readonly note: string;
}

export const REFORM_TRANSITIONS: readonly ReformTransition[] = [
  {
    from: 'inexistente',
    event: 'ReformOpened',
    to: 'deliberando',
    note: '§6.1: 21 días de deliberación, y las reglas del juicio se congelan aquí',
  },
  {
    from: 'deliberando',
    event: 'ReformVoteRecorded',
    to: 'votada',
    note: 'la votación no abre antes de que cierre la deliberación',
  },
  {
    from: 'deliberando',
    event: 'ReformRejected',
    to: 'rechazada',
    note: 'retirada o vencida antes de votarse',
  },
  {
    from: 'votada',
    event: 'ReformVoteRecorded',
    to: 'votada',
    note: '§6.a: la segunda vuelta de la doble llave temporal, un semestre después',
  },
  {
    from: 'votada',
    event: 'ReformApprovedByGuarantor',
    to: 'votada',
    note: '§6.6: M de N de Garantías, que verifican el procedimiento y no el fondo',
  },
  {
    from: 'votada',
    event: 'ReformRatified',
    to: 'ratificada',
    note: '§6.4-5: tras la espera, con la versión objetivo todavía vigente',
  },
  {
    from: 'votada',
    event: 'ReformRejected',
    to: 'rechazada',
    note: 'sin umbral, sin firmas o con la versión desplazada por otra reforma',
  },
];

const INDEX = new Map<string, ReformStatus>(
  REFORM_TRANSITIONS.map((t) => [`${t.from}\u0000${t.event}`, t.to]),
);

export const TERMINAL_REFORM_STATUSES: readonly ReformStatus[] = ['ratificada', 'rechazada'];

export function isTerminalReformStatus(status: ReformLifecycle): boolean {
  return status === 'ratificada' || status === 'rechazada';
}

export function isLegalReformTransition(
  from: ReformLifecycle,
  event: ConstitutionEventType,
): boolean {
  return INDEX.has(`${from}\u0000${event}`);
}

export function peekReformTransition(
  from: ReformLifecycle,
  event: ConstitutionEventType,
): ReformStatus | undefined {
  return INDEX.get(`${from}\u0000${event}`);
}

/**
 * Aplica la transición o lanza. Es la **única** puerta: si esto lanza, el estado del llamante queda
 * intacto porque nunca se llegó a construir uno nuevo.
 */
export function nextReformStatus(
  from: ReformLifecycle,
  event: ConstitutionEventType,
): ReformStatus {
  const to = peekReformTransition(from, event);
  if (to === undefined) {
    throw new IllegalTransitionError(
      from,
      event,
      isTerminalReformStatus(from)
        ? 'una reforma cerrada no se reabre: lo que sigue es otra reforma, con su deliberación y ' +
            'su votación'
        : 'la pareja (estado, evento) no está en la tabla de reformas',
    );
  }
  return to;
}

/** Todas las transiciones legales desde un estado. Para la interfaz y para los tests exhaustivos. */
export function legalReformEventsFrom(from: ReformLifecycle): readonly ConstitutionEventType[] {
  return REFORM_TRANSITIONS.filter((t) => t.from === from).map((t) => t.event);
}
