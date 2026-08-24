import { describe, expect, it } from 'vitest';

import type { PgClient } from '../src/db/client.js';
import { ESQUEMA_DE_TRABAJOS_SQL, otorgarPrivilegiosDeTrabajos } from '../src/jobs/esquema.js';

/** Doble mínimo de `PgClient`: sólo hace falta capturar el texto de cada sentencia. */
function clienteQueGraba(sentencias: string[]): PgClient {
  return {
    query: (texto: string) => {
      sentencias.push(texto);
      return Promise.resolve({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });
    },
  };
}

describe('esquema de jobs.job', () => {
  it('crea el esquema y la tabla de forma idempotente (IF NOT EXISTS en todo)', () => {
    expect(ESQUEMA_DE_TRABAJOS_SQL).toContain('CREATE SCHEMA IF NOT EXISTS jobs');
    expect(ESQUEMA_DE_TRABAJOS_SQL).toContain('CREATE TABLE IF NOT EXISTS jobs.job');
    expect(ESQUEMA_DE_TRABAJOS_SQL).toContain('CREATE INDEX IF NOT EXISTS job_pendientes_idx');
    expect(ESQUEMA_DE_TRABAJOS_SQL).toContain('CREATE INDEX IF NOT EXISTS job_en_curso_idx');
  });

  it('deja koinonia_app fuera de la propiedad de la tabla — sólo koinonia_ddl es dueño', () => {
    expect(ESQUEMA_DE_TRABAJOS_SQL).toContain('ALTER TABLE jobs.job OWNER TO koinonia_ddl');
    expect(ESQUEMA_DE_TRABAJOS_SQL).toContain('REVOKE ALL ON jobs.job FROM PUBLIC');
    expect(ESQUEMA_DE_TRABAJOS_SQL).not.toMatch(/OWNER TO koinonia_app/u);
  });

  it('restringe status a los cuatro valores del ciclo de vida, ni uno más', () => {
    expect(ESQUEMA_DE_TRABAJOS_SQL).toContain(
      "CHECK (status IN ('pendiente', 'en_curso', 'hecho', 'fallido'))",
    );
  });

  it('la clave de idempotencia es UNIQUE pero admite null (varias filas sin ella)', () => {
    expect(ESQUEMA_DE_TRABAJOS_SQL).toContain('idempotency_key text UNIQUE');
    expect(ESQUEMA_DE_TRABAJOS_SQL).not.toContain('idempotency_key text UNIQUE NOT NULL');
  });

  it('otorgarPrivilegiosDeTrabajos rechaza un nombre de rol que no sea un identificador simple', async () => {
    const sentencias: string[] = [];
    await expect(
      otorgarPrivilegiosDeTrabajos(clienteQueGraba(sentencias), 'koinonia_app; DROP TABLE x; --'),
    ).rejects.toThrow(TypeError);
    expect(sentencias).toEqual([]); // nunca llegó a ejecutar SQL con un rol sin validar
  });

  it('otorgarPrivilegiosDeTrabajos concede exactamente SELECT/INSERT/UPDATE/DELETE sobre jobs.job', async () => {
    const sentencias: string[] = [];
    await otorgarPrivilegiosDeTrabajos(clienteQueGraba(sentencias), 'koinonia_app');
    expect(sentencias).toEqual([
      'GRANT USAGE ON SCHEMA jobs TO koinonia_app',
      'GRANT SELECT, INSERT, UPDATE, DELETE ON jobs.job TO koinonia_app',
      'GRANT USAGE, SELECT ON SEQUENCE jobs.job_id_seq TO koinonia_app',
    ]);
  });
});
