import { loadMigrations } from '@koinonia/api';
import { describe, expect, it } from 'vitest';

const migration = (await loadMigrations()).find((item) => item.id === '0010');
if (migration === undefined) throw new Error('falta la migración 0010 de material privado');
const ddl = migration.sql;
const statements = ddl
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

describe('migración de material privado', () => {
  it('guarda sólo coordenadas opacas y un ciphertext ligado a la DSK del dueño', () => {
    expect(ddl).toContain('CREATE TABLE identity.private_material');
    expect(ddl).toContain('REFERENCES identity.member(member_id) ON DELETE CASCADE');
    expect(ddl).toContain('REFERENCES identity.subject_data_key(key_ref) ON DELETE CASCADE');
    expect(ddl).toContain('FOREIGN KEY (owner_id, key_ref)');
    expect(ddl).toContain(
      'REFERENCES identity.subject_data_key(member_id, key_ref) ON DELETE CASCADE',
    );
    expect(ddl).toContain('octet_length(nonce) = 12');
    expect(ddl).toContain('octet_length(ciphertext) = 131088');
  });

  it('cierra purpose y no crea columnas de apertura, índice de contenido o metadatos de archivo', () => {
    for (const purpose of [
      'task-block-detail',
      'task-help-detail',
      'task-evidence-object',
      'task-delivery-summary',
      'task-change-detail',
    ]) {
      expect(ddl).toContain(`'${purpose}'`);
    }
    expect(statements).not.toMatch(
      /commitment|nonce128|context|content|url|mime|file_name|exact_size|digest|jsonb?/iu,
    );
  });

  it('declara owner, revoca PUBLIC y concede sólo el acceso mutable de la bóveda', () => {
    expect(ddl).toContain('REVOKE ALL ON identity.private_material FROM PUBLIC');
    expect(ddl).toContain('ALTER TABLE identity.private_material OWNER TO koinonia_ddl');
    expect(ddl).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON identity.private_material TO koinonia_app',
    );
  });
});
