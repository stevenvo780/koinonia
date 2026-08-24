import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { crearAlmacen } from '../src/almacen/fabrica.js';
import { AlmacenS3NoDisponibleError } from '../src/almacen/s3.js';

describe('crearAlmacen — un único punto de entrada por configuración', () => {
  let directorio: string;

  beforeEach(async () => {
    directorio = await mkdtemp(path.join(tmpdir(), 'koinonia-almacen-fabrica-'));
  });

  afterEach(async () => {
    await rm(directorio, { recursive: true, force: true });
  });

  it("tipo 'disco' devuelve un almacén que de verdad funciona", async () => {
    const almacen = crearAlmacen({ tipo: 'disco', directorioBase: directorio });
    await almacen.guardar('a', new Uint8Array([1, 2, 3]), {
      tipoDeContenido: 'application/octet-stream',
      ahora: '2026-08-23T10:00:00.000Z',
    });
    await expect(almacen.existe('a')).resolves.toBe(true);
  });

  it(
    "tipo 's3' falla explícito y de inmediato al construirlo, en vez de fingir un almacén que " +
      'sólo revienta la primera vez que alguien lo usa — mejor descubrirlo al levantar el servidor',
    () => {
      expect(() => crearAlmacen({ tipo: 's3', bucket: 'koinonia', region: 'us-east-1' })).toThrow(
        AlmacenS3NoDisponibleError,
      );
    },
  );

  it('el mensaje del stub de S3 nombra qué instalar y qué implementar, no un TODO mudo', () => {
    expect(() => {
      throw new AlmacenS3NoDisponibleError();
    }).toThrow(/@aws-sdk\/client-s3/u);
  });
});
