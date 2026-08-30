/**
 * Empaqueta el export verificable en un `.tar.gz`, para poder entregarlo por HTTP.
 *
 * ═══ Por qué existe ═══
 *
 * `buildExport` (`./export.ts`) produce el paquete que el verificador independiente sabe leer:
 * `manifest.json`, `events.ndjson`, las pruebas de consistencia, los recibos de anclaje. Existía
 * desde hacía meses, pasaba sus pruebas de integración… y **ninguna ruta HTTP lo servía**. Su propio
 * comentario decía «escribirlo a disco es trivial y va aparte», y ese «aparte» no se escribió nunca.
 *
 * La consecuencia era que la pantalla de comprobar ofrecía un botón de descarga que entregaba OTRA
 * cosa —`/integridad/exportar`, un JSON suelto con otro propósito— y el verificador la rechazaba con
 * «no es un directorio». O sea que «comprobalo por fuera», que es la frase que sostiene el proyecto
 * entero y va en el pie de las 34 pantallas, no la podía cumplir nadie. Construido e inalcanzable,
 * que es peor que faltante porque nadie lo echa de menos.
 *
 * ═══ Por qué un `tar` escrito acá y no una dependencia ═══
 *
 * `node:zlib` trae el gzip; lo que falta es el `tar`, y el formato ustar son cabeceras de 512 bytes
 * con campos en posiciones fijas. Son sesenta líneas deterministas que se pueden comprobar contra el
 * `tar` del sistema —y se comprueban, en `services/api/test/empaquetar.test.ts`—, contra una
 * dependencia nueva en un servicio que hoy no tiene ninguna de este tipo. Si algún día hicieran falta
 * nombres largos, enlaces o permisos, esa balanza cambia; para siete ficheros de texto con rutas
 * cortas, no.
 */

import { gzipSync } from 'node:zlib';

import type { ExportBundle } from './export.js';

/** Tamaño de bloque de ustar. Todo —cabeceras y contenido— se alinea a este múltiplo. */
const BLOQUE = 512;

/**
 * Escribe un texto ASCII en un campo de longitud fija, terminado en NUL.
 *
 * Se rellena con ceros y no con espacios: `readNumeric` de la mayoría de implementaciones acepta
 * ambos, pero el NUL final es lo que exige la especificación para los campos de nombre.
 */
function campo(destino: Uint8Array, offset: number, largo: number, valor: string): void {
  const bytes = Buffer.from(valor, 'ascii');
  if (bytes.length >= largo) {
    throw new Error(`el valor «${valor}» no cabe en un campo ustar de ${String(largo)} bytes`);
  }
  destino.set(bytes, offset);
}

/** Un número en octal, alineado a la derecha con ceros y terminado en NUL, como manda ustar. */
function octal(destino: Uint8Array, offset: number, largo: number, valor: number): void {
  campo(destino, offset, largo, valor.toString(8).padStart(largo - 1, '0'));
}

/**
 * La cabecera de 512 bytes de un fichero.
 *
 * `mtime` entra como dato y no se lee el reloj acá, por la misma razón que en `buildExport`: dos
 * exports del mismo historial tienen que dar el mismo byte, o el `sha256` que alguien publique deja
 * de poder compararse con el que otro calcule.
 */
function cabecera(nombre: string, tamano: number, mtime: number): Uint8Array {
  const h = new Uint8Array(BLOQUE);

  campo(h, 0, 100, nombre);
  octal(h, 100, 8, 0o644); // modo
  octal(h, 108, 8, 0); // uid — cero a propósito: el paquete no es de nadie
  octal(h, 116, 8, 0); // gid
  octal(h, 124, 12, tamano);
  octal(h, 136, 12, mtime);
  h[156] = 0x30; // typeflag '0' = fichero normal
  campo(h, 257, 6, 'ustar');
  h[263] = 0x30; // versión '00'
  h[264] = 0x30;

  /*
   * La suma de comprobación se calcula con su propio campo lleno de ESPACIOS, y sólo después se
   * escribe encima. Es la parte que se equivoca todo el mundo al escribir un tar a mano: calcularla
   * sobre ceros da un número distinto y `tar` responde «checksum error» sin decir por qué.
   */
  h.fill(0x20, 148, 156);
  let suma = 0;
  for (const byte of h) suma += byte;
  campo(h, 148, 7, suma.toString(8).padStart(6, '0'));
  h[155] = 0x20;

  return h;
}

/** Redondea hacia arriba al siguiente múltiplo de 512, que es lo que ustar exige rellenar. */
function relleno(tamano: number): number {
  const resto = tamano % BLOQUE;
  return resto === 0 ? 0 : BLOQUE - resto;
}

/**
 * El paquete entero como `.tar.gz`.
 *
 * Los ficheros salen en orden alfabético por su ruta, no en el orden en que el `Map` los recibió: el
 * paquete tiene que ser reproducible byte a byte para que su huella sirva de algo, y el orden de
 * inserción de un `Map` es un detalle de cómo se construyó, no un hecho del historial.
 */
export function empaquetarTarGz(paquete: ExportBundle, mtime: number): Uint8Array {
  const trozos: Uint8Array[] = [];

  for (const nombre of [...paquete.keys()].sort()) {
    const crudo = paquete.get(nombre);
    if (crudo === undefined) continue;
    const contenido = typeof crudo === 'string' ? Buffer.from(crudo, 'utf8') : Buffer.from(crudo);

    trozos.push(cabecera(nombre, contenido.length, mtime));
    trozos.push(contenido);
    const sobra = relleno(contenido.length);
    if (sobra > 0) trozos.push(new Uint8Array(sobra));
  }

  // Fin de archivo: dos bloques en cero. Sin ellos, `tar` avisa de un fin inesperado.
  trozos.push(new Uint8Array(BLOQUE * 2));

  return new Uint8Array(gzipSync(Buffer.concat(trozos.map((t) => Buffer.from(t))), { level: 9 }));
}
