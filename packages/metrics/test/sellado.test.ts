/**
 * Que el guardián exista no sirve de nada si nadie lo llama.
 *
 * `adr-0040.test.ts` comprueba que `sellar()` **muerde**; esta prueba comprueba que está
 * **enchufado**: que las cinco métricas pasan por él y que le entregan las identidades de verdad y
 * no un arreglo vacío. Sin esto, borrar la llamada —o «optimizarla» pasándole `[]`— no rompería
 * ninguna prueba, porque las salidas hoy son legítimas y el recorrido de la prueba de propiedad las
 * seguiría dando por buenas. Un control que se puede quitar sin que nada se ponga rojo ya está
 * medio quitado.
 */

import { describe, expect, it, vi } from 'vitest';

// La forma del módulo se toma con un import de tipo, no con una anotación `import(...)`: el
// monorepo prohíbe la segunda porque esconde una dependencia donde nadie la busca.
import type * as Tipos from '../src/types.js';
import {
  informeDeAcuerdos,
  informeDeCobertura,
  informeDeDeliberacion,
  informeDeRotacion,
  informeDeVoz,
} from '../src/index.js';
import {
  acto,
  acuerdo,
  aportes,
  DIA,
  entradaAcuerdos,
  entradaCobertura,
  entradaDeliberacion,
  entradaRotacion,
  entradaVoz,
  estratos,
  miembro,
  ORIGEN,
  persona,
  VENTANA_ANTERIOR,
} from './datos.js';

const registro = vi.hoisted(() => ({ llamadas: [] as string[][] }));

vi.mock('../src/types.js', async (importOriginal) => {
  const original = await importOriginal<typeof Tipos>();
  return {
    ...original,
    sellar: <S>(salida: S, identidades: Iterable<string>): S => {
      const lista = [...identidades];
      registro.llamadas.push(lista);
      return original.sellar(salida, lista);
    },
  };
});

function grupo(desde: number, cuantos: number) {
  const salida = [];
  for (let i = 0; i < cuantos; i += 1) salida.push(miembro(desde + i, estratos('3', 'diurna')));
  return salida;
}

function activos(
  desde: number,
  cuantas: number,
  cada: number,
  ventana?: Parameters<typeof aportes>[2],
) {
  const lista = [];
  for (let i = 0; i < cuantas; i += 1) lista.push(...aportes(desde + i, cada, ventana));
  return lista;
}

describe('el sellado está enchufado a las cinco métricas', () => {
  it('cada métrica pasa su salida por el guardián, con las identidades que recibió', () => {
    registro.llamadas.length = 0;

    informeDeAcuerdos(entradaAcuerdos([acuerdo()]));
    expect(registro.llamadas).toHaveLength(1);

    informeDeVoz(entradaVoz(activos(0, 12, 3)));
    expect(registro.llamadas).toHaveLength(2);
    // No un arreglo vacío: las identidades reales de los doce que hablaron.
    expect(new Set(registro.llamadas[1])).toEqual(
      new Set(Array.from({ length: 12 }, (_, i) => persona(i))),
    );

    informeDeCobertura(entradaCobertura(grupo(0, 20), [acto(0, ORIGEN + DIA)]));
    expect(registro.llamadas).toHaveLength(3);
    expect(registro.llamadas[2]).toContain(persona(0));
    expect(registro.llamadas[2]).toHaveLength(20);

    informeDeRotacion(entradaRotacion(activos(0, 15, 2, VENTANA_ANTERIOR), activos(0, 15, 2)));
    expect(registro.llamadas).toHaveLength(4);
    expect(registro.llamadas[3]).toContain(persona(7));

    informeDeDeliberacion(entradaDeliberacion([{ instante: ORIGEN + DIA, intervenciones: 2 }], []));
    expect(registro.llamadas).toHaveLength(5);
  });

  it('y muerde de verdad al final del cálculo: una etiqueta de estrato con nombre de persona no sale', () => {
    // Es el accidente realista: una proyección que rellena `jornada` con una columna equivocada y
    // acaba metiendo un identificador donde iba una etiqueta. La cobertura se calcula sin
    // problemas —el número está bien— y aun así no se publica, porque publicarlo sería publicar el
    // identificador de alguien en la pantalla de las 300 personas.
    const contaminados = grupo(0, 20).map((m, i) => ({
      miembro: m.miembro,
      estratos: estratos('3', i === 0 ? persona(3) : 'diurna'),
    }));
    expect(() => informeDeCobertura(entradaCobertura(contaminados, []))).toThrow(/ADR-0040/u);
  });
});
