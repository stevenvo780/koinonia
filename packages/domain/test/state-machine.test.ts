/**
 * Máquina de estados: INV-34, INV-36, INV-37.
 *
 * El test central no es aleatorio: recorre el **producto cartesiano completo** `Estado × TipoEvento`
 * y exige que toda pareja ausente de la tabla lance `IllegalTransitionError`. Con 7 estados (los 6
 * de A.8 más el pseudo-estado previo) y 19 tipos de evento son 133 casos, todos comprobados.
 *
 * (A.8 lista 19 tipos de evento; INV-34 dice «6 × 17 = 102». La discrepancia está reportada: el
 * producto real es 6 × 19 = 114, o 133 contando `Inexistent`.)
 */

import { describe, expect, it } from 'vitest';

import {
  DECISION_EVENT_TYPES,
  DECISION_STATUSES,
  IllegalTransitionError,
  isLegalTransition,
  isTerminal,
  legalEventsFrom,
  LIFECYCLE_STATUSES,
  nextStatus,
  peekTransition,
  TERMINAL_STATUSES,
  TRANSITIONS,
} from '../src/index.js';

describe('state-machine — la tabla', () => {
  it('cubre los 6 estados de A.8 más el pseudo-estado previo, y los 19 eventos de A.7', () => {
    expect(DECISION_STATUSES).toHaveLength(6);
    expect(LIFECYCLE_STATUSES).toHaveLength(7);
    expect(DECISION_EVENT_TYPES).toHaveLength(19);
    expect(new Set(DECISION_EVENT_TYPES).size).toBe(19);
  });

  it('reproduce exactamente la tabla A.8.1', () => {
    const esperadas = [
      ['Inexistent', 'DecisionDrafted', 'Draft'],
      ['Draft', 'DecisionOpened', 'Open'],
      ['Draft', 'DecisionAnnulled', 'Annulled'],
      ['Open', 'BallotCast', 'Open'],
      ['Open', 'BallotVoided', 'Open'],
      ['Open', 'DelegationGranted', 'Open'],
      ['Open', 'DelegationRevoked', 'Open'],
      ['Open', 'ObjectionRaised', 'Open'],
      ['Open', 'ObjectionAdmitted', 'Open'],
      ['Open', 'ObjectionDismissed', 'Open'],
      ['Open', 'ObjectionIntegrated', 'Open'],
      ['Open', 'ObjectionWithdrawn', 'Open'],
      ['Open', 'RoundOpened', 'Open'],
      ['Open', 'WindowExtended', 'Open'],
      ['Open', 'DecisionClosed', 'Closed'],
      ['Open', 'DecisionAnnulled', 'Annulled'],
      ['Closed', 'SeedRevealed', 'Closed'],
      ['Closed', 'ResultComputed', 'Closed'],
      ['Closed', 'DecisionRatified', 'Ratified'],
      ['Closed', 'DecisionRejected', 'Rejected'],
      ['Closed', 'DecisionAnnulled', 'Annulled'],
    ];
    expect(TRANSITIONS.map((t) => [t.from, t.event, t.to])).toEqual(esperadas);
  });
});

describe('state-machine — INV-34: ninguna transición ilegal se acepta', () => {
  it('recorre el producto cartesiano completo Estado × TipoEvento', () => {
    let legales = 0;
    let ilegales = 0;
    for (const from of LIFECYCLE_STATUSES) {
      for (const event of DECISION_EVENT_TYPES) {
        const esperado = peekTransition(from, event);
        if (esperado === undefined) {
          ilegales++;
          expect(isLegalTransition(from, event)).toBe(false);
          expect(() => nextStatus(from, event)).toThrow(IllegalTransitionError);
        } else {
          legales++;
          expect(nextStatus(from, event)).toBe(esperado);
        }
      }
    }
    expect(legales).toBe(TRANSITIONS.length);
    expect(legales + ilegales).toBe(LIFECYCLE_STATUSES.length * DECISION_EVENT_TYPES.length);
    expect(legales + ilegales).toBe(133);
  });

  it('el error identifica el estado y el evento, para que el rechazo sea explicable', () => {
    try {
      nextStatus('Closed', 'BallotCast');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalTransitionError);
      const typed = error as IllegalTransitionError;
      expect(typed.from).toBe('Closed');
      expect(typed.eventType).toBe('BallotCast');
      expect(typed.code).toBe('ILLEGAL_TRANSITION');
    }
  });
});

describe('state-machine — las prohibiciones de A.8.2', () => {
  it('1. `Closed → Open` no existe: no se reabre una urna cuyo marcador ya se conoce', () => {
    expect(isLegalTransition('Closed', 'DecisionOpened')).toBe(false);
    expect(TRANSITIONS.some((t) => t.from === 'Closed' && t.to === 'Open')).toBe(false);
    // INV-37: ninguna transición lleva de vuelta a `Open` desde `Closed` o posterior.
    for (const from of ['Closed', 'Ratified', 'Rejected', 'Annulled'] as const) {
      expect(TRANSITIONS.filter((t) => t.from === from && t.to === 'Open')).toHaveLength(0);
    }
  });

  it('2. INV-36 — los estados terminales son absorbentes', () => {
    expect(TERMINAL_STATUSES).toEqual(['Ratified', 'Rejected', 'Annulled']);
    for (const from of TERMINAL_STATUSES) {
      expect(isTerminal(from)).toBe(true);
      expect(legalEventsFrom(from)).toHaveLength(0);
      for (const event of DECISION_EVENT_TYPES) {
        expect(() => nextStatus(from, event)).toThrow(IllegalTransitionError);
      }
    }
    // Ni siquiera «para corregir un error».
    expect(isLegalTransition('Annulled', 'DecisionRatified')).toBe(false);
  });

  it('3. no se puede saltar el escrutinio', () => {
    expect(isLegalTransition('Draft', 'DecisionClosed')).toBe(false);
    expect(isLegalTransition('Draft', 'DecisionRatified')).toBe(false);
    expect(isLegalTransition('Open', 'DecisionRatified')).toBe(false);
    expect(isLegalTransition('Open', 'DecisionRejected')).toBe(false);
  });

  it('4. `BallotCast` sólo en `Open`', () => {
    for (const from of LIFECYCLE_STATUSES) {
      expect(isLegalTransition(from, 'BallotCast')).toBe(from === 'Open');
    }
  });

  it('6. `DecisionOpened` dos veces es imposible: `Open` no lo admite', () => {
    expect(isLegalTransition('Open', 'DecisionOpened')).toBe(false);
    expect(legalEventsFrom('Draft')).toEqual(['DecisionOpened', 'DecisionAnnulled']);
  });

  it('A.11 — la prórroga es un evento dentro de `Open`, no un estado', () => {
    expect(peekTransition('Open', 'WindowExtended')).toBe('Open');
    expect(DECISION_STATUSES).not.toContain('Extended');
  });

  it('`BallotVoided` sólo en `Open`: en `Closed` contradiría INV-35', () => {
    expect(peekTransition('Open', 'BallotVoided')).toBe('Open');
    expect(isLegalTransition('Closed', 'BallotVoided')).toBe(false);
  });
});
