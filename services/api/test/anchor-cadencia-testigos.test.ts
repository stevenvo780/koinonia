import { describe, expect, it } from 'vitest';

import type { AnchorProvider } from '@koinonia/anchor';

import type { ConfiguracionDeAnclaje } from '../src/anchor/index.js';
import { crearTareaDeAnclaje } from '../src/anchor/tarea.js';
import type { PgPool } from '../src/db/client.js';

/**
 * A un testigo de carne y hueso no se le escribe cada hora.
 *
 * ═══ Qué se rompía, y por qué importa más de lo que parece ═══
 *
 * El corte de checkpoint es horario y TODOS los proveedores corrían en cada corte. Para el anclaje
 * por correo eso son **veinticuatro correos al día a cada testigo**, y cada uno no es un aviso: es
 * una petición de trabajo —dos órdenes en la consola y una respuesta firmada—.
 *
 * Nadie acepta eso. Y ésa era, en realidad, la razón por la que el padrón de testigos seguía vacío y
 * el anclaje no llegaba al quórum de dos clases distintas: no faltaba gente dispuesta, sobraba lo
 * que se le pedía. La pantalla de arquitectura decía «falta gente, no programa», y era verdad a
 * medias — faltaba gente porque el programa pedía algo inaceptable.
 *
 * ═══ Por qué espaciarlo no debilita nada ═══
 *
 * Los checkpoints encadenan: quien firma el de hoy atestigua también todo lo anterior. Lo que cambia
 * es cuán reciente es la última constancia firme, que es exactamente la salvedad que el verificador
 * ya dice en voz alta («lo ocurrido desde el último anclaje firme podría alterarse»). Un día de
 * ventana a cambio de que la clase exista es un trato bueno. Veinticuatro correos diarios a cambio
 * de una clase que nadie sostiene, no.
 *
 * ═══ Y por qué al MADURAR sí entran siempre ═══
 *
 * Es la mitad que podría hacer daño de verdad. Madurar es recoger los acuses que los testigos ya
 * mandaron; si el freno se aplicara también ahí, un acuse llegado dentro de la ventana no se
 * recogería nunca y el anclaje se quedaría en «pendiente» para siempre — el fallo callado, otra vez.
 *
 * Comprobado rompiéndolo: quitando el `if (!nuevoCorte) return todos;` de `proveedores`, el tercer
 * caso falla porque la maduración deja de preguntarle al proveedor de correo. Restaurado.
 */

/** Base de mentira que contesta lo que se le diga sobre el último envío a testigos. */
function baseCon(ultimoEnvio: string | null): {
  readonly pool: PgPool;
  readonly consultas: string[];
} {
  const consultas: string[] = [];
  const responder = (text: string): Promise<{ rows: unknown[]; rowCount: number }> => {
    consultas.push(text);
    if (text.includes('human-witness')) {
      return Promise.resolve({ rows: [{ cuando: ultimoEnvio }], rowCount: 1 });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  };
  const client = { query: responder, release: () => undefined };
  const pool = { connect: () => Promise.resolve(client), query: responder };
  return { pool: pool as unknown as PgPool, consultas };
}

const AHORA = '2026-08-30T12:00:00.000Z';

/** Un testigo de mentira que sólo apunta si le preguntaron. */
function testigoFalso(visto: string[]): AnchorProvider {
  return {
    meta: {
      id: 'testigo_de_prueba',
      independenceClass: 'human-witness',
      trustAssumption: 'de mentira',
      verificationNeedsNetwork: false,
      signingKeyOffHost: true,
    },
    submit: () => {
      visto.push('submit');
      return Promise.resolve(undefined);
    },
    poll: () => {
      visto.push('poll');
      return Promise.resolve(undefined);
    },
  } as unknown as AnchorProvider;
}

function tareaCon(ultimoEnvio: string | null, visto: string[]) {
  const { pool } = baseCon(ultimoEnvio);
  const config = {
    activo: true,
    checkpointCadaMs: 0,
    pollCadaMs: 60 * 60 * 1000,
    pendientesQueSeSiguen: 24,
    calendarios: [],
    motivosDeAusencia: [],
    bloquesUrl: 'https://bloques.invalid',
    correoCadaMs: 24 * 60 * 60 * 1000,
  } as unknown as ConfiguracionDeAnclaje;
  return crearTareaDeAnclaje({
    pool,
    config,
    ahora: () => AHORA,
    diario: () => undefined,
    providers: [testigoFalso(visto)],
  });
}

describe('cada cuánto se le pide firma a un testigo', () => {
  it('con un envío de hace una hora, un corte nuevo NO vuelve a escribirle', async () => {
    const visto: string[] = [];
    const tarea = tareaCon('2026-08-30T11:00:00.000Z', visto);

    // Un corte con la base vacía no llega a anclar nada; lo que se mide es a QUIÉN se le habría
    // preguntado, y para eso alcanza con que el proveedor no aparezca entre los activos.
    const activos = await tarea.proveedoresDeCorte();
    expect(activos.map((p: AnchorProvider) => p.meta.independenceClass)).not.toContain(
      'human-witness',
    );
  });

  it('pasado el día, vuelve a entrar', async () => {
    const visto: string[] = [];
    const tarea = tareaCon('2026-08-29T11:00:00.000Z', visto);
    const activos = await tarea.proveedoresDeCorte();
    expect(activos.map((p: AnchorProvider) => p.meta.independenceClass)).toContain('human-witness');
  });

  it('sin ningún envío previo entra a la primera: el freno no puede impedir que empiece', async () => {
    const visto: string[] = [];
    const tarea = tareaCon(null, visto);
    const activos = await tarea.proveedoresDeCorte();
    expect(activos.map((p: AnchorProvider) => p.meta.independenceClass)).toContain('human-witness');
  });

  it('al MADURAR entra siempre, aunque se le acabe de escribir', async () => {
    // La mitad que podría hacer daño: sin esto, un acuse que llega dentro de la ventana no se
    // recogería nunca y el anclaje se quedaría en «pendiente» para siempre.
    const visto: string[] = [];
    const tarea = tareaCon('2026-08-30T11:59:00.000Z', visto);
    const activos = await tarea.proveedoresDeMaduracion();
    expect(activos.map((p: AnchorProvider) => p.meta.independenceClass)).toContain('human-witness');
  });
});
