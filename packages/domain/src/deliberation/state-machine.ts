/**
 * Máquina de etapas de una deliberación, y la tabla de qué se puede escribir en cada una.
 *
 * ```
 *   preguntas_aclaratorias ─▶ perspectivas ─▶ perspectivas_revelando ─▶ construccion_alternativas
 *                                                                                  │
 *                          listo_para_decidir ◀── enmiendas ◀── objeciones ◀────────┘
 * ```
 *
 * ═══ Las dos tablas son datos, no cadenas de `if` ═══
 *
 * Igual que `src/state-machine.ts` hace con la decisión: lo que no está en la tabla no existe. Eso
 * permite recorrer el producto cartesiano completo `Etapa × TipoDeAporte` en un test y comprobar que
 * **toda** combinación ausente se rechaza. Un `switch` sobre el tipo de aporte con un `default:`
 * permisivo es literalmente inexpresable aquí.
 *
 * ═══ No se salta ninguna etapa ═══
 *
 * `STAGE_TRANSITIONS` sólo contiene el sucesor exacto. Ir de `perspectivas` a `objeciones` «porque ya
 * está claro» no es un atajo: es saltarse la revelación de autoría, que es justamente la etapa cuyo
 * salto haría inútil todo el compromiso.
 *
 * ═══ `listo_para_decidir` es terminal ═══
 *
 * No tiene sucesor y no admite aportes. Si hay que volver a deliberar, se abre otra deliberación;
 * reabrir una ventana cerrada es el mismo error que reabrir una urna cerrada (A.8.2.1).
 */

import { deepFreeze } from '../canonical.js';
import { IllegalTransitionError, PreconditionError } from '../errors.js';
import {
  type ContributionBody,
  type ContributionId,
  type ContributionKind,
  type DeliberationStage,
  DELIBERATION_STAGES,
  type PositionMode,
  type ReasonRelation,
} from './types.js';

export interface StageTransition {
  readonly from: DeliberationStage;
  readonly to: DeliberationStage;
  /** Por qué esa etapa sigue a la otra. Referencia al diseño, no adorno. */
  readonly note: string;
}

/** La cadena completa. Sólo sucesores exactos: no hay atajos ni vueltas atrás. */
export const STAGE_TRANSITIONS: readonly StageTransition[] = deepFreeze([
  {
    from: 'preguntas_aclaratorias',
    to: 'perspectivas',
    note: 'primero se entiende el problema, después se opina sobre él',
  },
  {
    from: 'perspectivas',
    to: 'perspectivas_revelando',
    note: 'cerrada la escritura a ciegas, se destapa quién escribió qué',
  },
  {
    from: 'perspectivas_revelando',
    to: 'construccion_alternativas',
    note: 'con la autoría ya pública se construyen alternativas',
  },
  {
    from: 'construccion_alternativas',
    to: 'objeciones',
    note: 'hay que tener alternativas antes de poder objetarlas',
  },
  {
    from: 'objeciones',
    to: 'enmiendas',
    note: 'una enmienda responde a una objeción concreta',
  },
  {
    from: 'enmiendas',
    to: 'listo_para_decidir',
    note: 'terminal: lo que sigue es una decisión, no más deliberación',
  },
] as const);

const SUCCESSOR = new Map<DeliberationStage, DeliberationStage>(
  STAGE_TRANSITIONS.map((t) => [t.from, t.to]),
);

/** Etapa terminal. No tiene sucesor y no admite aportes. */
export const TERMINAL_STAGE: DeliberationStage = 'listo_para_decidir';

export function isTerminalStage(stage: DeliberationStage): boolean {
  return stage === TERMINAL_STAGE;
}

/** El sucesor exacto, o `undefined` si la etapa es terminal. */
export function nextStage(from: DeliberationStage): DeliberationStage | undefined {
  return SUCCESSOR.get(from);
}

export function isLegalStageTransition(from: DeliberationStage, to: DeliberationStage): boolean {
  return SUCCESSOR.get(from) === to;
}

/**
 * Aplica la transición o lanza. Es la **única** puerta: si esto lanza, el estado del llamante queda
 * intacto porque nunca se llegó a construir uno nuevo.
 */
export function assertStageTransition(from: DeliberationStage, to: DeliberationStage): void {
  if (!isLegalStageTransition(from, to)) {
    throw new IllegalTransitionError(
      from,
      `StageAdvanced→${to}`,
      isTerminalStage(from)
        ? 'listo_para_decidir es terminal: volver a deliberar exige otra deliberación'
        : 'sólo se avanza al sucesor exacto; saltarse una etapa es saltarse su ventana de escritura',
    );
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Qué admite cada etapa
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface StageRule {
  /** Tipos de aporte admitidos. Vacío ⇒ la etapa no admite escritura de aportes. */
  readonly kinds: readonly ContributionKind[];
  /** Modos de `posicion` admitidos. Vacío ⇒ ninguna posición cabe en esta etapa. */
  readonly positionModes: readonly PositionMode[];
  /** Relaciones de `razon` admitidas. Vacío ⇒ ninguna razón cabe en esta etapa. */
  readonly reasonRelations: readonly ReasonRelation[];
  /** ¿Toda `alternativa` de esta etapa tiene que superseder a otra? (enmiendas). */
  readonly alternativeMustSupersede: boolean;
  /** ¿La autoría se sella durante esta etapa? */
  readonly sealsAuthorship: boolean;
}

const NO_WRITING: StageRule = {
  kinds: [],
  positionModes: [],
  reasonRelations: [],
  alternativeMustSupersede: false,
  sealsAuthorship: false,
};

/**
 * La tabla del diseño, literal y como dato.
 *
 * Las dos filas vacías son tan normativas como las llenas: `perspectivas_revelando` existe para
 * destapar autoría y **nada más**; admitir un aporte ahí sería escribir con la autoría de la etapa
 * anterior todavía a medio destapar.
 */
export const STAGE_RULES: Readonly<Record<DeliberationStage, StageRule>> = deepFreeze({
  preguntas_aclaratorias: {
    kinds: ['posicion', 'razon', 'evidencia'],
    positionModes: ['pregunta_aclaratoria'],
    reasonRelations: ['responde'],
    alternativeMustSupersede: false,
    sealsAuthorship: false,
  },
  perspectivas: {
    kinds: ['posicion', 'razon', 'evidencia', 'supuesto'],
    positionModes: ['afirmacion'],
    reasonRelations: ['sostiene'],
    alternativeMustSupersede: false,
    // La única etapa con autoría sellada. Ver `authorship.ts`.
    sealsAuthorship: true,
  },
  perspectivas_revelando: NO_WRITING,
  construccion_alternativas: {
    kinds: ['alternativa', 'posicion', 'razon', 'evidencia', 'supuesto'],
    positionModes: ['pregunta_aclaratoria', 'afirmacion'],
    reasonRelations: ['responde', 'sostiene'],
    alternativeMustSupersede: false,
    sealsAuthorship: false,
  },
  objeciones: {
    kinds: ['riesgo', 'razon', 'evidencia', 'supuesto'],
    positionModes: [],
    reasonRelations: ['responde', 'sostiene'],
    alternativeMustSupersede: false,
    sealsAuthorship: false,
  },
  enmiendas: {
    kinds: ['alternativa', 'razon', 'evidencia', 'supuesto'],
    positionModes: [],
    reasonRelations: ['responde', 'sostiene'],
    // Una enmienda que no supersede nada es una alternativa nueva fuera de plazo.
    alternativeMustSupersede: true,
    sealsAuthorship: false,
  },
  listo_para_decidir: NO_WRITING,
} as const);

export function stageRule(stage: DeliberationStage): StageRule {
  return STAGE_RULES[stage];
}

/** ¿La etapa admite ese tipo de aporte? Sin mirar modos ni relaciones. */
export function stageAdmits(stage: DeliberationStage, kind: ContributionKind): boolean {
  return STAGE_RULES[stage].kinds.includes(kind);
}

/** ¿La autoría se sella en esta etapa? Sólo `perspectivas`. */
export function stageSealsAuthorship(stage: DeliberationStage): boolean {
  return STAGE_RULES[stage].sealsAuthorship;
}

/** Etapas que no admiten ningún aporte. Para los tests exhaustivos y para la interfaz. */
export function stagesWithoutWriting(): readonly DeliberationStage[] {
  return DELIBERATION_STAGES.filter((stage) => STAGE_RULES[stage].kinds.length === 0);
}

/**
 * ¿Cabe **este** aporte en **esta** etapa? Lanza `PreconditionError` si no.
 *
 * Se comprueba el tipo, el modo (una pregunta aclaratoria no es una afirmación aunque las dos sean
 * `posicion`), la relación de la razón y, en `enmiendas`, que la alternativa supersede a otra.
 */
export function assertBodyAllowedInStage(
  stage: DeliberationStage,
  body: ContributionBody,
  supersedesContributionId: ContributionId | undefined,
): void {
  const rule = STAGE_RULES[stage];
  if (!rule.kinds.includes(body.kind)) {
    throw new PreconditionError(
      'CONTRIBUTION_KIND_NOT_ALLOWED',
      `la etapa ${stage} no admite aportes de tipo ${body.kind}` +
        (rule.kinds.length === 0
          ? ': esta etapa no admite ninguna escritura'
          : `; admite [${rule.kinds.join(', ')}]`),
    );
  }

  if (body.kind === 'posicion' && !rule.positionModes.includes(body.mode)) {
    throw new PreconditionError(
      'POSITION_MODE_NOT_ALLOWED',
      `la etapa ${stage} no admite una posición en modo ${body.mode}`,
    );
  }

  if (body.kind === 'razon' && !rule.reasonRelations.includes(body.relation)) {
    throw new PreconditionError(
      'REASON_RELATION_NOT_ALLOWED',
      `la etapa ${stage} no admite una razón que ${body.relation}`,
    );
  }

  if (
    body.kind === 'alternativa' &&
    rule.alternativeMustSupersede &&
    supersedesContributionId === undefined
  ) {
    throw new PreconditionError(
      'AMENDMENT_MUST_SUPERSEDE',
      'en enmiendas una alternativa enmienda a otra: sin supersedesContributionId sería una ' +
        'alternativa nueva presentada fuera de su ventana',
    );
  }
}
