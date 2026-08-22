/**
 * Constructores y arbitrarios compartidos por las pruebas.
 *
 * Todo instante es un número explícito: aquí tampoco se lee el reloj, y una prueba que dependiera
 * de la fecha en que se ejecuta sería exactamente el tipo de prueba que un día falla sola.
 */

import fc from 'fast-check';

import { identidadMiembro, type Aporte, type Ventana } from '../src/index.js';
import type {
  AcuerdoProyectado,
  ActoSignificativo,
  EntradaAcuerdos,
  EntradaCobertura,
  EntradaDeliberacion,
  EntradaRotacion,
  EntradaSalud,
  EntradaVoz,
  Estratos,
  MiembroDelPadron,
} from '../src/index.js';

/** Un día en milisegundos. El origen es arbitrario y fijo: 2026-01-01T00:00:00Z. */
export const DIA = 24 * 60 * 60 * 1000;
export const ORIGEN = 1_767_225_600_000;

export const VENTANA: Ventana = { desde: ORIGEN, hasta: ORIGEN + 30 * DIA };
export const VENTANA_ANTERIOR: Ventana = { desde: ORIGEN - 30 * DIA, hasta: ORIGEN };
/** Dos semestres, la prescripción del ADR-0040. */
export const DOS_SEMESTRES = 365 * DIA;

/**
 * Las identidades llevan un prefijo que ninguna etiqueta de estrato usa.
 *
 * Es deliberado: la comprobación de fuga busca por subcadena, y si una etiqueta de jornada se
 * llamara igual que una persona la prueba fallaría por una colisión inventada por la propia prueba
 * y no por un fallo real del paquete.
 */
export function persona(n: number): ReturnType<typeof identidadMiembro> {
  return identidadMiembro(`p#${n.toString().padStart(4, '0')}`);
}

export function estratos(
  semestre: string,
  jornada: string,
  nivel = 'pregrado',
  participacionPrevia = 'sí',
): Estratos {
  return { semestre, jornada, nivel, participacionPrevia };
}

export function miembro(n: number, e: Estratos): MiembroDelPadron {
  return { miembro: persona(n), estratos: e };
}

export function acto(n: number, instante: number): ActoSignificativo {
  return { miembro: persona(n), instante };
}

export function aporte(n: number, instante: number): Aporte {
  return { autor: persona(n), instante };
}

/** `veces` aportes de la persona `n`, repartidos por días dentro de la ventana. */
export function aportes(n: number, veces: number, ventana: Ventana = VENTANA): Aporte[] {
  const salida: Aporte[] = [];
  for (let i = 0; i < veces; i += 1) {
    salida.push(aporte(n, ventana.desde + (i % 30) * DIA + 1000));
  }
  return salida;
}

export function acuerdo(parcial: Partial<AcuerdoProyectado> = {}): AcuerdoProyectado {
  return {
    circulo: 'secretaría',
    tipo: 'redacción',
    acordadoEn: ORIGEN + DIA,
    vencimiento: ORIGEN + 10 * DIA,
    cerradoEn: null,
    relojDetenido: false,
    ...parcial,
  };
}

export function entradaAcuerdos(
  lista: readonly AcuerdoProyectado[],
  circulos: readonly { circulo: string; personas: number }[] = [
    { circulo: 'secretaría', personas: 40 },
  ],
  instante = ORIGEN + 20 * DIA,
): EntradaAcuerdos {
  return {
    ventana: VENTANA,
    instante,
    acuerdos: lista,
    circulos,
    prescripcionMs: DOS_SEMESTRES,
  };
}

export function entradaVoz(lista: readonly Aporte[], censo = 300): EntradaVoz {
  return { ventana: VENTANA, aportes: lista, censo };
}

export function entradaCobertura(
  padron: readonly MiembroDelPadron[],
  actos: readonly ActoSignificativo[],
): EntradaCobertura {
  return { ventana: VENTANA, padron, actos };
}

export function entradaRotacion(
  anteriores: readonly Aporte[],
  actuales: readonly Aporte[],
): EntradaRotacion {
  return {
    periodoAnterior: VENTANA_ANTERIOR,
    periodoActual: VENTANA,
    aportesAnteriores: anteriores,
    aportesActuales: actuales,
  };
}

export function entradaDeliberacion(
  deliberaciones: readonly { instante: number; intervenciones: number }[],
  votaciones: readonly { instante: number; unanime: boolean; conDeliberacionPrevia: boolean }[],
): EntradaDeliberacion {
  return { ventana: VENTANA, deliberaciones, votaciones };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Arbitrarios
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** La semilla es fija (`30_000_821`, la del dominio): un contraejemplo se reproduce mañana. */
export const FC = { numRuns: 300, seed: 30_000_821, verbose: 0 } as const;

export const arbPersona = fc.integer({ min: 0, max: 79 }).map(persona);

export const arbInstante = fc
  .integer({ min: -5, max: 35 })
  .map((d) => ORIGEN + d * DIA + 3 * 60 * 60 * 1000);

export const arbAporte: fc.Arbitrary<Aporte> = fc
  .record({ autor: arbPersona, instante: arbInstante })
  .map(({ autor, instante }) => ({ autor, instante }));

export const arbEstratos: fc.Arbitrary<Estratos> = fc.record({
  semestre: fc.constantFrom('e#1', 'e#3', 'e#5', 'e#7', 'e#9'),
  jornada: fc.constantFrom('e#diurna', 'e#nocturna'),
  nivel: fc.constantFrom('e#pregrado', 'e#posgrado'),
  participacionPrevia: fc.constantFrom('e#sí', 'e#no'),
});

/** Un padrón sin personas repetidas: la métrica lo exige y un duplicado contaría doble. */
export const arbPadron: fc.Arbitrary<readonly MiembroDelPadron[]> = fc
  .uniqueArray(fc.record({ n: fc.integer({ min: 0, max: 79 }), e: arbEstratos }), {
    minLength: 0,
    maxLength: 80,
    selector: (x) => x.n,
  })
  .map((xs) => xs.map(({ n, e }) => miembro(n, e)));

export const arbAcuerdo: fc.Arbitrary<AcuerdoProyectado> = fc
  .record({
    circulo: fc.constantFrom('c#secretaría', 'c#comunicación', 'c#finanzas'),
    tipo: fc.constantFrom('t#redacción', 't#convocatoria', 't#gestión'),
    acordadoEn: arbInstante,
    vencimiento: arbInstante,
    cerrado: fc.option(arbInstante, { nil: null }),
    relojDetenido: fc.boolean(),
  })
  .map(({ circulo, tipo, acordadoEn, vencimiento, cerrado, relojDetenido }) => ({
    circulo,
    tipo,
    acordadoEn,
    vencimiento,
    cerradoEn: cerrado,
    relojDetenido,
  }));

export const arbEntradaSalud: fc.Arbitrary<EntradaSalud> = fc
  .record({
    acuerdos: fc.array(arbAcuerdo, { maxLength: 40 }),
    aportes: fc.array(arbAporte, { maxLength: 120 }),
    anteriores: fc.array(arbAporte, { maxLength: 120 }),
    padron: arbPadron,
    actos: fc.array(fc.record({ autor: arbPersona, instante: arbInstante }), { maxLength: 120 }),
    deliberaciones: fc.array(
      fc.record({ instante: arbInstante, intervenciones: fc.integer({ min: 0, max: 30 }) }),
      { maxLength: 30 },
    ),
    votaciones: fc.array(
      fc.record({
        instante: arbInstante,
        unanime: fc.boolean(),
        conDeliberacionPrevia: fc.boolean(),
      }),
      { maxLength: 30 },
    ),
  })
  .map((r) => ({
    acuerdos: entradaAcuerdos(r.acuerdos, [
      { circulo: 'c#secretaría', personas: 40 },
      { circulo: 'c#comunicación', personas: 12 },
      { circulo: 'c#finanzas', personas: 4 },
    ]),
    voz: entradaVoz(r.aportes),
    cobertura: entradaCobertura(
      r.padron,
      r.actos.map((a) => ({ miembro: a.autor, instante: a.instante })),
    ),
    rotacion: entradaRotacion(
      r.anteriores.map((a) => ({ autor: a.autor, instante: a.instante - 30 * DIA })),
      r.aportes,
    ),
    deliberacion: entradaDeliberacion(r.deliberaciones, r.votaciones),
  }));

/** Todas las identidades que entraron, para comprobar que ninguna sale. */
export function identidadesDe(entrada: EntradaSalud): readonly string[] {
  return [
    ...entrada.voz.aportes.map((a) => a.autor),
    ...entrada.cobertura.padron.map((m) => m.miembro),
    ...entrada.cobertura.actos.map((a) => a.miembro),
    ...entrada.rotacion.aportesAnteriores.map((a) => a.autor),
    ...entrada.rotacion.aportesActuales.map((a) => a.autor),
  ];
}

/**
 * Recolecta TODAS las cadenas de una estructura, claves incluidas.
 *
 * Es una implementación independiente de la de `sellar()`, a propósito: si la prueba usara la misma
 * función que el código bajo prueba, comprobaría que el guardián se llama a sí mismo, que es la
 * forma más común de test que no prueba nada.
 */
export function cadenasDe(valor: unknown, salida: string[] = []): string[] {
  if (typeof valor === 'string') {
    salida.push(valor);
    return salida;
  }
  if (valor === null || typeof valor !== 'object') return salida;
  if (Array.isArray(valor)) {
    for (const elemento of valor as readonly unknown[]) cadenasDe(elemento, salida);
    return salida;
  }
  if (valor instanceof Map) {
    for (const [clave, contenido] of valor as ReadonlyMap<unknown, unknown>) {
      cadenasDe(clave, salida);
      cadenasDe(contenido, salida);
    }
    return salida;
  }
  if (valor instanceof Set) {
    for (const elemento of valor as ReadonlySet<unknown>) cadenasDe(elemento, salida);
    return salida;
  }
  for (const [clave, contenido] of Object.entries(valor as Record<string, unknown>)) {
    salida.push(clave);
    cadenasDe(contenido, salida);
  }
  return salida;
}

/** Baraja determinista: mezcla de Fisher-Yates con un generador congruencial sembrado. */
export function barajar<T>(lista: readonly T[], semilla: number): T[] {
  const salida = [...lista];
  let estado = semilla >>> 0;
  for (let i = salida.length - 1; i > 0; i -= 1) {
    estado = (estado * 1_664_525 + 1_013_904_223) >>> 0;
    const j = estado % (i + 1);
    const a = salida[i];
    const b = salida[j];
    if (a === undefined || b === undefined) continue;
    salida[i] = b;
    salida[j] = a;
  }
  return salida;
}
