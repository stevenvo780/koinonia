/**
 * El hecho del que depende la pantalla que abre una votación: qué papeleta puede recibir hoy el
 * sistema, método por método.
 *
 * ═══ Qué se protege ═══
 *
 * `apps/web/app/decisiones/metodos-en-palabras.ts` decide, para cada uno de los nueve métodos, qué
 * formulario dibuja la pantalla y si el método se puede abrir. Cuatro están marcados `todavia-no` —
 * puntuación, voto por rondas, valoración por menciones y comparación por pares— y esa marca no es
 * una opinión de la pantalla: es la consecuencia de dos hechos que viven en otros dos paquetes.
 *
 *   1. `acceptedPayloadKinds` (`@koinonia/domain`) dice qué clase de papeleta admite cada método.
 *   2. El esquema `emitirPapeleta` (`@koinonia/contracts`) dice cuáles de esas clases caben en el
 *      cuerpo de `POST /decisiones/:id/papeletas`. Hoy son tres: `binary`, `abstain` y `consent`.
 *
 * Los cuatro métodos de arriba exigen `score`, `ranking` o `grades`, y ninguna de las tres cruza la
 * red. Abrir una votación con uno de ellos crearía una votación **que nadie puede responder**, en un
 * historial que no se corrige ni se borra; por eso la pantalla los muestra, explica para qué sirven
 * y no los deja elegir.
 *
 * ═══ Por qué esta prueba no importa el fichero de la pantalla ═══
 *
 * Porque no puede, y la razón es estructural, no un descuido: `apps/web` no declara
 * `"type": "module"` en su `package.json` —es un proyecto de Next con `moduleResolution: Bundler`—,
 * así que bajo el `NodeNext` de `tsconfig.check.json`, que es el que compila `tests/**`, cualquier
 * fichero suyo se lee como CommonJS y `verbatimModuleSyntax` lo rechaza (TS1295/TS1287). Importarlo
 * desde aquí rompe `pnpm run typecheck` del repositorio entero. Es la misma razón por la que
 * `vitest.config.ts` dice que `apps/web` no tiene suite unitaria y se cubre por E2E
 * (docs/TESTING.md §6).
 *
 * Así que se protege el **hecho**, no la copia: si alguien añade al contrato la rama que falta, o si
 * el dominio cambia qué admite un método, esta prueba cae y el mensaje dice qué fichero de pantalla
 * hay que revisar. Comprobado rompiéndolo: añadiendo a mano `score` a la lista de clases
 * transportables el primer caso falla, y quitando `condorcet-schulze` de la lista de bloqueados
 * falla el tercero. Restaurado después.
 */

import { describe, expect, it } from 'vitest';

import {
  acceptedPayloadKinds,
  type BallotPayloadKind,
  type DecisionMethod,
} from '@koinonia/domain';
import {
  emitirPapeleta,
  ID_METODOS,
  METODOS_DISPONIBLES,
  type IdMetodo,
} from '@koinonia/contracts';

/**
 * Los cuatro métodos que `apps/web/app/decisiones/metodos-en-palabras.ts` marca `todavia-no`.
 *
 * Está escrita a mano **a propósito**: es la copia de la decisión de producto que esta prueba tiene
 * que confrontar con la realidad. Derivarla de lo mismo que se compara convertiría la prueba en una
 * tautología.
 */
const BLOQUEADOS_EN_LA_PANTALLA: readonly IdMetodo[] = [
  'score',
  'irv',
  'majority-judgment',
  'condorcet-schulze',
];

/**
 * Las clases de papeleta que el cuerpo de `POST /decisiones/:id/papeletas` sabe transportar hoy.
 *
 * Se leen del esquema, no de una lista escrita a mano: `emitirPapeleta.shape.respuesta` es una unión
 * discriminada por `tipo` y cada rama declara su literal.
 */
function clasesQueLaRedTransporta(): ReadonlySet<BallotPayloadKind> {
  const clases = new Set<BallotPayloadKind>();
  for (const rama of emitirPapeleta.shape.respuesta.options) {
    clases.add(rama.shape.tipo.value);
  }
  return clases;
}

/**
 * El método del motor a partir de su identificador.
 *
 * `acceptedPayloadKinds` sólo mira `method.kind` —directamente y a través de `isThresholdMethod`—,
 * así que la sola discriminante alcanza y no hace falta reconstruir aquí las nueve configuraciones
 * completas de `construirMetodo`, que son código del servidor y no de esta frontera.
 */
function metodoDelMotor(id: IdMetodo): DecisionMethod {
  return { kind: id } as DecisionMethod;
}

describe('qué papeleta puede recibir hoy cada uno de los nueve métodos', () => {
  const transportables = clasesQueLaRedTransporta();

  it('la red transporta exactamente tres clases de papeleta', () => {
    // Es el hecho del que cuelga todo lo demás. Si cambia, cambia el reparto de abajo y con él la
    // pantalla de `apps/web/app/decisiones/abrir`.
    expect([...transportables].sort()).toEqual(['abstain', 'binary', 'consent']);
  });

  it.each(ID_METODOS)('%s: se puede responder ⟺ la pantalla lo deja abrir', (id) => {
    const admitidas = acceptedPayloadKinds(metodoDelMotor(id));
    // Un método sin ninguna papeleta admitida —la deliberación aleatoria— no necesita transporte:
    // el sorteo es el mecanismo y nadie llena nada. Los demás sí necesitan al menos una.
    const alcanzable =
      admitidas.length === 0 || admitidas.some((clase) => transportables.has(clase));
    expect(
      alcanzable,
      `si esto cambió, hay que revisar el mapa de apps/web/app/decisiones/metodos-en-palabras.ts`,
    ).toBe(!BLOQUEADOS_EN_LA_PANTALLA.includes(id));
  });

  it('los cuatro bloqueados son exactamente los que piden puntuar, ordenar o valorar', () => {
    const piden = BLOQUEADOS_EN_LA_PANTALLA.map((id) => acceptedPayloadKinds(metodoDelMotor(id)));
    expect(piden).toEqual([['score'], ['ranking'], ['grades'], ['ranking']]);
  });

  it('la deliberación aleatoria no admite ninguna papeleta, y eso no es un hueco', () => {
    // El sorteo ES el mecanismo: la pantalla lo dice («acá no hay nada que responder») en vez de
    // dibujar un sí/no que el motor rechazaría.
    expect(acceptedPayloadKinds(metodoDelMotor('deliberative-sortition'))).toEqual([]);
  });

  it('el acuerdo interno no admite abstención, y por eso su papeleta tiene tres respuestas', () => {
    // B.3: el conjunto de posturas es cerrado —sin objeción, reserva, objeto— y una abstención sería
    // una cuarta cosa sin efecto definido sobre la participación. La pantalla no la ofrece.
    expect(acceptedPayloadKinds(metodoDelMotor('sociocratic-consent'))).toEqual(['consent']);
  });

  it('los tres de umbral comparten papeleta, y por eso comparten formulario en pantalla', () => {
    for (const id of ['simple-majority', 'supermajority', 'unanimity'] as const) {
      expect(acceptedPayloadKinds(metodoDelMotor(id))).toEqual(['binary', 'abstain']);
    }
  });

  it('el catálogo declara los nueve métodos que la pantalla tiene que saber explicar', () => {
    expect(ID_METODOS.map((id) => METODOS_DISPONIBLES[id].id)).toEqual([...ID_METODOS]);
    for (const id of ID_METODOS) {
      // Sin nombre no hay nada que poner en la etiqueta del control, y sin descripción la pantalla
      // tendría que inventar la suya: las dos cosas salen del contrato, no de la interfaz.
      expect(METODOS_DISPONIBLES[id].nombre.length).toBeGreaterThan(0);
      expect(METODOS_DISPONIBLES[id].descripcion.length).toBeGreaterThan(40);
    }
  });
});
