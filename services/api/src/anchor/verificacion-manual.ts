/**
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *  COMPROBACIÓN MANUAL DEL ANCLAJE — **NO ES UN TEST Y NO DEBE SERLO**
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Este fichero sale a internet. Está fuera de la suite a propósito: un test que dependa de que
 * `opentimestamps.org` esté en pie fallaría los días que ese servicio esté saturado, alguien lo
 * marcaría como `skip`, y el día que el cliente HTTP se rompiera de verdad nadie se enteraría. La
 * suite prueba todo lo que no es el diálogo HTTP; esto prueba el diálogo HTTP, y lo corre una
 * persona.
 *
 * ─── CÓMO SE CORRE ──────────────────────────────────────────────────────────────────────────
 *
 * Con el proyecto compilado (`pnpm build`):
 *
 *     node services/api/dist/anchor/verificacion-manual.js sellar
 *     node services/api/dist/anchor/verificacion-manual.js madurar
 *     node services/api/dist/anchor/verificacion-manual.js verificar
 *
 * Órdenes:
 *
 *   `sellar`     Sella un resumen contra calendarios reales y escribe dos ficheros en
 *                `./checkpoints-local/` (que está en `.gitignore`):
 *                  · `<hex>.bin`      los 32 bytes del `checkpointHash`. Es «el fichero sellado».
 *                  · `<hex>.bin.ots`  el sello.
 *   `madurar`    Vuelve a pedir a los calendarios que injerten el camino hasta el bloque. Hay que
 *                esperar entre 1 y 6 horas desde `sellar`; antes devuelve «todavía no».
 *   `verificar`  Pasa el `.ots` por NUESTRO verificador y enseña lo que afirma y lo que le falta.
 *
 * Opciones: `--hash <64 hex>` (por defecto, uno derivado de la fecha), `--dir <ruta>`,
 * `--pool` (usa `a.pool.opentimestamps.org` en vez de los cuatro calendarios nombrados),
 * `--calendario <uri>` (repetible).
 *
 * ─── QUÉ TIENE QUE SALIR ────────────────────────────────────────────────────────────────────
 *
 * `sellar`, con todo bien, imprime una línea por calendario que respondió y termina con
 * `SELLADO`. El `.ots` recién hecho contiene **una atestación pendiente por calendario** y ninguna
 * de Bitcoin: eso es correcto y es lo normal. Si un calendario está caído, aparece en `FALLARON` y
 * el sello se hace igual con los demás; si fallan todos, la orden termina con código 1.
 *
 * `madurar`, antes de 1-6 h, imprime `TODAVÍA NO` y sale con código 0: no es un error.
 * Después, imprime `MADURADO` y la altura del bloque.
 *
 * `verificar` imprime `pendiente` mientras no haya bloque; con el sello maduro y sin cabeceras de
 * Bitcoin a mano imprime **`incompleto`** y la afirmación que le falta —«el bloque N tiene esta
 * raíz de Merkle»—. **`incompleto` es el resultado correcto**: quiere decir que el verificador se
 * niega a dar por buena una afirmación que no puede comprobar. Un `confirmado` aquí, sin cabeceras,
 * sería un fallo grave.
 *
 * ─── EL CONTRASTE QUE DE VERDAD IMPORTA ─────────────────────────────────────────────────────
 *
 * Nuestro código escribiendo un `.ots` y nuestro código leyéndolo no prueba que el fichero sea
 * legítimo: prueba que somos consistentes con nosotros mismos. Lo que lo prueba es el **cliente
 * oficial**, que no ha visto este repositorio:
 *
 *     pipx install opentimestamps-client     # o: pip install --user opentimestamps-client
 *     cd checkpoints-local
 *     ots info   <hex>.bin.ots               # debe listar las mismas atestaciones pendientes
 *     ots upgrade <hex>.bin.ots              # tras 1-6 h
 *     ots verify <hex>.bin.ots               # busca <hex>.bin al lado
 *
 * `ots verify` con un sello maduro imprime `Success! Bitcoin block <N> attests existence as of
 * <fecha>`. Si `ots info` no puede leer nuestro fichero, **el fichero está mal y el problema es
 * nuestro**, por mucho que nuestro verificador lo lea.
 *
 * ─── C17 ────────────────────────────────────────────────────────────────────────────────────
 *
 * Esta orden habla con servicios externos y no registra ninguna dirección IP: imprime nombres de
 * calendario, que son configuración, y nada más.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

import {
  applyOp,
  CalendarPoolError,
  NO_HEADERS,
  OpenTimestampsProvider,
  parseDetachedTimestamp,
  RetriesExhaustedError,
  walk,
  type AnchorReceipt,
  type OtsCalendarClient,
} from '@koinonia/anchor';
import { fromBase64Url, fromHex, sha256, toBase64Url, toHex } from '@koinonia/crypto';

import { calendariosDeProduccion, CALENDARIOS_PUBLICOS, POOL_DE_PRUEBA } from './calendarios.js';

const salida = (texto: string): void => {
  process.stdout.write(`${texto}\n`);
};

interface Opciones {
  readonly orden: string;
  readonly hash: string;
  readonly dir: string;
  readonly uris: readonly string[];
}

function leerArgumentos(argv: readonly string[]): Opciones {
  const orden = argv[0] ?? 'ayuda';
  let hash: string | undefined;
  let dir = 'checkpoints-local';
  const calendarios: string[] = [];
  let pool = false;

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--hash') hash = argv[++i];
    else if (arg === '--dir') dir = argv[++i] ?? dir;
    else if (arg === '--calendario') {
      const uri = argv[++i];
      if (uri !== undefined) calendarios.push(uri);
    } else if (arg === '--pool') pool = true;
  }

  const uris =
    calendarios.length > 0 ? calendarios : pool ? [POOL_DE_PRUEBA] : CALENDARIOS_PUBLICOS;
  return { orden, hash: hash ?? hashDelDia(), dir, uris };
}

/**
 * Resumen de prueba derivado del día, no aleatorio.
 *
 * Correr la orden dos veces el mismo día sella **el mismo** resumen, y eso es lo que se quiere: el
 * segundo sello debe poder fusionarse con el primero. Un valor aleatorio obligaría a apuntar el hash
 * a mano entre `sellar` y `madurar`, que es exactamente el paso donde una comprobación manual se
 * abandona.
 */
function hashDelDia(): string {
  const dia = new Date().toISOString().slice(0, 10);
  let semilla = '';
  for (const caracter of `koinonia-comprobacion-manual-${dia}`) {
    semilla += caracter.codePointAt(0)?.toString(16).padStart(4, '0') ?? '0000';
  }
  return semilla.slice(0, 64).padEnd(64, '0');
}

function rutas(opciones: Opciones): { readonly bin: string; readonly ots: string } {
  return {
    bin: join(opciones.dir, `${opciones.hash}.bin`),
    ots: join(opciones.dir, `${opciones.hash}.bin.ots`),
  };
}

function describirFallo(error: unknown): readonly string[] {
  if (error instanceof CalendarPoolError) {
    return [...error.failures].map(([uri, motivo]) => `  · ${uri} → ${recorte(motivo)}`);
  }
  if (error instanceof RetriesExhaustedError) return [`  · ${recorte(error.message)}`];
  return [`  · ${recorte(error instanceof Error ? error.message : String(error))}`];
}

function recorte(texto: string): string {
  const limpio = texto.replace(/\s+/gu, ' ').trim();
  return limpio.length > 300 ? `${limpio.slice(0, 300)}…` : limpio;
}

async function describirSello(bytes: Uint8Array): Promise<readonly string[]> {
  const detached = await parseDetachedTimestamp(bytes);
  return walk(detached.timestamp).map((hoja) => {
    const a = hoja.attestation;
    if (a.kind === 'pending') return `  pendiente en ${a.uri}`;
    if (a.kind === 'bitcoin')
      return `  BITCOIN bloque ${String(a.height)} · raíz ${toHex(hoja.digest)}`;
    return `  ${a.kind}`;
  });
}

function calendarios(opciones: Opciones): OtsCalendarClient {
  return calendariosDeProduccion({ uris: opciones.uris });
}

async function sellar(opciones: Opciones): Promise<number> {
  const checkpointHash = fromHex(opciones.hash);
  const { bin, ots } = rutas(opciones);
  await mkdir(opciones.dir, { recursive: true });

  salida(`Sellando ${opciones.hash}`);
  for (const uri of opciones.uris) salida(`  → ${uri}`);

  const fileDigest = await applyOp({ kind: 'sha256' }, checkpointHash);
  salida(`SHA256(checkpointHash) = ${toHex(fileDigest)}`);

  let bytes: Uint8Array;
  try {
    bytes = await calendarios(opciones).stamp(fileDigest);
  } catch (error) {
    salida('FALLARON todos los calendarios:');
    for (const linea of describirFallo(error)) salida(linea);
    return 1;
  }

  await writeFile(bin, checkpointHash);
  await writeFile(ots, bytes);

  salida('');
  salida('El sello contiene:');
  for (const linea of await describirSello(bytes)) salida(linea);
  salida('');
  salida(`Escrito ${bin} (32 B) y ${ots} (${String(bytes.length)} B)`);
  salida('SELLADO. Volvé dentro de 1-6 h y corré `madurar`.');
  salida(`Contraste independiente:  ots info ${ots}`);
  return 0;
}

async function madurar(opciones: Opciones): Promise<number> {
  const { ots } = rutas(opciones);
  const antes = new Uint8Array(await readFile(ots));

  let despues: Uint8Array | undefined;
  try {
    despues = await calendarios(opciones).upgrade(antes);
  } catch (error) {
    salida('FALLARON todos los calendarios al madurar:');
    for (const linea of describirFallo(error)) salida(linea);
    return 1;
  }

  if (despues === undefined) {
    salida('TODAVÍA NO: ningún calendario tiene aún el camino hasta un bloque.');
    salida('Es lo normal durante las primeras horas. No es un error.');
    return 0;
  }

  await writeFile(ots, despues);
  salida('El sello contiene ahora:');
  for (const linea of await describirSello(despues)) salida(linea);
  salida('');
  salida(`MADURADO. Reescrito ${ots} (${String(despues.length)} B).`);
  salida(`Contraste independiente:  ots verify ${ots}`);
  return 0;
}

async function verificar(opciones: Opciones): Promise<number> {
  const { ots } = rutas(opciones);
  const bytes = new Uint8Array(await readFile(ots));
  const checkpointHash = fromHex(opciones.hash);

  const recibo: AnchorReceipt = {
    provider: 'ots',
    independenceClass: 'blockchain',
    checkpointHash: opciones.hash,
    externalRef: opciones.uris[0] ?? 'calendario',
    submittedAt: new Date().toISOString().replace(/\.\d+Z$/u, '.000Z'),
    proof: toBase64Url(bytes),
    raw: {},
  };

  // Sin cabeceras de Bitcoin a propósito: así se ve que el verificador dice `incompleto` en vez de
  // dar por buena la afirmación que no puede comprobar.
  const proveedor = new OpenTimestampsProvider({
    headers: NO_HEADERS,
    clock: () => recibo.submittedAt,
  });
  const resultado = await proveedor.verify(recibo, checkpointHash);

  salida(`estado: ${resultado.status}`);
  salida(`sin red: ${String(resultado.offline)}`);
  salida(resultado.detail);
  salida('');
  salida('Comprobaciones:');
  for (const check of resultado.checks)
    salida(`  [${check.ok ? 'ok' : '  '}] ${check.name}: ${check.detail}`);
  if (resultado.residualClaims.length > 0) {
    salida('');
    salida('Lo que NO se pudo cerrar sin un dato externo:');
    for (const claim of resultado.residualClaims) {
      salida(`  · ${claim.claim}`);
      salida(`    → ${claim.verifyBy}`);
    }
  }
  // `incompleto` y `pendiente` son resultados correctos aquí; `invalido` no lo es.
  return resultado.status === 'invalido' ? 1 : 0;
}

function ayuda(): number {
  salida('Uso: verificacion-manual.js <sellar|madurar|verificar> [--hash <64hex>] [--dir <ruta>]');
  salida('                            [--pool] [--calendario <uri>]…');
  salida('');
  salida('Leé la cabecera de este fichero: dice qué tiene que salir en cada caso.');
  return 2;
}

async function main(): Promise<number> {
  const opciones = leerArgumentos(process.argv.slice(2));
  switch (opciones.orden) {
    case 'sellar':
      return sellar(opciones);
    case 'madurar':
      return madurar(opciones);
    case 'verificar':
      return verificar(opciones);
    default:
      return Promise.resolve(ayuda());
  }
}

// Sólo se ejecuta si se invoca directamente. Importarlo desde una prueba no dispara nada, que es lo
// que permite que este fichero viva dentro de `src/` sin que la suite salga a la red por accidente.
if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/gu, '/'))
) {
  main().then(
    (codigo) => {
      process.exitCode = codigo;
    },
    (error: unknown) => {
      salida(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    },
  );
}

export { leerArgumentos, hashDelDia, main };

/** Reexportado para que una prueba pueda comprobar el formato sin ejecutar nada. */
export { fromBase64Url, sha256 };
