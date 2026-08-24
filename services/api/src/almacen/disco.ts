/**
 * `almacenEnDisco`: la implementación real de `AlmacenDeObjetos` sobre el sistema de ficheros local.
 *
 * ═══ El contenido y sus metadatos van en dos ficheros separados ═══
 *
 * `<base>/<clave>` guarda los bytes tal cual; `<base>/<clave>.meta.json` guarda `sha256`,
 * `tipoDeContenido` y `guardadoEn`. Incrustar los metadatos en el propio fichero (p.ej. un prefijo)
 * obligaría a parsear cada lectura y contaminaría el contenido que alguien más pueda esperar
 * intacto; guardarlos aparte es lo que después hace trivial migrar a S3, donde los metadatos viajan
 * en la cabecera HTTP del objeto y no en su cuerpo.
 *
 * ═══ Escritura atómica ═══
 *
 * `guardar` escribe primero a `<destino>.tmp-<al azar>` y recién al final hace `rename()` al nombre
 * definitivo. `rename()` en el mismo sistema de ficheros es atómico en POSIX: nadie puede observar
 * un fichero a medio escribir con el nombre final, ni aunque el proceso se caiga entre el `write` y
 * el `rename` — en ese caso sólo queda un `.tmp-*` huérfano, nunca un objeto corrupto con el nombre
 * que alguien más espera leer.
 *
 * ═══ Qué pasa si el contenido está pero falta el sidecar de metadatos ═══
 *
 * No se inventan metadatos plausibles (recalcular el sha256 y adivinar el tipo de contenido por la
 * extensión). Eso escondería una escritura a medias o una manipulación directa del disco detrás de
 * una lectura que parece normal — el mismo principio que gobierna todo el ledger: mejor un error
 * ruidoso que una reconstrucción silenciosa que podría estar mintiendo.
 */

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  type AlmacenDeObjetos,
  type MetadatosDeObjeto,
  type ObjetoLeido,
  type OpcionesDeGuardado,
  validarClave,
  validarPrefijo,
} from './puerto.js';

const SUFIJO_DE_METADATOS = '.meta.json';

/** El objeto existe pero su sidecar de metadatos no. Ver la cabecera del fichero. */
export class ObjetoCorruptoError extends Error {
  constructor(clave: string) {
    super(
      `el objeto '${clave}' existe en disco pero le falta el fichero de metadatos — no se ` +
        'reconstruye a ciegas: hay que investigar cómo se perdió',
    );
    this.name = 'ObjetoCorruptoError';
  }
}

interface MetadatosEnDisco {
  readonly tamanoBytes: number;
  readonly sha256: string;
  readonly tipoDeContenido: string;
  readonly guardadoEn: string;
}

export function almacenEnDisco(directorioBase: string): AlmacenDeObjetos {
  const base = path.resolve(directorioBase);

  /** Traduce la clave a una ruta dentro de `base`, y comprueba que no se salió — cinturón y tirantes. */
  function rutaDe(clave: string): string {
    validarClave(clave);
    const ruta = path.resolve(base, clave);
    const relativa = path.relative(base, ruta);
    if (relativa.startsWith('..') || path.isAbsolute(relativa)) {
      // `validarClave` ya debería haber atrapado cualquier clave capaz de llegar hasta acá; si
      // pasó, es un bug en esa validación y no una entrada que simplemente se rechaza — por eso
      // esto lanza en vez de devolver `false` como lo hacen `existe`/`leer`.
      throw new Error(`ruta fuera del almacén tras resolver la clave: ${clave}`);
    }
    return ruta;
  }

  async function existeFichero(ruta: string): Promise<boolean> {
    try {
      await stat(ruta);
      return true;
    } catch {
      return false;
    }
  }

  return {
    async guardar(
      clave: string,
      contenido: Uint8Array,
      opciones: OpcionesDeGuardado,
    ): Promise<MetadatosDeObjeto> {
      const destino = rutaDe(clave);
      await mkdir(path.dirname(destino), { recursive: true });

      const sha256 = createHash('sha256').update(contenido).digest('hex');
      const meta: MetadatosEnDisco = {
        tamanoBytes: contenido.byteLength,
        sha256,
        tipoDeContenido: opciones.tipoDeContenido,
        guardadoEn: opciones.ahora,
      };

      const sufijoTemporal = randomBytes(8).toString('hex');
      const tmpContenido = `${destino}.tmp-${sufijoTemporal}`;
      const tmpMeta = `${destino}${SUFIJO_DE_METADATOS}.tmp-${sufijoTemporal}`;
      try {
        await writeFile(tmpContenido, contenido);
        await writeFile(tmpMeta, JSON.stringify(meta), 'utf8');
        // El contenido se publica antes que sus metadatos: si el proceso muere entre los dos
        // `rename`, lo peor que puede pasar es un objeto sin sidecar todavía — que `leer` rechaza
        // ruidosamente (`ObjetoCorruptoError`) — nunca un sidecar apuntando a contenido ausente.
        await rename(tmpContenido, destino);
        await rename(tmpMeta, `${destino}${SUFIJO_DE_METADATOS}`);
      } catch (error) {
        await rm(tmpContenido, { force: true });
        await rm(tmpMeta, { force: true });
        throw error;
      }

      return meta;
    },

    async leer(clave: string): Promise<ObjetoLeido | undefined> {
      const destino = rutaDe(clave);
      if (!(await existeFichero(destino))) return undefined;

      const rutaMeta = `${destino}${SUFIJO_DE_METADATOS}`;
      if (!(await existeFichero(rutaMeta))) throw new ObjetoCorruptoError(clave);

      const [contenido, crudo] = await Promise.all([readFile(destino), readFile(rutaMeta, 'utf8')]);
      const meta = JSON.parse(crudo) as MetadatosEnDisco;
      return { contenido: new Uint8Array(contenido), meta };
    },

    async existe(clave: string): Promise<boolean> {
      return existeFichero(rutaDe(clave));
    },

    async borrar(clave: string): Promise<void> {
      const destino = rutaDe(clave);
      await rm(destino, { force: true });
      await rm(`${destino}${SUFIJO_DE_METADATOS}`, { force: true });
    },

    async listar(prefijo: string): Promise<readonly string[]> {
      validarPrefijo(prefijo);
      const claves: string[] = [];
      await recorrer(base, base, claves);
      return claves.filter((clave) => clave.startsWith(prefijo)).sort();
    },
  };
}

/** Recorrido recursivo del árbol, acumulando claves relativas a `base` (siempre con `/`, no `\`). */
async function recorrer(base: string, directorio: string, acumulador: string[]): Promise<void> {
  let entradas;
  try {
    entradas = await readdir(directorio, { withFileTypes: true });
  } catch {
    return; // el directorio base puede no existir todavía si nunca se guardó nada
  }
  for (const entrada of entradas) {
    const ruta = path.join(directorio, entrada.name);
    if (entrada.isDirectory()) {
      await recorrer(base, ruta, acumulador);
      continue;
    }
    if (entrada.name.endsWith(SUFIJO_DE_METADATOS) || entrada.name.includes('.tmp-')) continue;
    acumulador.push(path.relative(base, ruta).split(path.sep).join('/'));
  }
}
