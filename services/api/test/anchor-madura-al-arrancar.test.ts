import { describe, expect, it } from 'vitest';

import { crearTareaDeAnclaje } from '../src/anchor/tarea.js';
import type { ConfiguracionDeAnclaje } from '../src/anchor/index.js';
import type { PgPool } from '../src/db/client.js';

/**
 * Que un despliegue no deje el anclaje dormido una hora.
 *
 * ═══ Qué se rompía ═══
 *
 * `arrancar()` sólo programaba dos temporizadores. El reloj se reiniciaba en cada reinicio, así que
 * después de cada despliegue no pasaba **nada** durante sesenta minutos. Se vio el 2026-08-26 al
 * desplegar un arreglo del verificador de anclajes y no poder comprobar si servía hasta la vuelta
 * siguiente; y con despliegues seguidos —una tarde de trabajo, por ejemplo— el anclaje podría no
 * llegar a correr nunca.
 *
 * ═══ Qué se comprueba, y qué NO ═══
 *
 * Que al arrancar corra una pasada de **maduración**, que vuelve a consultar y verificar recibos ya
 * enviados: es idempotente y no crea nada.
 *
 * Y, con el mismo peso, que **no** corte un checkpoint nuevo al arrancar. Ésa es la mitad que
 * podría hacer daño: un contenedor que se reinicia en bucle emitiría un checkpoint por reinicio.
 *
 * Comprobado rompiéndolo: sin el `enCola(madurarPendientes)` de `arrancar()`, el primer caso falla
 * porque no se registra ninguna maduración; cambiándolo por `cortarYAnclar`, falla el segundo.
 */

/** Base que contesta «no hay nada»: alcanza, porque lo que se mide es que se PREGUNTE. */
function baseVacia(): { readonly pool: PgPool; readonly consultas: string[] } {
  const consultas: string[] = [];
  const client = {
    query: (text: string) => {
      consultas.push(text);
      return Promise.resolve({ rows: [], rowCount: 0 });
    },
    release: () => undefined,
  };
  const pool = {
    connect: () => Promise.resolve(client),
    query: (text: string) => {
      consultas.push(text);
      return Promise.resolve({ rows: [], rowCount: 0 });
    },
  };
  return { pool: pool as unknown as PgPool, consultas };
}

function tareaDePrueba(): {
  readonly diario: string[];
  readonly consultas: string[];
  readonly tarea: ReturnType<typeof crearTareaDeAnclaje>;
} {
  const diario: string[] = [];
  const { pool, consultas } = baseVacia();
  const config = {
    activo: true,
    // Cero apaga el corte periódico; la maduración no depende de este número.
    checkpointCadaMs: 0,
    pollCadaMs: 60 * 60 * 1000,
    pendientesQueSeSiguen: 24,
    calendarios: [],
    motivosDeAusencia: [],
    bloquesUrl: 'https://bloques.invalid',
  } as unknown as ConfiguracionDeAnclaje;
  const tarea = crearTareaDeAnclaje({
    pool,
    config,
    ahora: () => '2026-08-26T03:00:00.000Z',
    diario: (linea: string) => diario.push(linea),
    providers: [],
  });
  return { diario, consultas, tarea };
}

describe('el anclaje al arrancar', () => {
  it('madura los pendientes de entrada, sin esperar a la vuelta siguiente', async () => {
    const { diario, tarea } = tareaDePrueba();
    tarea.arrancar();
    await tarea.reposo();
    tarea.detener();

    // Con la base vacía, madurar dice exactamente esto. Que aparezca prueba que se preguntó.
    expect(diario.join(' | ')).toContain('no hay checkpoints pendientes de madurar');
  });

  it('y NO emite un checkpoint nuevo, que es lo que un reinicio en bucle multiplicaría', async () => {
    const { consultas, tarea } = tareaDePrueba();
    tarea.arrancar();
    await tarea.reposo();
    tarea.detener();

    // Cortar escribe en `governance.checkpoint`; madurar sólo lo lee.
    const escrituras = consultas.filter((sql) =>
      /INSERT\s+INTO\s+governance\.checkpoint/iu.test(sql),
    );
    expect(escrituras).toEqual([]);
  });
});
