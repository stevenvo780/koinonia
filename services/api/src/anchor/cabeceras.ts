/**
 * Las cabeceras de bloque de Bitcoin: **el fichero sin el cual el verificador nunca dice «sí»**.
 *
 * ═══ Por qué esto es lo más importante de los tres enganches ═══
 *
 * Un sello OpenTimestamps maduro afirma tres cosas encadenadas (ver `providers/opentimestamps.ts`):
 *
 *  1. el sello es del hash de NUESTRO checkpoint,
 *  2. el árbol de operaciones lleva de ahí a un digest concreto,
 *  3. **ese digest es la raíz de Merkle del bloque N de Bitcoin**.
 *
 * Las dos primeras se comprueban con aritmética sobre los bytes del recibo. La tercera necesita 80
 * bytes que no están en el recibo: la cabecera del bloque N. Sin ellos el verificador independiente
 * emite `incompleto` —correctamente, porque no se finge lo que no se ha comprobado— y ese
 * `incompleto` es permanente: por muchos ciclos que corran, el dato nunca aparece solo.
 *
 * Y el verificador independiente es la única defensa contra el administrador con `root`. Un
 * verificador que dice `incompleto` para siempre es un verificador que la asamblea deja de mirar.
 *
 * `services/api/src/ledger/export.ts` ya publica `anchors/bitcoin-headers.json` **si la tabla tiene
 * filas**. Nadie las escribía. Esto las escribe.
 *
 * ═══ Publicarlas nosotros no las hace confiables, y no hace falta que lo sean ═══
 *
 * Si el administrador fabrica una cabecera a medida para que la afirmación 3 cuadre con su historia
 * falsa, el `blockHash` de esa cabecera —`SHA256(SHA256(cabecera))`, 64 caracteres— no será el del
 * bloque N real. El verificador lo imprime siempre, justo para que cualquiera lo pegue en un
 * explorador. Nosotros añadimos aquí la comprobación barata que sí podemos hacer: la cabecera que
 * guardamos tiene que ser la del bloque cuyo identificador pedimos. Un intermediario que devuelva
 * bytes cambiados se cae aquí, no tres meses después en una asamblea.
 *
 * ⚠ Discrepancia con lo que pide el encargo: allí se habla de `bitcoin-headers.txt`. El nombre real
 * del contrato es `anchors/bitcoin-headers.json` (`packages/verifier-cli/src/formato.ts`), con
 * `{"headers":[{"height":…,"header":"<160 hex>"}]}` en forma canónica JCS. Manda el verificador: es
 * el programa que lo lee, y cambiarle el nombre al fichero sería cambiar el verificador, que es
 * exactamente lo que no debe cambiar.
 */

import {
  type AnchorReceipt,
  BITCOIN_HEADER_BYTES,
  type BitcoinHeaderSource,
  blockHashHex,
  headerFromHex,
  parseDetachedTimestamp,
  staticHeaders,
  walk,
} from '@koinonia/anchor';
import { fromBase64Url } from '@koinonia/crypto';

import { type PgClient } from '../db/client.js';
import { saveBitcoinHeader } from '../ledger/anchor-store.js';
import { getTexto, type HttpOptions } from './http.js';

/**
 * API pública de bloques por defecto: la de Blockstream, en el formato que también sirve
 * mempool.space. Se puede cambiar por la de un nodo propio con `KOINONIA_ANCLAJE_BLOQUES_URL`, y
 * quien tenga nodo debería hacerlo: es una petición menos a un tercero.
 */
export const EXPLORADOR_POR_DEFECTO = 'https://blockstream.info/api';

/** Fuente de cabeceras que sí puede salir a la red, a diferencia de `BitcoinHeaderSource`. */
export interface FuenteDeCabeceras {
  /** Los 80 bytes de la cabecera del bloque `height`. Lanza si no se pueden obtener o no cuadran. */
  obtener(height: number): Promise<Uint8Array>;
}

/**
 * Fuente sobre una API REST estilo Esplora: dos peticiones de texto plano.
 *
 *     GET {base}/block-height/{N}        → el identificador del bloque N
 *     GET {base}/block/{id}/header       → los 160 caracteres de su cabecera
 *
 * Se hacen las dos, en vez de una sola a un `/header/{N}` que no existe en esa API, porque la
 * primera es la que da el dato contra el que se comprueba la segunda.
 */
export function exploradorDeBloques(
  baseUrl: string = EXPLORADOR_POR_DEFECTO,
  http: HttpOptions = {},
): FuenteDeCabeceras {
  const base = baseUrl.replace(/\/+$/u, '');
  return {
    async obtener(height: number): Promise<Uint8Array> {
      if (!Number.isSafeInteger(height) || height < 0) {
        throw new RangeError(`altura de bloque inválida: ${String(height)}`);
      }
      const id = await getTexto(`${base}/block-height/${String(height)}`, http);
      if (!/^[0-9a-f]{64}$/u.test(id)) {
        throw new Error(
          'el explorador devolvió algo que no es un identificador de bloque para la altura ' +
            String(height),
        );
      }
      const hex = await getTexto(`${base}/block/${id}/header`, http);
      const cabecera = headerFromHex(hex.toLowerCase());

      // La comprobación que sí podemos hacer sin confiar en nadie: los bytes que nos dieron son los
      // del bloque que pedimos. Si el intermediario cambió uno, el doble SHA-256 ya no coincide.
      const calculado = await blockHashHex(cabecera);
      if (calculado !== id) {
        throw new Error(
          `la cabecera del bloque ${String(height)} no corresponde a su identificador: se pidió ` +
            `${id} y los bytes recibidos hashean a ${calculado}`,
        );
      }
      return cabecera;
    },
  };
}

/**
 * Alturas de bloque que los recibos afirman, leídas **de los bytes del sello** y no de `raw`.
 *
 * `raw` es informativo y lo escribe este servidor; el árbol de operaciones no. Si el día de mañana
 * alguien manipula `raw` para pedir la cabecera de un bloque que le conviene, esto sigue mirando
 * donde tiene que mirar.
 */
export async function alturasAncladas(
  receipts: readonly AnchorReceipt[],
): Promise<readonly number[]> {
  const alturas = new Set<number>();
  for (const receipt of receipts) {
    const proof = receipt.proof;
    if (proof === undefined) continue;
    let hojas;
    try {
      const detached = await parseDetachedTimestamp(fromBase64Url(proof));
      hojas = walk(detached.timestamp);
    } catch {
      // Un recibo que no es un sello OTS —el de git, el de correo— no es un error aquí: no tiene
      // alturas que cosechar y ya se validó en su propio proveedor.
      continue;
    }
    for (const hoja of hojas) {
      if (hoja.attestation.kind === 'bitcoin') alturas.add(hoja.attestation.height);
    }
  }
  return [...alturas].sort((a, b) => a - b);
}

export interface CosechaDeCabeceras {
  readonly guardadas: readonly number[];
  readonly yaEstaban: readonly number[];
  readonly fallos: readonly { readonly height: number; readonly motivo: string }[];
}

/**
 * Descarga y guarda las cabeceras que hagan falta para cerrar los sellos de estos recibos.
 *
 * **Ninguna falla se traga**, igual que en el ciclo de anclaje: una cabecera que no se pudo obtener
 * sale en `fallos` con su motivo, para que quien lea el registro sepa por qué el verificador va a
 * seguir diciendo `incompleto`.
 */
export async function cosecharCabeceras(input: {
  readonly client: PgClient;
  readonly receipts: readonly AnchorReceipt[];
  readonly fuente: FuenteDeCabeceras;
}): Promise<CosechaDeCabeceras> {
  const alturas = await alturasAncladas(input.receipts);
  const conocidas = await alturasConocidas(input.client);

  const guardadas: number[] = [];
  const yaEstaban: number[] = [];
  const fallos: { height: number; motivo: string }[] = [];

  for (const height of alturas) {
    if (conocidas.has(height)) {
      yaEstaban.push(height);
      continue;
    }
    try {
      const cabecera = await input.fuente.obtener(height);
      await saveBitcoinHeader(input.client, height, cabecera);
      guardadas.push(height);
    } catch (error) {
      fallos.push({ height, motivo: error instanceof Error ? error.message : String(error) });
    }
  }

  return { guardadas, yaEstaban, fallos };
}

/** Alturas ya presentes en la base. Evita pedirle a un tercero lo que ya tenemos. */
export async function alturasConocidas(client: PgClient): Promise<ReadonlySet<number>> {
  const { rows } = await client.query<{ height: string }>(
    'SELECT height::text AS height FROM governance.bitcoin_header',
  );
  return new Set(rows.map((fila) => Number(fila.height)));
}

/**
 * Las cabeceras guardadas, como `BitcoinHeaderSource` para el proveedor de OpenTimestamps.
 *
 * El puerto es **síncrono a propósito** —así `verify()` puede prometer que funciona sin red—, y por
 * eso esto carga todo de golpe. Son 80 bytes por bloque anclado: con un checkpoint por hora durante
 * diez años son 700 kB.
 */
export async function cabecerasGuardadas(client: PgClient): Promise<BitcoinHeaderSource> {
  const { rows } = await client.query<{ height: string; header: Uint8Array }>(
    'SELECT height::text AS height, header FROM governance.bitcoin_header',
  );
  return staticHeaders(
    rows
      .map((fila): readonly [number, Uint8Array] => [
        Number(fila.height),
        new Uint8Array(fila.header),
      ])
      .filter(([, header]) => header.length === BITCOIN_HEADER_BYTES),
  );
}
