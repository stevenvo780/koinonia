/**
 * El tono de los peldaños de incumplimiento y el resumen del plan, atados a lo que ADR-0039/ADR-0040
 * prohíben — comprobados, no prometidos en un comentario.
 *
 * ═══ Por qué esta prueba existe donde existe ═══
 *
 * `apps/web` no tiene suite unitaria (docs/TESTING.md §6: se cubre por E2E) y este encargo no puede
 * añadir dependencias, así que no hay forma de renderizar React acá. No hace falta: lo que hay que
 * proteger de las dos pantallas de ejecución **no es el marcado**, es la redacción y el color, y los
 * dos viven enteros en `apps/web/app/iniciativas/escalones.ts` y `.../plan.ts`, que son módulos
 * puros sin JSX. El marcado que los usa lo sigue cubriendo el E2E.
 *
 * ═══ Por qué el `import` es dinámico y no una línea normal ═══
 *
 * `apps/web/package.json` no declara `"type": "module"`, así que bajo la resolución `NodeNext` de
 * `tsconfig.check.json` —el proyecto que corre `pnpm run typecheck`— todo fichero de `apps/web` se
 * considera CommonJS, y con `verbatimModuleSyntax` activado cualquier `export const` de allí es un
 * error de compilación (TS1287/TS1295). **Medido**: un `import` estático de estos dos módulos añade
 * 12 errores a un `typecheck` que tiene que dar 0.
 *
 * TypeScript sólo resuelve —y por tanto sólo comprueba— el destino de un `import()` cuyo argumento
 * es un literal escrito en la propia llamada. Pasándole una constante, el módulo se carga en tiempo
 * de ejecución (vitest lo resuelve sin problema) y el proyecto de comprobación no lo arrastra. El
 * precio es que el tipo llega como `any`, y por eso cada módulo se afirma contra una interfaz
 * declarada acá abajo: esa interfaz **es** el contrato que las dos pantallas necesitan, y si el
 * módulo se aparta de ella las aserciones de más abajo fallan en el acto.
 *
 * Cada bloque se rompe si alguien afloja lo que protege; está comprobado rompiéndolo a propósito y
 * restaurándolo después (ver el informe de este encargo).
 */

import { describe, expect, it } from 'vitest';

import { forbiddenTermsIn } from '@koinonia/contracts';

/** Los siete peldaños de ADR-0040, escritos acá a mano: si el módulo cambia uno, esto lo detecta. */
type EscalonTarea =
  | 'por-vencer'
  | 'atrasada'
  | 'consultada'
  | 'bloqueada'
  | 'en-apoyo'
  | 'reasignada'
  | 'en-revision-colectiva';

/** Las cinco variantes de `<Ficha>`. `mal` está en la lista **para poder afirmar que no se usa**. */
type VarianteFicha = 'neutra' | 'bien' | 'mal' | 'atencion' | 'en-curso';

interface ModuloEscalones {
  readonly ESCALONES_DE_TAREA: readonly EscalonTarea[];
  readonly ESCALON_EN_PALABRAS: Readonly<Record<EscalonTarea, string>>;
  readonly ESCALON_EXPLICACION: Readonly<Record<EscalonTarea, string>>;
  readonly ESCALON_VARIANTE: Readonly<Record<EscalonTarea, VarianteFicha>>;
  readonly ESCALON_PRIVADO: Readonly<Record<EscalonTarea, boolean>>;
  readonly esEscalonTarea: (valor: unknown) => boolean;
  readonly escalonesPorTarea: (
    respuesta:
      | {
          readonly tareas: readonly { readonly tareaId: string; readonly escalon: string | null }[];
        }
      | undefined,
  ) => ReadonlyMap<string, EscalonTarea>;
  readonly hayRevisionColectiva: (indice: ReadonlyMap<string, EscalonTarea>) => boolean;
}

/** Lo único que `plan.ts` lee de una `Tarea`; el contrato real tiene veinte campos más. */
interface TareaMinima {
  readonly id: string;
  readonly titulo: string;
  readonly esfuerzoMinutos: number;
  readonly dependeDe: readonly string[];
  readonly estado: string;
  readonly evidencias: readonly { readonly id: string }[];
}

interface ModuloPlan {
  readonly resumirPlan: (iniciativa: {
    readonly hitos: readonly { readonly id: string }[];
    readonly tareas: readonly TareaMinima[];
  }) => {
    readonly hitos: number;
    readonly tareas: number;
    readonly esfuerzoMinutos: number;
    readonly tareasQueEsperan: number;
    readonly evidencias: number;
  };
  readonly duracionEnPalabras: (minutos: number) => string;
  readonly ordenDelTrabajo: (tareas: readonly TareaMinima[]) => readonly {
    readonly id: string;
    readonly titulo: string;
    readonly espera: readonly { readonly titulo: string; readonly completada: boolean }[];
    readonly libre: boolean;
  }[];
  readonly ventanaDeImpugnacion: (
    creadaEn: number,
    ratificableEn: number | undefined,
    ahora: number,
  ) => { readonly horas: number; readonly vencida: boolean } | undefined;
}

const RUTA_ESCALONES = '../../apps/web/app/iniciativas/escalones.js';
const RUTA_PLAN = '../../apps/web/app/iniciativas/plan.js';

const {
  ESCALONES_DE_TAREA,
  ESCALON_EN_PALABRAS,
  ESCALON_EXPLICACION,
  ESCALON_PRIVADO,
  ESCALON_VARIANTE,
  esEscalonTarea,
  escalonesPorTarea,
  hayRevisionColectiva,
} = (await import(RUTA_ESCALONES)) as ModuloEscalones;

const { duracionEnPalabras, ordenDelTrabajo, resumirPlan, ventanaDeImpugnacion } = (await import(
  RUTA_PLAN
)) as ModuloPlan;

/** Los dos peldaños que PRODUCT.md §6 reserva a quien tiene la tarea. Ver `rutas-escalones.ts`. */
const PRIVADOS: readonly EscalonTarea[] = ['por-vencer', 'consultada'];

/**
 * Marcas de que una frase le habla a una persona en la cara. Se busca con límite de palabra para no
 * cazar «te» dentro de «tercera» ni «tu» dentro de «turno».
 */
const SEGUNDA_PERSONA =
  /\b(vos|te|tu|tus|tuyo|tuya|usted|ustedes|sos|tenés|hiciste|entregaste)\b/iu;

function tarea(sobre: {
  readonly id: string;
  readonly esfuerzoMinutos?: number;
  readonly dependeDe?: readonly string[];
  readonly estado?: string;
  readonly evidencias?: number;
}): TareaMinima {
  return {
    id: sobre.id,
    titulo: `Tarea ${sobre.id}`,
    esfuerzoMinutos: sobre.esfuerzoMinutos ?? 60,
    dependeDe: sobre.dependeDe ?? [],
    estado: sobre.estado ?? 'en-curso',
    evidencias: Array.from({ length: sobre.evidencias ?? 0 }, (_v, i) => ({ id: `e${String(i)}` })),
  };
}

describe('los siete peldaños tienen dicho todo lo que la pantalla necesita', () => {
  it('cada peldaño tiene palabra, explicación, color y visibilidad', () => {
    expect(ESCALONES_DE_TAREA).toHaveLength(7);
    for (const escalon of ESCALONES_DE_TAREA) {
      expect(ESCALON_EN_PALABRAS[escalon].length).toBeGreaterThan(0);
      // Una explicación de una línea no explica: el peldaño sin frase larga es el que se lee como
      // reproche, que es exactamente lo que ese fichero existe para evitar.
      expect(ESCALON_EXPLICACION[escalon].length).toBeGreaterThan(60);
      expect(ESCALON_VARIANTE[escalon]).toBeDefined();
      expect(typeof ESCALON_PRIVADO[escalon]).toBe('boolean');
    }
  });

  it('los identificadores del servidor son exactamente estos siete, sin sobras ni faltas', () => {
    // Copiados a mano de `ESCALONES_DE_TAREA` en `packages/domain/src/execution/escalones.ts`. Si
    // el dominio añade un peldaño y esta pantalla no se entera, acá se ve.
    expect([...ESCALONES_DE_TAREA]).toEqual([
      'por-vencer',
      'atrasada',
      'consultada',
      'bloqueada',
      'en-apoyo',
      'reasignada',
      'en-revision-colectiva',
    ]);
  });
});

describe('ADR-0040: el peldaño marca la tarea, nunca a la persona', () => {
  it('ningún peldaño se pinta como fracaso', () => {
    // `VarianteFicha` tiene `mal` —la ✕ roja— y esa tabla no puede usarla: atrasarse no es un
    // veredicto negativo sobre nadie. Poner `atrasada: 'mal'` pone esta prueba en rojo.
    for (const escalon of ESCALONES_DE_TAREA) {
      expect(ESCALON_VARIANTE[escalon]).not.toBe('mal');
      expect(['neutra', 'atencion', 'en-curso']).toContain(ESCALON_VARIANTE[escalon]);
    }
  });

  it('los peldaños que ve el círculo no le hablan a la persona en segunda persona', () => {
    // Un «no entregaste» leído por doce personas es la humillación que el pliego prohíbe. Los dos
    // privados sí pueden vosear: sólo los lee quien tiene la tarea.
    for (const escalon of ESCALONES_DE_TAREA) {
      if (ESCALON_PRIVADO[escalon]) continue;
      expect(
        SEGUNDA_PERSONA.test(`${ESCALON_EN_PALABRAS[escalon]} ${ESCALON_EXPLICACION[escalon]}`),
      ).toBe(false);
    }
  });

  it('el techo de la escalera dice en pantalla que el objeto es el acuerdo y no la persona', () => {
    const texto = ESCALON_EXPLICACION['en-revision-colectiva'];
    expect(texto).toContain('acuerdo');
    expect(texto).toMatch(/nunca a quien|no a quien|no sobre quién/u);
  });

  it('el peldaño 0 se dice como recordatorio y no como sanción', () => {
    const texto = ESCALON_EXPLICACION['por-vencer'];
    expect(texto).toContain('recordatorio');
    // «no una marca» y «nadie más»: sin las dos, un aviso privado se lee como público.
    expect(texto).toMatch(/no una marca|no es una marca/u);
    expect(texto).toContain('nadie más');
    expect(ESCALON_PRIVADO['por-vencer']).toBe(true);
  });

  it('la visibilidad declarada coincide con la que filtra el servidor', () => {
    // Espejo de `PELDANOS_PRIVADOS` en `services/api/src/http/rutas-escalones.ts`. Si una de las dos
    // listas cambia sin la otra, la pantalla promete privacidad que el servidor no da (o al revés).
    const privados = ESCALONES_DE_TAREA.filter((escalon) => ESCALON_PRIVADO[escalon]);
    expect([...privados].sort()).toEqual([...PRIVADOS].sort());
  });

  it('nada de este vocabulario usa una palabra prohibida (ADR-0041)', () => {
    for (const escalon of ESCALONES_DE_TAREA) {
      expect(forbiddenTermsIn(ESCALON_EN_PALABRAS[escalon])).toEqual([]);
      expect(forbiddenTermsIn(ESCALON_EXPLICACION[escalon])).toEqual([]);
    }
  });
});

describe('el índice de peldaños aguanta lo que puede llegar por la red', () => {
  it('descarta las tareas sin peldaño y las que traen un valor desconocido', () => {
    const indice = escalonesPorTarea({
      tareas: [
        { tareaId: 't1', escalon: 'atrasada' },
        { tareaId: 't2', escalon: null },
        // Un peldaño que esta versión de la pantalla no conoce: se calla, no inventa una palabra.
        { tareaId: 't3', escalon: 'dominio-suspendido' },
      ],
    });
    expect([...indice.entries()]).toEqual([['t1', 'atrasada']]);
  });

  it('una respuesta ausente da un índice vacío y no revienta', () => {
    expect(escalonesPorTarea(undefined).size).toBe(0);
  });

  it('reconoce los siete y rechaza el octavo peldaño y la basura', () => {
    for (const escalon of ESCALONES_DE_TAREA) expect(esEscalonTarea(escalon)).toBe(true);
    // `dominio-suspendido` es el peldaño excepcional que el dominio deja fuera a propósito: nunca
    // automático. Que esta pantalla no lo reconozca es la mitad de esa garantía.
    expect(esEscalonTarea('dominio-suspendido')).toBe(false);
    expect(esEscalonTarea(undefined)).toBe(false);
    expect(esEscalonTarea(7)).toBe(false);
  });

  it('la señal de revisión colectiva es un sí/no y nunca un conteo comparable', () => {
    expect(hayRevisionColectiva(new Map([['t1', 'atrasada']]))).toBe(false);
    expect(
      hayRevisionColectiva(
        new Map<string, EscalonTarea>([
          ['t1', 'atrasada'],
          ['t2', 'en-revision-colectiva'],
        ]),
      ),
    ).toBe(true);
    // Es `boolean` a propósito: un número invita a comparar iniciativas —o personas— entre sí.
    expect(typeof hayRevisionColectiva(new Map())).toBe('boolean');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// El plan comprometido
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('el resumen del plan describe la iniciativa, nunca a una persona', () => {
  it('suma el tiempo de todas las tareas y cuenta las que esperan a otra', () => {
    const resumen = resumirPlan({
      hitos: [{ id: 'h1' }],
      tareas: [
        tarea({ id: 'a', esfuerzoMinutos: 90, evidencias: 2 }),
        tarea({ id: 'b', esfuerzoMinutos: 30, dependeDe: ['a'] }),
        // Una tarea que volvió al círculo sigue contando: el trabajo hace falta igual.
        tarea({ id: 'c', esfuerzoMinutos: 60, estado: 'rechazada' }),
      ],
    });
    expect(resumen).toEqual({
      hitos: 1,
      tareas: 3,
      esfuerzoMinutos: 180,
      tareasQueEsperan: 1,
      evidencias: 2,
    });
  });

  it('un plan vacío no inventa cifras', () => {
    expect(resumirPlan({ hitos: [], tareas: [] })).toEqual({
      hitos: 0,
      tareas: 0,
      esfuerzoMinutos: 0,
      tareasQueEsperan: 0,
      evidencias: 0,
    });
  });
});

describe('el tiempo se dice como lo diría una persona', () => {
  it('por debajo de una hora, en minutos, con el singular donde toca', () => {
    expect(duracionEnPalabras(1)).toBe('1 minuto');
    expect(duracionEnPalabras(45)).toBe('45 minutos');
  });

  it('a partir de una hora, en horas, y los minutos sueltos sólo si los hay', () => {
    expect(duracionEnPalabras(60)).toBe('1 hora');
    expect(duracionEnPalabras(90)).toBe('1 hora y 30 minutos');
    expect(duracionEnPalabras(121)).toBe('2 horas y 1 minuto');
    expect(duracionEnPalabras(4380)).toBe('73 horas');
  });
});

describe('el orden del trabajo', () => {
  it('sólo lista las tareas que esperan, y resuelve los identificadores a títulos', () => {
    const orden = ordenDelTrabajo([
      tarea({ id: 'a', estado: 'completada' }),
      tarea({ id: 'b', estado: 'en-curso' }),
      tarea({ id: 'c', dependeDe: ['a'] }),
      tarea({ id: 'd', dependeDe: ['a', 'b'] }),
    ]);
    expect(orden.map((fila) => fila.id)).toEqual(['c', 'd']);
    expect(orden[0]?.espera).toEqual([{ titulo: 'Tarea a', completada: true }]);
    expect(orden[0]?.libre).toBe(true);
    expect(orden[1]?.libre).toBe(false);
  });

  it('una dependencia que ya no está se dice sin nombre y se cuenta como pendiente', () => {
    // Prometer que está completa sin poder mirarla sería peor que decir que no se sabe.
    const orden = ordenDelTrabajo([tarea({ id: 'c', dependeDe: ['fantasma'] })]);
    expect(orden[0]?.espera).toEqual([{ titulo: 'Una tarea anterior', completada: false }]);
    expect(orden[0]?.libre).toBe(false);
  });
});

describe('la ventana de impugnación se deriva, no se escribe a mano', () => {
  const HORA = 60 * 60 * 1000;
  const NACIO = 1_700_000_000_000;

  it('calcula las horas de los dos instantes que manda el servidor', () => {
    const ventana = ventanaDeImpugnacion(NACIO, NACIO + 72 * HORA, NACIO + HORA);
    expect(ventana?.horas).toBe(72);
    expect(ventana?.vencida).toBe(false);
  });

  it('si el Instituto cambia el plazo, la pantalla dice el nuevo sin que nadie la toque', () => {
    // El número 72 no está escrito en `plan.ts` ni en las pantallas: sale de la resta.
    expect(ventanaDeImpugnacion(NACIO, NACIO + 24 * HORA, NACIO)?.horas).toBe(24);
  });

  it('sabe cuándo ya venció, con el borde incluido', () => {
    const fin = NACIO + 72 * HORA;
    expect(ventanaDeImpugnacion(NACIO, fin, fin - 1)?.vencida).toBe(false);
    expect(ventanaDeImpugnacion(NACIO, fin, fin)?.vencida).toBe(true);
  });

  it('sin fecha de ratificación no hay ventana que contar', () => {
    expect(ventanaDeImpugnacion(NACIO, undefined, NACIO)).toBeUndefined();
  });
});
