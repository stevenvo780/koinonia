import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { empaquetarTarGz } from '../src/ledger/empaquetar.js';

/**
 * El `.tar.gz` que se escribe a mano tiene que abrirlo el `tar` de verdad.
 *
 * ═══ Por qué se comprueba contra el binario del sistema ═══
 *
 * Una prueba que empaqueta y desempaqueta con el MISMO código no prueba nada: si la suma de
 * comprobación está mal calculada, lo está en los dos sentidos y la prueba pasa igual. Lo único que
 * responde la pregunta que importa —«¿podrá abrir esto la persona que se lo descargue?»— es
 * dárselo a `tar`, que es lo que esa persona va a usar.
 *
 * La suma es exactamente donde esto se rompe: se calcula con su propio campo lleno de ESPACIOS y
 * sólo después se escribe encima. Calcularla sobre ceros da un número distinto y `tar` contesta
 * «checksum error» sin decir cuál de los ocho campos está mal.
 *
 * Comprobado rompiéndolo: quitando el `h.fill(0x20, 148, 156)` de `empaquetar.ts`, el primer caso
 * falla con «tar: Skipping to next header». Restaurado después.
 */

const RAIZ = mkdtempSync(join(tmpdir(), 'koinonia-tar-'));

afterAll(() => {
  rmSync(RAIZ, { recursive: true, force: true });
});

/** Las rutas reales del paquete verificable, incluidas las que van en subdirectorio. */
function paqueteDeMuestra(): ReadonlyMap<string, string | Uint8Array> {
  return new Map<string, string | Uint8Array>([
    ['manifest.json', '{"version":1,"algoritmos":["sha256"]}\n'],
    ['events.ndjson', '{"leafIndex":"0"}\n{"leafIndex":"1"}\n'],
    ['events.hashes.ndjson', '{"leafIndex":"0","eventHash":"aa"}\n'],
    ['heads.json', '{"#ledger":3}\n'],
    ['checkpoints.ndjson', '{"treeSize":2}\n'],
    ['proofs/consistency/1-2.json', '{"desde":1,"hasta":2}\n'],
    ['anchors/2/bitcoin.json', '{"proveedor":"opentimestamps"}\n'],
    // Un contenido binario, que es el otro tipo que `ExportBundle` admite.
    ['anchors/bitcoin-headers.json', new Uint8Array([0x7b, 0x7d, 0x0a])],
  ]);
}

describe('el paquete que se descarga lo abre el tar del sistema', () => {
  it('`tar -xzf` lo desempaqueta y devuelve cada fichero con su contenido exacto', () => {
    const tgz = empaquetarTarGz(paqueteDeMuestra(), 1_700_000_000);
    const ruta = join(RAIZ, 'export.tar.gz');
    writeFileSync(ruta, tgz);

    const destino = join(RAIZ, 'abierto');
    execFileSync('mkdir', ['-p', destino]);
    // Sin `--warning=none`: si `tar` tiene algo que decir sobre el paquete, que se vea acá.
    execFileSync('tar', ['-xzf', ruta, '-C', destino]);

    for (const [nombre, contenido] of paqueteDeMuestra()) {
      const leido = readFileSync(join(destino, nombre));
      const esperado =
        typeof contenido === 'string' ? Buffer.from(contenido, 'utf8') : Buffer.from(contenido);
      expect(leido.equals(esperado), nombre).toBe(true);
    }
  });

  it('`tar -tzf` lista exactamente los ficheros del paquete, sin colarse ninguno', () => {
    const ruta = join(RAIZ, 'listar.tar.gz');
    writeFileSync(ruta, empaquetarTarGz(paqueteDeMuestra(), 1_700_000_000));

    const listado = execFileSync('tar', ['-tzf', ruta], { encoding: 'utf8' })
      .split('\n')
      .filter((l) => l !== '');

    expect([...listado].sort()).toEqual([...paqueteDeMuestra().keys()].sort());
  });

  it('el mismo historial da el mismo byte: la huella del paquete sirve para comparar', () => {
    /*
     * Es la razón por la que `mtime` entra como dato en vez de leerse del reloj, y por la que los
     * ficheros salen ordenados por nombre en vez de por orden de inserción. Sin esto, dos personas
     * que exporten el mismo historial obtienen paquetes distintos y no pueden contrastar su `sha256`
     * —que es justamente lo que se les pide hacer cuando algo no cuadra.
     */
    const a = empaquetarTarGz(paqueteDeMuestra(), 1_700_000_000);
    const b = empaquetarTarGz(paqueteDeMuestra(), 1_700_000_000);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);

    // Y el orden en que se construyó el Map no cambia el resultado.
    const alReves = new Map([...paqueteDeMuestra()].reverse());
    const c = empaquetarTarGz(alReves, 1_700_000_000);
    expect(Buffer.from(a).equals(Buffer.from(c))).toBe(true);
  });

  it('un nombre que no cabe en la cabecera se rechaza en vez de salir cortado', () => {
    // ustar guarda el nombre en 100 bytes. Cortarlo en silencio produciría un paquete que se abre
    // pero con el fichero equivocado, que es peor que no producirlo.
    const largo = 'anchors/' + 'x'.repeat(120) + '.json';
    expect(() => empaquetarTarGz(new Map([[largo, 'a']]), 0)).toThrow(/no cabe/u);
  });
});
