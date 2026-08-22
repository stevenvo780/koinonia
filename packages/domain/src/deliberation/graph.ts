/**
 * Las aristas del grafo de aportes, y por qué no puede tener ciclos.
 *
 * ═══ Prohibida la referencia hacia adelante ═══
 *
 * Toda referencia de un aporte apunta a un aporte con `seq` **estrictamente menor**. La consecuencia
 * es que el grafo es acíclico **por construcción**: un ciclo exigiría que algún aporte de la vuelta
 * apuntara a otro escrito después que él, y esa escritura se rechaza en el momento de producirse. No
 * hace falta un detector de ciclos que alguien pueda olvidarse de llamar; hace falta que la única
 * puerta de escritura no lo permita. `isAcyclic` existe de todos modos, pero para **comprobar la
 * afirmación** en los tests, no para sostenerla.
 *
 * ═══ Cada arista tiene un tipo de destino, y algunas además un MODO ═══
 *
 * Una `evidencia` que «apoya» una `posicion` es exactamente el salto que hace irrevisable una
 * discusión: el dato pasa a respaldar la conclusión sin pasar por la razón que la une. Aquí el
 * destino se comprueba contra el tipo exigido y se rechaza si no coincide.
 *
 * El tipo no basta cuando dentro de un tipo hay dos actos distintos. `posicion` es preguntar **o**
 * afirmar, y una `razon` declara cuál de los dos hace: `responde` a una pregunta, `sostiene` una
 * afirmación. Comprobar sólo el tipo dejaba pasar una razón que dice «sostiene» apuntando a una
 * pregunta aclaratoria de la etapa anterior —un aporte que afirma estar respaldando algo que nadie
 * afirmó—. La interfaz ya no ofrecía ese destino, pero una regla que sólo vive en el formulario no
 * es una regla: se salta llamando a la API. Ahora la arista lleva también el modo exigido.
 *
 * ═══ DECISIÓN: una corrección supersede a un aporte del MISMO tipo y de la MISMA persona ═══
 *
 * El diseño exige que en `enmiendas` una `alternativa` supersede a otra, pero no dice qué puede
 * superseder un aporte de otro tipo. Se resuelve con la regla general —se supersede al mismo tipo—
 * en vez de con un caso especial: una `razon` corrige una `razon`. Superseder cruzando tipos
 * convertiría `supersedes` en una arista sin significado, y de paso haría que la exigencia de
 * `enmiendas` fuera una excepción en lugar de una instancia de la regla. Se declara aquí.
 *
 * Y **la corrección es de quien escribió el original**. Sin esa condición `supersedes` era una
 * escalada horizontal con todas las letras: `currentContributions` deja fuera lo supersedido, así
 * que cualquiera podía retirar de la vista el aporte de cualquier otra persona escribiendo uno suyo
 * que dijera corregirlo. El original no se borraba —eso nunca pasó—, pero dejaba de ser lo que la
 * pantalla enseña, que es todo lo que hace falta para silenciar a alguien. Corregir lo ajeno no es
 * un permiso que le falte a nadie: es un acto que no existe. Para discrepar del aporte de otra
 * persona están las aristas —una razón, un riesgo, una alternativa—, que **añaden** en vez de
 * desplazar.
 *
 * ═══ Las listas de aristas son CONJUNTOS ordenados ═══
 *
 * `appliesToContributionIds` y `sourcePositionIds` viajan dentro de la preimagen de hash del evento.
 * La regla 1 de `canonical.ts` obliga a serializar todo conjunto como arreglo ordenado
 * ascendentemente: si dos implementaciones honestas los ordenaran distinto, el mismo aporte tendría
 * dos hashes y la verificación acusaría de manipulación a quien no hizo nada. Se exigen
 * estrictamente ordenados, lo que además prohíbe los duplicados.
 */

import { PreconditionError } from '../errors.js';
import { isStrictlySorted, type MemberId } from '../ids.js';
import {
  type ContributionBody,
  type ContributionId,
  type ContributionKind,
  type ContributionRecord,
  type DeliberationState,
  findContribution,
  type PositionMode,
} from './types.js';

/** Una arista declarada por un aporte, con lo que exige de su destino. */
export interface ContributionReference {
  readonly targetId: ContributionId;
  /** Tipo exigido al destino; `undefined` ⇒ sirve cualquier aporte. */
  readonly expectedKind: ContributionKind | undefined;
  /**
   * Modo exigido al destino cuando es una `posicion`; `undefined` ⇒ sirve cualquiera.
   *
   * Preguntar y afirmar son dos actos distintos con el mismo tipo. Una arista que sólo mira el tipo
   * los confunde, y confundirlos es lo que permite «sostener» una pregunta.
   */
  readonly expectedMode: PositionMode | undefined;
  /**
   * ¿El destino tiene que ser de la misma persona que escribe? Sólo la arista de corrección.
   *
   * Es un dato de la arista y no un `if` suelto en la comprobación para que la regla se pueda leer
   * —y recorrer en un test— en el mismo sitio donde se declara qué apunta a qué.
   */
  readonly sameAuthor: boolean;
  /** Campo que produce la arista. Sólo para el mensaje de rechazo. */
  readonly field: string;
}

/**
 * Todas las aristas que declara un aporte, incluida la de corrección.
 *
 * Es una función pura del cuerpo: no mira el estado. Sirve tanto para validar como para pintar el
 * grafo sin volver a recorrer la unión de tipos en otro sitio.
 */
export function referencesOf(
  body: ContributionBody,
  supersedesContributionId: ContributionId | undefined,
): readonly ContributionReference[] {
  const own: readonly ContributionReference[] = ownReferences(body);
  if (supersedesContributionId === undefined) return own;
  return [
    ...own,
    {
      targetId: supersedesContributionId,
      expectedKind: body.kind,
      expectedMode: undefined,
      sameAuthor: true,
      field: 'supersedesContributionId',
    },
  ];
}

/** El modo que exige una razón de la posición a la que apunta. Es la tabla de `ReasonRelation`. */
const MODO_QUE_EXIGE_LA_RAZON: Readonly<Record<'responde' | 'sostiene', PositionMode>> = {
  responde: 'pregunta_aclaratoria',
  sostiene: 'afirmacion',
};

function ownReferences(body: ContributionBody): readonly ContributionReference[] {
  switch (body.kind) {
    case 'posicion':
      return [];
    case 'razon':
      return [
        {
          targetId: body.positionId,
          expectedKind: 'posicion',
          expectedMode: MODO_QUE_EXIGE_LA_RAZON[body.relation],
          sameAuthor: false,
          field: 'positionId',
        },
      ];
    case 'evidencia':
      return [
        {
          targetId: body.supportsReasonId,
          expectedKind: 'razon',
          expectedMode: undefined,
          sameAuthor: false,
          field: 'supportsReasonId',
        },
      ];
    case 'supuesto':
      return body.appliesToContributionIds.map((targetId) => ({
        targetId,
        expectedKind: undefined,
        expectedMode: undefined,
        sameAuthor: false,
        field: 'appliesToContributionIds',
      }));
    case 'riesgo':
      return [
        {
          targetId: body.alternativeId,
          expectedKind: 'alternativa',
          expectedMode: undefined,
          sameAuthor: false,
          field: 'alternativeId',
        },
      ];
    case 'alternativa':
      return body.sourcePositionIds.map((targetId) => ({
        targetId,
        expectedKind: 'posicion' as const,
        expectedMode: undefined,
        sameAuthor: false,
        field: 'sourcePositionIds',
      }));
  }
}

/** Los conjuntos de aristas múltiples, que tienen que llegar estrictamente ordenados. */
function assertSortedSets(body: ContributionBody): void {
  if (body.kind === 'supuesto' && !isStrictlySorted(body.appliesToContributionIds)) {
    throw new PreconditionError(
      'REFERENCES_NOT_SORTED',
      'appliesToContributionIds es un conjunto: llega ordenado ascendentemente y sin repetidos, ' +
        'porque entra en la preimagen de hash del evento (A.1.1.1)',
    );
  }
  if (body.kind === 'alternativa' && !isStrictlySorted(body.sourcePositionIds)) {
    throw new PreconditionError(
      'REFERENCES_NOT_SORTED',
      'sourcePositionIds es un conjunto: llega ordenado ascendentemente y sin repetidos, porque ' +
        'entra en la preimagen de hash del evento (A.1.1.1)',
    );
  }
}

/**
 * Comprueba las aristas de un aporte que se escribe en la posición `seq` de la cadena, escrito por
 * `authorId`.
 *
 * Rechaza —nunca acomoda— si el destino no existe, si es de otro tipo, si es del modo equivocado, si
 * no es anterior, o si una corrección apunta al aporte de otra persona. La comprobación de
 * anterioridad es la que sostiene la aciclicidad de todo el grafo.
 *
 * El `authorId` es un **parámetro obligatorio** y no un extra opcional a propósito: una firma con la
 * autoría opcional deja que un llamante nuevo se olvide de pasarla y pierda la comprobación sin que
 * nada se ponga en rojo. Aquí, olvidarse no compila.
 */
export function assertReferences(
  state: DeliberationState,
  seq: number,
  body: ContributionBody,
  supersedesContributionId: ContributionId | undefined,
  authorId: MemberId,
): void {
  assertSortedSets(body);
  for (const reference of referencesOf(body, supersedesContributionId)) {
    const target = findContribution(state, reference.targetId);
    if (target === undefined) {
      throw new PreconditionError(
        'UNKNOWN_CONTRIBUTION_REFERENCE',
        `${reference.field} apunta a un aporte que no existe en esta deliberación`,
      );
    }
    if (target.seq >= seq) {
      throw new PreconditionError(
        'FORWARD_REFERENCE',
        `${reference.field} apunta a un aporte con seq=${String(target.seq)}, que no es anterior a ` +
          `seq=${String(seq)}: una referencia hacia adelante abriría ciclos en el grafo`,
      );
    }
    if (reference.expectedKind !== undefined && target.body.kind !== reference.expectedKind) {
      throw new PreconditionError(
        'WRONG_REFERENCE_KIND',
        `${reference.field} exige un aporte de tipo ${reference.expectedKind} y apunta a uno de ` +
          `tipo ${target.body.kind}`,
      );
    }
    if (
      reference.expectedMode !== undefined &&
      (target.body.kind !== 'posicion' || target.body.mode !== reference.expectedMode)
    ) {
      throw new PreconditionError(
        'WRONG_REFERENCE_MODE',
        `${reference.field} exige una posición en modo ${reference.expectedMode} y apunta a ` +
          (target.body.kind === 'posicion'
            ? `una en modo ${target.body.mode}`
            : `un aporte de tipo ${target.body.kind}`),
      );
    }
    if (reference.sameAuthor && target.authorId !== authorId) {
      throw new PreconditionError(
        'SUPERSEDES_ANOTHER_AUTHOR',
        'una corrección sólo alcanza a un aporte de quien la escribe: corregir el de otra persona ' +
          'la retiraría de lo vigente, que es silenciarla sin borrar nada',
      );
    }
  }
}

export interface ContributionEdge {
  readonly from: ContributionId;
  readonly to: ContributionId;
  readonly field: string;
}

/** Todas las aristas del grafo, en orden de escritura. */
export function referenceEdges(state: DeliberationState): readonly ContributionEdge[] {
  const edges: ContributionEdge[] = [];
  for (const contribution of state.contributions) {
    for (const reference of referencesOf(
      contribution.body,
      contribution.supersedesContributionId,
    )) {
      edges.push({
        from: contribution.contributionId,
        to: reference.targetId,
        field: reference.field,
      });
    }
  }
  return edges;
}

/**
 * ¿El grafo es acíclico? Recorrido en profundidad con marcas, sobre las aristas reales.
 *
 * No se apoya en `seq`: si se apoyara sería una tautología y no comprobaría nada. Recorre el grafo
 * tal como quedó, de modo que un log fabricado a mano que consiguiera colar un ciclo lo delataría.
 */
export function isAcyclic(state: DeliberationState): boolean {
  const outgoing = new Map<ContributionId, readonly ContributionId[]>();
  for (const contribution of state.contributions) {
    outgoing.set(
      contribution.contributionId,
      referencesOf(contribution.body, contribution.supersedesContributionId).map(
        (reference) => reference.targetId,
      ),
    );
  }

  // 0 = sin visitar, 1 = en la pila actual, 2 = cerrado.
  const mark = new Map<ContributionId, number>();
  const stack: { readonly node: ContributionId; readonly index: number }[] = [];

  for (const contribution of state.contributions) {
    if (mark.get(contribution.contributionId) === 2) continue;
    stack.push({ node: contribution.contributionId, index: 0 });
    mark.set(contribution.contributionId, 1);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame === undefined) break;
      const neighbours = outgoing.get(frame.node) ?? [];
      const next = neighbours[frame.index];
      if (next === undefined) {
        mark.set(frame.node, 2);
        stack.pop();
        continue;
      }
      stack[stack.length - 1] = { node: frame.node, index: frame.index + 1 };
      const state_ = mark.get(next);
      if (state_ === 1) return false;
      if (state_ === 2) continue;
      // Una arista a un aporte inexistente no puede cerrar ciclo; `assertReferences` ya lo impide.
      if (!outgoing.has(next)) continue;
      mark.set(next, 1);
      stack.push({ node: next, index: 0 });
    }
  }
  return true;
}

/** Aportes que fueron supersedidos por otro. Siguen en el historial: sólo dejan de ser los vigentes. */
export function supersededContributions(state: DeliberationState): readonly ContributionRecord[] {
  const superseded = new Set<ContributionId>();
  for (const contribution of state.contributions) {
    if (contribution.supersedesContributionId !== undefined) {
      superseded.add(contribution.supersedesContributionId);
    }
  }
  return state.contributions.filter((c) => superseded.has(c.contributionId));
}

/** Aportes vigentes: los que nadie supersedió. Los otros **no desaparecen**, sólo no son la punta. */
export function currentContributions(state: DeliberationState): readonly ContributionRecord[] {
  const superseded = new Set(supersededContributions(state).map((c) => c.contributionId));
  return state.contributions.filter((c) => !superseded.has(c.contributionId));
}
