/**
 * Árbol de Merkle estilo Certificate Transparency (RFC 6962) — §6 y §7 de la spec del ledger.
 *
 *     MTH({})   = SHA256("")
 *     MTH({d0}) = SHA256(0x00 ‖ d0)                        // HOJA
 *     MTH(D[n]) = SHA256(0x01 ‖ MTH(D[0:k]) ‖ MTH(D[k:n])) // NODO, k = mayor potencia de 2 < n
 *
 * Dos detalles que no son de estilo sino de seguridad:
 *
 *  1. **Prefijos `0x00` / `0x01`.** Sin ellos, un hash de nodo interno y uno de hoja son
 *     sintácticamente indistinguibles y se puede exhibir un log de tamaño 2 con la misma raíz que
 *     uno de tamaño 4, negando dos eventos, **sin romper SHA-256** (§6.3).
 *  2. **El nodo impar asciende, no se duplica.** Duplicar la cola —como hace Bitcoin— produjo
 *     CVE-2012-2459: dos listas distintas con idéntica raíz. En un ledger de gobernanza serían dos
 *     historias con el mismo checkpoint.
 */

import { bytesEqual, DOMAIN, HASH_BYTES, sha256, sha256Concat } from './hash.js';

/** `SHA256(0x00 ‖ entrada)`. La entrada es el `eventHash`, ya calculado con prefijo `0x02`. */
export async function leafHash(entry: Uint8Array): Promise<Uint8Array> {
  return sha256Concat(Uint8Array.of(DOMAIN.leaf), entry);
}

/** `SHA256(0x01 ‖ izquierdo ‖ derecho)`. */
export async function nodeHash(left: Uint8Array, right: Uint8Array): Promise<Uint8Array> {
  return sha256Concat(Uint8Array.of(DOMAIN.node), left, right);
}

/** Raíz del árbol vacío: `SHA256("")`. */
export async function emptyRoot(): Promise<Uint8Array> {
  return sha256(new Uint8Array(0));
}

/**
 * Mayor potencia de dos **estrictamente menor** que `n`.
 *
 * DECISIÓN: la spec calcula esto como `1 << (31 - Math.clz32(n - 1))`, que es correcto sólo para
 * `2 <= n < 2^31`: con `n = 1` da `1 << -1` (o sea `1 << 31`, negativo) y con `n - 1 >= 2^32`
 * `clz32` trunca a 32 bits. Se implementa con un bucle explícito, que además documenta la
 * definición sin depender de una identidad de bits.
 */
export function largestPowerOfTwoLessThan(n: number): number {
  if (!Number.isSafeInteger(n) || n < 2) {
    throw new RangeError(`largestPowerOfTwoLessThan requiere un entero >= 2, recibió ${String(n)}`);
  }
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

function copy(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

function rangeKey(lo: number, hi: number): string {
  return `${String(lo)},${String(hi)}`;
}

/**
 * Árbol construido sobre entradas crudas (los `eventHash` del log, en orden de `leaf_index`).
 *
 * DECISIÓN: la spec mezcla dos convenciones en el mismo §6 —`MTH({d0}) = SHA256(0x00 ‖ d0)` en la
 * fórmula, pero `merkleRoot(leaves)` "ya vienen hasheadas con 0x00" en el código—. Aquí la API
 * pública recibe siempre **entradas crudas** y aplica `leafHash` internamente: es la convención del
 * RFC y elimina la posibilidad de que alguien pase hojas ya hasheadas creyendo lo contrario, que es
 * precisamente el error que el prefijo `0x00` existe para hacer imposible.
 *
 * Todos los hashes de la descomposición canónica se calculan una vez en `build` (2n-1 nodos) y se
 * memorizan, de modo que raíz y pruebas son después operaciones síncronas y sin recomputo.
 */
export class MerkleTree {
  readonly #leaves: readonly Uint8Array[];
  readonly #subtrees: ReadonlyMap<string, Uint8Array>;
  readonly #root: Uint8Array;

  private constructor(
    leaves: readonly Uint8Array[],
    subtrees: ReadonlyMap<string, Uint8Array>,
    root: Uint8Array,
  ) {
    this.#leaves = leaves;
    this.#subtrees = subtrees;
    this.#root = root;
  }

  static async build(entries: readonly Uint8Array[]): Promise<MerkleTree> {
    const leaves: Uint8Array[] = [];
    for (const entry of entries) leaves.push(await leafHash(entry));

    const subtrees = new Map<string, Uint8Array>();
    if (leaves.length === 0) {
      return new MerkleTree(leaves, subtrees, await emptyRoot());
    }
    const root = await computeSubtree(leaves, 0, leaves.length, subtrees);
    return new MerkleTree(leaves, subtrees, root);
  }

  get size(): number {
    return this.#leaves.length;
  }

  root(): Uint8Array {
    return copy(this.#root);
  }

  #subtree(lo: number, hi: number): Uint8Array {
    const value = this.#subtrees.get(rangeKey(lo, hi));
    if (value === undefined) {
      throw new Error(`rango [${String(lo)},${String(hi)}) fuera de la descomposición canónica`);
    }
    return value;
  }

  /**
   * *Audit path* de RFC 6962 para la hoja `index`: los hermanos desde la hoja hasta la raíz.
   * Su longitud es `⌈log2(n)⌉`: con 100 000 eventos, 17 hashes.
   */
  inclusionProof(index: number): Uint8Array[] {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.size) {
      throw new RangeError(`índice ${String(index)} fuera de [0, ${String(this.size)})`);
    }
    return this.#path(0, this.size, index).map(copy);
  }

  #path(lo: number, hi: number, index: number): Uint8Array[] {
    if (hi - lo === 1) return [];
    const k = lo + largestPowerOfTwoLessThan(hi - lo);
    return index < k
      ? [...this.#path(lo, k, index), this.#subtree(k, hi)]
      : [...this.#path(k, hi, index), this.#subtree(lo, k)];
  }

  /**
   * Prueba de consistencia RFC 6962 §2.1.2 entre el árbol de tamaño `m` y este, de tamaño `n >= m`.
   * Demuestra que este árbol **contiene al de tamaño `m` como prefijo intacto**.
   *
   * DECISIÓN: `m = 0` devuelve la prueba vacía (el árbol vacío es prefijo de todo). La `SUBPROOF`
   * de la spec no contempla ese caso y, tal como está escrita, calcularía `k` sobre `n - 1 = 0`
   * produciendo basura; RFC 6962 y `certificate-transparency-go` lo tratan como prueba vacía.
   */
  consistencyProof(m: number): Uint8Array[] {
    if (!Number.isSafeInteger(m) || m < 0 || m > this.size) {
      throw new RangeError(`m=${String(m)} fuera de [0, ${String(this.size)}]`);
    }
    if (m === 0 || m === this.size) return [];
    return this.#subproof(m, 0, this.size, true).map(copy);
  }

  #subproof(m: number, lo: number, hi: number, known: boolean): Uint8Array[] {
    const n = hi - lo;
    // `known` (el `b` del RFC): mientras el prefijo antiguo coincide con un subárbol completo, el
    // verificador puede recomponerlo solo y no hace falta enviárselo.
    if (m === n) return known ? [] : [this.#subtree(lo, hi)];
    const k = largestPowerOfTwoLessThan(n);
    return m <= k
      ? [...this.#subproof(m, lo, lo + k, known), this.#subtree(lo + k, hi)]
      : [...this.#subproof(m - k, lo + k, hi, false), this.#subtree(lo, lo + k)];
  }
}

async function computeSubtree(
  leaves: readonly Uint8Array[],
  lo: number,
  hi: number,
  memo: Map<string, Uint8Array>,
): Promise<Uint8Array> {
  const key = rangeKey(lo, hi);
  const cached = memo.get(key);
  if (cached !== undefined) return cached;

  let value: Uint8Array;
  if (hi - lo === 1) {
    const leaf = leaves[lo];
    if (leaf === undefined) throw new Error(`hoja ${String(lo)} ausente`);
    value = leaf;
  } else {
    const k = lo + largestPowerOfTwoLessThan(hi - lo);
    value = await nodeHash(
      await computeSubtree(leaves, lo, k, memo),
      await computeSubtree(leaves, k, hi, memo),
    );
  }
  memo.set(key, value);
  return value;
}

/** Raíz del árbol sobre `entries` (entradas crudas, en orden de `leaf_index`). */
export async function merkleRoot(entries: readonly Uint8Array[]): Promise<Uint8Array> {
  return (await MerkleTree.build(entries)).root();
}

export async function inclusionProof(
  entries: readonly Uint8Array[],
  index: number,
): Promise<Uint8Array[]> {
  return (await MerkleTree.build(entries)).inclusionProof(index);
}

export async function consistencyProof(
  entries: readonly Uint8Array[],
  m: number,
): Promise<Uint8Array[]> {
  return (await MerkleTree.build(entries)).consistencyProof(m);
}

function wellFormed(hashes: readonly Uint8Array[]): boolean {
  return hashes.every((hash) => hash.length === HASH_BYTES);
}

/**
 * Verifica una prueba de inclusión contra la raíz de un checkpoint **anclado** (no contra la que
 * diga la web hoy). Corre igual en el navegador y en Node, sin descargar el log.
 *
 * DECISIÓN: `leafIndex` y `treeSize` son `bigint`, como en la firma de la spec (§6.5). El log es
 * `bigint` en PostgreSQL y convertir a `number` en el borde reintroduciría exactamente la clase de
 * pérdida de exactitud que el §1.3.a prohíbe.
 */
export async function verifyInclusion(
  entry: Uint8Array,
  leafIndex: bigint,
  treeSize: bigint,
  proof: readonly Uint8Array[],
  expectedRoot: Uint8Array,
): Promise<boolean> {
  if (leafIndex < 0n || treeSize <= 0n || leafIndex >= treeSize) return false;
  if (expectedRoot.length !== HASH_BYTES || !wellFormed(proof)) return false;

  let fn = leafIndex;
  let sn = treeSize - 1n;
  let r = await leafHash(entry);

  for (const sibling of proof) {
    if (sn === 0n) return false; // sobran nodos: prueba mal formada
    if ((fn & 1n) === 1n || fn === sn) {
      r = await nodeHash(sibling, r); // somos hijo derecho (o cola promovida)
      while (fn !== 0n && (fn & 1n) === 0n) {
        fn >>= 1n;
        sn >>= 1n;
      }
    } else {
      r = await nodeHash(r, sibling); // somos hijo izquierdo
    }
    fn >>= 1n;
    sn >>= 1n;
  }

  return sn === 0n && bytesEqual(r, expectedRoot); // sn !== 0 => faltan nodos
}

/**
 * Verifica una prueba de consistencia recomputando **dos** raíces con la misma lista de nodos: la
 * vieja y la nueva. Sólo si ambas salen correctas la prueba vale.
 *
 * Es la pieza que impide "publicar una raíz nueva coherente pero falsa" (§7.1): si el servidor
 * cambió, borró o reordenó cualquiera de las primeras `m` hojas, no existe prueba posible.
 *
 * DECISIÓN: con `m = 0` se exige además que `oldRoot` sea `SHA256("")`, la raíz del árbol vacío.
 * `certificate-transparency-go` acepta cualquier `oldRoot` en ese caso; aceptar una raíz arbitraria
 * como "consistente" es una laxitud gratuita en un verificador cuyo único trabajo es desconfiar.
 */
export async function verifyConsistency(
  m: bigint,
  n: bigint,
  proof: readonly Uint8Array[],
  oldRoot: Uint8Array,
  newRoot: Uint8Array,
): Promise<boolean> {
  if (m < 0n || n < 0n || m > n) return false;
  if (oldRoot.length !== HASH_BYTES || newRoot.length !== HASH_BYTES) return false;
  if (!wellFormed(proof)) return false;
  if (m === n) return proof.length === 0 && bytesEqual(oldRoot, newRoot);
  if (m === 0n) return proof.length === 0 && bytesEqual(oldRoot, await emptyRoot());

  let fn = m - 1n;
  let sn = n - 1n;
  while ((fn & 1n) === 1n) {
    // descarta los unos de la derecha
    fn >>= 1n;
    sn >>= 1n;
  }

  let index = 0;
  let fr: Uint8Array;
  let sr: Uint8Array;
  if (fn === 0n) {
    // `m` es potencia de dos: la raíz vieja ES un subárbol completo y por eso NO viene en la prueba.
    fr = oldRoot;
    sr = oldRoot;
  } else {
    const first = proof[index];
    if (first === undefined) return false;
    fr = first;
    sr = first;
    index++;
  }

  for (; index < proof.length; index++) {
    const node = proof[index];
    if (node === undefined) return false;
    if (sn === 0n) return false;
    if ((fn & 1n) === 1n || fn === sn) {
      fr = await nodeHash(node, fr);
      sr = await nodeHash(node, sr);
      while (fn !== 0n && (fn & 1n) === 0n) {
        fn >>= 1n;
        sn >>= 1n;
      }
    } else {
      sr = await nodeHash(sr, node); // rama que sólo existe en el árbol nuevo
    }
    fn >>= 1n;
    sn >>= 1n;
  }

  return sn === 0n && bytesEqual(fr, oldRoot) && bytesEqual(sr, newRoot);
}
