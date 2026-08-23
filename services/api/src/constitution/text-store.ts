/**
 * El texto de las normas, direccionado por su huella.
 *
 * ═══ La decisión, y por qué no fue «al ledger» ═══
 *
 * El dominio modela una cláusula como el par `(clauseId, textHash)` y **no guarda prosa**: el
 * agregado está cerrado y probado, y ADR-0051 rechaza explícitamente guardar texto y huella juntos
 * porque «añade una forma de mentir —declarar una huella que no corresponde al texto— sin añadir
 * ninguna garantía». Meterlo en el evento exigiría además cambiar `packages/domain`, que aquí no se
 * toca.
 *
 * Tampoco puede vivir **fuera de la base** —un fichero publicado, un repositorio—: el §6 obliga a
 * publicar «versión, fecha y diferencia respecto de la anterior», y una diferencia contra un texto
 * que hay que ir a buscar a otro sitio no se puede comprobar desde la pantalla que la muestra. Si
 * el texto está fuera, la promesa del producto depende de que alguien mantenga otra cosa
 * sincronizada, y lo que depende de que alguien se acuerde no es una garantía.
 *
 * Así que vive **en su propia tabla, con la huella como clave primaria**. Tres consecuencias, y las
 * tres son la decisión:
 *
 *  1. **La huella sigue cuadrando, y se comprueba al leer.** `readClauseTexts` recomputa SHA-256
 *     sobre lo que devolvió la base y lo compara con la clave. No normaliza antes de comparar —eso
 *     taparía justo la alteración que se busca— así que un texto cambiado no «gana»: deja de
 *     resolver, y quien lea la pantalla se entera.
 *  2. **Es público**, como manda el §6: `constitution:read` es abierto y estas filas no llevan ni
 *     un dato personal.
 *  3. **Es recuperable por versión histórica sin duplicar nada.** La correspondencia cláusula →
 *     huella vive sólo en el evento de su versión; una cláusula que no cambia entre la 3 y la 4 se
 *     guarda una vez y las dos la resuelven.
 *
 * ═══ La preimagen, declarada ═══
 *
 *     textHash = sha256_hex( utf8( título ‖ U+000A U+000A ‖ cuerpo ) )
 *
 * Texto plano y no un objeto canónico: `Clause.textHash` está definido en el dominio como
 * «sha256Hex(utf8(texto normalizado))», y exigir un perfil de canonicalización JSON para comprobar
 * una norma dejaría fuera a cualquiera con herramientas corrientes. Con esto, comprobar una
 * cláusula desde fuera es `printf '%s\n\n%s' "$titulo" "$cuerpo" | sha256sum`.
 *
 * El título **no puede llevar saltos de línea**, y no es cosmético: sin esa restricción la
 * codificación no sería inyectiva —(«a\n\nb», «c») y («a», «b\n\nc») darían la misma preimagen— y
 * una codificación no inyectiva es exactamente el defecto por el que `jsonb` está proscrito en el
 * ledger. Lo comprueban las dos capas: aquí, y el `CHECK` de la migración 0011.
 */

import { type Hash, hashText, normalizeLedgerText } from '@koinonia/domain';

import { toFixedChar, toText, type PgClient } from '../db/client.js';

/** Separador de la preimagen: una línea en blanco entre el título y el cuerpo. */
export const CLAUSE_TEXT_SEPARATOR = '\n\n';

/** El texto normativo de una cláusula, ya normalizado. */
export interface ClauseText {
  readonly title: string;
  readonly body: string;
}

export class ClauseTextError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ClauseTextError';
    this.code = code;
  }
}

/**
 * Normaliza en el borde de entrada: CRLF a LF, NFC y sin espacios sobrantes.
 *
 * Se normaliza **una sola vez, al entrar**, y lo que se guarda es el resultado. Normalizar también
 * al leer sería cómodo y taparía el fallo que esto existe para detectar: dos textos que se ven
 * iguales y hashean distinto (A.1.1).
 */
export function normalizeClauseText(text: ClauseText): ClauseText {
  return { title: normalizeLedgerText(text.title), body: normalizeLedgerText(text.body) };
}

/** La preimagen exacta. Es lo único que se hashea, y lo que un tercero repite con `sha256sum`. */
export function clauseTextPreimage(text: ClauseText): string {
  return `${text.title}${CLAUSE_TEXT_SEPARATOR}${text.body}`;
}

/** Comprueba la forma del par antes de que llegue a ser una huella de algo. */
export function assertWellFormedClauseText(text: ClauseText, field: string): void {
  if (text.title.length === 0) {
    throw new ClauseTextError(
      'CLAUSE_TITLE_EMPTY',
      `${field}: una regla sin título no se puede leer`,
    );
  }
  if (text.body.length === 0) {
    throw new ClauseTextError('CLAUSE_BODY_EMPTY', `${field}: una regla sin texto no dice nada`);
  }
  if (/[\n\r]/u.test(text.title)) {
    throw new ClauseTextError(
      'CLAUSE_TITLE_MULTILINE',
      `${field}: el título de una regla ocupa una línea. Con saltos de línea, dos parejas ` +
        'distintas de título y texto producirían la misma huella, y una huella que vale para dos ' +
        'textos no identifica ninguno',
    );
  }
}

/** `sha256Hex(utf8(título ‖ \n\n ‖ cuerpo))`. La misma cuenta en las dos direcciones. */
export async function clauseTextHash(text: ClauseText): Promise<Hash> {
  return hashText(clauseTextPreimage(text));
}

/**
 * Archiva textos. Idempotente por construcción: la clave es el contenido.
 *
 * Se recomputa la huella antes de escribir. El llamante ya la calculó para meterla en el evento;
 * volver a calcularla aquí cuesta un SHA-256 y cierra la única forma de que la fila y el evento
 * discrepen: escribir una fila cuya clave no sea la huella de su contenido.
 *
 * `ON CONFLICT DO NOTHING` y **jamás** `DO UPDATE`: una fila que ya existe con esa clave ya tiene
 * ese contenido —o hubo una colisión de SHA-256, que no es el caso que este código debe manejar—.
 * Y un `DO UPDATE` dispararía el trigger de inmutabilidad de 0011, que es justo lo que debe pasar.
 */
export async function saveClauseTextsWithin(
  client: PgClient,
  texts: readonly ClauseText[],
): Promise<void> {
  for (const [index, text] of texts.entries()) {
    assertWellFormedClauseText(text, `reglas[${String(index)}]`);
    const hash = await clauseTextHash(text);
    await client.query(
      `INSERT INTO governance.clause_text (text_hash, title, body)
            VALUES ($1, $2, $3)
       ON CONFLICT (text_hash) DO NOTHING`,
      [hash, text.title, text.body],
    );
  }
}

/**
 * Resuelve huellas a textos, **comprobando cada una**.
 *
 * Dos fallos posibles y ninguno se traga en silencio: que falte el texto de una cláusula que el
 * historial nombra, y que el texto guardado ya no corresponda a su huella. El segundo es el caso
 * grave —alguien reescribió una norma vigente sin pasar por una reforma— y el mensaje lo dice.
 */
export async function readClauseTexts(
  client: PgClient,
  hashes: readonly Hash[],
): Promise<ReadonlyMap<Hash, ClauseText>> {
  const wanted = [...new Set(hashes)];
  if (wanted.length === 0) return new Map();

  const { rows } = await client.query<{ text_hash: string; title: string; body: string }>(
    `SELECT text_hash, title, body
       FROM governance.clause_text
      WHERE text_hash = ANY($1::char(64)[])`,
    [wanted],
  );

  const found = new Map<Hash, ClauseText>();
  for (const row of rows) {
    const stored = toFixedChar(row.text_hash, 64, 'clause_text.text_hash') as Hash;
    const text: ClauseText = {
      title: toText(row.title, 'clause_text.title'),
      body: toText(row.body, 'clause_text.body'),
    };
    const recomputed = await clauseTextHash(text);
    if (recomputed !== stored) {
      throw new ClauseTextError(
        'CLAUSE_TEXT_ALTERED',
        `el texto archivado con la huella ${stored} hashea ${recomputed}: alguien cambió la letra ` +
          'de una norma sin pasar por una reforma, o la fila se corrompió. No se enseña un texto ' +
          'que no es el que se votó',
      );
    }
    found.set(stored, text);
  }

  const missing = wanted.find((hash) => !found.has(hash));
  if (missing !== undefined) {
    throw new ClauseTextError(
      'CLAUSE_TEXT_MISSING',
      `no está archivado el texto de la regla con huella ${missing}: el historial la nombra y el ` +
        'archivo no la tiene',
    );
  }
  return found;
}
