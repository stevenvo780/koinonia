import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import type { FastifyInstance } from 'fastify';

/** Forma de cada entrada del catálogo tal como cruza el cable (sin `configSchema`, que no es
 * serializable — ver la prueba que lo comprueba más abajo). */
interface EntradaDeCatalogo {
  readonly id: string;
  readonly nombre: string;
  readonly descripcion: string;
  readonly formasPapeleta: readonly string[];
  readonly delegacionPermitida: boolean;
}

describe('GET /metodos', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({
      pool: {} as never,
      ports: {} as never,
      ratePepper: 'pepper-de-prueba',
      webBaseUrl: 'http://localhost:5173',
      modoDesarrollo: true,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('responde 200 con la lista de los nueve métodos', async () => {
    const res = await app.inject({ method: 'GET', url: '/metodos' });
    expect(res.statusCode).toBe(200);
    const cuerpo = res.json<EntradaDeCatalogo[]>();
    expect(cuerpo).toHaveLength(9);
  });

  it('sirve el orden pedagógico declarado en el catálogo', async () => {
    const res = await app.inject({ method: 'GET', url: '/metodos' });
    const cuerpo = res.json<EntradaDeCatalogo[]>();
    expect(cuerpo.map((m) => m.id)).toEqual([
      'simple-majority',
      'supermajority',
      'unanimity',
      'sociocratic-consent',
      'score',
      'irv',
      'majority-judgment',
      'condorcet-schulze',
      'deliberative-sortition',
    ]);
  });

  it('empaqueta nombre, descripción, papeleta y delegación por entrada', async () => {
    const res = await app.inject({ method: 'GET', url: '/metodos' });
    const cuerpo = res.json<EntradaDeCatalogo[]>();
    for (const m of cuerpo) {
      expect(typeof m.nombre).toBe('string');
      expect(m.nombre.length).toBeGreaterThan(0);
      expect(typeof m.descripcion).toBe('string');
      expect(m.descripcion.length).toBeGreaterThan(20);
      expect(Array.isArray(m.formasPapeleta)).toBe(true);
      expect(typeof m.delegacionPermitida).toBe('boolean');
    }
  });

  it('marca delegación prohibida en consentimiento y sorteo', async () => {
    const res = await app.inject({ method: 'GET', url: '/metodos' });
    const cuerpo = res.json<EntradaDeCatalogo[]>();
    const sin = cuerpo.filter((m) => !m.delegacionPermitida).map((m) => m.id);
    expect(sin).toContain('sociocratic-consent');
    expect(sin).toContain('deliberative-sortition');
  });

  it('declara no-store para impedir que un intermediario sirva una lista vieja', async () => {
    const res = await app.inject({ method: 'GET', url: '/metodos' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('no expone el esquema Zod (no es serializable)', async () => {
    const res = await app.inject({ method: 'GET', url: '/metodos' });
    const cuerpo = res.json<EntradaDeCatalogo[]>();
    for (const m of cuerpo) {
      expect(m).not.toHaveProperty('configSchema');
    }
  });

  it('usa nombres en castellano neutro', async () => {
    const res = await app.inject({ method: 'GET', url: '/metodos' });
    const cuerpo = res.json<EntradaDeCatalogo[]>();
    const porNombre = new Map(cuerpo.map((m) => [m.id, m.nombre]));
    expect(porNombre.get('simple-majority')).toBe('Mayoría simple');
    // «Supermayoría» normaliza a un término prohibido (ADR-0041): el catálogo usa la traducción
    // oficial del glosario, «mayoría reforzada».
    expect(porNombre.get('supermajority')).toBe('Mayoría reforzada');
    expect(porNombre.get('unanimity')).toBe('Unanimidad');
    expect(porNombre.get('sociocratic-consent')).toBe('Acuerdo interno');
    expect(porNombre.get('score')).toBe('Puntuación');
    expect(porNombre.get('irv')).toBe('Voto por rondas');
    expect(porNombre.get('majority-judgment')).toBe('Valoración por menciones');
    expect(porNombre.get('condorcet-schulze')).toBe('Comparación por pares');
    expect(porNombre.get('deliberative-sortition')).toBe('Deliberación aleatoria');
  });
});
