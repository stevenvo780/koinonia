/**
 * Guardián de CI de la migración 0011, la del texto de las normas.
 *
 * Esta tabla es el caso límite de la regla de tipos del ledger: la columna `body` **es** la
 * preimagen de la clave primaria. No hace falta base de datos para comprobar que el DDL no
 * reintroduce un tipo que normalice —se lee el texto de la migración—, y ésa es la razón de que el
 * guardián exista: la regla se comprueba en CI, no en revisión de código, porque leyéndolo no se
 * vio la primera vez (la propia especificación violaba su regla en cinco columnas).
 */

import { loadMigrations } from '@koinonia/api';
import { describe, expect, it } from 'vitest';

const migration = (await loadMigrations()).find((item) => item.id === '0011');
if (migration === undefined) throw new Error('falta la migración 0011 de la constitución');
const ddl = migration.sql;

/** El DDL sin comentarios: la migración explica en prosa justo lo que prohíbe. */
const sentencias = ddl
  .split('\n')
  .map((linea) => {
    const corte = linea.indexOf('--');
    return corte === -1 ? linea : linea.slice(0, corte);
  })
  .join('\n');

/** El cuerpo del `CREATE TABLE`, que es donde viven los tipos que importan. */
function tabla(): string {
  const inicio = sentencias.indexOf('CREATE TABLE governance.clause_text (');
  expect(inicio, 'no se encontró el DDL de governance.clause_text').toBeGreaterThan(-1);
  return sentencias.slice(inicio, sentencias.indexOf('\n);', inicio));
}

describe('migración 0011: el texto de las normas', () => {
  it('la clave primaria ES la huella, con CHECK anclado de 64 hexadecimales', () => {
    // Sin el CHECK, `char(64)` rellenaría con espacios y la preimagen dejaría de cuadrar. Con él,
    // un valor más corto ni entra: el operador `~` recorta el relleno y el patrón no casa.
    expect(tabla()).toContain('text_hash   char(64)');
    expect(tabla()).toContain("text_hash ~ '^[0-9a-f]{64}$'");
    expect(tabla()).toContain('PRIMARY KEY');
  });

  it('el título y el cuerpo son `text`: nada normaliza la preimagen', () => {
    expect(tabla()).toMatch(/title\s+text\s+NOT NULL/u);
    expect(tabla()).toMatch(/body\s+text\s+NOT NULL/u);
  });

  it('ningún tipo proscrito toca la preimagen', () => {
    const cuerpo = tabla();
    // `uuid` reescribe la forma, `numeric` normaliza los ceros a la derecha y `jsonb` reordena las
    // claves y ni siquiera es inyectivo. `timestamptz` sólo se admite fuera de la preimagen.
    expect(cuerpo).not.toMatch(/\buuid\b/iu);
    expect(cuerpo).not.toMatch(/\bjsonb?\b/iu);
    expect(cuerpo).not.toMatch(/\bnumeric\b/iu);
    const conTimestamp = cuerpo
      .split('\n')
      .filter((linea) => /\btimestamptz?\b/u.test(linea))
      .map((linea) => linea.trim());
    // La única fecha es `recorded_at`, que es sobre y no preimagen.
    expect(conTimestamp.every((linea) => linea.startsWith('recorded_at'))).toBe(true);
  });

  it('el título no admite saltos de línea: sin eso la preimagen no sería inyectiva', () => {
    // («a\n\nb», «c») y («a», «b\n\nc») producirían el mismo texto que se hashea, y una huella que
    // vale para dos textos distintos no identifica ninguno. Es el mismo defecto por el que `jsonb`
    // está proscrito en el ledger.
    expect(tabla()).toContain("title !~ '[\\n\\r]'");
  });

  it('la tabla no guarda una segunda copia de la etiqueta de la cláusula', () => {
    // La correspondencia cláusula → huella vive SÓLO en el historial. Una copia aquí sería una
    // segunda fuente no autoritativa del mismo hecho, y dos fuentes pueden discrepar.
    expect(tabla()).not.toMatch(/\bclause_id\b/u);
  });

  it('el texto de una norma es inmutable y el trigger dispara siempre', () => {
    expect(sentencias).toContain('BEFORE UPDATE OR DELETE ON governance.clause_text');
    expect(sentencias).toContain('BEFORE TRUNCATE ON governance.clause_text');
    // `session_replication_role = 'replica'` desactiva los triggers ORIGIN en una línea.
    expect(sentencias).toContain('ENABLE ALWAYS TRIGGER trg_clause_text_immutable');
    expect(sentencias).toContain('ENABLE ALWAYS TRIGGER trg_clause_text_no_truncate');
    // La RULE que §4.2 proponía convierte el fallo ruidoso en un no-op mudo. No se reintroduce.
    expect(sentencias).not.toMatch(/DO\s+INSTEAD\s+NOTHING/iu);
  });

  it('la aplicación no es dueña de la tabla y sólo puede leer y añadir', () => {
    // Si fuera dueña podría `ALTER TABLE … DISABLE TRIGGER` sin ser superusuario.
    expect(sentencias).toContain('ALTER TABLE governance.clause_text OWNER TO koinonia_ddl');
    expect(sentencias).toContain('GRANT SELECT, INSERT ON governance.clause_text TO koinonia_app');
    expect(sentencias).not.toMatch(/GRANT[^;]*UPDATE[^;]*governance\.clause_text/iu);
    expect(sentencias).not.toMatch(/GRANT[^;]*DELETE[^;]*governance\.clause_text/iu);
    expect(sentencias).toContain('REVOKE ALL ON governance.clause_text FROM PUBLIC');
  });
});
