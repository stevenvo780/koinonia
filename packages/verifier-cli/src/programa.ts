/**
 * El programa: análisis de argumentos, orquestación e informe.
 *
 * Separado de `cli.ts` para que se pueda ejecutar entero desde un test —con la salida capturada en
 * un arreglo y el instante inyectado— sin lanzar procesos. Un verificador que sólo se puede probar
 * arrancándolo a mano acaba sin probar sus modos de fallo, que son justamente los que importan.
 */

import { parseTrustRoster, type ExportSource, type TrustRoster } from './formato.js';
import { SALIDA, type CodigoSalida } from './hallazgos.js';
import { renderInforme, SALIDAS_EXPLICADAS } from './informe.js';
import { verificarExport, type ResultadoVerificacion } from './verificar.js';

export interface EntornoPrograma {
  /** Escribe una línea en la salida. */
  readonly escribir: (linea: string) => void;
  /** Abre el export de una ruta. Inyectable para que los tests usen fuentes en memoria. */
  readonly abrir: (ruta: string) => Promise<ExportSource>;
  /** Lee un fichero suelto (el padrón de `--confianza`). */
  readonly leerFichero: (ruta: string) => Promise<string>;
  /** Instante actual, RFC 3339 UTC. */
  readonly ahora: () => string;
}

export interface Argumentos {
  readonly ruta: string | undefined;
  readonly explicar: boolean;
  readonly ayuda: boolean;
  readonly version: boolean;
  readonly confianza: string | undefined;
  readonly ahora: string | undefined;
  readonly ancho: number | undefined;
  readonly error: string | undefined;
}

export const VERSION = '0.1.0';

export function analizarArgumentos(argv: readonly string[]): Argumentos {
  let ruta: string | undefined;
  let explicar = false;
  let ayuda = false;
  let version = false;
  let confianza: string | undefined;
  let ahora: string | undefined;
  let ancho: number | undefined;
  let error: string | undefined;

  const pendiente = [...argv];
  // `revisar` es opcional: `npx @koinonia/verificar <ruta>` tiene que funcionar tal cual, porque es
  // lo que la gente va a copiar del cartel de la asamblea.
  if (pendiente[0] === 'revisar') pendiente.shift();

  while (pendiente.length > 0) {
    const argumento = pendiente.shift() ?? '';
    switch (argumento) {
      case '--explicar':
        explicar = true;
        break;
      case '--ayuda':
      case '-h':
      case '--help':
        ayuda = true;
        break;
      case '--version':
        version = true;
        break;
      case '--confianza': {
        const valor = pendiente.shift();
        if (valor === undefined) error ??= '--confianza necesita la ruta de un fichero';
        else confianza = valor;
        break;
      }
      case '--ahora': {
        const valor = pendiente.shift();
        if (valor === undefined) error ??= '--ahora necesita un instante';
        else ahora = valor;
        break;
      }
      case '--ancho': {
        const valor = Number(pendiente.shift());
        if (!Number.isSafeInteger(valor) || valor < 40)
          error ??= '--ancho necesita un entero >= 40';
        else ancho = valor;
        break;
      }
      default:
        if (argumento.startsWith('-')) error ??= `opción desconocida: ${argumento}`;
        else if (ruta === undefined) ruta = argumento;
        else error ??= 'sólo se admite una ruta';
    }
  }

  return { ruta, explicar, ayuda, version, confianza, ahora, ancho, error };
}

export const AYUDA: readonly string[] = [
  '',
  'Koinonía — verificador independiente',
  '',
  '  npx @koinonia/verificar <ruta-al-paquete>',
  '',
  'Comprueba que la historia de decisiones de un paquete exportado no fue alterada.',
  'NO habla con ningún servidor: todo se comprueba sobre los ficheros del paquete.',
  '',
  'Opciones:',
  '  --explicar            describe en prosa qué hace cada paso y por qué',
  '  --confianza <fichero> padrón de claves de la veeduría obtenido POR OTRO CANAL.',
  '                        Sin esta opción se usa el del propio paquete, que prueba menos.',
  '  --ahora <instante>    instante de referencia RFC 3339 (por defecto, el reloj del sistema)',
  '  --ancho <columnas>    ancho del informe (por defecto 78)',
  '  --version             muestra la versión',
  '  --ayuda               muestra esta ayuda',
  '',
  'Códigos de salida:',
  ...SALIDAS_EXPLICADAS.map(([codigo, texto]) => `  ${String(codigo)}  ${texto}`),
  '',
];

export interface ResultadoPrograma {
  readonly codigo: CodigoSalida;
  readonly verificacion: ResultadoVerificacion | undefined;
}

export async function ejecutar(
  argv: readonly string[],
  entorno: EntornoPrograma,
): Promise<ResultadoPrograma> {
  const args = analizarArgumentos(argv);

  if (args.ayuda) {
    for (const linea of AYUDA) entorno.escribir(linea);
    return { codigo: SALIDA.ok, verificacion: undefined };
  }
  if (args.version) {
    entorno.escribir(VERSION);
    return { codigo: SALIDA.ok, verificacion: undefined };
  }
  if (args.error !== undefined) {
    entorno.escribir(`Error: ${args.error}`);
    entorno.escribir('Probá `npx @koinonia/verificar --ayuda`.');
    return { codigo: SALIDA.uso, verificacion: undefined };
  }
  if (args.ruta === undefined) {
    entorno.escribir('Error: falta la ruta del paquete que querés comprobar.');
    entorno.escribir('Probá `npx @koinonia/verificar --ayuda`.');
    return { codigo: SALIDA.uso, verificacion: undefined };
  }

  let source: ExportSource;
  try {
    source = await entorno.abrir(args.ruta);
  } catch (error) {
    entorno.escribir(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return { codigo: SALIDA.uso, verificacion: undefined };
  }

  let confianza: TrustRoster | undefined;
  if (args.confianza !== undefined) {
    try {
      confianza = parseTrustRoster(args.confianza, await entorno.leerFichero(args.confianza));
    } catch (error) {
      entorno.escribir(
        `Error: no se pudo leer el padrón de confianza (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
      return { codigo: SALIDA.uso, verificacion: undefined };
    }
  }

  const explicaciones: string[] = [];
  const verificacion = await verificarExport({
    source,
    ...(confianza === undefined ? {} : { confianza }),
    ahora: args.ahora ?? entorno.ahora(),
    ...(args.explicar
      ? {
          explicar: (texto: string): void => {
            explicaciones.push(texto);
          },
        }
      : {}),
  });

  if (args.explicar) {
    entorno.escribir('');
    entorno.escribir('QUÉ VOY A HACER Y POR QUÉ');
    entorno.escribir('─'.repeat(args.ancho ?? 78));
    for (const [indice, texto] of explicaciones.entries()) {
      entorno.escribir('');
      entorno.escribir(`  ${String(indice + 1)}.`);
      for (const linea of envolverTexto(texto, args.ancho ?? 78)) entorno.escribir(linea);
    }
  }

  for (const linea of renderInforme(verificacion, {
    ruta: args.ruta,
    ...(args.ancho === undefined ? {} : { ancho: args.ancho }),
  })) {
    entorno.escribir(linea);
  }

  return { codigo: verificacion.salida, verificacion };
}

function envolverTexto(texto: string, ancho: number): readonly string[] {
  const palabras = texto.split(/\s+/u).filter((palabra) => palabra !== '');
  const util = Math.max(20, ancho - 6);
  const lineas: string[] = [];
  let actual = '';
  for (const palabra of palabras) {
    if (actual === '') actual = palabra;
    else if (actual.length + 1 + palabra.length <= util) actual += ` ${palabra}`;
    else {
      lineas.push(`      ${actual}`);
      actual = palabra;
    }
  }
  if (actual !== '') lineas.push(`      ${actual}`);
  return lineas;
}
