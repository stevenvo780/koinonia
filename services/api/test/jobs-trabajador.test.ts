/**
 * Pruebas del trabajador con una cola falsa en memoria — sin PostgreSQL.
 *
 * La cola falsa reimplementa el mismo CASE de `fallar()` y el mismo filtro de `reclamar()` que
 * `cola.ts` hace en SQL, así que estas pruebas ejercen la lógica del trabajador (reintentos,
 * backoff, el barrido de expirados, el manejador que falta) de forma determinista y rápida. Lo que
 * SÍ necesita PostgreSQL real — que `SKIP LOCKED` reparta trabajos entre dos reclamos concurrentes
 * sin duplicar ninguno — está en `tests/integration/cola-de-trabajos.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';

import type {
  ColaDeTrabajos,
  ConteoPorEstado,
  EstadoDeTrabajo,
  NuevoTrabajo,
  OpcionesDeReclamo,
  ResultadoDeFallo,
  TrabajoEncolado,
  TrabajoReclamado,
} from '../src/jobs/cola.js';
import { crearTrabajadorDeTrabajos } from '../src/jobs/trabajador.js';

interface FilaFalsa {
  id: string;
  tipo: string;
  datos: unknown;
  estado: EstadoDeTrabajo;
  runAt: string;
  intentos: number;
  intentosMaximos: number;
  creadoEn: string;
  lockedAt?: string | undefined;
  ultimoError?: string;
}

export interface ColaFalsa extends ColaDeTrabajos {
  readonly filas: Map<string, FilaFalsa>;
}

/**
 * Cola en memoria que reproduce el mismo contrato que la implementación de PostgreSQL.
 *
 * Fábrica que devuelve un objeto plano, NO una clase: varias pruebas de abajo hacen
 * `{ ...colaFalsa(), metodo: espía }` para espiar o romper un solo método a propósito, y un
 * `spread` sobre una instancia de clase sólo copiaría sus propiedades propias — perdería en
 * silencio los métodos, que viven en el prototipo. Con un objeto literal cada método es una
 * propiedad propia y el `spread` los copia todos tal cual.
 */
function colaFalsa(): ColaFalsa {
  const filas = new Map<string, FilaFalsa>();
  let siguienteId = 1;

  // Ningún método de abajo tiene un `await` real (el `Map` es síncrono): son `Promise.resolve(...)`
  // en vez de `async`, la misma convención que `tests/integration/http-asistente.test.ts` — el tipo
  // `Promise<T>` que exige `ColaDeTrabajos` sin fingir una asincronía que no existe.
  return {
    filas,

    encolar(trabajo: NuevoTrabajo): Promise<TrabajoEncolado> {
      const id = String(siguienteId++);
      filas.set(id, {
        id,
        tipo: trabajo.tipo,
        datos: trabajo.datos ?? {},
        estado: 'pendiente',
        runAt: trabajo.ejecutarEn,
        intentos: 0,
        intentosMaximos: trabajo.intentosMaximos ?? 5,
        creadoEn: trabajo.ejecutarEn,
      });
      return Promise.resolve({ id, yaExistia: false });
    },

    reclamar(opciones: OpcionesDeReclamo): Promise<readonly TrabajoReclamado[]> {
      const candidatos = [...filas.values()]
        .filter((f) => f.estado === 'pendiente')
        .filter((f) => f.runAt <= opciones.ahora)
        .filter((f) => opciones.tipos === undefined || opciones.tipos.includes(f.tipo))
        .sort((a, b) => a.runAt.localeCompare(b.runAt) || a.id.localeCompare(b.id))
        .slice(0, opciones.maximo ?? 10);

      for (const fila of candidatos) {
        fila.estado = 'en_curso';
        fila.lockedAt = opciones.ahora;
      }
      return Promise.resolve(
        candidatos.map((f) => ({
          id: f.id,
          tipo: f.tipo,
          datos: f.datos,
          intentos: f.intentos,
          intentosMaximos: f.intentosMaximos,
          creadoEn: f.creadoEn,
        })),
      );
    },

    completar(id: string, _ahora: string): Promise<void> {
      const fila = filas.get(id);
      if (fila === undefined) throw new Error(`completar: no existe ${id}`);
      fila.estado = 'hecho';
      fila.lockedAt = undefined;
      return Promise.resolve();
    },

    fallar(id: string, resultado: ResultadoDeFallo): Promise<void> {
      const fila = filas.get(id);
      if (fila === undefined) throw new Error(`fallar: no existe ${id}`);
      fila.intentos += 1;
      fila.ultimoError = resultado.error;
      const puedeReintentar =
        fila.intentos < fila.intentosMaximos && resultado.reintentarEn !== undefined;
      if (puedeReintentar) {
        fila.estado = 'pendiente';
        fila.runAt = resultado.reintentarEn ?? fila.runAt;
        fila.lockedAt = undefined;
      } else {
        fila.estado = 'fallido';
      }
      return Promise.resolve();
    },

    liberarExpirados(limite: string, _ahora: string): Promise<readonly string[]> {
      const liberadas: string[] = [];
      for (const fila of filas.values()) {
        if (fila.estado === 'en_curso' && fila.lockedAt !== undefined && fila.lockedAt < limite) {
          fila.estado = 'pendiente';
          fila.lockedAt = undefined;
          liberadas.push(fila.id);
        }
      }
      return Promise.resolve(liberadas);
    },

    contarPorEstado(): Promise<ConteoPorEstado> {
      const conteo: Record<EstadoDeTrabajo, number> = {
        pendiente: 0,
        en_curso: 0,
        hecho: 0,
        fallido: 0,
      };
      for (const fila of filas.values()) conteo[fila.estado]++;
      return Promise.resolve(conteo);
    },

    purgarTerminados(limite: string): Promise<number> {
      let borrados = 0;
      for (const [id, fila] of filas) {
        if ((fila.estado === 'hecho' || fila.estado === 'fallido') && fila.creadoEn < limite) {
          filas.delete(id);
          borrados++;
        }
      }
      return Promise.resolve(borrados);
    },
  };
}

const T0 = '2026-08-23T10:00:00.000Z';

function relojFijo(instante: string): () => string {
  return () => instante;
}

describe('crearTrabajadorDeTrabajos — cicloUnaVez', () => {
  it('reclama un trabajo pendiente, lo procesa y lo marca hecho', async () => {
    const cola = colaFalsa();
    await cola.encolar({ tipo: 'saludo', ejecutarEn: T0 });

    const procesados: unknown[] = [];
    const trabajador = crearTrabajadorDeTrabajos({
      cola,
      ahora: relojFijo(T0),
      manejadores: {
        saludo: (t) => {
          procesados.push(t.datos);
          return Promise.resolve();
        },
      },
      diario: () => undefined,
    });

    const resultado = await trabajador.cicloUnaVez();
    expect(resultado).toEqual({ reclamados: 1, completados: 1, fallidos: 0, liberados: 0 });
    expect(cola.filas.get('1')?.estado).toBe('hecho');
  });

  it('no reclama un trabajo cuyo run_at todavía no llegó', async () => {
    const cola = colaFalsa();
    await cola.encolar({ tipo: 'saludo', ejecutarEn: '2026-08-23T12:00:00.000Z' });

    const trabajador = crearTrabajadorDeTrabajos({
      cola,
      ahora: relojFijo(T0), // antes de las 12:00
      manejadores: { saludo: () => Promise.resolve() },
      diario: () => undefined,
    });

    const resultado = await trabajador.cicloUnaVez();
    expect(resultado).toEqual({ reclamados: 0, completados: 0, fallidos: 0, liberados: 0 });
  });

  it('si el manejador lanza, el trabajo vuelve a pendiente con backoff si quedan intentos', async () => {
    const cola = colaFalsa();
    await cola.encolar({ tipo: 'falla-siempre', ejecutarEn: T0, intentosMaximos: 3 });

    const trabajador = crearTrabajadorDeTrabajos({
      cola,
      ahora: relojFijo(T0),
      manejadores: {
        'falla-siempre': () => {
          throw new Error('esto siempre revienta');
        },
      },
      diario: () => undefined,
    });

    const resultado = await trabajador.cicloUnaVez();
    expect(resultado).toEqual({ reclamados: 1, completados: 0, fallidos: 1, liberados: 0 });

    const fila = cola.filas.get('1');
    expect(fila?.estado).toBe('pendiente'); // quedaban intentos: 1 de 3 usado
    expect(fila?.intentos).toBe(1);
    expect(fila?.ultimoError).toContain('esto siempre revienta');
    // Backoff exponencial por defecto: 2^1 s = 2000 ms tras el instante del fallo.
    expect(Date.parse(fila?.runAt ?? '')).toBe(Date.parse(T0) + 2000);
  });

  it('agotados los intentos, el trabajo queda fallido en firme y ya no se reclama', async () => {
    const cola = colaFalsa();
    await cola.encolar({ tipo: 'falla-siempre', ejecutarEn: T0, intentosMaximos: 1 });

    const trabajador = crearTrabajadorDeTrabajos({
      cola,
      ahora: relojFijo(T0),
      manejadores: {
        'falla-siempre': () => {
          throw new Error('sin remedio');
        },
      },
      diario: () => undefined,
    });

    await trabajador.cicloUnaVez();
    expect(cola.filas.get('1')?.estado).toBe('fallido');

    // Un segundo ciclo, incluso mucho después, no vuelve a reclamarlo.
    const trabajadorMasTarde = crearTrabajadorDeTrabajos({
      cola,
      ahora: relojFijo('2027-01-01T00:00:00.000Z'),
      manejadores: { 'falla-siempre': () => Promise.resolve() },
      diario: () => undefined,
    });
    const resultado = await trabajadorMasTarde.cicloUnaVez();
    expect(resultado?.reclamados).toBe(0);
  });

  it('libera trabajos en_curso abandonados más viejos que el plazo, antes de reclamar', async () => {
    const cola = colaFalsa();
    await cola.encolar({ tipo: 'x', ejecutarEn: T0 });
    // Simula que otro trabajador (que ya no existe) lo tomó hace mucho y nunca reportó nada.
    await cola.reclamar({ trabajador: 'trabajador-muerto', ahora: T0, tipos: ['x'] });
    expect(cola.filas.get('1')?.estado).toBe('en_curso');

    const muchoMasTarde = new Date(Date.parse(T0) + 10 * 60_000).toISOString(); // 10 min después
    const procesados: string[] = [];
    const trabajador = crearTrabajadorDeTrabajos({
      cola,
      ahora: relojFijo(muchoMasTarde),
      manejadores: {
        x: (t) => {
          procesados.push(t.id);
          return Promise.resolve();
        },
      },
      tiempoMaximoDeBloqueoMs: 5 * 60_000, // 5 min: el abandono de arriba ya lo supera
      diario: () => undefined,
    });

    const resultado = await trabajador.cicloUnaVez();
    expect(resultado?.liberados).toEqual(1);
    // Liberado Y reclamado en el mismo ciclo: el barrido corre antes que el reclamo.
    expect(resultado?.reclamados).toBe(1);
    expect(procesados).toEqual(['1']);
  });

  it('un trabajo de un tipo sin manejador registrado se marca fallido, no se reintenta a ciegas', async () => {
    const cola = colaFalsa();
    await cola.encolar({ tipo: 'huerfano', ejecutarEn: T0 });
    // Fuerza que `reclamar` devuelva el huérfano igual, simulando la carrera que el comentario de
    // `trabajador.ts` describe: otro proceso registró menos manejadores que los tipos en la cola.
    const colaConFuga: ColaDeTrabajos = {
      ...cola,
      reclamar: () => cola.reclamar({ trabajador: 'x', ahora: T0 }),
    };

    const trabajador = crearTrabajadorDeTrabajos({
      cola: colaConFuga,
      ahora: relojFijo(T0),
      manejadores: { 'lo-unico-registrado': () => Promise.resolve() },
      diario: () => undefined,
    });

    const resultado = await trabajador.cicloUnaVez();
    expect(resultado?.fallidos).toBe(1);
    expect(cola.filas.get('1')?.estado).toBe('fallido');
    expect(cola.filas.get('1')?.ultimoError).toContain('sin manejador');
  });

  it('un error de infraestructura en el ciclo se registra en el diario y no revienta a quien llama', async () => {
    const cola = colaFalsa();
    const colaRota: ColaDeTrabajos = {
      ...cola,
      liberarExpirados: () => {
        throw new Error('la base no responde');
      },
    };
    const lineas: string[] = [];
    const trabajador = crearTrabajadorDeTrabajos({
      cola: colaRota,
      ahora: relojFijo(T0),
      manejadores: { x: () => Promise.resolve() },
      diario: (linea) => lineas.push(linea),
    });

    await expect(trabajador.cicloUnaVez()).resolves.toBeUndefined();
    expect(lineas.some((l) => l.includes('la base no responde'))).toBe(true);
  });

  it('sin ningún manejador registrado, el ciclo no intenta reclamar nada', async () => {
    const cola = colaFalsa();
    await cola.encolar({ tipo: 'lo-que-sea', ejecutarEn: T0 });
    const trabajador = crearTrabajadorDeTrabajos({
      cola,
      ahora: relojFijo(T0),
      manejadores: {},
      diario: () => undefined,
    });
    const resultado = await trabajador.cicloUnaVez();
    expect(resultado).toEqual({ reclamados: 0, completados: 0, fallidos: 0, liberados: 0 });
  });
});

describe('crearTrabajadorDeTrabajos — arrancar/detener', () => {
  it('arrancar programa ciclos periódicos; detener los para; arrancar dos veces no duplica', async () => {
    vi.useFakeTimers();
    try {
      const cola = colaFalsa();
      const llamadas: string[] = [];
      const colaEspiada: ColaDeTrabajos = {
        ...cola,
        reclamar: (o) => {
          llamadas.push('reclamar');
          return cola.reclamar(o);
        },
      };
      const trabajador = crearTrabajadorDeTrabajos({
        cola: colaEspiada,
        ahora: relojFijo(T0),
        manejadores: { x: () => Promise.resolve() },
        intervaloMs: 1000,
        diario: () => undefined,
      });

      trabajador.arrancar();
      trabajador.arrancar(); // idempotente: si esto creara un segundo temporizador, se vería abajo

      await vi.advanceTimersByTimeAsync(1000);
      await trabajador.reposo();
      // Exactamente UN ciclo por cada 1000 ms transcurridos: si `arrancar()` hubiera duplicado el
      // temporizador, este tick habría producido dos llamadas a `reclamar`, no una.
      expect(llamadas).toEqual(['reclamar']);

      await vi.advanceTimersByTimeAsync(1000);
      await trabajador.reposo();
      expect(llamadas).toEqual(['reclamar', 'reclamar']);

      trabajador.detener();
      await vi.advanceTimersByTimeAsync(5000);
      await trabajador.reposo();
      // Nada nuevo tras `detener()`: el temporizador se apagó de verdad, no siguió en segundo plano.
      expect(llamadas).toEqual(['reclamar', 'reclamar']);
    } finally {
      vi.useRealTimers();
    }
  });
});
