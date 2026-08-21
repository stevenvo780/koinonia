/**
 * Guardián de CI de la regla de tipos del ledger (§1.1-bis, corolario 4).
 *
 * > «Se verifica en CI, no en revisión de código.»
 *
 * No hace falta base de datos: se analiza el texto del DDL. La razón de que este test exista es
 * histórica y concreta —la propia especificación violaba su regla en cinco columnas y nadie lo vio
 * leyendo; lo vio quien la implementó—, así que la siguiente columna que alguien añada tampoco se
 * revisa a ojo. Si el guardián estorba, es que está haciendo su trabajo.
 */

import { describe, expect, it } from 'vitest';

import { loadMigrations } from '../src/db/migrate.js';

const migraciones = await loadMigrations();

/** Columnas de `governance.event` que entran en la preimagen del `event_hash` (§1.1). */
const COLUMNAS_DE_PREIMAGEN = [
  'aggregate_id',
  'aggregate_type',
  'seq',
  'event_type',
  'event_version',
  'occurred_at',
  'actor',
  'payload',
] as const;

/** Tipos cuya representación NO se normaliza al ir y volver. */
const TIPOS_PERMITIDOS = /^(char\(\d+\)|text|bytea|bigint|integer|boolean)(\s|,|$)/u;

/** Los cuatro proscritos, con el motivo por el que lo están. */
const TIPOS_PROHIBIDOS: readonly (readonly [RegExp, string])[] = [
  [/\buuid\b/u, 'uuid reescribe la forma: devuelve siempre 36 caracteres con guiones'],
  [
    /\bjsonb?\b/u,
    'jsonb reordena las claves y no guarda el texto: destruye la canonicalización JCS',
  ],
  [/\btimestamptz?\b/u, 'timestamptz normaliza la zona y trunca los ceros de los milisegundos'],
  [/\bnumeric\b/u, 'numeric normaliza los ceros a la derecha'],
];

function ddlDeEvento(): string {
  const sql = migraciones.map((m) => m.sql).join('\n');
  const inicio = sql.indexOf('CREATE TABLE governance.event (');
  expect(inicio, 'no se encontró el DDL de governance.event').toBeGreaterThan(-1);
  const fin = sql.indexOf('\n);', inicio);
  return sql.slice(inicio, fin);
}

/** Quita comentarios `--`: el DDL los usa para explicar precisamente qué está prohibido. */
function sinComentarios(sql: string): string {
  return sql
    .split('\n')
    .map((linea) => {
      const corte = linea.indexOf('--');
      return corte === -1 ? linea : linea.slice(0, corte);
    })
    .join('\n');
}

describe('migraciones', () => {
  it('están numeradas, sin repetidos y en orden total', () => {
    expect(migraciones.length).toBeGreaterThanOrEqual(4);
    const ids = migraciones.map((m) => m.id);
    expect(ids).toStrictEqual([...ids].sort());
    expect(new Set(ids).size).toBe(ids.length);
    for (const migracion of migraciones) {
      expect(migracion.id).toMatch(/^\d{4}$/u);
      expect(migracion.sha256).toMatch(/^[0-9a-f]{64}$/u);
    }
  });

  it('cada migración lleva su hash de contenido: editar una aplicada deja de ser invisible', () => {
    const hashes = migraciones.map((m) => m.sha256);
    expect(new Set(hashes).size).toBe(hashes.length);
  });
});

describe('regla de tipos del ledger, aplicada por CI sobre el DDL', () => {
  const ddl = sinComentarios(ddlDeEvento());

  it.each(COLUMNAS_DE_PREIMAGEN)(
    'governance.event.%s usa un tipo que no normaliza su representación',
    (columna) => {
      const linea = ddl
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.startsWith(`${columna} `));
      expect(linea, `no se encontró la columna ${columna}`).toBeDefined();
      const tipo = (linea ?? '').slice(columna.length).trim();
      expect(tipo).toMatch(TIPOS_PERMITIDOS);
      for (const [prohibido, motivo] of TIPOS_PROHIBIDOS) {
        expect(prohibido.test(tipo.split('CHECK')[0] ?? tipo), `${columna}: ${motivo}`).toBe(false);
      }
    },
  );

  it('los identificadores llevan CHECK anclado: sin él, `char(n)` rellenaría con espacios', () => {
    for (const columna of ['aggregate_id', 'actor']) {
      const linea = ddl
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.startsWith(`${columna} `));
      expect(linea).toContain("~ '^[0-9a-f]{32}$'");
    }
  });

  it('`occurred_at` fija el formato RFC 3339 de 24 caracteres, milisegundos incluidos', () => {
    expect(ddl).toContain(String.raw`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`);
  });

  it('la única columna jsonb de `event` es la derivada, y lleva el sufijo `_idx`', () => {
    const jsonbLines = ddl
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /\bjsonb\b/u.test(l));
    expect(jsonbLines).toHaveLength(1);
    expect(jsonbLines[0]).toMatch(/^payload_idx\s+jsonb\s+GENERATED ALWAYS AS/u);
  });

  it('`request_id` y `recorded_at` SÍ pueden ser uuid y timestamptz: son sobre, no preimagen', () => {
    // La regla es sobre participar del hash, no una fobia a los tipos ricos de PostgreSQL.
    expect(ddl).toMatch(/request_id\s+uuid/u);
    expect(ddl).toMatch(/recorded_at\s+timestamptz/u);
  });

  it('el índice global NO es una secuencia: `bigserial` está prohibido (§3.2)', () => {
    const todo = sinComentarios(migraciones.map((m) => m.sql).join('\n'));
    expect(todo).not.toMatch(/\bbigserial\b/iu);
    expect(todo).not.toMatch(/\bserial\b/iu);
    expect(todo).not.toMatch(/GENERATED\s+(ALWAYS|BY DEFAULT)\s+AS\s+IDENTITY/iu);
    expect(todo).toContain('CREATE TABLE governance.ledger_cursor');
  });

  it('el blindaje append-only no reintroduce la RULE que anula el trigger (§4.2)', () => {
    const todo = sinComentarios(migraciones.map((m) => m.sql).join('\n'));
    // `ON DELETE … DO INSTEAD NOTHING` convierte el fallo ruidoso del trigger en un no-op mudo.
    expect(todo).not.toMatch(/DO\s+INSTEAD\s+NOTHING/iu);
    expect(todo).toContain('ENABLE ALWAYS TRIGGER trg_event_append_only');
    expect(todo).toContain('BEFORE TRUNCATE ON governance.event');
  });

  it('la aplicación no recibe UPDATE ni DELETE sobre governance.event (§4.1)', () => {
    const todo = sinComentarios(migraciones.map((m) => m.sql).join('\n'));
    const grants = todo
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('GRANT') && l.includes('governance.event'));
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatch(/^GRANT SELECT, INSERT ON governance\.event\s+TO koinonia_app;/u);
  });
});
