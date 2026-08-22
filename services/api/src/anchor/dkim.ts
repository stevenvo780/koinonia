/**
 * **DKIM** (RFC 6376, y Ed25519 por RFC 8463) para el correo de anclaje.
 *
 * ═══ Qué aporta DKIM aquí, y qué NO ═══
 *
 * **No** aporta la prueba. La prueba la dan los acuses firmados por los testigos con **sus** claves:
 * nuestra firma sobre nuestro propio correo no vale nada contra el administrador, porque la clave
 * está en el mismo servidor que él controla. Eso está dicho en `witness-email.ts` y sigue siendo
 * cierto con DKIM puesto.
 *
 * Lo que DKIM aporta es **entrega**. Un correo sin DKIM desde un VPS acaba en la carpeta de spam de
 * cinco personas que no lo miran, y un anclaje que nadie lee es un anclaje que no existe. Firmar el
 * correo es lo que hace que el testigo lo vea, y que el testigo lo vea es la condición de que exista
 * el acuse que sí prueba algo.
 *
 * ═══ Por qué la canonicalización es lo único que hay que probar con cuidado ═══
 *
 * Porque es donde falla DKIM en la práctica. Un byte de más en el material firmado y la firma es
 * válida para nosotros e inválida para todo el mundo; el correo se entrega igual, pero sin
 * autenticar, y nadie se entera hasta que empieza a caer en spam. Aquí las funciones de
 * canonicalización son puras y se prueban contra los ejemplos del propio RFC.
 */

import { createHash, createSign, type KeyObject, sign as signRaw } from 'node:crypto';

export type CanonicalizacionCabecera = 'relaxed';
export type CanonicalizacionCuerpo = 'relaxed' | 'simple';
export type AlgoritmoDkim = 'rsa-sha256' | 'ed25519-sha256';

const CRLF = '\r\n';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Canonicalización
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Canonicalización `relaxed` de una cabecera (RFC 6376 §3.4.2).
 *
 * Sólo se implementa `relaxed`, y es deliberado: `simple` exige que la cabecera llegue **byte a
 * byte** como se firmó, y cualquier retransmisor la vuelve a plegar. Ofrecer `simple` sería ofrecer
 * una firma que se rompe sola en el primer salto.
 */
export function canonicalizarCabecera(nombre: string, valor: string): string {
  const desplegado = valor.replace(/\r\n/gu, '');
  const comprimido = desplegado.replace(/[ \t]+/gu, ' ');
  return `${nombre.toLowerCase().trim()}:${comprimido.replace(/^ +/u, '').replace(/ +$/u, '')}`;
}

/** Canonicalización del cuerpo (RFC 6376 §3.4.3 y §3.4.4). */
export function canonicalizarCuerpo(cuerpo: string, modo: CanonicalizacionCuerpo): string {
  const lineas = cuerpo.replace(/\r\n/gu, '\n').split('\n');

  const tratadas =
    modo === 'relaxed'
      ? lineas.map((linea) => linea.replace(/[ \t]+/gu, ' ').replace(/[ \t]+$/u, ''))
      : lineas;

  // Fuera las líneas vacías del final. En `relaxed`, un cuerpo que queda vacío se canonicaliza a
  // la cadena vacía; en `simple`, a un CRLF suelto. Es la diferencia exacta que marca el RFC y la
  // que hace que un `bh=` no cuadre si se copia de un ejemplo del modo equivocado.
  let fin = tratadas.length;
  while (fin > 0 && tratadas[fin - 1] === '') fin--;
  const utiles = tratadas.slice(0, fin);

  if (utiles.length === 0) return modo === 'relaxed' ? '' : CRLF;
  return utiles.join(CRLF) + CRLF;
}

export function hashDeCuerpo(cuerpo: string, modo: CanonicalizacionCuerpo): string {
  return createHash('sha256').update(canonicalizarCuerpo(cuerpo, modo), 'utf8').digest('base64');
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Firma
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface CabeceraDeCorreo {
  readonly nombre: string;
  readonly valor: string;
}

export interface DkimOptions {
  /** Dominio firmante: `udea.edu.co`. Va en `d=`. */
  readonly domain: string;
  /** Selector del registro TXT `<selector>._domainkey.<domain>`. Va en `s=`. */
  readonly selector: string;
  readonly algorithm: AlgoritmoDkim;
  readonly privateKey: KeyObject;
  /**
   * Instante de la firma en segundos desde epoch. **Entra como dato**: una firma que dependa del
   * reloj del proceso no se puede reproducir en una prueba, y una firma que no se puede reproducir
   * es una firma que nadie comprueba.
   */
  readonly timestamp: number;
  /** Cabeceras a firmar, en orden. Por defecto las que importan. */
  readonly headers?: readonly string[];
  readonly bodyCanonicalization?: CanonicalizacionCuerpo;
  /** Caducidad de la firma, en segundos desde `timestamp`. */
  readonly expiresInSeconds?: number;
}

/**
 * Cabeceras firmadas por defecto.
 *
 * `From` es obligatorio por el RFC. `Subject`, `Date`, `To` y `Message-ID` van porque son las que un
 * retransmisor malicioso querría cambiar: alterar el asunto o el destinatario de un correo de
 * anclaje sin romper la firma sería exactamente la clase de manipulación que DKIM debe impedir.
 */
export const CABECERAS_FIRMADAS: readonly string[] = [
  'from',
  'to',
  'subject',
  'date',
  'message-id',
];

function digestDeCabeceras(
  cabeceras: readonly CabeceraDeCorreo[],
  aFirmar: readonly string[],
  dkimSinB: string,
): string {
  const partes: string[] = [];
  // Se recorre `aFirmar` en su orden, no el del mensaje: el verificador hará lo mismo leyendo `h=`.
  // Y se consume de atrás hacia delante, como manda el RFC cuando una cabecera aparece repetida.
  const pendientes = new Map<string, string[]>();
  for (const cabecera of cabeceras) {
    const clave = cabecera.nombre.toLowerCase();
    const lista = pendientes.get(clave) ?? [];
    lista.push(cabecera.valor);
    pendientes.set(clave, lista);
  }

  for (const nombre of aFirmar) {
    const lista = pendientes.get(nombre.toLowerCase());
    const valor = lista?.pop();
    if (valor === undefined) continue;
    partes.push(canonicalizarCabecera(nombre, valor));
  }

  // La propia `DKIM-Signature` entra con `b=` vacío y **sin CRLF final** (RFC 6376 §3.7).
  return [...partes.map((p) => p + CRLF), canonicalizarCabecera('DKIM-Signature', dkimSinB)].join(
    '',
  );
}

export interface DkimSignature {
  /** Valor completo de la cabecera, ya plegado y listo para anteponer al mensaje. */
  readonly header: string;
  /** El material exacto que se firmó. Se devuelve para poder auditarlo en una prueba. */
  readonly signedMaterial: string;
}

/** Firma un mensaje y devuelve la cabecera `DKIM-Signature`. */
export function firmarDkim(
  cabeceras: readonly CabeceraDeCorreo[],
  cuerpo: string,
  options: DkimOptions,
): DkimSignature {
  const canonCuerpo = options.bodyCanonicalization ?? 'relaxed';
  const aFirmar = options.headers ?? CABECERAS_FIRMADAS;
  const presentes = new Set(cabeceras.map((c) => c.nombre.toLowerCase()));
  const listadas = aFirmar.filter((nombre) => presentes.has(nombre.toLowerCase()));

  if (!listadas.some((nombre) => nombre.toLowerCase() === 'from')) {
    throw new Error('DKIM exige firmar `From`: sin ella la firma no autentica al remitente');
  }

  const tags = [
    'v=1',
    `a=${options.algorithm}`,
    `c=relaxed/${canonCuerpo}`,
    `d=${options.domain}`,
    `s=${options.selector}`,
    `t=${String(options.timestamp)}`,
    ...(options.expiresInSeconds === undefined
      ? []
      : [`x=${String(options.timestamp + options.expiresInSeconds)}`]),
    `h=${listadas.join(':')}`,
    `bh=${hashDeCuerpo(cuerpo, canonCuerpo)}`,
    'b=',
  ];

  const sinB = ` ${tags.join('; ')}`;
  const material = digestDeCabeceras(cabeceras, listadas, sinB);
  const firma = firmarMaterial(material, options);

  return {
    header: plegar(`${sinB.trimStart()}${firma}`),
    signedMaterial: material,
  };
}

function firmarMaterial(material: string, options: DkimOptions): string {
  if (options.algorithm === 'rsa-sha256') {
    return createSign('sha256').update(material, 'utf8').sign(options.privateKey, 'base64');
  }
  // RFC 8463: se firma con Ed25519 **el resumen SHA-256** del material, no el material.
  const resumen = createHash('sha256').update(material, 'utf8').digest();
  return signRaw(null, resumen, options.privateKey).toString('base64');
}

/**
 * Pliega la cabecera para no pasarse del límite de 998 octetos por línea de RFC 5322.
 *
 * Se pliega por espacios, que es lo que la canonicalización `relaxed` vuelve a comprimir: el
 * verificador recompone exactamente lo que se firmó. Plegar en cualquier otro sitio rompería la
 * firma, y por eso `b=` largo se parte en trozos precedidos de espacio.
 */
function plegar(valor: string, ancho = 72): string {
  const salida: string[] = [];
  let linea = '';
  for (const trozo of valor.split(' ')) {
    const candidato = linea === '' ? trozo : `${linea} ${trozo}`;
    if (candidato.length > ancho && linea !== '') {
      salida.push(linea);
      linea = trozo;
    } else {
      linea = candidato;
    }
  }
  if (linea !== '') salida.push(linea);

  // El último trozo suele ser la firma en base64, que no lleva espacios: se parte a lo ancho.
  const partido = salida.flatMap((l) =>
    l.length <= ancho ? [l] : (l.match(new RegExp(`.{1,${String(ancho)}}`, 'gu')) ?? [l]),
  );
  return partido.join(`${CRLF} `);
}
