/**
 * Clientes reales de forja: **Codeberg (Forgejo)** y **GitHub**.
 *
 * ═══ El problema que había que resolver ═══
 *
 * La verificación necesita los **bytes exactos** del objeto commit: sin ellos no se puede recalcular
 * el OID ni comprobar la firma `SSHSIG`, que se hace sobre el objeto sin la cabecera `gpgsig`.
 * Ninguna de las dos forjas expone el objeto crudo por su API REST: las dos devuelven JSON.
 *
 * Lo que sí devuelven las dos, y esto es lo que lo hace posible, es `verification.payload` —el objeto
 * **sin** la cabecera de firma, es decir, exactamente lo que se firmó— y `verification.signature`
 * —la armadura—. Con esas dos piezas el objeto se **reconstruye**.
 *
 * ═══ Y por qué reconstruir no es adivinar ═══
 *
 * Porque el resultado se contrasta contra el OID que se pidió. `SHA1("commit " ‖ len ‖ 0 ‖ bytes)`
 * tiene que dar exactamente el identificador solicitado; si no da, la reconstrucción se rechaza y se
 * dice por qué. Una reconstrucción mal colocada no produce un anclaje débil: produce un error. La
 * única forma de que pase una reconstrucción falsa es una colisión de SHA-1, y de eso se ocupa
 * `crossCheckForges()` comparando además los bytes.
 *
 * ═══ Lo que este módulo NO hace ═══
 *
 * No decide si el anclaje vale. Devuelve bytes; comparar las dos forjas y detectar el `push --force`
 * es de `SignedGitProvider.poll()`, en `packages/anchor`, donde se puede probar sin red.
 */

import { commitOid, type GitForgeClient } from '@koinonia/anchor';

import { getJson, type HttpOptions } from './http.js';

const UTF8 = new TextEncoder();

export interface ForgeRepoOptions {
  /** Base de la API. Para Codeberg, `https://codeberg.org`; para GitHub, `https://api.github.com`. */
  readonly baseUrl?: string;
  readonly owner: string;
  readonly repo: string;
  /** Rama de anclaje. Es donde vive `CHECKPOINTS.txt`. */
  readonly branch: string;
  /** Nombre con el que la forja aparece en el padrón y en el recibo. */
  readonly name?: string;
  /** Token de sólo lectura, si el repositorio es privado o para subir el límite de peticiones. */
  readonly token?: string;
  readonly http?: HttpOptions;
}

export class ForgeReconstructionError extends Error {
  readonly forge: string;
  readonly oid: string;

  constructor(forge: string, oid: string, detail: string) {
    super(`la forja ${forge} entregó un commit que no se puede reconstruir (${oid}): ${detail}`);
    this.name = 'ForgeReconstructionError';
    this.forge = forge;
    this.oid = oid;
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Reconstrucción del objeto commit
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Coloca la cabecera `gpgsig` dentro del payload firmado, en cada sitio donde git podría haberla
 * escrito.
 *
 * Git la añade como cabecera extra después de `committer`, pero un commit con `encoding` o con
 * `mergetag` la lleva más abajo. En vez de suponer, se generan las colocaciones plausibles y **gana
 * la que reproduce el OID**. Suponer y acertar el 99 % de las veces sería lo peor de los dos mundos:
 * funcionaría en las pruebas y fallaría el día que la veeduría firmara desde un git con otra
 * configuración.
 */
export function colocacionesDeFirma(payload: string, signature: string): readonly string[] {
  const corte = payload.indexOf('\n\n');
  if (corte === -1) return [];

  const cabeceras = payload.slice(0, corte).split('\n');
  const resto = payload.slice(corte);

  // ERRATA (hallada contra las APIs REALES, 2026-08-22): el salto de línea final de la armadura
  // **cuenta**, y no se comporta igual en los dos casos. Un commit firmado con PGP necesita
  // conservarlo —git guarda el valor de la cabecera con ese salto, lo que produce una última línea
  // de continuación que es un espacio suelto— y uno firmado con `ssh-keygen -Y sign` necesita que se
  // recorte. No es una diferencia entre forjas sino entre **formatos de firma**, y ninguna lectura
  // de la documentación lo dice: apareció reconstruyendo un commit real de cada una.
  //
  // Por eso no se elige: se generan las cuatro combinaciones y **gana la que reproduce el OID**.
  // Acertar por razonamiento el 99 % de las veces sería lo peor de los dos mundos.
  const armaduras = [signature, signature.replace(/[\r\n]+$/u, '')];

  const posiciones = new Set<number>();
  const trasCommitter = cabeceras.findIndex((linea) => linea.startsWith('committer '));
  if (trasCommitter !== -1) posiciones.add(trasCommitter + 1);
  posiciones.add(cabeceras.length);

  const salida: string[] = [];
  for (const armadura of new Set(armaduras)) {
    const lineas = [
      `gpgsig ${armadura.split('\n')[0] ?? ''}`,
      ...armadura
        .split('\n')
        .slice(1)
        .map((linea) => ` ${linea}`),
    ];
    for (const posicion of posiciones) {
      salida.push(
        [...cabeceras.slice(0, posicion), ...lineas, ...cabeceras.slice(posicion)].join('\n') +
          resto,
      );
    }
  }
  return salida;
}

/**
 * Reconstruye los bytes del objeto commit y **exige** que produzcan el OID pedido.
 *
 * Un payload vacío significa «este commit no está firmado». No se reconstruye nada: un commit sin
 * firma no ancla, y devolverlo como si anclara sería el error que hace inútil todo el mecanismo.
 */
export async function reconstruirCommitFirmado(input: {
  readonly forge: string;
  readonly oid: string;
  readonly payload: string;
  readonly signature: string;
}): Promise<Uint8Array> {
  if (input.payload === '' || input.signature === '') {
    throw new ForgeReconstructionError(
      input.forge,
      input.oid,
      'la forja no trae firma para este commit: un commit sin firmar sólo prueba que alguien con ' +
        'acceso de escritura lo escribió, y ese alguien puede ser el propio administrador',
    );
  }

  const intentos = colocacionesDeFirma(input.payload, input.signature);
  if (intentos.length === 0) {
    throw new ForgeReconstructionError(
      input.forge,
      input.oid,
      'el payload firmado no tiene línea en blanco entre cabeceras y mensaje',
    );
  }

  for (const candidato of intentos) {
    const bytes = UTF8.encode(candidato);
    if ((await commitOid(bytes)) === input.oid) return bytes;
  }

  throw new ForgeReconstructionError(
    input.forge,
    input.oid,
    `ninguna de las ${String(intentos.length)} reconstrucciones reproduce el identificador que la ` +
      'forja declara. O el payload no es el del commit que se pidió, o la forja lo alteró',
  );
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Lectura de las respuestas JSON
// ═════════════════════════════════════════════════════════════════════════════════════════════

function comoObjeto(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function comoTexto(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

const OID = /^[0-9a-f]{40}$/u;

/** Extrae `{payload, signature}` de la respuesta, sea de GitHub o de Forgejo. */
export function leerVerificacion(
  cuerpo: unknown,
): { readonly payload: string; readonly signature: string } | undefined {
  const raiz = comoObjeto(cuerpo);
  if (raiz === undefined) return undefined;
  // GitHub la pone en la raíz; Forgejo, dentro de `commit`.
  const anidado = comoObjeto(raiz['commit']);
  const verification =
    comoObjeto(raiz['verification']) ??
    (anidado === undefined ? undefined : comoObjeto(anidado['verification']));
  if (verification === undefined) return undefined;

  const payload = comoTexto(verification['payload']);
  const signature = comoTexto(verification['signature']);
  if (payload === undefined || signature === undefined) return undefined;
  return { payload, signature };
}

/** Extrae el identificador del commit de la respuesta de `head`, sea `object.sha`, `sha` o `commit.id`. */
export function leerOid(cuerpo: unknown): string | undefined {
  const raiz = comoObjeto(cuerpo);
  if (raiz === undefined) return undefined;
  const candidatos = [
    comoTexto(raiz['sha']),
    comoTexto(comoObjeto(raiz['object'])?.['sha']),
    comoTexto(comoObjeto(raiz['commit'])?.['id']),
    comoTexto(comoObjeto(raiz['commit'])?.['sha']),
  ];
  return candidatos.find((valor) => valor !== undefined && OID.test(valor));
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Los dos clientes
// ═════════════════════════════════════════════════════════════════════════════════════════════

interface Rutas {
  readonly head: (o: ForgeRepoOptions) => string;
  readonly commit: (o: ForgeRepoOptions, oid: string) => string;
  readonly auth: (token: string) => Readonly<Record<string, string>>;
  readonly baseUrl: string;
  readonly name: string;
}

function clienteDeForja(rutas: Rutas, options: ForgeRepoOptions): GitForgeClient {
  const name = options.name ?? rutas.name;
  const base = (options.baseUrl ?? rutas.baseUrl).replace(/\/+$/u, '');
  const conBase = { ...options, baseUrl: base };
  const http: HttpOptions = {
    ...options.http,
    headers: {
      ...options.http?.headers,
      ...(options.token === undefined ? {} : rutas.auth(options.token)),
    },
  };

  return {
    name,
    async head(): Promise<string | undefined> {
      const cuerpo = await getJson(rutas.head(conBase), http);
      return leerOid(cuerpo);
    },
    async fetchCommit(oid: string): Promise<Uint8Array | undefined> {
      if (!OID.test(oid)) return undefined;
      const cuerpo = await getJson(rutas.commit(conBase, oid), http);
      const verificacion = leerVerificacion(cuerpo);
      if (verificacion === undefined) return undefined;
      return reconstruirCommitFirmado({ forge: name, oid, ...verificacion });
    },
  };
}

/**
 * Codeberg, que corre Forgejo. API v1, compatible con la de Gitea.
 *
 * Se pone primero en el padrón a propósito: es una asociación sin ánimo de lucro alemana, sin
 * relación con la otra forja ni con nadie del instituto, y esa falta de relación es literalmente lo
 * que se está comprando. Dos forjas del mismo dueño son una sola forja con dos nombres.
 */
export function codebergForge(options: ForgeRepoOptions): GitForgeClient {
  return clienteDeForja(
    {
      name: 'codeberg',
      baseUrl: 'https://codeberg.org',
      head: (o) =>
        `${o.baseUrl ?? ''}/api/v1/repos/${enc(o.owner)}/${enc(o.repo)}/branches/${enc(o.branch)}`,
      commit: (o, oid) =>
        `${o.baseUrl ?? ''}/api/v1/repos/${enc(o.owner)}/${enc(o.repo)}/git/commits/${oid}`,
      auth: (token) => ({ Authorization: `token ${token}` }),
    },
    options,
  );
}

export function githubForge(options: ForgeRepoOptions): GitForgeClient {
  return clienteDeForja(
    {
      name: 'github',
      baseUrl: 'https://api.github.com',
      head: (o) =>
        `${o.baseUrl ?? ''}/repos/${enc(o.owner)}/${enc(o.repo)}/git/ref/heads/${enc(o.branch)}`,
      commit: (o, oid) =>
        `${o.baseUrl ?? ''}/repos/${enc(o.owner)}/${enc(o.repo)}/git/commits/${oid}`,
      auth: (token) => ({ Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' }),
    },
    options,
  );
}

function enc(segmento: string): string {
  return encodeURIComponent(segmento);
}
