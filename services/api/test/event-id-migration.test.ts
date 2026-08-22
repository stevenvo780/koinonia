import { loadMigrations } from '@koinonia/api';
import { describe, expect, it } from 'vitest';

const migration = (await loadMigrations()).find((item) => item.id === '0009');
if (migration === undefined) throw new Error('falta la migración 0009 de eventId global');

describe('migración de unicidad global de eventId', () => {
  it('impide repetir una identidad de evento entre agregados sin afectar hechos técnicos', () => {
    expect(migration.sql).toMatch(/CREATE UNIQUE INDEX governance_event_payload_event_id_uk/u);
    expect(migration.sql).not.toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS/u);
    expect(migration.sql).toContain("ON governance.event ((payload_idx ->> 'eventId'))");
    expect(migration.sql).toContain("WHERE payload_idx ? 'eventId'");
  });

  it('no altera payload, hash ni streams históricos', () => {
    expect(migration.sql).not.toMatch(/\bUPDATE\b|\bDELETE\b|ALTER\s+TABLE/iu);
    expect(migration.sql).not.toMatch(/event_hash|prev_hash|payload\s*=/iu);
  });
});
