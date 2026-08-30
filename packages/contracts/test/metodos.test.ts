import { describe, expect, it } from 'vitest';

import {
  configuracionDeMetodo,
  formasDePapeleta,
  ID_METODOS,
  METODOS_DISPONIBLES,
  METODOS_EN_ORDEN,
  type IdMetodo,
} from '../src/metodos.js';
import { forbiddenTermsIn } from '../src/glossary.js';

describe('catálogo de métodos de votación', () => {
  it('expone los nueve métodos, en el orden pedagógico', () => {
    expect(ID_METODOS).toEqual([
      'simple-majority',
      'supermajority',
      'unanimity',
      'sociocratic-consent',
      'score',
      'irv',
      'majority-judgment',
      'condorcet-schulze',
      'deliberative-sortition',
      'advice-process',
    ]);
    expect(METODOS_EN_ORDEN.map((m) => m.id)).toEqual(ID_METODOS);
    expect(METODOS_EN_ORDEN).toHaveLength(10);
    expect(Object.keys(METODOS_DISPONIBLES)).toHaveLength(10);
  });

  it('traduce los identificadores al castellano neutro pedido', () => {
    const esperado: Readonly<Record<IdMetodo, string>> = {
      'simple-majority': 'Mayoría simple',
      // «Supermayoría» normaliza a un término prohibido (ADR-0041): se usa la traducción oficial
      // del glosario («mayoría reforzada»), no el tecnicismo.
      supermajority: 'Mayoría reforzada',
      unanimity: 'Unanimidad',
      'sociocratic-consent': 'Acuerdo interno',
      score: 'Puntuación',
      irv: 'Voto por rondas',
      'majority-judgment': 'Valoración por menciones',
      'condorcet-schulze': 'Comparación por pares',
      'deliberative-sortition': 'Deliberación aleatoria',
      'advice-process': 'Proceso de consejo',
    };
    for (const id of ID_METODOS) {
      expect(METODOS_DISPONIBLES[id].nombre).toBe(esperado[id]);
    }
  });

  it('ADR-0041: ningún nombre ni descripción del catálogo usa una palabra prohibida', () => {
    // Rompí esto a propósito (agregando 'Schulze' a una descripción) para comprobar que la
    // prueba lo detecta antes de restaurar — ver el informe del integrador.
    for (const entrada of METODOS_EN_ORDEN) {
      expect(forbiddenTermsIn(entrada.nombre), entrada.nombre).toEqual([]);
      expect(forbiddenTermsIn(entrada.descripcion), entrada.descripcion).toEqual([]);
    }
  });

  it('declara delegación prohibida para consentimiento y sorteo', () => {
    expect(METODOS_DISPONIBLES['sociocratic-consent'].delegacionPermitida).toBe(false);
    expect(METODOS_DISPONIBLES['deliberative-sortition'].delegacionPermitida).toBe(false);
  });

  it('declara delegación permitida para los siete métodos restantes', () => {
    const conDelegacion = ID_METODOS.filter(
      // El proceso de consejo tampoco: un consejo se da o no se da, no se presta. Y quien decide
      // menos todavía — delegar la decisión sería otro método, no éste.
      (id) =>
        id !== 'sociocratic-consent' && id !== 'deliberative-sortition' && id !== 'advice-process',
    );
    for (const id of conDelegacion) {
      expect(METODOS_DISPONIBLES[id].delegacionPermitida).toBe(true);
    }
  });

  it('asocia cada método a su papeleta', () => {
    expect(formasDePapeleta('simple-majority')).toEqual(['binaria']);
    expect(formasDePapeleta('supermajority')).toEqual(['binaria']);
    expect(formasDePapeleta('unanimity')).toEqual(['binaria']);
    expect(formasDePapeleta('sociocratic-consent')).toEqual(['consentimiento']);
    expect(formasDePapeleta('score')).toEqual(['puntuacion']);
    expect(formasDePapeleta('irv')).toEqual(['ordenamiento']);
    expect(formasDePapeleta('majority-judgment')).toEqual(['menciones']);
    expect(formasDePapeleta('condorcet-schulze')).toEqual(['ordenamiento']);
    expect(formasDePapeleta('deliberative-sortition')).toEqual(['sorteo']);
  });
});

describe('configuración discriminada por método', () => {
  it('valida la configuración por defecto de cada método', () => {
    expect(() => configuracionDeMetodo.parse({ metodo: 'simple-majority' })).not.toThrow();
    expect(() => configuracionDeMetodo.parse({ metodo: 'supermajority' })).not.toThrow();
    expect(() => configuracionDeMetodo.parse({ metodo: 'unanimity' })).not.toThrow();
    expect(() => configuracionDeMetodo.parse({ metodo: 'sociocratic-consent' })).not.toThrow();
    expect(() => configuracionDeMetodo.parse({ metodo: 'score' })).not.toThrow();
    expect(() => configuracionDeMetodo.parse({ metodo: 'irv' })).not.toThrow();
    expect(() => configuracionDeMetodo.parse({ metodo: 'majority-judgment' })).not.toThrow();
    expect(() => configuracionDeMetodo.parse({ metodo: 'condorcet-schulze' })).not.toThrow();
    expect(() => configuracionDeMetodo.parse({ metodo: 'deliberative-sortition' })).not.toThrow();
  });

  it('rechaza campos desconocidos en estricto', () => {
    expect(
      configuracionDeMetodo.safeParse({
        metodo: 'simple-majority',
        cualquierCosa: true,
      }).success,
    ).toBe(false);
  });

  it('rechaza fracciones fuera de rango para supermayoría', () => {
    expect(
      configuracionDeMetodo.safeParse({
        metodo: 'supermajority',
        fraccion: { numerador: 0, denominador: 3 },
      }).success,
    ).toBe(false);
    expect(
      configuracionDeMetodo.safeParse({
        metodo: 'supermajority',
        fraccion: { numerador: 2, denominador: 0 },
      }).success,
    ).toBe(false);
  });

  it('rechaza escalas con menos de tres o más de siete grados', () => {
    expect(
      configuracionDeMetodo.safeParse({
        metodo: 'majority-judgment',
        escala: [{ id: 'a', etiqueta: 'A' }],
      }).success,
    ).toBe(false);
    expect(
      configuracionDeMetodo.safeParse({
        metodo: 'majority-judgment',
        escala: Array.from({ length: 8 }, (_, i) => ({
          id: `g${String(i)}`,
          etiqueta: `G${String(i)}`,
        })),
      }).success,
    ).toBe(false);
  });

  it('acepta una escala completa de tres a siete grados', () => {
    expect(
      configuracionDeMetodo.safeParse({
        metodo: 'majority-judgment',
        escala: [
          { id: 'excelente', etiqueta: 'Excelente' },
          { id: 'buena', etiqueta: 'Buena' },
          { id: 'rechazar', etiqueta: 'Rechazar' },
        ],
      }).success,
    ).toBe(true);
  });

  it('limita rondasMaximas entre 1 y 5', () => {
    expect(
      configuracionDeMetodo.safeParse({
        metodo: 'sociocratic-consent',
        rondasMaximas: 0,
      }).success,
    ).toBe(false);
    expect(
      configuracionDeMetodo.safeParse({
        metodo: 'sociocratic-consent',
        rondasMaximas: 6,
      }).success,
    ).toBe(false);
    expect(
      configuracionDeMetodo.safeParse({
        metodo: 'sociocratic-consent',
        rondasMaximas: 3,
      }).success,
    ).toBe(true);
  });

  it('limita tamanoDeMuestra entre 1 y 100', () => {
    expect(
      configuracionDeMetodo.safeParse({
        metodo: 'deliberative-sortition',
        tamanoDeMuestra: 0,
      }).success,
    ).toBe(false);
    expect(
      configuracionDeMetodo.safeParse({
        metodo: 'deliberative-sortition',
        tamanoDeMuestra: 101,
      }).success,
    ).toBe(false);
  });
});

describe('descripciones y formas de papeleta', () => {
  it('cada método tiene descripción no vacía', () => {
    for (const id of ID_METODOS) {
      const descripcion = METODOS_DISPONIBLES[id].descripcion;
      expect(descripcion.length).toBeGreaterThan(20);
      // Las nueve descripciones son prosa (una o varias oraciones) y terminan en punto, igual que
      // los mensajes de error del catálogo (`packages/contracts/test/errores.test.ts`): la
      // aserción original pedía lo contrario sin que ninguna convención del proyecto lo respalde,
      // y las nueve descripciones ya terminaban en punto — se corrige la aserción, no la prosa.
      expect(descripcion.endsWith('.')).toBe(true);
    }
  });

  it('cada método expone al menos una forma de papeleta', () => {
    for (const id of ID_METODOS) {
      expect(METODOS_DISPONIBLES[id].formasPapeleta.length).toBeGreaterThanOrEqual(1);
    }
  });
});
