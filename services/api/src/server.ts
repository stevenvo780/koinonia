/**
 * Arranque del servidor. Es el único punto del repositorio que lee variables de entorno.
 *
 * Todo lo demás recibe sus dependencias por parámetro, que es lo que hace posible que las pruebas de
 * integración levanten la aplicación entera contra un PostgreSQL real sin tocar un fichero de
 * configuración ni una variable global.
 *
 * Aquí viven las dos decisiones que el despliegue no puede tomar en silencio: con qué adaptador de
 * correo se arranca y **con qué credenciales se habla con la base**. Las dos se resuelven con una
 * función pura del entorno que devuelve, junto a la elección, la línea que la anuncia. La segunda es
 * nueva y cierra un hueco medido: la API se conectaba como `postgres` porque un solo pool servía
 * para migrar y para atender, así que la separación de privilegios de la migración 0003 existía en
 * el esquema y no estaba en vigor en ejecución.
 *
 * Este módulo **exporta** `main` y no la ejecuta. Quien la ejecuta es `bin.ts`, que es un fichero
 * aparte con una sola línea. La primera versión llevaba aquí mismo un
 * `if (import.meta.url.endsWith('server.js')) main()`, que parece un guardián de «¿me han lanzado
 * directamente?» y **no lo es**: se cumple también cuando alguien importa el paquete, porque el
 * módulo compilado se llama `server.js` siempre. El síntoma fue que arrancar las pruebas de extremo
 * a extremo levantaba un servidor contra la base de producción por el mero hecho de importar
 * `@koinonia/api`. Una librería no tiene efectos al importarse; si los tiene, no es una librería.
 */

import { configuracionDeAnclajeDesdeEntorno } from './anchor/configuracion.js';
import type { ModoTls } from './anchor/smtp.js';
import { nodeConnect } from './anchor/socket.js';
import { crearTareaDeAnclaje } from './anchor/tarea.js';
import { createPool, type PgPool } from './db/client.js';
import { migrate } from './db/migrate.js';
import { APP_ROLE, inspectLedgerPrivileges, setAppRolePassword } from './db/roles.js';
import { ensureSpine } from './ledger/event-store.js';
import { buildApp } from './http/app.js';
import {
  consoleMailer,
  cryptoRandom,
  NodeAes256GcmVaultCrypto,
  smtpMailer,
  systemClock,
  udeaIdentityAdapter,
  unavailableVaultCrypto,
} from './http/adapters.js';
import type { MailerPort, VaultCryptoPort } from './http/ports.js';

function lista(nombre: string): readonly string[] {
  const valor = process.env[nombre];
  if (valor === undefined || valor.trim() === '') return [];
  return valor
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

function vaultFromEnvironment(modoDesarrollo: boolean): VaultCryptoPort {
  const encoded = process.env['KOINONIA_VAULT_MASTER_KEY'];
  if (encoded === undefined || encoded.trim() === '') {
    if (!modoDesarrollo) {
      throw new Error(
        'KOINONIA_VAULT_MASTER_KEY es obligatoria en producción y debe ser base64 de 32 bytes',
      );
    }
    return unavailableVaultCrypto;
  }

  const normalized = encoded.trim();
  const validBase64 = /^[A-Za-z0-9+/]{43}=$/u.test(normalized);
  const key = validBase64 ? Buffer.from(normalized, 'base64') : undefined;
  if (key === undefined || key.length !== 32) {
    if (!modoDesarrollo) {
      throw new Error('KOINONIA_VAULT_MASTER_KEY no es base64 válido de 32 bytes');
    }
    return unavailableVaultCrypto;
  }
  try {
    return new NodeAes256GcmVaultCrypto(key);
  } finally {
    key.fill(0);
  }
}

type Entorno = Readonly<Partial<Record<string, string>>>;

function variable(env: Entorno, nombre: string): string | undefined {
  const valor = env[nombre];
  if (valor === undefined) return undefined;
  const limpio = valor.trim();
  return limpio === '' ? undefined : limpio;
}

/**
 * `KOINONIA_SMTP_TLS` es un «sí/no» sobre STARTTLS, y además admite `implicita`.
 *
 * El sí/no es lo que pide el encargo y cubre los dos casos normales: 587 con STARTTLS y un relé de
 * la casa sin cifrar. `implicita` está porque hay servidores institucionales que sólo escuchan en
 * 465 con TLS desde el primer byte, y sin esa palabra el despliegue no tendría forma de llegar a
 * ellos con las variables que existen. **El defecto es STARTTLS**: el defecto seguro, no el cómodo.
 */
export function modoTlsDeEntorno(valor: string | undefined): ModoTls {
  if (valor === undefined) return 'starttls';
  const v = valor.toLowerCase();
  if (/^(1|si|sí|s|true|t|yes|y|on|starttls)$/u.test(v)) return 'starttls';
  if (/^(0|no|n|false|f|off|ninguna|ninguno)$/u.test(v)) return 'ninguna';
  if (v === 'implicita' || v === 'implícita' || v === 'tls') return 'implicita';
  throw new Error(
    `KOINONIA_SMTP_TLS no entiende «${valor}»: usá «sí» (STARTTLS), «no» (sin cifrar) o «implicita» (TLS desde el primer byte)`,
  );
}

/**
 * Elige el adaptador de correo y **dice cuál eligió**.
 *
 * Sin correo nadie entra: no hay contraseñas, la única puerta es un enlace que llega al buzón. Por
 * eso la decisión no puede ser silenciosa en ninguno de los dos sentidos. Con `KOINONIA_SMTP_HOST`
 * se manda de verdad; sin ella se imprime en el registro, que es lo que hace falta en desarrollo y
 * es una avería con forma de éxito en producción.
 *
 * El entorno entra **como dato** —igual que en `configuracionDeAnclajeDesdeEntorno`— para que esta
 * decisión se pueda comprobar sin arrancar un servidor ni escribir en `process.env` global.
 */
export function mailerDeEntorno(
  env: Entorno,
  opciones: { readonly modoDesarrollo: boolean },
): {
  readonly mailer: MailerPort;
  readonly anuncio: string;
  readonly grave: boolean;
} {
  const modoDesarrollo = opciones.modoDesarrollo;
  const host = variable(env, 'KOINONIA_SMTP_HOST');
  if (host === undefined) {
    return {
      mailer: consoleMailer,
      grave: !modoDesarrollo,
      anuncio: modoDesarrollo
        ? 'Correo: adaptador de CONSOLA (no hay KOINONIA_SMTP_HOST). Los enlaces de entrada se imprimen aquí; no sale ningún correo.'
        : '⚠ Correo: adaptador de CONSOLA en PRODUCCIÓN porque falta KOINONIA_SMTP_HOST. No se manda ni un correo, así que NADIE puede entrar, y los enlaces de entrada quedan IMPRESOS EN EL REGISTRO: quien lo lea puede tomar la sesión de otra persona durante 15 minutos. Configurá KOINONIA_SMTP_HOST y KOINONIA_SMTP_FROM.',
    };
  }

  const from = variable(env, 'KOINONIA_SMTP_FROM');
  if (from === undefined) {
    // Fallar al arrancar y no al primer intento de entrar: un remitente inventado por el programa
    // es un correo que sale y lo rechaza el receptor por SPF, sin que nadie mire ese registro.
    throw new Error(
      'KOINONIA_SMTP_HOST está configurada pero falta KOINONIA_SMTP_FROM: sin remitente no hay correo que mandar',
    );
  }

  const tls = modoTlsDeEntorno(variable(env, 'KOINONIA_SMTP_TLS'));
  const puertoCrudo = variable(env, 'KOINONIA_SMTP_PORT');
  const puerto =
    puertoCrudo === undefined
      ? { starttls: 587, implicita: 465, ninguna: 25 }[tls]
      : Number(puertoCrudo);
  if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65_535) {
    throw new Error(`KOINONIA_SMTP_PORT debe ser un puerto TCP, y es «${String(puertoCrudo)}»`);
  }

  const user = variable(env, 'KOINONIA_SMTP_USER');
  const pass = variable(env, 'KOINONIA_SMTP_PASS');
  if ((user === undefined) !== (pass === undefined)) {
    throw new Error('KOINONIA_SMTP_USER y KOINONIA_SMTP_PASS van juntas o no van');
  }
  const auth = user === undefined || pass === undefined ? undefined : { user, pass };

  return {
    mailer: smtpMailer({
      host,
      port: puerto,
      tls,
      from,
      auth,
      connect: nodeConnect(),
      clock: systemClock,
      random: cryptoRandom,
    }),
    grave: tls === 'ninguna',
    anuncio:
      `Correo: SMTP contra ${host} puerto ${String(puerto)}, ` +
      `${{ starttls: 'STARTTLS', implicita: 'TLS implícito', ninguna: '⚠ SIN CIFRAR' }[tls]}, ` +
      `${auth === undefined ? 'sin autenticar' : `autenticado como ${auth.user}`}, ` +
      `remitente ${from}. Los enlaces de entrada NO se imprimen.`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Dos conexiones, no una
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** Nombre con el que se presenta el pool efímero de migración. Se cierra en cuanto termina. */
export const APP_NAME_MIGRACION = 'koinonia-migracion';
/** Nombre con el que se presenta el pool que sirve las peticiones. */
export const APP_NAME_API = 'koinonia-api';

const DB_DESARROLLO = 'postgresql://postgres:koinonia@localhost:55432/koinonia';

/** Adónde va cada línea del arranque. `grave` la manda a `stderr`, como hace ya el correo. */
export type Anunciar = (linea: string, grave: boolean) => void;

const anunciarPorConsola: Anunciar = (linea, grave) => {
  (grave ? process.stderr : process.stdout).write(`${linea}\n`);
};

export interface EleccionDeConexiones {
  /** Credenciales con permiso de DDL. Sólo para `migrate()`; el pool muere ahí. */
  readonly migracionUrl: string;
  /** Credenciales de `koinonia_app`. Sirven todas las peticiones. */
  readonly appUrl: string;
  /** Si está, el arranque le fija esta contraseña al rol de aplicación antes de conectarse. */
  readonly appPassword: string | undefined;
  /** `false` cuando no hay credencial de aplicación y se está usando la de DDL para todo. */
  readonly separadas: boolean;
  readonly anuncio: string;
  readonly grave: boolean;
}

/**
 * Describe una conexión **sin la contraseña**.
 *
 * Esto se imprime en el registro del arranque, y el registro lo lee más gente de la que uno cree:
 * `journalctl`, el agregador de trazas, la captura de pantalla que alguien pega en un chat. La
 * contraseña de `koinonia_app` no aparece por ninguna de esas vías.
 */
function describirConexion(url: string): string {
  try {
    const u = new URL(url);
    const usuario = u.username === '' ? '(usuario del sistema)' : decodeURIComponent(u.username);
    const base = u.pathname.replace(/^\//u, '');
    return `${usuario}@${u.hostname}:${u.port === '' ? '5432' : u.port}/${base === '' ? '(por defecto)' : base}`;
  } catch {
    // Una cadena que no se puede analizar NO se imprime tal cual: lleva la contraseña dentro.
    return '(cadena de conexión no analizable; no se imprime porque llevaría la contraseña)';
  }
}

function claveDeUrl(url: string): string | undefined {
  try {
    const password = new URL(url).password;
    return password === '' ? undefined : decodeURIComponent(password);
  } catch {
    return undefined;
  }
}

/**
 * Elige las dos conexiones y **dice cuál eligió**, igual que la elección de correo.
 *
 * ═══ Qué pasa si falta la credencial de aplicación: se cae en producción ═══
 *
 * DECISIÓN: sin `KOINONIA_DATABASE_URL_APP`, en producción **el arranque falla**; fuera de
 * producción se avisa por `stderr` y se sigue con la credencial de DDL.
 *
 * El aviso fuerte era la otra opción del encargo y aquí no sirve, por un motivo concreto y medido:
 * **el hueco que esto cierra es exactamente un despliegue que nadie miró**. La API llevaba
 * conectándose como `postgres` desde la puesta en marcha; había un registro, y nadie lo leyó. Una
 * defensa cuya activación depende de que alguien lea una línea de `stderr` ya falló una vez de esa
 * manera, y repetirla sería elegir a sabiendas el modo de fallo conocido.
 *
 * Pesa además la asimetría del daño. Arrancar sin la variable no es «lo mismo pero sin una capa»: es
 * quedarse sin **la** capa que el modelo de amenaza pone frente al adversario nº 2, el
 * administrador. Con la aplicación como superusuario, cualquier `UPDATE` que se cuele —un bug, una
 * inyección, una consola a las 3 a.m.— sólo lo detiene el trigger de la 0002, y el trigger lo apaga
 * ese mismo rol en una línea. El coste de fallar cerrado es un despliegue que no levanta y lo dice
 * en la primera línea; el coste de seguir es una promesa —«el administrador no puede alterar la
 * historia sin que se detecte»— que el sistema hace y no cumple. No son comparables.
 *
 * Fuera de producción el cálculo se invierte: exigir un rol con contraseña rompería `pnpm run dev`
 * contra una base recién creada y el `docker-compose` del repositorio, y en un portátil no hay
 * historia que proteger. Ahí se avisa, se dice que se está corriendo sin la separación, y se sigue.
 */
export function conexionesDeEntorno(
  env: Entorno,
  opciones: { readonly modoDesarrollo: boolean },
): EleccionDeConexiones {
  const migracionUrl =
    variable(env, 'KOINONIA_DATABASE_URL_MIGRACION') ??
    variable(env, 'DATABASE_URL') ??
    DB_DESARROLLO;
  const appUrl = variable(env, 'KOINONIA_DATABASE_URL_APP');
  const appPassword = variable(env, 'KOINONIA_DB_APP_PASSWORD');

  if (appUrl === undefined) {
    if (!opciones.modoDesarrollo) {
      throw new Error(
        'KOINONIA_DATABASE_URL_APP es obligatoria en producción: sin ella la API serviría las ' +
          'peticiones con las credenciales de migración —normalmente el superusuario—, y la ' +
          'separación de privilegios de la migración 0003 (koinonia_app sólo SELECT, INSERT sobre ' +
          'governance.event) dejaría de proteger nada en ejecución. Ponela apuntando al rol ' +
          `${APP_ROLE}; ver «Dos conexiones a la base» en el README.`,
      );
    }
    return {
      migracionUrl,
      appUrl: migracionUrl,
      appPassword,
      separadas: false,
      grave: true,
      anuncio:
        '⚠ Base de datos: SIN SEPARAR. No hay KOINONIA_DATABASE_URL_APP, así que las peticiones se ' +
        `sirven con la MISMA conexión que aplica las migraciones (${describirConexion(migracionUrl)}), ` +
        'que normalmente es el superusuario. Los GRANT de la 0003 no están en vigor: un UPDATE sobre ' +
        'governance.event sólo lo pararía el trigger de la 0002, y ese rol puede apagar el trigger. ' +
        'Se admite en desarrollo; en producción el arranque se cae.',
    };
  }

  const claveEnUrl = claveDeUrl(appUrl);
  if (appPassword !== undefined && claveEnUrl !== undefined && claveEnUrl !== appPassword) {
    // Fallar aquí y no en el primer `connect()`: si no, el arranque le pone al rol una contraseña y
    // acto seguido intenta entrar con otra, y el diagnóstico que llega es «autenticación fallida»,
    // que apunta a cualquier sitio menos al de verdad.
    throw new Error(
      'KOINONIA_DB_APP_PASSWORD no coincide con la contraseña de KOINONIA_DATABASE_URL_APP: el ' +
        'arranque le fijaría una al rol y se conectaría con la otra. Poné la misma en las dos, o ' +
        'quitá KOINONIA_DB_APP_PASSWORD si la contraseña ya está puesta en la base.',
    );
  }

  return {
    migracionUrl,
    appUrl,
    appPassword,
    separadas: true,
    grave: false,
    anuncio:
      `Base de datos: SEPARADA. Migraciones con ${describirConexion(migracionUrl)} en un pool que se ` +
      `cierra en cuanto terminan; peticiones con ${describirConexion(appUrl)}` +
      `${appPassword === undefined ? '' : ', cuya contraseña fija el arranque'}.`,
  };
}

/**
 * Migra con una conexión y devuelve **otra** para servir.
 *
 * El pool de migración se cierra en el `finally`, antes de abrir el de la aplicación: no es aseo, es
 * lo que hace que las credenciales de DDL no estén disponibles mientras el servicio atiende
 * peticiones. Un pool abierto es una conexión con permiso de `ALTER TABLE` esperando a que un bug la
 * use.
 *
 * Y antes de devolver el pool se le pregunta a la base **qué puede hacer de verdad** esta conexión.
 * Comprobar la configuración en vez de confiar en ella es la diferencia entre esta versión y la
 * anterior: la anterior también «tenía» la separación de privilegios, escrita en la 0003.
 */
export async function prepararBaseDeDatos(
  conexiones: EleccionDeConexiones,
  anunciar: Anunciar = anunciarPorConsola,
): Promise<PgPool> {
  const migracion = createPool({
    connectionString: conexiones.migracionUrl,
    max: 2,
    applicationName: APP_NAME_MIGRACION,
  });
  try {
    const hecho = await migrate(migracion);
    anunciar(
      `Base de datos: migraciones al día — ${String(hecho.applied.length)} aplicadas ahora, ` +
        `${String(hecho.alreadyApplied.length)} ya estaban.`,
      false,
    );
    if (conexiones.appPassword !== undefined) {
      const cliente = await migracion.connect();
      try {
        await setAppRolePassword(cliente, conexiones.appPassword);
      } finally {
        cliente.release();
      }
      anunciar(`Base de datos: contraseña de ${APP_ROLE} fijada desde el entorno.`, false);
    }
  } finally {
    await migracion.end().catch(() => undefined);
  }

  const pool = createPool({ connectionString: conexiones.appUrl, applicationName: APP_NAME_API });
  let veredicto;
  try {
    const cliente = await pool.connect();
    try {
      veredicto = await inspectLedgerPrivileges(cliente);
    } finally {
      cliente.release();
    }
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }

  if (veredicto.canRewriteHistory && conexiones.separadas) {
    // Se configuró una conexión de aplicación aparte y resulta que puede reescribir la historia.
    // Eso no es una degradación aceptable: es la variable puesta y la propiedad ausente, que es peor
    // que no haberla puesto, porque el registro diría «SEPARADA» y sería mentira.
    await pool.end().catch(() => undefined);
    throw new Error(
      `KOINONIA_DATABASE_URL_APP no cumple lo que promete: ${veredicto.reason ?? 'motivo desconocido'}. ` +
        `Tiene que apuntar al rol ${APP_ROLE}, que sobre governance.event sólo tiene SELECT e INSERT.`,
    );
  }

  anunciar(
    veredicto.canRewriteHistory
      ? `⚠ Base de datos: las peticiones van como «${veredicto.identity.user}», que PUEDE reescribir ` +
          `la historia — ${veredicto.reason ?? ''}. El ledger no es append-only en ejecución.`
      : `Base de datos: las peticiones van como «${veredicto.identity.user}», que NO es superusuario ` +
          `y sobre governance.event tiene exactamente ${veredicto.eventPrivileges.join(', ')}. ` +
          'Comprobado contra el catálogo, no contra la migración.',
    veredicto.canRewriteHistory,
  );
  return pool;
}

export async function main(): Promise<void> {
  const puerto = Number.parseInt(process.env['PORT'] ?? '3001', 10);
  const modoDesarrollo = process.env['NODE_ENV'] !== 'production';
  const vault = vaultFromEnvironment(modoDesarrollo);

  // Antes de tocar la base: si el correo está mal configurado, que se sepa en la primera línea del
  // registro y no cuando alguien se quede sin poder entrar.
  const correo = mailerDeEntorno(process.env, { modoDesarrollo });
  anunciarPorConsola(correo.anuncio, correo.grave);

  // Y la segunda línea dice con qué credenciales se va a hablar con la base. Si falta la de
  // aplicación, en producción esto lanza y el proceso no llega a escuchar.
  const conexiones = conexionesDeEntorno(process.env, { modoDesarrollo });
  anunciarPorConsola(conexiones.anuncio, conexiones.grave);

  const pepper = process.env['KOINONIA_RATE_PEPPER'];
  if (pepper === undefined || pepper.length < 16) {
    if (!modoDesarrollo) {
      // En producción no hay pimienta por defecto. Una pimienta conocida es una pimienta que no
      // protege, y el contador de abuso volvería a ser un registro de quién intentó qué.
      throw new Error(
        'KOINONIA_RATE_PEPPER es obligatoria en producción y debe tener al menos 16 caracteres',
      );
    }
  }

  // Migra con las credenciales de DDL, cierra ese pool, y devuelve el de la aplicación ya
  // comprobado contra el catálogo. De aquí en adelante `pool` es `koinonia_app`.
  const pool = await prepararBaseDeDatos(conexiones);
  await ensureSpine(pool, {
    occurredAt: new Date(systemClock.now()).toISOString(),
    payload: { vigencia: '2026_2', instituto: 'filosofia_udea' },
    requestId: '00000000-0000-4000-8000-000000000001',
  });

  const app = await buildApp({
    pool,
    ports: {
      clock: systemClock,
      random: cryptoRandom,
      mailer: correo.mailer,
      identity: udeaIdentityAdapter({
        facilitadores: lista('KOINONIA_FACILITADORES'),
        garantias: lista('KOINONIA_GARANTIAS'),
      }),
      vault,
    },
    ratePepper: pepper ?? 'pimienta-de-desarrollo-no-usar-en-produccion',
    webBaseUrl: process.env['KOINONIA_WEB_URL'] ?? 'http://localhost:3000',
    modoDesarrollo,
  });

  // ── Anclaje externo ──────────────────────────────────────────────────────────────────────────
  //
  // Se arranca DESPUÉS del `listen` a propósito. El primer ciclo sale a la red —calendarios de
  // OpenTimestamps, forjas, SMTP— y puede tardar decenas de segundos; ponerlo antes retrasaría el
  // arranque del servicio por algo que no lo bloquea. Si la configuración lo deja apagado, la tarea
  // dice por qué y no hace nada.
  const anclaje = crearTareaDeAnclaje({
    pool,
    config: configuracionDeAnclajeDesdeEntorno(process.env, { produccion: !modoDesarrollo }),
    ahora: () => new Date(systemClock.now()).toISOString(),
  });

  await app.listen({ port: puerto, host: '0.0.0.0' });
  anclaje.arrancar();

  // El cierre ordenado importa aquí más que en otros sitios: un ciclo a medias deja recibos
  // guardados sin su evento en el ledger, y el ledger es lo autoritativo.
  for (const senal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(senal, () => {
      anclaje.detener();
      void anclaje
        .reposo()
        .then(() => app.close())
        .then(() => pool.end())
        .then(() => {
          process.exit(0);
        });
    });
  }

  process.stdout.write(`Koinonía escuchando en http://localhost:${String(puerto)}\n`);
}
