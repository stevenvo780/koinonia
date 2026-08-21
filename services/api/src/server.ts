/**
 * Arranque del servidor. Es el único punto del repositorio que lee variables de entorno.
 *
 * Todo lo demás recibe sus dependencias por parámetro, que es lo que hace posible que las pruebas de
 * integración levanten la aplicación entera contra un PostgreSQL real sin tocar un fichero de
 * configuración ni una variable global.
 *
 * Este módulo **exporta** `main` y no la ejecuta. Quien la ejecuta es `bin.ts`, que es un fichero
 * aparte con una sola línea. La primera versión llevaba aquí mismo un
 * `if (import.meta.url.endsWith('server.js')) main()`, que parece un guardián de «¿me han lanzado
 * directamente?» y **no lo es**: se cumple también cuando alguien importa el paquete, porque el
 * módulo compilado se llama `server.js` siempre. El síntoma fue que arrancar las pruebas de extremo
 * a extremo levantaba un servidor contra la base de producción por el mero hecho de importar
 * `@koinonia/api`. Una librería no tiene efectos al importarse; si los tiene, no es una librería.
 */

import { createPool } from './db/client.js';
import { migrate } from './db/migrate.js';
import { ensureSpine } from './ledger/event-store.js';
import { buildApp } from './http/app.js';
import { consoleMailer, cryptoRandom, systemClock, udeaIdentityAdapter } from './http/adapters.js';

function lista(nombre: string): readonly string[] {
  const valor = process.env[nombre];
  if (valor === undefined || valor.trim() === '') return [];
  return valor
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

export async function main(): Promise<void> {
  const url =
    process.env['DATABASE_URL'] ?? 'postgresql://postgres:koinonia@localhost:55432/koinonia';
  const puerto = Number.parseInt(process.env['PORT'] ?? '3001', 10);
  const modoDesarrollo = process.env['NODE_ENV'] !== 'production';

  const pepper = process.env['KOINONIA_RATE_PEPPER'];
  if (pepper === undefined || pepper.length < 16) {
    if (!modoDesarrollo) {
      // En producción no hay pimienta por defecto. Una pimienta conocida es una pimienta que no
      // protege, y el contador de abuso volvería a ser un registro de quién intentó qué.
      throw new Error(
        'KOINONIA_RATE_PEPPER es obligatoria en producción y debe tener al menos 16 caracteres',
      );
    }
  }

  const pool = createPool({ connectionString: url, applicationName: 'koinonia-api' });
  await migrate(pool);
  await ensureSpine(pool, {
    occurredAt: new Date(systemClock.now()).toISOString(),
    payload: { vigencia: '2026_2', instituto: 'filosofia_udea' },
    requestId: '00000000-0000-4000-8000-000000000001',
  });

  const app = await buildApp({
    pool,
    ports: {
      clock: systemClock,
      random: cryptoRandom,
      mailer: consoleMailer,
      identity: udeaIdentityAdapter({
        facilitadores: lista('KOINONIA_FACILITADORES'),
        garantias: lista('KOINONIA_GARANTIAS'),
      }),
    },
    ratePepper: pepper ?? 'pimienta-de-desarrollo-no-usar-en-produccion',
    webBaseUrl: process.env['KOINONIA_WEB_URL'] ?? 'http://localhost:3000',
    modoDesarrollo,
  });

  await app.listen({ port: puerto, host: '0.0.0.0' });
  process.stdout.write(`Koinonía escuchando en http://localhost:${String(puerto)}\n`);
}
