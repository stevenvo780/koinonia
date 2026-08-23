/**
 * El puerto de IA: lo que **no puede** expresar, comprobado en el tipo y en tiempo de ejecución.
 *
 * Buena parte de este fichero no se ejecuta: se compila. Las líneas anotadas para que el compilador
 * espere un error son pruebas de verdad porque `npx tsc -p tsconfig.check.json --noEmit` incluye los
 * directorios `test` de todos los paquetes, así que si un día una de esas construcciones **deja** de
 * ser un error, la comprobación de tipos falla.
 * Es la única forma de probar una barrera que vive en los tipos: los tipos se borran al emitir, y una
 * prueba que sólo corriera no vería nada.
 *
 * Lo que se demuestra, en orden:
 *
 *  1. Una sugerencia con un número, un booleano, una función o un identificador **no se construye**:
 *     `Inocuo` la deja en `never`.
 *  2. El puerto **no tiene dónde** poner un identificador, ni al recibir ni al devolver.
 *  3. Las cuatro operaciones prohibidas no están en `OperacionIA`, y el pliegue las rechaza aunque
 *     lleguen en un historial.
 *  4. Los guardianes de tiempo de ejecución siguen en pie cuando alguien esquiva los tipos con un
 *     `as`, que es exactamente lo que hace un adaptador escrito con prisa.
 */

import { describe, expect, it } from 'vitest';

import {
  type AIAssistantPort,
  type AlternativasSugeridas,
  assertPeticionSinIdentidad,
  assertSugerenciaSinPoder,
  CAMPO_NUMERICO_PERMITIDO,
  type ContradiccionesSugeridas,
  type EsInocuo,
  esOperacionIA,
  esOperacionProhibida,
  type EstructuraSugerida,
  type ExplicacionSugerida,
  type Inocuo,
  METODO_DE_OPERACION,
  type OperacionIA,
  OPERACIONES,
  OPERACIONES_PROHIBIDAS,
  type OperacionProhibida,
  type ParecidosSugeridos,
  type PeticionIA,
  type PuertoDeIA,
  type ResumenSugerido,
  type Sugerencia,
  type TareasSugeridas,
  type TextoSugerido,
  textoSugerido,
  textosDe,
  TITULO_DE_OPERACION,
} from '../src/assistant/index.js';
import { DomainError } from '../src/errors.js';
import { type MemberId, memberId } from '../src/ids.js';

const hex = (n: number): string => n.toString(16).padStart(32, '0');

function codigoAlLanzar(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof DomainError ? error.code : `no es DomainError: ${String(error)}`;
  }
  return 'no lanzó';
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 1. La barrera de tipos
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('`Inocuo` deja pasar texto y nada más', () => {
  it('los siete contenidos del puerto son inocuos', () => {
    const estructura: EsInocuo<EstructuraSugerida> = true;
    const resumen: EsInocuo<ResumenSugerido> = true;
    const parecidos: EsInocuo<ParecidosSugeridos> = true;
    const tensiones: EsInocuo<ContradiccionesSugeridas> = true;
    const alternativas: EsInocuo<AlternativasSugeridas> = true;
    const tareas: EsInocuo<TareasSugeridas> = true;
    const explicacion: EsInocuo<ExplicacionSugerida> = true;
    expect([estructura, resumen, parecidos, tensiones, alternativas, tareas, explicacion]).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it('un número es un peso o una nota: no pasa', () => {
    const conPuntaje: EsInocuo<{ readonly puntaje: number }> = false;
    expect(conPuntaje).toBe(false);
  });

  it('un booleano es un veredicto: no pasa', () => {
    const conVeredicto: EsInocuo<{ readonly aprobado: boolean }> = false;
    expect(conVeredicto).toBe(false);
  });

  it('una cadena sin marcar es la puerta por la que entra un identificador: no pasa', () => {
    const conCadena: EsInocuo<{ readonly texto: string }> = false;
    const conMiembro: EsInocuo<{ readonly quien: MemberId }> = false;
    expect([conCadena, conMiembro]).toEqual([false, false]);
  });

  it('una función es una mutación esperando: no pasa', () => {
    const conFuncion: EsInocuo<{ readonly aplicar: () => void }> = false;
    expect(conFuncion).toBe(false);
  });

  it('un campo opcional no pasa: la ausencia se dice con una lista vacía', () => {
    const conOpcional: EsInocuo<{ readonly texto: TextoSugerido | undefined }> = false;
    expect(conOpcional).toBe(false);
  });

  it('lo malo anidado dentro de lo bueno tampoco pasa', () => {
    const anidado: EsInocuo<{ readonly lista: readonly { readonly peso: number }[] }> = false;
    expect(anidado).toBe(false);
  });

  it('`Inocuo` de algo con poder es `never`', () => {
    const esNever: EsInocuo<Inocuo<{ readonly puntaje: number }> extends never ? true : false> =
      false;
    // El tipo de arriba es una comprobación auxiliar; la de abajo es la que importa.
    const nunca: Inocuo<{ readonly puntaje: number }> extends never ? 'never' : 'construible' =
      'never';
    expect([esNever, nunca]).toEqual([false, 'never']);
  });
});

describe('una sugerencia con poder no se puede construir', () => {
  const bruto = { clase: 'sugerencia', operacion: 'resumir', contenido: { puntaje: 5 } };

  it('con una puntuación, el contenido es `never`', () => {
    // @ts-expect-error `Inocuo<{puntaje:number}>` es `never`: el objeto no encaja y no hay valor que encaje
    const conPuntaje: Sugerencia<{ readonly puntaje: number }> = bruto;
    expect(conPuntaje).toBeDefined();
  });

  it('con un veredicto, el contenido es `never`', () => {
    // @ts-expect-error un booleano en una sugerencia es «aprobado / no aprobado»: prohibido por el tipo
    const conVeredicto: Sugerencia<{ readonly aprobado: boolean }> = bruto;
    expect(conVeredicto).toBeDefined();
  });

  it('con un identificador de persona, el contenido es `never`', () => {
    // @ts-expect-error un `MemberId` es una cadena sin marcar de texto sugerido: no entra
    const conPersona: Sugerencia<{ readonly quien: MemberId }> = bruto;
    expect(conPersona).toBeDefined();
  });

  it('con una función, el contenido es `never`', () => {
    // @ts-expect-error una función es una mutación: el puerto propone palabras, no acciones
    const conAccion: Sugerencia<{ readonly aplicar: () => void }> = bruto;
    expect(conAccion).toBeDefined();
  });

  it('con texto marcado, sí se construye', () => {
    const valida: Sugerencia<ResumenSugerido> = {
      clase: 'sugerencia',
      operacion: 'resumir',
      contenido: { resumen: textoSugerido('la sala cierra a las 5') },
    };
    expect(valida.contenido.resumen).toBe('la sala cierra a las 5');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 2. El puerto no puede nombrar nada
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('el puerto no conoce ningún identificador del sistema', () => {
  it('la sugerencia sólo tiene tres campos y ninguno es un identificador', () => {
    const claves: readonly (keyof Sugerencia<ResumenSugerido>)[] = [
      'clase',
      'operacion',
      'contenido',
    ];
    expect([...claves].sort()).toEqual(['clase', 'contenido', 'operacion']);
  });

  it('no hay dónde poner un identificador de sugerencia', () => {
    // @ts-expect-error el `sugerenciaId` lo pone quien registra, ya dentro del historial
    const clave: keyof Sugerencia<ResumenSugerido> = 'sugerenciaId';
    expect(clave).toBe('sugerenciaId');
  });

  it('no hay dónde poner un borrador ni una decisión', () => {
    // @ts-expect-error una sugerencia que pudiera nombrar un borrador podría dirigirse a él
    const conBorrador: keyof Sugerencia<ResumenSugerido> = 'borradorId';
    // @ts-expect-error ni hablar de nombrar una decisión: eso ya sería votar
    const conDecision: keyof Sugerencia<ResumenSugerido> = 'decisionId';
    expect([conBorrador, conDecision]).toEqual(['borradorId', 'decisionId']);
  });

  it('la petición lleva el fragmento y nada más', () => {
    const claves: readonly (keyof PeticionIA)[] = ['operacion', 'fragmento', 'conQueComparar'];
    expect([...claves].sort()).toEqual(['conQueComparar', 'fragmento', 'operacion']);
  });

  it('no hay dónde poner al autor ni su historial en la petición', () => {
    // @ts-expect-error el texto puede revelar la posición política de alguien: su nombre no viaja
    const conAutor: keyof PeticionIA = 'autor';
    // @ts-expect-error lo anterior que escribió tampoco: sólo viaja el fragmento a procesar
    const conHistorial: keyof PeticionIA = 'respuestasAnteriores';
    expect([conAutor, conHistorial]).toEqual(['autor', 'respuestasAnteriores']);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 3. Las operaciones
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('las operaciones que hay y las que nunca puede haber', () => {
  it('son siete y todas tienen método y rótulo sin jerga', () => {
    expect(OPERACIONES).toHaveLength(7);
    for (const operacion of OPERACIONES) {
      expect(METODO_DE_OPERACION[operacion]).toBeTruthy();
      expect(TITULO_DE_OPERACION[operacion]).toBeTruthy();
      expect(TITULO_DE_OPERACION[operacion]).not.toMatch(/puntu|calific|aprob|moder/iu);
    }
  });

  it('las cuatro prohibidas están declaradas con su motivo', () => {
    expect(OPERACIONES_PROHIBIDAS.map((p) => p.operacion).sort()).toEqual([
      'evaluar_impacto',
      'fusionar_borradores',
      'moderar',
      'puntuar_propuestas',
    ]);
    for (const prohibida of OPERACIONES_PROHIBIDAS) {
      expect(prohibida.porQue.length).toBeGreaterThan(80);
      expect(esOperacionProhibida(prohibida.operacion)).toBe(true);
      expect(esOperacionIA(prohibida.operacion)).toBe(false);
    }
  });

  it('ninguna prohibida cabe en `OperacionIA`, y el compilador lo sabe', () => {
    const sinSolape: Extract<OperacionIA, OperacionProhibida> extends never ? true : false = true;
    expect(sinSolape).toBe(true);
    // @ts-expect-error puntuar propuestas es ordenar, y ordenar es decidir antes de la votación
    const puntuar: OperacionIA = 'puntuar_propuestas';
    // @ts-expect-error moderar es quitarle la voz a alguien, y el derecho de voz es inderogable
    const moderar: OperacionIA = 'moderar';
    expect([puntuar, moderar]).toEqual(['puntuar_propuestas', 'moderar']);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 4. Los guardianes de tiempo de ejecución
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('el guardián que sigue en pie cuando alguien esquiva los tipos', () => {
  it('deja pasar texto y números de pregunta bien nombrados', () => {
    expect(() => {
      assertSugerenciaSinPoder({ tramos: [{ pregunta: 1, texto: 'algo' }] });
    }).not.toThrow();
    expect(() => {
      assertSugerenciaSinPoder({ pregunta: [3, 27] });
    }).not.toThrow();
    expect(() => {
      assertSugerenciaSinPoder(['uno', 'dos']);
    }).not.toThrow();
    // Un número suelto, sin campo que lo nombre, no pasa: podría ser cualquier cosa.
    expect(
      codigoAlLanzar(() => {
        assertSugerenciaSinPoder(['uno', 'dos', 27]);
      }),
    ).toBe('AI_SUGGESTION_WITH_POWER');
  });

  it('revienta ante cualquier número que no vaya bajo un campo llamado «pregunta»', () => {
    // Aquí está el agujero que el tipo no puede tapar: `{ puntaje: 5 }` y `{ pregunta: 5 }` son el
    // mismo tipo. Los distingue el nombre del campo, y eso sólo se ve en tiempo de ejecución.
    expect(
      codigoAlLanzar(() => {
        assertSugerenciaSinPoder({ puntaje: 5 });
      }),
    ).toBe('AI_SUGGESTION_WITH_POWER');
    expect(
      codigoAlLanzar(() => {
        assertSugerenciaSinPoder({ peso: 1, texto: 'a' });
      }),
    ).toBe('AI_SUGGESTION_WITH_POWER');
    expect(
      codigoAlLanzar(() => {
        assertSugerenciaSinPoder(CAMPO_NUMERICO_PERMITIDO);
      }),
    ).toBe('no lanzó');
    expect(() => {
      assertSugerenciaSinPoder({ pregunta: 5, texto: 'a' });
    }).not.toThrow();
  });

  it('revienta ante un número de pregunta que no existe', () => {
    for (const malo of [0, 28, 3.5, -1, 1_000]) {
      expect(
        codigoAlLanzar(() => {
          assertSugerenciaSinPoder({ pregunta: malo });
        }),
      ).toBe('AI_SUGGESTION_WITH_POWER');
      expect(
        codigoAlLanzar(() => {
          assertSugerenciaSinPoder(malo);
        }),
      ).toBe('AI_SUGGESTION_WITH_POWER');
    }
  });

  it('revienta ante un veredicto, una función, un nulo o una fecha', () => {
    for (const malo of [true, false, (): void => undefined, null, undefined, 9n, Symbol('x')]) {
      expect(
        codigoAlLanzar(() => {
          assertSugerenciaSinPoder(malo);
        }),
      ).toBe('AI_SUGGESTION_WITH_POWER');
    }
  });

  it('señala el camino exacto de lo que está mal', () => {
    try {
      assertSugerenciaSinPoder({ tramos: [{ pregunta: 1, peso: 0.9 }] });
      expect.unreachable('debía lanzar');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as Error).message).toContain('contenido.tramos[0].peso');
    }
  });

  it('aplana los textos en un orden que no depende de cómo se escribió el objeto', () => {
    // El recorrido va por clave ordenada, no por orden de inserción: dos adaptadores que produzcan
    // el mismo contenido con las claves en distinto orden guardan la misma lista en el historial.
    expect(textosDe({ b: 'segundo', a: 'primero' })).toEqual(['primero', 'segundo']);
    expect(textosDe({ a: 'primero', b: 'segundo' })).toEqual(['primero', 'segundo']);
    expect(textosDe({ tensiones: [{ unaParte: 'x', otraParte: 'y', porQue: 'z' }] })).toEqual([
      'y',
      'z',
      'x',
    ]);
  });
});

describe('lo que sale hacia el tercero', () => {
  const peticion = (fragmento: string, comparar: readonly string[] = []): PeticionIA => ({
    operacion: 'resumir',
    fragmento,
    conQueComparar: comparar,
  });

  it('deja pasar prosa normal', () => {
    expect(() => {
      assertPeticionSinIdentidad(peticion('la sala de estudio cierra a las 5 de la tarde'));
    }).not.toThrow();
  });

  it('rechaza cualquier cosa con forma de identificador opaco', () => {
    expect(
      codigoAlLanzar(() => {
        assertPeticionSinIdentidad(peticion(`caso ${hex(0xfeed)}`));
      }),
    ).toBe('AI_IDENTITY_LEAK');
  });

  it('rechaza también en los textos con los que se compara', () => {
    expect(
      codigoAlLanzar(() => {
        assertPeticionSinIdentidad(peticion('normal', [hex(0xbeef)]));
      }),
    ).toBe('AI_IDENTITY_LEAK');
  });

  it('rechaza un identificador conocido aunque no tenga la forma esperada', () => {
    const raro = 'ANA-2026-FILO';
    expect(
      codigoAlLanzar(() => {
        assertPeticionSinIdentidad(peticion(`lo dijo ${raro}`), [raro]);
      }),
    ).toBe('AI_IDENTITY_LEAK');
  });

  it('una lista de identidades vacía o con cadenas vacías no da falsos positivos', () => {
    expect(() => {
      assertPeticionSinIdentidad(peticion('texto normal'), ['']);
    }).not.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 5. Un adaptador de verdad, y la ausencia de adaptador
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Un adaptador que devuelve siempre lo mismo.
 *
 * Existe para demostrar que la interfaz **es implementable transportando sólo texto**: si hiciera
 * falta un número o un identificador para que resultara útil, este fichero no compilaría, y eso sería
 * la señal de que el puerto está mal cortado.
 */
class PuertoDeEjemplo implements AIAssistantPort {
  private readonly eco: TextoSugerido = textoSugerido('lo mismo, dicho más corto');

  estructurar(_peticion: PeticionIA): Promise<Sugerencia<EstructuraSugerida>> {
    const contenido: EstructuraSugerida = { tramos: [{ pregunta: 1, texto: this.eco }] };
    return Promise.resolve({ clase: 'sugerencia', operacion: 'estructurar', contenido });
  }

  resumir(_peticion: PeticionIA): Promise<Sugerencia<ResumenSugerido>> {
    const contenido: ResumenSugerido = { resumen: this.eco };
    return Promise.resolve({ clase: 'sugerencia', operacion: 'resumir', contenido });
  }

  buscarParecidos(_peticion: PeticionIA): Promise<Sugerencia<ParecidosSugeridos>> {
    const contenido: ParecidosSugeridos = {
      parecidos: [{ texto: this.eco, porQue: textoSugerido('dice casi lo mismo') }],
    };
    return Promise.resolve({ clase: 'sugerencia', operacion: 'buscar_parecidos', contenido });
  }

  senalarContradicciones(_peticion: PeticionIA): Promise<Sugerencia<ContradiccionesSugeridas>> {
    const contenido: ContradiccionesSugeridas = { tensiones: [] };
    return Promise.resolve({
      clase: 'sugerencia',
      operacion: 'senalar_contradicciones',
      contenido,
    });
  }

  proponerAlternativas(_peticion: PeticionIA): Promise<Sugerencia<AlternativasSugeridas>> {
    const contenido: AlternativasSugeridas = { alternativas: [this.eco] };
    return Promise.resolve({ clase: 'sugerencia', operacion: 'proponer_alternativas', contenido });
  }

  partirEnTareas(_peticion: PeticionIA): Promise<Sugerencia<TareasSugeridas>> {
    const contenido: TareasSugeridas = { tareas: [this.eco] };
    return Promise.resolve({ clase: 'sugerencia', operacion: 'partir_en_tareas', contenido });
  }

  explicarUnaRegla(_peticion: PeticionIA): Promise<Sugerencia<ExplicacionSugerida>> {
    const contenido: ExplicacionSugerida = { explicacion: this.eco };
    return Promise.resolve({ clase: 'sugerencia', operacion: 'explicar_una_regla', contenido });
  }
}

/** La forma de una sugerencia vista sin sus genéricos, para recorrer las siete de un tirón. */
interface SugerenciaOpaca {
  readonly clase: string;
  readonly operacion: string;
  readonly contenido: unknown;
}

describe('un adaptador cualquiera', () => {
  it('implementa las siete operaciones transportando sólo texto', async () => {
    const puerto = new PuertoDeEjemplo();
    const p: PeticionIA = {
      operacion: 'resumir',
      fragmento: 'algo que escribí',
      conQueComparar: [],
    };
    const llamadas: readonly {
      readonly operacion: OperacionIA;
      readonly hacer: () => Promise<SugerenciaOpaca>;
    }[] = [
      { operacion: 'estructurar', hacer: () => puerto.estructurar(p) },
      { operacion: 'resumir', hacer: () => puerto.resumir(p) },
      { operacion: 'buscar_parecidos', hacer: () => puerto.buscarParecidos(p) },
      { operacion: 'senalar_contradicciones', hacer: () => puerto.senalarContradicciones(p) },
      { operacion: 'proponer_alternativas', hacer: () => puerto.proponerAlternativas(p) },
      { operacion: 'partir_en_tareas', hacer: () => puerto.partirEnTareas(p) },
      { operacion: 'explicar_una_regla', hacer: () => puerto.explicarUnaRegla(p) },
    ];

    expect(llamadas.map((l) => l.operacion)).toEqual([...OPERACIONES]);
    for (const { operacion, hacer } of llamadas) {
      const salida = await hacer();
      expect(salida.clase).toBe('sugerencia');
      expect(salida.operacion).toBe(operacion);
      expect(Object.keys(salida).sort()).toEqual(['clase', 'contenido', 'operacion']);
      expect(() => {
        assertSugerenciaSinPoder(salida.contenido);
      }).not.toThrow();
      for (const texto of textosDe(salida.contenido)) expect(typeof texto).toBe('string');
    }
  });

  it('la ausencia de adaptador está en el tipo, no en una variable de entorno', () => {
    const puerto: PuertoDeIA = undefined;
    expect(puerto).toBeUndefined();
  });

  it('el identificador de una persona nunca aparece en lo que devuelve el puerto', async () => {
    const ana = memberId(hex(0xa11a));
    const puerto = new PuertoDeEjemplo();
    const salida = await puerto.resumir({
      operacion: 'resumir',
      fragmento: 'algo',
      conQueComparar: [],
    });
    expect(JSON.stringify(salida)).not.toContain(ana);
  });
});
