import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { almacenEnDisco, ObjetoCorruptoError } from '../src/almacen/disco.js';
import { ClaveInvalidaError, type AlmacenDeObjetos } from '../src/almacen/puerto.js';

const AHORA = '2026-08-23T10:00:00.000Z';

describe('almacenEnDisco — el puerto AlmacenDeObjetos', () => {
  let directorio: string;
  let almacen: AlmacenDeObjetos;

  beforeEach(async () => {
    directorio = await mkdtemp(path.join(tmpdir(), 'koinonia-almacen-'));
    almacen = almacenEnDisco(directorio);
  });

  afterEach(async () => {
    await rm(directorio, { recursive: true, force: true });
  });

  it('guarda y devuelve exactamente los mismos bytes', async () => {
    const contenido = new Uint8Array([1, 2, 3, 4, 250, 0, 255]);
    await almacen.guardar('adjuntos/foto.png', contenido, {
      tipoDeContenido: 'image/png',
      ahora: AHORA,
    });

    const leido = await almacen.leer('adjuntos/foto.png');
    expect(leido).toBeDefined();
    expect(Array.from(leido?.contenido ?? [])).toEqual(Array.from(contenido));
  });

  it('calcula el sha256 real del contenido, no uno inventado', async () => {
    const contenido = new TextEncoder().encode('el contenido exacto');
    const { createHash } = await import('node:crypto');
    const esperado = createHash('sha256').update(contenido).digest('hex');

    const meta = await almacen.guardar('doc.txt', contenido, {
      tipoDeContenido: 'text/plain',
      ahora: AHORA,
    });

    expect(meta.sha256).toBe(esperado);
    expect(meta.tamanoBytes).toBe(contenido.byteLength);
    expect(meta.tipoDeContenido).toBe('text/plain');
    expect(meta.guardadoEn).toBe(AHORA);

    const leido = await almacen.leer('doc.txt');
    expect(leido?.meta).toEqual(meta);
  });

  it('leer una clave que nunca se guardó devuelve undefined, no lanza', async () => {
    await expect(almacen.leer('no-existe.pdf')).resolves.toBeUndefined();
  });

  it('existe distingue lo guardado de lo que no', async () => {
    await expect(almacen.existe('x')).resolves.toBe(false);
    await almacen.guardar('x', new Uint8Array([1]), { tipoDeContenido: 'a/b', ahora: AHORA });
    await expect(almacen.existe('x')).resolves.toBe(true);
  });

  it('borrar es idempotente: borrar dos veces, o algo que no existe, no falla', async () => {
    await almacen.guardar('y', new Uint8Array([1]), { tipoDeContenido: 'a/b', ahora: AHORA });
    await almacen.borrar('y');
    await expect(almacen.existe('y')).resolves.toBe(false);
    await expect(almacen.borrar('y')).resolves.toBeUndefined();
    await expect(almacen.borrar('jamas-existio')).resolves.toBeUndefined();
  });

  it('guardar dos veces la misma clave reemplaza contenido y metadatos', async () => {
    await almacen.guardar('z', new TextEncoder().encode('version 1'), {
      tipoDeContenido: 'text/plain',
      ahora: AHORA,
    });
    const segundo = await almacen.guardar('z', new TextEncoder().encode('version 2, mas larga'), {
      tipoDeContenido: 'text/plain',
      ahora: '2026-08-23T11:00:00.000Z',
    });

    const leido = await almacen.leer('z');
    expect(new TextDecoder().decode(leido?.contenido)).toBe('version 2, mas larga');
    expect(leido?.meta.sha256).toBe(segundo.sha256);
    expect(leido?.meta.guardadoEn).toBe('2026-08-23T11:00:00.000Z');
  });

  it('listar filtra por prefijo y ordena lexicográficamente, sin colar sidecars ni temporales', async () => {
    await almacen.guardar('tareas/1/evidencia.jpg', new Uint8Array([1]), {
      tipoDeContenido: 'image/jpeg',
      ahora: AHORA,
    });
    await almacen.guardar('tareas/1/otra.jpg', new Uint8Array([1]), {
      tipoDeContenido: 'image/jpeg',
      ahora: AHORA,
    });
    await almacen.guardar('tareas/2/evidencia.jpg', new Uint8Array([1]), {
      tipoDeContenido: 'image/jpeg',
      ahora: AHORA,
    });

    await expect(almacen.listar('tareas/1/')).resolves.toEqual([
      'tareas/1/evidencia.jpg',
      'tareas/1/otra.jpg',
    ]);
    await expect(almacen.listar('')).resolves.toEqual([
      'tareas/1/evidencia.jpg',
      'tareas/1/otra.jpg',
      'tareas/2/evidencia.jpg',
    ]);
  });

  it('listar sobre un almacén que nunca guardó nada devuelve vacío, no lanza', async () => {
    const vacio = almacenEnDisco(path.join(directorio, 'jamas-creado'));
    await expect(vacio.listar('')).resolves.toEqual([]);
  });

  describe('claves peligrosas: se rechazan ANTES de tocar el sistema de ficheros', () => {
    const invalidas: readonly [string, string][] = [
      ['', 'vacía'],
      ['../fuera-del-almacen', 'sube un nivel'],
      ['a/../../fuera', 'sube dos niveles desde dentro'],
      ['/absoluta', 'empieza por /'],
      ['con/barra/final/', 'termina en /'],
      [`con${String.fromCharCode(0)}nulo`, 'byte nulo'],
    ];

    for (const [clave, motivo] of invalidas) {
      it(`guardar rechaza "${clave}" (${motivo})`, async () => {
        await expect(
          almacen.guardar(clave, new Uint8Array([1]), { tipoDeContenido: 'a/b', ahora: AHORA }),
        ).rejects.toThrow(ClaveInvalidaError);
      });

      it(`leer/existe/borrar rechazan "${clave}" (${motivo}) igual que guardar`, async () => {
        await expect(almacen.leer(clave)).rejects.toThrow(ClaveInvalidaError);
        await expect(almacen.existe(clave)).rejects.toThrow(ClaveInvalidaError);
        await expect(almacen.borrar(clave)).rejects.toThrow(ClaveInvalidaError);
      });
    }

    it('un intento de escape nunca deja un fichero fuera del directorio base', async () => {
      const fueraDelBase = path.join(path.dirname(directorio), 'escape-koinonia-test.txt');
      await rm(fueraDelBase, { force: true });

      await expect(
        almacen.guardar('../escape-koinonia-test.txt', new Uint8Array([1]), {
          tipoDeContenido: 'a/b',
          ahora: AHORA,
        }),
      ).rejects.toThrow(ClaveInvalidaError);

      await expect(async () => {
        const { stat } = await import('node:fs/promises');
        await stat(fueraDelBase);
      }).rejects.toThrow();
    });
  });

  it('un objeto sin su fichero de metadatos se declara corrupto, no se adivina', async () => {
    // Se escribe el contenido saltándose el puerto — simula una escritura a medias o una
    // manipulación directa del disco, que es exactamente lo que `leer` no debe tapar.
    await writeFile(path.join(directorio, 'huerfano.bin'), new Uint8Array([9, 9, 9]));
    await expect(almacen.leer('huerfano.bin')).rejects.toThrow(ObjetoCorruptoError);
  });
});
