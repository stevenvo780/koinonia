import { loadMigrations } from '@koinonia/api';
import { describe, expect, it } from 'vitest';

const migration = (await loadMigrations()).find((item) => item.id === '0008');
if (migration === undefined) throw new Error('falta la migración 0008 de capacidad privada');
const ddl = migration.sql;
const statements = ddl
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

describe('migración de capacidad privada', () => {
  it('ata DSK y capacidad a identity.member con borrado en cascada', () => {
    expect(ddl).toContain('CREATE TABLE identity.subject_data_key');
    expect(ddl).toContain('CREATE TABLE identity.contribution_capacity');
    expect(ddl.match(/REFERENCES identity\.member\(member_id\) ON DELETE CASCADE/gu)).toHaveLength(
      2,
    );
    expect(ddl).toMatch(/key_ref\s+char\(32\) NOT NULL UNIQUE/u);
    expect(ddl).toContain('REFERENCES identity.subject_data_key(key_ref) ON DELETE CASCADE');
  });

  it('impone longitudes GCM y revisiones positivas en PostgreSQL', () => {
    expect(ddl).toContain('octet_length(wrap_nonce) = 12');
    expect(ddl).toContain('octet_length(wrapped_dek) >= 48');
    expect(ddl).toContain('octet_length(nonce) = 12');
    expect(ddl).toContain('octet_length(ciphertext) >= 16');
    expect(ddl).toContain('CHECK (revision > 0)');
    expect(ddl).toContain('CHECK (crypto_version > 0)');
  });

  it('no crea columna de minutos o JSON y declara owner y grants explícitos', () => {
    expect(statements).not.toMatch(/minutos_por_semana|jsonb?/iu);
    expect(ddl).toContain('ALTER TABLE identity.subject_data_key OWNER TO koinonia_ddl');
    expect(ddl).toContain('ALTER TABLE identity.contribution_capacity OWNER TO koinonia_ddl');
    expect(ddl).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON identity.subject_data_key TO koinonia_app',
    );
    expect(ddl).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON identity.contribution_capacity TO koinonia_app',
    );
  });
});
