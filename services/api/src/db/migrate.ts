/**
 * Runner de migraciones mínimo: SQL plano, numerado, aplicado en orden y dentro de una transacción.
 *
 * Nada de ORM. La razón está en el ADR-0002 y en la regla de tipos del ledger: un generador de
 * esquema decide por su cuenta los tipos de las columnas —`uuid` para lo que parece un
 * identificador, `jsonb` para lo que parece JSON, `timestamptz` para lo que parece una fecha—, que
 * son exactamente las tres decisiones que destruirían la verificación. Aquí el DDL es un artefacto
 * revisable línea por línea, y esa revisión es parte de la garantía.
 *
 * El runner registra el **hash del contenido** de cada migración aplicada. Editar un fichero ya
 * aplicado deja de ser un cambio invisible: la siguiente ejecución lo denuncia. En un proyecto cuya
 * promesa es «nada se altera sin que se detecte», el esquema no puede ser la excepción.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PgClient, PgPool } from './client.js';

const MIGRATION_FILE = /^(\d{4})_[a-z0-9_]+\.sql$/u;

export interface Migration {
  readonly id: string;
  readonly name: string;
  readonly sql: string;
  readonly sha256: string;
}

export interface MigrationOutcome {
  readonly applied: readonly string[];
  readonly alreadyApplied: readonly string[];
}

/** Directorio `migrations/` de este paquete, resuelto desde el propio módulo. */
export function defaultMigrationsDir(): string {
  return fileURLToPath(new URL('../../migrations/', import.meta.url));
}

export async function loadMigrations(dir = defaultMigrationsDir()): Promise<readonly Migration[]> {
  const entries = await readdir(dir);
  const files = entries.filter((name) => MIGRATION_FILE.test(name)).sort();

  const seen = new Set<string>();
  const migrations: Migration[] = [];
  for (const file of files) {
    const id = MIGRATION_FILE.exec(file)?.[1];
    if (id === undefined) continue;
    if (seen.has(id)) {
      throw new Error(`migraciones con el mismo número: ${id}. El orden dejaría de ser total.`);
    }
    seen.add(id);
    const sql = await readFile(path.join(dir, file), 'utf8');
    migrations.push({
      id,
      name: file,
      sql,
      sha256: createHash('sha256').update(sql, 'utf8').digest('hex'),
    });
  }
  if (migrations.length === 0) throw new Error(`no hay migraciones en ${dir}`);
  return migrations;
}

const META_DDL = `
  CREATE SCHEMA IF NOT EXISTS koinonia_meta;
  CREATE TABLE IF NOT EXISTS koinonia_meta.migration (
    id         text        NOT NULL PRIMARY KEY,
    name       text        NOT NULL,
    sha256     char(64)    NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
  );
`;

interface MigrationRow {
  readonly id: string;
  readonly name: string;
  readonly sha256: string;
}

/**
 * Aplica lo que falte. Cada migración va en su propia transacción: si la 0003 falla, la 0001 y la
 * 0002 quedan aplicadas y registradas, y el diagnóstico es «falló la 0003», no «falló algo».
 */
export async function migrate(
  pool: PgPool,
  dir = defaultMigrationsDir(),
): Promise<MigrationOutcome> {
  const migrations = await loadMigrations(dir);
  const client = await pool.connect();
  try {
    await client.query(META_DDL);
    const { rows } = await client.query<MigrationRow>(
      'SELECT id, name, sha256 FROM koinonia_meta.migration',
    );
    const applied = new Map(rows.map((row) => [row.id, row]));

    for (const migration of migrations) {
      const previous = applied.get(migration.id);
      if (previous !== undefined && previous.sha256 !== migration.sha256) {
        throw new Error(
          `la migración ${migration.name} cambió después de aplicarse ` +
            `(registrado ${previous.sha256.slice(0, 12)}…, en disco ${migration.sha256.slice(0, 12)}…). ` +
            'Una migración aplicada es historia: se corrige con una migración nueva.',
        );
      }
    }

    const done: string[] = [];
    const skipped: string[] = [];
    for (const migration of migrations) {
      if (applied.has(migration.id)) {
        skipped.push(migration.name);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO koinonia_meta.migration (id, name, sha256) VALUES ($1, $2, $3)',
          [migration.id, migration.name, migration.sha256],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(
          `migración ${migration.name} fallida: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
      done.push(migration.name);
    }
    return { applied: done, alreadyApplied: skipped };
  } finally {
    client.release();
  }
}

/** ¿El esquema del ledger está presente y al día? Para `/salud`. */
export async function pendingMigrations(
  client: PgClient,
  dir = defaultMigrationsDir(),
): Promise<readonly string[]> {
  const migrations = await loadMigrations(dir);
  const exists = await client.query<{ present: boolean }>(
    "SELECT to_regclass('koinonia_meta.migration') IS NOT NULL AS present",
  );
  if (exists.rows[0]?.present !== true) return migrations.map((m) => m.name);
  const { rows } = await client.query<{ id: string }>('SELECT id FROM koinonia_meta.migration');
  const applied = new Set(rows.map((row) => row.id));
  return migrations.filter((m) => !applied.has(m.id)).map((m) => m.name);
}
