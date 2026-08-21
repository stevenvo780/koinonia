/**
 * El programa de línea de órdenes: argumentos, informe en castellano y códigos de salida.
 *
 * El informe es la mitad del valor de esta herramienta. Si dijera
 * `event-hash-mismatch at leaf 8412`, la persona que tiene que decidir si convoca a la veeduría no
 * sabría qué hacer, y una herramienta que no se entiende no se usa. Estas pruebas fijan el texto,
 * no sólo el resultado.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chdir, cwd } from 'node:process';

import { canonicalize } from '@koinonia/crypto';
import {
  analizarArgumentos,
  directorySource,
  ejecutar,
  envolver,
  memorySource,
  README_VERIFICACION,
  SALIDA,
  type EntornoPrograma,
  type ExportSource,
} from '@koinonia/verificar';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  AHORA,
  anclar,
  construirLedger,
  DECISION_A,
  renderExport,
  type Ledger,
} from './fabrica.js';

const ledgerLimpio = await anclar(await construirLedger());

async function correr(
  ledger: Ledger,
  argv: readonly string[] = [],
): Promise<{ codigo: number; salida: string }> {
  const lineas: string[] = [];
  const ficheros = await renderExport(ledger);
  const entorno: EntornoPrograma = {
    escribir: (linea) => lineas.push(linea),
    abrir: (): Promise<ExportSource> =>
      Promise.resolve(memorySource('koinonia-export-2026-08-21', ficheros)),
    leerFichero: () => Promise.resolve(`${canonicalize(padronJson(ledger))}\n`),
    ahora: () => AHORA,
  };
  const resultado = await ejecutar(
    ['koinonia-export-2026-08-21', '--confianza', 'padron.json', '--ahora', AHORA, ...argv],
    entorno,
  );
  return { codigo: resultado.codigo, salida: lineas.join('\n') };
}

/** El informe ajusta a 78 columnas, así que para buscar frases hay que aplanar los saltos. */
function plano(salida: string): string {
  return salida.replace(/\s+/gu, ' ');
}

function padronJson(ledger: Ledger): Record<string, unknown> {
  return {
    forges: [...ledger.confianza.forges],
    gitSigners: ledger.confianza.gitSigners.map((f) => ({
      identity: f.identity,
      publicKey: f.publicKey,
    })),
    gitSigningKeyOffHost: ledger.confianza.gitSigningKeyOffHost,
    minDistinctDomains: ledger.confianza.minDistinctDomains,
    witnesses: ledger.confianza.witnesses.map((t) => ({
      id: t.id,
      address: t.address,
      publicKey: t.publicKey,
    })),
  };
}

describe('argumentos', () => {
  it('acepta la ruta a secas y también `revisar <ruta>`', () => {
    expect(analizarArgumentos(['./export']).ruta).toBe('./export');
    expect(analizarArgumentos(['revisar', './export']).ruta).toBe('./export');
  });

  it('reconoce las opciones', () => {
    const args = analizarArgumentos([
      './export',
      '--explicar',
      '--confianza',
      'padron.json',
      '--ancho',
      '100',
    ]);
    expect(args).toMatchObject({
      ruta: './export',
      explicar: true,
      confianza: 'padron.json',
      ancho: 100,
    });
  });

  it('rechaza lo que no entiende en vez de ignorarlo', () => {
    expect(analizarArgumentos(['./export', '--turbo']).error).toMatch(/opción desconocida/u);
    expect(analizarArgumentos(['./a', './b']).error).toMatch(/una ruta/u);
    expect(analizarArgumentos(['--confianza']).error).toMatch(/necesita la ruta/u);
  });

  it('sin ruta, sale con el código de uso y explica qué falta', async () => {
    const lineas: string[] = [];
    const resultado = await ejecutar([], {
      escribir: (linea) => lineas.push(linea),
      abrir: () => Promise.reject(new Error('no debería abrirse nada')),
      leerFichero: () => Promise.reject(new Error('no')),
      ahora: () => AHORA,
    });
    expect(resultado.codigo).toBe(SALIDA.uso);
    expect(lineas.join('\n')).toMatch(/falta la ruta del paquete/u);
  });
});

describe('informe de un paquete correcto', () => {
  it('sale VERDE, en castellano y sin hexadecimal a la vista', async () => {
    const { codigo, salida } = await correr(ledgerLimpio);

    expect(codigo).toBe(SALIDA.ok);
    expect(salida).toContain('VERDE — Todo cuadra.');
    expect(salida).toContain('Se revisaron 17 registros desde el 20 de agosto de 2026');
    expect(salida).toContain('17 registros: escritura canónica y resúmenes correctos');
    expect(salida).toContain('2 sellos recalculados desde cero');
    expect(salida).toContain('1 tramos de continuidad verificados');
    expect(salida).toContain('registrado fuera en 3 sitios independientes');

    // La primera pantalla no enseña ni un hash: hay que poder leerla sin saber qué es un hash.
    const antesDelDetalle = salida.split('DETALLE PARA EL ACTA')[0] ?? '';
    expect(antesDelDetalle).not.toMatch(/[0-9a-f]{32}/u);

    // Y el aviso que da sentido a todo lo demás.
    expect(salida).toContain('Este programa no habló con ningún servidor');
  });

  it('`--explicar` describe en prosa qué hace y por qué, para poder enseñarlo', async () => {
    const { salida } = await correr(ledgerLimpio, ['--explicar']);

    expect(salida).toContain('QUÉ VOY A HACER Y POR QUÉ');
    expect(plano(salida)).toMatch(/Los registros se numeran 0, 1, 2… sin saltos/u);
    expect(plano(salida)).toMatch(
      /si borrás los últimos registros, la numeración sigue pareciendo/u,
    );
    expect(plano(salida)).toMatch(
      /lo único que un administrador con acceso total NO puede falsificar/u,
    );
    // Y advierte de lo que el índice del paquete NO prueba, antes de dar el primer visto bueno.
    expect(plano(salida)).toMatch(/NO sirve contra quien produjo el paquete/u);
  });

  it('sin `--explicar` el informe no lleva la prosa', async () => {
    const { salida } = await correr(ledgerLimpio);
    expect(salida).not.toContain('QUÉ VOY A HACER Y POR QUÉ');
  });
});

describe('informe de un paquete manipulado', () => {
  it('sale ROJO, dice qué significa y qué hacer, sin acusar de más', async () => {
    const ledger: Ledger = {
      ...ledgerLimpio,
      registros: ledgerLimpio.registros.map((registro) =>
        registro.event.aggregateId === DECISION_A && registro.event.seq === 0
          ? {
              ...registro,
              event: { ...registro.event, payload: { resumen: 'Otra cosa completamente' } },
            }
          : registro,
      ),
    };

    const { codigo, salida } = await correr(ledger);

    expect(codigo).toBe(SALIDA.integridadInterna);
    expect(salida).toContain('ROJO — Hay una diferencia.');
    expect(salida).toContain('Un registro fue modificado después de haberse escrito.');
    expect(salida).toContain('Qué hacer:');
    expect(plano(salida)).toMatch(/Guardá este paquete SIN MODIFICARLO/u);
    // Honestidad: no se afirma mala fe, que es algo que este programa no puede saber.
    expect(plano(salida)).toMatch(/un disco defectuoso también rompe cuentas/u);
    // El dato técnico existe, pero abajo.
    expect(salida).toContain('[REGISTRO_ALTERADO]');
    expect(salida).toMatch(/expediente=[0-9a-f]{32}/u);
  });

  it('sin anclaje sale ÁMBAR y explica qué NO prueba el verde interno', async () => {
    const { codigo, salida } = await correr({ ...ledgerLimpio, anclajes: new Map() });

    expect(codigo).toBe(SALIDA.sinAnclajeFirme);
    expect(salida).toContain('ÁMBAR — Las cuentas cuadran; falta la confirmación externa.');
    expect(plano(salida)).toMatch(/puede producir una historia falsa perfectamente coherente/u);
  });
});

describe('el texto de última instancia', () => {
  it('`README-VERIFICACION.txt` describe el algoritmo entero, incluidas sus limitaciones', () => {
    for (const obligatorio of [
      'RFC 8785',
      'RFC 6962',
      'eventHash = SHA256( 0x02 ‖ prevHash ‖ JCS_utf8(registro) )',
      'cola CORTADA',
      'REGLA DEL PRIMER SELLO',
      'LA CLAVE PRIVADA NO VIVE EN EL SERVIDOR',
      'LO QUE ESTE PROCEDIMIENTO NO PRUEBA',
      'Integridad no es autenticidad',
    ]) {
      expect(README_VERIFICACION).toContain(obligatorio);
    }
  });

  it('avisa de que el índice del paquete no protege contra quien lo produjo', () => {
    expect(README_VERIFICACION.replace(/\s+/gu, ' ')).toMatch(
      /Quien altere un fichero recalculará su sha256/u,
    );
  });
});

describe('la fuente de disco, que es la que usa el ejecutable de verdad', () => {
  // Estas pruebas tocan el disco a propósito. `directorySource` es el ÚNICO módulo del paquete que
  // habla con Node, y por eso es el único que no se puede probar con una fuente en memoria: los
  // fallos que tiene son fallos de resolución de rutas, y una fuente inyectada no los reproduce.
  let raiz = '';
  let anterior = '';

  beforeAll(async () => {
    raiz = await mkdtemp(path.join(tmpdir(), 'koinonia-fuente-'));
    await writeFile(path.join(raiz, 'manifest.json'), '{"formato":1}\n', 'utf8');
    anterior = cwd();
  });

  afterAll(async () => {
    chdir(anterior);
    await rm(raiz, { recursive: true, force: true });
  });

  it('ERROR ENCONTRADO: con una RUTA RELATIVA no leía NADA y acusaba de paquete incompleto', async () => {
    // `path.resolve(raiz, relativo)` siempre devuelve una ruta absoluta. Comparándola contra una
    // raíz relativa —`export/`—, el guardián de travesía la rechazaba entera: `read()` devolvía
    // `undefined` para todos los ficheros y el informe salía ROJO con `EXPORT_INCOMPLETO` sobre un
    // paquete intacto. Y la ruta relativa es justo la que se teclea: `verificar export`.
    chdir(path.dirname(raiz));
    const relativa = path.basename(raiz);

    const fuente = await directorySource(relativa);

    expect(await fuente.list()).toStrictEqual(['manifest.json']);
    const bytes = await fuente.read('manifest.json');
    expect(bytes, 'con ruta relativa el paquete se leía vacío').toBeDefined();
    expect(new TextDecoder().decode(bytes)).toBe('{"formato":1}\n');
    // El informe cita lo que se tecleó, no la ruta resuelta.
    expect(fuente.name).toBe(relativa);
  });

  it('la ruta absoluta sigue funcionando igual', async () => {
    const fuente = await directorySource(raiz);
    expect(await fuente.list()).toStrictEqual(['manifest.json']);
    expect(await fuente.read('manifest.json')).toBeDefined();
  });

  it('y la travesía de directorios sigue cerrada: `..` no sale del paquete', async () => {
    const fuente = await directorySource(raiz);
    expect(await fuente.read('../fuera.txt')).toBeUndefined();
    expect(await fuente.read('../../etc/passwd')).toBeUndefined();
    expect(await fuente.read('/etc/passwd')).toBeUndefined();
  });
});

describe('formato del informe', () => {
  it('envolver no parte palabras ni pierde texto', () => {
    const texto = 'una frase razonablemente larga para comprobar el ajuste de línea del informe';
    const lineas = envolver(texto, 30, '  ');
    expect(lineas.join(' ').replace(/\s+/gu, ' ').trim()).toBe(texto);
    for (const linea of lineas) expect(linea.length).toBeLessThanOrEqual(30);
  });
});
