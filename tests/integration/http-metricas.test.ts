/**
 * `GET /metricas/salud` y `GET /metricas/acuerdos/serie` contra un Fastify real.
 *
 * La ruta bajo prueba vive en un `FastifyInstance` propio, separado de la app real: es exactamente
 * la situación en la que va a estar hasta que un agente integrador llame a
 * `registrarRutasDeMetricas` desde `services/api/src/http/app.ts` (fuera de mi ámbito en este
 * encargo — ver `services/api/src/http/rutas-metricas.ts`). No hace falta PostgreSQL: ninguna de las
 * cinco proyecciones que `ContextoMetricas` pide (acuerdos, aportes de habla, padrón, deliberaciones,
 * votaciones) existe todavía como lectura real, así que el contexto de esta prueba es un objeto en
 * memoria con datos fijos — el mismo papel que cumplirán, más adelante, las consultas reales.
 *
 * Lo que sí es real de punta a punta: Fastify, la validación Zod de la consulta, las cinco funciones
 * de `@koinonia/metrics` y la traducción a DTO de `packages/contracts/src/metricas.ts`. Si algo de
 * esa cadena se rompe, se rompe aquí.
 *
 * Lo que estas pruebas demuestran:
 *  - el panel completo valida contra su propio esquema y no lleva ningún `bigint` (la respuesta pasa
 *    por JSON de verdad, vía `.inject()`, no por un objeto en memoria);
 *  - el k-anonimato de `@koinonia/metrics` atraviesa intacto hasta la respuesta HTTP: un estrato de
 *    3 personas llega como `{ publicado: false }`, no como un hueco silencioso ni como el dato;
 *  - la razón deliberación/votación se transporta como razón, nunca como porcentaje;
 *  - la serie de acuerdos respeta `puntos` (con su valor por defecto), va de la ventana más vieja a
 *    la más nueva y cada ventana es exactamente 30 días;
 *  - ninguna palabra de la respuesta usa la jerga que ADR-0041 prohíbe en pantalla;
 *  - ninguna de las dos rutas exige sesión.
 */

import { forbiddenTermsIn } from '@koinonia/contracts';
import {
  identidadMiembro,
  VENTANA_DE_30_DIAS_MS,
  type AcuerdoProyectado,
  type Aporte,
  type Estratos,
  type MiembroDelPadron,
  type Ventana,
} from '@koinonia/metrics';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Ruta relativa, no `@koinonia/contracts`: ver la nota de cabecera de `rutas-metricas.ts` sobre por
// qué `packages/contracts/src/index.ts` (fuera de mi ámbito en este encargo) no reexporta esto todavía.
import {
  informeSalud,
  serieDeAcuerdos,
  type InformeSalud,
  type SerieDeAcuerdos,
} from '../../packages/contracts/src/metricas.js';
// Idem: `registrarRutasDeMetricas` es nuevo y todavía no lo llama `app.ts` (fuera de mi ámbito).
import {
  generarVentanas,
  registrarRutasDeMetricas,
  type ContextoMetricas,
} from '../../services/api/src/http/rutas-metricas.js';

const DIA = 24 * 60 * 60 * 1000;
const AHORA = 1_767_225_600_000; // 2026-01-01T00:00:00Z, fijo: nada de esto lee el reloj real.
const DOS_SEMESTRES = 2 * 180 * DIA;

function persona(n: number): ReturnType<typeof identidadMiembro> {
  return identidadMiembro(`p#${n.toString().padStart(4, '0')}`);
}

/** Dos acuerdos por ventana, anclados a `ventana.desde` para que el filtro por vencimiento los tome
 * sin importar qué ventana pida la ruta: uno cumplido a tiempo, otro que queda en deuda. */
function acuerdosFixture(ventana: Ventana): AcuerdoProyectado[] {
  const vencimiento = ventana.desde + 5 * DIA;
  return [
    {
      circulo: 'secretaría',
      tipo: 'redacción',
      acordadoEn: ventana.desde,
      vencimiento,
      cerradoEn: vencimiento - DIA,
      relojDetenido: false,
    },
    {
      circulo: 'secretaría',
      tipo: 'convocatoria',
      acordadoEn: ventana.desde,
      vencimiento,
      cerradoEn: null,
      relojDetenido: false,
    },
  ];
}

function aportesFixture(cuantos: number, ventana: Ventana): Aporte[] {
  const salida: Aporte[] = [];
  for (let i = 0; i < cuantos; i += 1) {
    salida.push({ autor: persona(i), instante: ventana.desde + i });
  }
  return salida;
}

function estratos(semestre: string, jornada: string): Estratos {
  return { semestre, jornada, nivel: 'pregrado', participacionPrevia: 'sí' };
}

/** 43 personas en un estrato grande y 3 en uno chico — el caso que motiva este encargo entero. */
function padronFixture(): MiembroDelPadron[] {
  const chico = [0, 1, 2].map((n) => ({
    miembro: persona(n),
    estratos: estratos('10', 'nocturna'),
  }));
  const grande = Array.from({ length: 43 }, (_v, i) => ({
    miembro: persona(i + 3),
    estratos: estratos('1', 'diurna'),
  }));
  return [...chico, ...grande];
}

function contextoDePrueba(): ContextoMetricas {
  return {
    clock: { now: () => AHORA },
    leerEntradaAcuerdos: (ventana, instante) =>
      Promise.resolve({
        ventana,
        instante,
        acuerdos: acuerdosFixture(ventana),
        circulos: [{ circulo: 'secretaría', personas: 40 }],
        prescripcionMs: DOS_SEMESTRES,
      }),
    leerEntradaVoz: (ventana) =>
      Promise.resolve({ ventana, aportes: aportesFixture(15, ventana), censo: 300 }),
    leerEntradaCobertura: (ventana) =>
      Promise.resolve({
        ventana,
        padron: padronFixture(),
        actos: [{ miembro: persona(0), instante: ventana.desde + DIA }],
      }),
    leerEntradaRotacion: (periodoAnterior, periodoActual) =>
      Promise.resolve({
        periodoAnterior,
        periodoActual,
        aportesAnteriores: aportesFixture(20, periodoAnterior),
        aportesActuales: aportesFixture(20, periodoActual),
      }),
    leerEntradaDeliberacion: (ventana) =>
      Promise.resolve({
        ventana,
        deliberaciones: [
          { instante: ventana.desde + DIA, intervenciones: 5 },
          { instante: ventana.desde + 2 * DIA, intervenciones: 3 },
        ],
        votaciones: [
          { instante: ventana.desde + 3 * DIA, unanime: false, conDeliberacionPrevia: true },
        ],
      }),
  };
}

describe('GET /metricas/salud y GET /metricas/acuerdos/serie', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    registrarRutasDeMetricas(app, contextoDePrueba());
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('el panel completo valida contra su esquema y no exige sesión', async () => {
    const response = await app.inject({ method: 'GET', url: '/metricas/salud' });
    expect(response.statusCode, response.body).toBe(200);
    const body: InformeSalud = informeSalud.parse(response.json());
    expect(body.acuerdos.total.cumplidos).toBe(1);
    expect(body.acuerdos.total.deuda).toBe(1);
  });

  it('un estrato de 3 personas llega como retenido, no como el dato ni como un hueco', async () => {
    const response = await app.inject({ method: 'GET', url: '/metricas/salud' });
    const body: InformeSalud = informeSalud.parse(response.json());
    const celda = body.cobertura.porEje.find((c) => c.eje === 'semestre' && c.valor === '10');
    expect(celda).toBeDefined();
    expect(celda?.desglose).toEqual({ publicado: false });
    expect(body.cobertura.celdasNoPublicadas).toBeGreaterThan(0);
  });

  it('con 15 personas hablando, el reparto se publica pero "quien más habló" se retiene', async () => {
    const response = await app.inject({ method: 'GET', url: '/metricas/salud' });
    const body: InformeSalud = informeSalud.parse(response.json());
    expect(body.voz.reparto).toMatchObject({ publicado: true });
    if (body.voz.reparto.publicado) {
      expect(body.voz.reparto.valor.mayorParticipacion).toEqual({ publicado: false });
    }
  });

  it('la razón deliberación/votación viaja como razón, no como porcentaje', async () => {
    const response = await app.inject({ method: 'GET', url: '/metricas/salud' });
    const body: InformeSalud = informeSalud.parse(response.json());
    expect(body.deliberacion.razon).toEqual({
      hay: true,
      numerador: 2,
      denominador: 1,
      texto: '2,0',
    });
  });

  it('ninguna palabra de la respuesta usa la jerga que ADR-0041 prohíbe', async () => {
    const response = await app.inject({ method: 'GET', url: '/metricas/salud' });
    expect(forbiddenTermsIn(response.body)).toEqual([]);
  });

  it('la serie por defecto trae 12 puntos de 30 días, del más viejo al más nuevo', async () => {
    const response = await app.inject({ method: 'GET', url: '/metricas/acuerdos/serie' });
    expect(response.statusCode, response.body).toBe(200);
    const body: SerieDeAcuerdos = serieDeAcuerdos.parse(response.json());
    expect(body.puntos).toHaveLength(12);
    expect(body.duracionDePuntoMs).toBe(VENTANA_DE_30_DIAS_MS);
    expect(body.generadaEn).toBe(AHORA);
    const ultimo = body.puntos.at(-1);
    expect(ultimo?.ventana.hasta).toBe(AHORA);
    for (let i = 1; i < body.puntos.length; i += 1) {
      expect(body.puntos[i]?.ventana.desde).toBeGreaterThan(
        body.puntos[i - 1]?.ventana.desde ?? -1,
      );
    }
  });

  it('"puntos" en la consulta cambia cuántos puntos trae la serie', async () => {
    const response = await app.inject({ method: 'GET', url: '/metricas/acuerdos/serie?puntos=3' });
    expect(response.statusCode, response.body).toBe(200);
    const body: SerieDeAcuerdos = serieDeAcuerdos.parse(response.json());
    expect(body.puntos).toHaveLength(3);
  });

  it('"puntos" fuera de rango se rechaza (0 y más de 52)', async () => {
    const bajo = await app.inject({ method: 'GET', url: '/metricas/acuerdos/serie?puntos=0' });
    const alto = await app.inject({ method: 'GET', url: '/metricas/acuerdos/serie?puntos=53' });
    expect(bajo.statusCode).toBeGreaterThanOrEqual(400);
    expect(alto.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('un parámetro de más en /metricas/salud se rechaza', async () => {
    const response = await app.inject({ method: 'GET', url: '/metricas/salud?estrato=nocturna' });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe('generarVentanas', () => {
  it('produce ventanas contiguas, sin huecos ni solapes, terminando en "hasta"', () => {
    const ventanas = generarVentanas(AHORA, VENTANA_DE_30_DIAS_MS, 4);
    expect(ventanas).toHaveLength(4);
    expect(ventanas.at(-1)?.hasta).toBe(AHORA);
    for (let i = 1; i < ventanas.length; i += 1) {
      expect(ventanas[i]?.desde).toBe(ventanas[i - 1]?.hasta);
    }
    for (const v of ventanas) expect(v.hasta - v.desde).toBe(VENTANA_DE_30_DIAS_MS);
  });
});
