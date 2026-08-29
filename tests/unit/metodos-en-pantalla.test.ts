/**
 * El hecho del que depende la pantalla que responde una papeleta: qué clase de papeleta puede
 * recibir hoy el sistema, método por método.
 *
 * ═══ Qué se protege ═══
 *
 * `apps/web/app/decisiones/metodos-en-palabras.ts` decide, para cada uno de los nueve métodos, qué
 * formulario dibuja la pantalla de la papeleta, y esa decisión no es una opinión de la pantalla: es
 * la consecuencia de dos hechos que viven en otros dos paquetes.
 *
 *   1. `acceptedPayloadKinds` (`@koinonia/domain`) dice qué clase de papeleta admite cada método.
 *   2. El esquema `emitirPapeleta` (`@koinonia/contracts`) dice cuáles de esas clases caben en el
 *      cuerpo de `POST /decisiones/:id/papeletas`.
 *
 * Hasta hace poco esas dos listas no coincidían: cuatro métodos —puntuación, voto por rondas,
 * valoración por menciones y comparación por pares— exigían `score`, `ranking` o `grades`, y
 * ninguna de las tres cruzaba la red. Esta prueba comprueba que hoy las dos listas coinciden para
 * los nueve, y sigue viva para que, el día que alguien recorte una clase del contrato sin recortarla
 * también del motor (o al revés), el fallo se vea aquí y no en una votación real que nadie puede
 * responder.
 *
 * **Esto no dice si esos cuatro métodos se pueden ABRIR desde `apps/web/app/decisiones/abrir`.**
 * Siguen sin poder: `abrirDecision` construye toda votación sobre una única opción, y los cuatro
 * existen para comparar varias.
 *
 * Eso SÍ tiene ya una invariante de dominio detrás, y no la tenía: `validateDecisionConfig` rechaza
 * los cuatro con menos de dos opciones (`MULTI_METHOD_NEEDS_TWO_OPTIONS`). Antes la regla vivía sólo
 * en `apps/web/app/decisiones/metodos-en-palabras.ts` (`sePuedeAbrirHoy`), es decir sólo en el
 * navegador, y un revisor abrió una decisión de menciones por la API saltándose la pantalla: los
 * cuatro votantes mandaron «rechazar» y el cierre devolvió `approved`, porque «la mejor de una» es
 * la única de una. El último caso de esta prueba es el que impide que las dos listas se separen otra
 * vez.
 *
 * ═══ Por qué esta prueba no importa el fichero de la pantalla ═══
 *
 * Porque no puede, y la razón es estructural, no un descuido: `apps/web` no declara
 * `"type": "module"` en su `package.json` —es un proyecto de Next con `moduleResolution: Bundler`—,
 * así que bajo el `NodeNext` de `tsconfig.check.json`, que es el que compila `tests/**`, cualquier
 * fichero suyo se lee como CommonJS y `verbatimModuleSyntax` lo rechaza (TS1295/TS1287). Importarlo
 * desde aquí rompe `pnpm run typecheck` del repositorio entero. Es la misma razón por la que
 * `vitest.config.ts` dice que `apps/web` no tiene suite unitaria y se cubre por integración HTTP
 * (`tests/integration/http-metodos.test.ts`) y por E2E (docs/TESTING.md §6).
 *
 * Así que se protege el **hecho**, no la copia: si el dominio deja de admitir una clase que la red sí
 * transporta, o la red deja de transportar una que el dominio exige, esta prueba cae. Comprobado
 * rompiéndolo: quitando `score` de `clasesQueLaRedTransporta` (simulando que el contrato pierde esa
 * rama) el segundo caso falla para `score`, y cambiando la lista esperada de `condorcet-schulze` a
 * `['grades']` falla el tercero. Restaurado después.
 */

import { describe, expect, it } from 'vitest';

import {
  acceptedPayloadKinds,
  type BallotPayloadKind,
  type DecisionMethod,
  isComparativeMethod,
} from '@koinonia/domain';
import {
  emitirPapeleta,
  ID_METODOS,
  METODOS_DISPONIBLES,
  type IdMetodo,
} from '@koinonia/contracts';

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

  it('la red transporta exactamente seis clases de papeleta', () => {
    // Es el hecho del que cuelga todo lo demás. Si cambia, cambia el formulario que dibuja
    // `apps/web/app/decisiones/[id]/page.tsx` para el método que exija la clase que falte.
    expect([...transportables].sort()).toEqual([
      'abstain',
      'binary',
      'consent',
      'grades',
      'ranking',
      'score',
    ]);
  });

  it.each(ID_METODOS)('%s: siempre hay alguna papeleta que la red sepa transportar', (id) => {
    const admitidas = acceptedPayloadKinds(metodoDelMotor(id));
    // Un método sin ninguna papeleta admitida —la deliberación aleatoria— no necesita transporte:
    // el sorteo es el mecanismo y nadie llena nada. Los demás ocho sí necesitan al menos una, y la
    // que exigen tiene que estar entre las que la red sabe llevar.
    const alcanzable =
      admitidas.length === 0 || admitidas.some((clase) => transportables.has(clase));
    expect(
      alcanzable,
      `${id} exige ${admitidas.join(' | ')} y la red no transporta ninguna: revisá emitirPapeleta ` +
        'en packages/contracts/src/http.ts',
    ).toBe(true);
  });

  it('puntuación, voto por rondas, menciones y comparación por pares piden puntuar, ordenar o valorar', () => {
    const cuatro: readonly IdMetodo[] = ['score', 'irv', 'majority-judgment', 'condorcet-schulze'];
    const piden = cuatro.map((id) => acceptedPayloadKinds(metodoDelMotor(id)));
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

  it('el motor y la pantalla coinciden en cuáles cuatro comparan opciones entre sí', () => {
    // La lista de la pantalla (`METODOS_QUE_COMPARAN_OPCIONES`, en `metodos-en-palabras.ts`) está
    // escrita a mano y no se puede importar desde acá —ver la cabecera, es CommonJS bajo NodeNext—,
    // así que lo que se fija es el HECHO del que esa lista es copia: qué considera el motor un
    // método comparativo. Si alguien añade un décimo método comparativo al dominio y se olvida de la
    // pantalla, o al revés, este caso cae y dice cuál de los dos se movió.
    //
    // Importa que sean EXACTAMENTE éstos y no «al menos éstos»: de más, la pantalla escondería un
    // método perfectamente abrible; de menos, volvería a ofrecerse uno que la API rechaza al abrir,
    // que es justo la grieta por la que se coló el desenlace `approved` con todos rechazando.
    const comparativos = ID_METODOS.filter((id) => isComparativeMethod(metodoDelMotor(id)));
    expect(comparativos).toEqual(['score', 'irv', 'majority-judgment', 'condorcet-schulze']);

    // Y los cinco restantes no lo son: sin esto, un `isComparativeMethod` que devolviera `true`
    // siempre pasaría el caso de arriba con sólo reordenar la lista esperada.
    const abribles = ID_METODOS.filter((id) => !isComparativeMethod(metodoDelMotor(id)));
    expect(abribles.length).toBe(ID_METODOS.length - 4);
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
