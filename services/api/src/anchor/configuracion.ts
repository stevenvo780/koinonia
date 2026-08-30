/**
 * La configuración del anclaje, leída de variables de entorno.
 *
 * ═══ Tres reglas, y ninguna es de estilo ═══
 *
 * **1. Ningún secreto vive aquí.** Ni una clave, ni una contraseña, ni un token. Lo que este fichero
 * contiene son *nombres* de variables. La clave DKIM entra por **ruta a un fichero**, no por
 * contenido: una clave privada en una variable de entorno acaba en `docker inspect`, en el registro
 * del orquestador y en el `ps` de cualquiera con una sesión en la máquina.
 *
 * **2. Los valores por defecto son los seguros, no los cómodos.** El caso es
 * `signingKeyOffHost`: su defecto es `false`, que es el pesimista, porque declarar que la clave de
 * la veeduría vive fuera del servidor es una afirmación sobre el despliegue y quien la haga tiene
 * que escribirla. Con defecto `true`, un despliegue mal hecho produciría un anclaje impecable de una
 * mentira; con defecto `false`, produce un anclaje que **no cuenta para el quórum y lo dice**.
 *
 * **3. Lo que falta no se inventa: se apaga y se nombra.** Sin firmantes no hay anclaje de git; sin
 * testigos ni SMTP no hay anclaje de correo. En vez de arrancarlos a medias con valores fingidos,
 * quedan fuera y `motivosDeAusencia` explica por qué. El quórum verá dos clases en vez de tres y lo
 * publicará como evento, que es exactamente la información que hace falta para arreglarlo.
 *
 * ⚠ Con el anclaje activo y **sólo** OpenTimestamps configurado, el veredicto NO será firme: §8.2
 * pide clases de independencia distintas. Eso no es un fallo de este módulo, es el estado real del
 * despliegue, y el sitio donde tiene que verse es el veredicto publicado.
 */

import { type AllowedSigner, type Witness } from '@koinonia/anchor';

import { CALENDARIOS_PUBLICOS } from './calendarios.js';
import { EXPLORADOR_POR_DEFECTO } from './cabeceras.js';
import { type ModoTls } from './smtp.js';

export interface ConfiguracionDeForja {
  readonly tipo: 'codeberg' | 'github';
  readonly owner: string;
  readonly repo: string;
  readonly branch: string;
  readonly token: string | undefined;
}

export interface ConfiguracionDeGit {
  readonly allowedSigners: readonly AllowedSigner[];
  readonly signingKeyOffHost: boolean;
  readonly forges: readonly string[];
  readonly minForges: number | undefined;
  readonly repos: readonly ConfiguracionDeForja[];
}

export interface ConfiguracionDeSmtp {
  readonly host: string;
  readonly port: number;
  readonly tls: ModoTls;
  readonly helo: string;
  readonly auth: { readonly user: string; readonly pass: string } | undefined;
}

export interface ConfiguracionDeImap {
  readonly host: string;
  readonly port: number;
  readonly tls: boolean;
  readonly user: string;
  readonly pass: string;
  readonly mailbox: string | undefined;
}

export interface ConfiguracionDeDkim {
  readonly domain: string;
  readonly selector: string;
  readonly algorithm: 'rsa-sha256' | 'ed25519-sha256';
  /** RUTA al fichero de la clave privada. Nunca la clave. */
  readonly privateKeyPath: string;
}

export interface ConfiguracionDeCorreo {
  readonly witnesses: readonly Witness[];
  readonly minDistinctDomains: number;
  readonly selfDomains: readonly string[];
  readonly from: string;
  readonly envelopeFrom: string;
  readonly messageIdDomain: string | undefined;
  readonly smtp: ConfiguracionDeSmtp;
  readonly imap: ConfiguracionDeImap | undefined;
  readonly dkim: ConfiguracionDeDkim | undefined;
}

export interface ConfiguracionDeAnclaje {
  readonly activo: boolean;
  /** Cada cuánto se emite un checkpoint nuevo y se ancla. `0` ⇒ no se emiten desde aquí. */
  readonly checkpointCadaMs: number;
  /** Cada cuánto se relee el estado de los anclajes pendientes con `poll: true`. */
  readonly pollCadaMs: number;
  /** Cuántos checkpoints hacia atrás se siguen intentando madurar. */
  readonly pendientesQueSeSiguen: number;
  readonly calendarios: readonly string[];
  readonly minCalendarios: number;
  readonly bloquesUrl: string;
  readonly git: ConfiguracionDeGit | undefined;
  readonly correo: ConfiguracionDeCorreo | undefined;
  /**
   * Cada cuánto se le pide a un testigo de carne y hueso que firme. **No** cada checkpoint.
   *
   * El corte de checkpoint es cada hora, y todos los proveedores corrían en cada corte. Para el
   * anclaje por correo eso significa **veinticuatro correos al día a cada testigo**, cada uno
   * pidiéndole dos órdenes en la consola y una respuesta. Nadie acepta eso, y por eso el padrón
   * seguía vacío: el problema no era encontrar gente dispuesta, era que lo que se le pedía era
   * inaceptable.
   *
   * Espaciarlo no debilita la garantía: los checkpoints encadenan, así que un testigo que firma el
   * de hoy está atestiguando también todo lo anterior. Lo que cambia es cuán reciente es la última
   * constancia firme —«lo ocurrido desde el último anclaje firme podría alterarse», que es
   * exactamente lo que el verificador ya dice—. Un día de ventana a cambio de que la clase exista
   * es un trato bueno; veinticuatro correos diarios a cambio de una clase que nadie sostiene, no.
   */
  readonly correoCadaMs: number;
  /** Por qué falta cada proveedor que falta. Se registra al arrancar: un hueco callado no existe. */
  readonly motivosDeAusencia: readonly string[];
}

type Entorno = Readonly<Partial<Record<string, string>>>;

function texto(env: Entorno, nombre: string): string | undefined {
  const valor = env[nombre];
  if (valor === undefined) return undefined;
  const limpio = valor.trim();
  return limpio === '' ? undefined : limpio;
}

function lista(env: Entorno, nombre: string): readonly string[] {
  const valor = texto(env, nombre);
  if (valor === undefined) return [];
  return valor
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/**
 * Booleano tolerante con las formas en que la gente escribe «sí»: `1`, `si`, `sí`, `true`, `yes`,
 * `on`. Cualquier otra cosa es `false`. Un valor mal escrito **no** enciende nada.
 */
export function booleano(valor: string | undefined, porDefecto: boolean): boolean {
  if (valor === undefined) return porDefecto;
  return /^(1|si|sí|s|true|t|yes|y|on)$/iu.test(valor.trim());
}

function entero(env: Entorno, nombre: string, porDefecto: number): number {
  const valor = texto(env, nombre);
  if (valor === undefined) return porDefecto;
  const n = Number.parseInt(valor, 10);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error(`${nombre} debe ser un entero no negativo, y es «${valor}»`);
  }
  return n;
}

/**
 * Padrón de firmantes de la veeduría.
 *
 * Formato: entradas separadas por `;`. Cada una admite las dos formas que la gente tiene a mano:
 *
 *     Veeduría 2026-2 — María Restrepo|AAAAC3NzaC1lZDI1NTE5AAAA…
 *     Veeduría 2026-2 — María Restrepo ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA…
 *
 * La segunda es una línea de `~/.ssh/allowed_signers` pegada tal cual, que es lo que alguien tiene
 * delante cuando configura esto. Lo que se guarda como `publicKey` es **sólo el blob en base64**,
 * que es contra lo que compara `SignedGitProvider`.
 */
export function parsearFirmantes(crudo: string | undefined): readonly AllowedSigner[] {
  if (crudo === undefined) return [];
  const salida: AllowedSigner[] = [];
  for (const entrada of crudo.split(';')) {
    const linea = entrada.trim();
    if (linea === '') continue;

    const barra = linea.lastIndexOf('|');
    if (barra !== -1) {
      const identity = linea.slice(0, barra).trim();
      const publicKey = linea.slice(barra + 1).trim();
      if (identity === '' || publicKey === '') {
        throw new Error(`entrada de firmante incompleta: «${linea}»`);
      }
      salida.push({ identity, publicKey });
      continue;
    }

    // Forma `allowed_signers`: el blob es el último campo que parece base64 largo.
    const campos = linea.split(/\s+/u);
    const blob = campos.at(-1);
    if (blob === undefined || !/^[A-Za-z0-9+/]{32,}={0,2}$/u.test(blob)) {
      throw new Error(
        `no se reconoce la entrada de firmante «${linea}»: usá «identidad|clave-en-base64»`,
      );
    }
    const identity = campos
      .slice(0, -1)
      .filter((campo) => !/^(ssh-|sk-)/u.test(campo) && !campo.startsWith('namespaces='))
      .join(' ')
      .trim();
    if (identity === '') throw new Error(`la entrada de firmante «${linea}» no dice de quién es`);
    salida.push({ identity, publicKey: blob });
  }
  return salida;
}

/**
 * Padrón de testigos. Entradas separadas por `;`, campos por `|`:
 *
 *     representacion_estudiantil|ana@correo.example|AAAAC3Nza…;externa|carla@otra.example|
 *
 * La clave puede ir vacía: un testigo sin clave acusa recibo pero su acuse **no cuenta** para el
 * umbral, y así está documentado en `Witness`. Es mejor tenerlo declarado que no tenerlo.
 */
export function parsearTestigos(crudo: string | undefined): readonly Witness[] {
  if (crudo === undefined) return [];
  const salida: Witness[] = [];
  for (const entrada of crudo.split(';')) {
    const linea = entrada.trim();
    if (linea === '') continue;
    const campos = linea.split('|');
    const id = campos[0]?.trim() ?? '';
    const address = campos[1]?.trim() ?? '';
    const publicKey = campos[2]?.trim() ?? '';
    if (id === '' || address === '') {
      throw new Error(`entrada de testigo incompleta: «${linea}» (falta id o correo)`);
    }
    if (!address.includes('@')) {
      throw new Error(`«${address}» no parece un correo, en la entrada de testigo «${linea}»`);
    }
    salida.push({ id, address, publicKey });
  }
  return salida;
}

function modoTls(valor: string | undefined, porDefecto: ModoTls): ModoTls {
  if (valor === undefined) return porDefecto;
  const v = valor.trim().toLowerCase();
  if (v === 'implicita' || v === 'implícita') return 'implicita';
  if (v === 'starttls') return 'starttls';
  if (v === 'ninguna') return 'ninguna';
  throw new Error(`modo TLS desconocido «${valor}»: se admite «implicita», «starttls» o «ninguna»`);
}

function forjasDesde(env: Entorno, nombres: readonly string[]): readonly ConfiguracionDeForja[] {
  const salida: ConfiguracionDeForja[] = [];
  for (const nombre of nombres) {
    if (nombre !== 'codeberg' && nombre !== 'github') continue;
    const sufijo = nombre.toUpperCase();
    const repo = texto(env, `KOINONIA_ANCLAJE_${sufijo}_REPO`);
    if (repo === undefined) continue;
    const partes = repo.split('/');
    const owner = partes[0]?.trim() ?? '';
    const nombreRepo = partes[1]?.trim() ?? '';
    if (partes.length !== 2 || owner === '' || nombreRepo === '') {
      throw new Error(`KOINONIA_ANCLAJE_${sufijo}_REPO debe ser «propietario/repositorio»`);
    }
    salida.push({
      tipo: nombre,
      owner,
      repo: nombreRepo,
      branch: texto(env, `KOINONIA_ANCLAJE_${sufijo}_RAMA`) ?? 'anclaje',
      token: texto(env, `KOINONIA_ANCLAJE_${sufijo}_TOKEN`),
    });
  }
  return salida;
}

function correoDesde(env: Entorno, motivos: string[]): ConfiguracionDeCorreo | undefined {
  const witnesses = parsearTestigos(texto(env, 'KOINONIA_ANCLAJE_TESTIGOS'));
  const host = texto(env, 'KOINONIA_ANCLAJE_SMTP_HOST');
  const from = texto(env, 'KOINONIA_ANCLAJE_CORREO_FROM');

  if (witnesses.length === 0 || host === undefined || from === undefined) {
    if (witnesses.length > 0 || host !== undefined || from !== undefined) {
      motivos.push(
        'anclaje por correo APAGADO: hacen falta KOINONIA_ANCLAJE_TESTIGOS, ' +
          'KOINONIA_ANCLAJE_SMTP_HOST y KOINONIA_ANCLAJE_CORREO_FROM, y falta alguna',
      );
    } else {
      motivos.push('anclaje por correo apagado: no hay padrón de testigos configurado');
    }
    return undefined;
  }

  const usuario = texto(env, 'KOINONIA_ANCLAJE_SMTP_USUARIO');
  const clave = texto(env, 'KOINONIA_ANCLAJE_SMTP_CLAVE');
  if ((usuario === undefined) !== (clave === undefined)) {
    throw new Error(
      'KOINONIA_ANCLAJE_SMTP_USUARIO y KOINONIA_ANCLAJE_SMTP_CLAVE van juntas o no van',
    );
  }

  const imapHost = texto(env, 'KOINONIA_ANCLAJE_IMAP_HOST');
  const imapUsuario = texto(env, 'KOINONIA_ANCLAJE_IMAP_USUARIO');
  const imapClave = texto(env, 'KOINONIA_ANCLAJE_IMAP_CLAVE');
  let imap: ConfiguracionDeImap | undefined;
  if (imapHost !== undefined && imapUsuario !== undefined && imapClave !== undefined) {
    imap = {
      host: imapHost,
      port: entero(env, 'KOINONIA_ANCLAJE_IMAP_PUERTO', 993),
      tls: booleano(texto(env, 'KOINONIA_ANCLAJE_IMAP_TLS'), true),
      user: imapUsuario,
      pass: imapClave,
      mailbox: texto(env, 'KOINONIA_ANCLAJE_IMAP_BUZON'),
    };
  } else {
    motivos.push(
      'sin buzón IMAP: los correos a los testigos salen, pero NADIE recoge sus acuses ni sus ' +
        'rebotes, así que este anclaje nunca pasará de «pendiente». Configurá ' +
        'KOINONIA_ANCLAJE_IMAP_HOST, _USUARIO y _CLAVE',
    );
  }

  const dkimDominio = texto(env, 'KOINONIA_ANCLAJE_DKIM_DOMINIO');
  const dkimSelector = texto(env, 'KOINONIA_ANCLAJE_DKIM_SELECTOR');
  const dkimClave = texto(env, 'KOINONIA_ANCLAJE_DKIM_CLAVE_FICHERO');
  let dkim: ConfiguracionDeDkim | undefined;
  if (dkimDominio !== undefined && dkimSelector !== undefined && dkimClave !== undefined) {
    const algoritmo = texto(env, 'KOINONIA_ANCLAJE_DKIM_ALGORITMO') ?? 'rsa-sha256';
    if (algoritmo !== 'rsa-sha256' && algoritmo !== 'ed25519-sha256') {
      throw new Error(
        `KOINONIA_ANCLAJE_DKIM_ALGORITMO sólo admite «rsa-sha256» o «ed25519-sha256»`,
      );
    }
    dkim = {
      domain: dkimDominio,
      selector: dkimSelector,
      algorithm: algoritmo,
      privateKeyPath: dkimClave,
    };
  } else {
    motivos.push(
      'sin firma DKIM: los correos a los testigos saldrán sin firmar y una parte acabará en ' +
        'carpetas de correo no deseado, que se parece mucho a un testigo que calla',
    );
  }

  return {
    witnesses,
    minDistinctDomains: entero(env, 'KOINONIA_ANCLAJE_DOMINIOS_MINIMOS', 3),
    selfDomains: lista(env, 'KOINONIA_ANCLAJE_DOMINIOS_PROPIOS'),
    from,
    envelopeFrom: texto(env, 'KOINONIA_ANCLAJE_CORREO_REMITENTE') ?? direccionDe(from),
    messageIdDomain: texto(env, 'KOINONIA_ANCLAJE_CORREO_DOMINIO_ID'),
    smtp: {
      host,
      port: entero(env, 'KOINONIA_ANCLAJE_SMTP_PUERTO', 587),
      tls: modoTls(texto(env, 'KOINONIA_ANCLAJE_SMTP_TLS'), 'starttls'),
      helo: texto(env, 'KOINONIA_ANCLAJE_SMTP_HELO') ?? 'localhost',
      auth:
        usuario === undefined || clave === undefined ? undefined : { user: usuario, pass: clave },
    },
    imap,
    dkim,
  };
}

/** `Anclaje <anclaje@udea.edu.co>` → `anclaje@udea.edu.co`. */
function direccionDe(from: string): string {
  return /<([^>]+)>/u.exec(from)?.[1]?.trim() ?? from.trim();
}

function gitDesde(env: Entorno, motivos: string[]): ConfiguracionDeGit | undefined {
  const allowedSigners = parsearFirmantes(texto(env, 'KOINONIA_ANCLAJE_FIRMANTES'));
  if (allowedSigners.length === 0) {
    motivos.push(
      'anclaje por git APAGADO: sin KOINONIA_ANCLAJE_FIRMANTES no hay padrón de la veeduría, y un ' +
        'padrón vacío admitiría cualquier firma',
    );
    return undefined;
  }

  const forges = lista(env, 'KOINONIA_ANCLAJE_FORJAS');
  const usadas = forges.length === 0 ? ['codeberg', 'github'] : forges;
  if (usadas.length < 2) {
    motivos.push(
      `anclaje por git con UNA sola forja (${usadas.join(', ')}): es un punto único de fallo y ` +
        'quien controle esa forja controla el anclaje',
    );
  }

  const signingKeyOffHost = booleano(
    texto(env, 'KOINONIA_ANCLAJE_CLAVE_FUERA_DEL_SERVIDOR'),
    false,
  );
  if (!signingKeyOffHost) {
    motivos.push(
      '⚠ KOINONIA_ANCLAJE_CLAVE_FUERA_DEL_SERVIDOR no está declarada: el anclaje de git NO cuenta ' +
        'para el quórum. Declaralo sólo si la clave de la veeduría vive de verdad fuera de esta ' +
        'máquina; si vive dentro, este anclaje es teatro y así queda registrado',
    );
  }

  const repos = forjasDesde(env, usadas);
  if (repos.length === 0) {
    motivos.push(
      'anclaje por git sin repositorios: se verificará la firma del commit, pero NADIE comprobará ' +
        'que está publicado. Configurá KOINONIA_ANCLAJE_CODEBERG_REPO y/o _GITHUB_REPO',
    );
  }

  const minForges = texto(env, 'KOINONIA_ANCLAJE_FORJAS_MINIMO');
  return {
    allowedSigners,
    signingKeyOffHost,
    forges: usadas,
    minForges:
      minForges === undefined ? undefined : entero(env, 'KOINONIA_ANCLAJE_FORJAS_MINIMO', 0),
    repos,
  };
}

/**
 * Lee la configuración completa.
 *
 * `activo` por defecto sigue a `NODE_ENV`: encendido en producción, apagado fuera. Encenderlo por
 * defecto en desarrollo pondría a cada portátil del equipo a sellar contra los calendarios públicos
 * de OpenTimestamps; dejarlo apagado por defecto en producción sería peor: un despliegue sin anclaje
 * y sin que nadie se entere.
 */
export function configuracionDeAnclajeDesdeEntorno(
  env: Entorno,
  opciones: { readonly produccion: boolean },
): ConfiguracionDeAnclaje {
  const motivos: string[] = [];
  const activo = booleano(texto(env, 'KOINONIA_ANCLAJE'), opciones.produccion);

  const calendarios = lista(env, 'KOINONIA_ANCLAJE_CALENDARIOS');
  const usados = calendarios.length === 0 ? CALENDARIOS_PUBLICOS : calendarios;

  const git = activo ? gitDesde(env, motivos) : undefined;
  const correo = activo ? correoDesde(env, motivos) : undefined;

  return {
    activo,
    checkpointCadaMs: entero(env, 'KOINONIA_ANCLAJE_CHECKPOINT_MINUTOS', 60) * 60_000,
    correoCadaMs: entero(env, 'KOINONIA_ANCLAJE_CORREO_CADA_HORAS', 24) * 60 * 60_000,
    pollCadaMs: entero(env, 'KOINONIA_ANCLAJE_POLL_MINUTOS', 60) * 60_000,
    pendientesQueSeSiguen: entero(env, 'KOINONIA_ANCLAJE_PENDIENTES', 24),
    calendarios: usados,
    minCalendarios: entero(env, 'KOINONIA_ANCLAJE_CALENDARIOS_MINIMO', 1),
    bloquesUrl: texto(env, 'KOINONIA_ANCLAJE_BLOQUES_URL') ?? EXPLORADOR_POR_DEFECTO,
    git,
    correo,
    motivosDeAusencia: motivos,
  };
}
