/**
 * La **tarea periódica del anclaje**: lo que convierte tres adaptadores en un anclaje que ocurre.
 *
 * Hasta aquí `packages/anchor` sabía sellar, `services/api/src/anchor` sabía hablar con el mundo, y
 * nadie llamaba a nadie. El anclaje existía en el repositorio y no en el despliegue, que para el
 * caso es igual que no existir: la portada seguiría en verde y ningún checkpoint estaría dentro de
 * Bitcoin.
 *
 * ═══ Dos ritmos, y son distintos a propósito ═══
 *
 *  · **Tras cada checkpoint** (`tras()`): un ciclo inmediato **sin `poll`**. El sello acaba de
 *    nacer; preguntarle al calendario si ya maduró un segundo después es garantía de un `no` y una
 *    petición gastada. Lo que sí importa es enviarlo cuanto antes, porque lo que el anclaje prueba
 *    es una cota SUPERIOR de tiempo y cada minuto de retraso la afloja.
 *
 *  · **Cada hora** (`poll: true`): se releen los checkpoints pendientes y se intenta madurarlos.
 *    Un sello de OpenTimestamps tarda entre una y seis horas; el commit de la veeduría tarda lo que
 *    tarde una persona; los acuses de los testigos, días. Por eso se siguen `pendientesQueSeSiguen`
 *    checkpoints hacia atrás y no sólo el último: el anclaje de ayer sigue madurando hoy.
 *
 * ═══ Ninguna falla se traga, tampoco aquí ═══
 *
 * `runAnchorCycle` ya escribe un `AnclajeFallido` en el ledger por cada proveedor que revienta. Lo
 * que esta tarea añade es que **un error suyo no mate el proceso ni se pierda**: se escribe en el
 * diario con su motivo y el ciclo siguiente vuelve a intentarlo. Lo que nunca hace es quedarse
 * callada, porque un anclaje que falla en silencio es peor que no tener anclaje.
 *
 * ⚠ La tarea también **emite los checkpoints**. Hasta ahora `emitCheckpoint` sólo se llamaba desde
 * las pruebas: en producción no había nada que fijara un corte, y sin corte no hay nada que anclar.
 * Se puede apagar con `KOINONIA_ANCLAJE_CHECKPOINT_MINUTOS=0` si algún día lo emite otra cosa.
 */

import { createHash, createPrivateKey, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  type AnchorCycleResult,
  type AnchorEventDraft,
  type AnchorProvider,
  type AnchorReceipt,
  type BitcoinHeaderSource,
  type IndependenceClass,
  OpenTimestampsProvider,
  runAnchorCycle,
  SignedGitProvider,
  WitnessEmailProvider,
} from '@koinonia/anchor';
import { canonicalizeToBytes } from '@koinonia/crypto';

import { type PgClient, type PgPool } from '../db/client.js';
import {
  anchorLedgerPort,
  readAnchorReceipts,
  requestIdFromHash,
  saveAnchorAttempt,
} from '../ledger/anchor-store.js';
import { type Checkpoint, emitCheckpoint, latestCheckpoint } from '../ledger/checkpoint.js';
import { cabecerasGuardadas, cosecharCabeceras, exploradorDeBloques } from './cabeceras.js';
import { calendariosDeProduccion, relojDelSistema } from './calendarios.js';
import {
  type ConfiguracionDeAnclaje,
  type ConfiguracionDeDkim,
  type ConfiguracionDeImap,
} from './configuracion.js';
import { imapAckCollector, smtpWitnessTransport } from './correo.js';
import { type DkimOptions } from './dkim.js';
import { codebergForge, githubForge } from './forjas.js';
import { type ImapOptions } from './imap.js';
import { type Conectar, nodeConnect } from './socket.js';

/** Registro de la tarea. Un puerto: en las pruebas es un array, en producción la salida de error. */
export type DiarioDeAnclaje = (linea: string) => void;

export const DIARIO_A_STDERR: DiarioDeAnclaje = (linea) => {
  process.stderr.write(`[anclaje] ${linea}\n`);
};

export interface TareaDeAnclajeOptions {
  readonly pool: PgPool;
  readonly config: ConfiguracionDeAnclaje;
  /** Instante actual en RFC 3339 UTC. Entra como puerto: la tarea no lee el reloj por su cuenta. */
  readonly ahora: () => string;
  readonly diario?: DiarioDeAnclaje;
  /** Proveedores ya construidos. Sólo para las pruebas: en producción salen de `config`. */
  readonly providers?: readonly AnchorProvider[];
}

export interface TareaDeAnclaje {
  /** Enciende los dos ritmos. Idempotente. */
  arrancar(): void;
  /** Apaga los temporizadores. Un ciclo en vuelo termina; no se corta a medias. */
  detener(): void;
  /** Un ciclo inmediato para este checkpoint, sin `poll`. Lo llama quien emita un checkpoint. */
  tras(checkpoint: Checkpoint): Promise<AnchorCycleResult | undefined>;
  /** Emite un checkpoint si hay hechos nuevos y lo ancla. Devuelve el sello si lo hubo. */
  cortarYAnclar(): Promise<Checkpoint | undefined>;
  /** Repasa los pendientes con `poll: true` y cosecha las cabeceras de bloque que falten. */
  madurarPendientes(): Promise<void>;
  /** Espera a que termine lo que haya en cola. Para las pruebas y para un apagado ordenado. */
  reposo(): Promise<void>;
}

/**
 * Construye los proveedores que la configuración permita.
 *
 * Los que no se puedan construir **no se construyen a medias**: se quedan fuera. Un
 * `SignedGitProvider` con un padrón vacío admitiría cualquier firma, y un `WitnessEmailProvider` sin
 * transporte fingiría haber enviado correos que nadie mandó. Es mejor un quórum de dos clases que se
 * ve que son dos, que uno de tres donde la tercera es de cartón.
 */
export function proveedoresDesde(
  config: ConfiguracionDeAnclaje,
  ahora: () => string,
  headers?: BitcoinHeaderSource,
): readonly AnchorProvider[] {
  const proveedores: AnchorProvider[] = [
    new OpenTimestampsProvider({
      calendar: calendariosDeProduccion({
        uris: config.calendarios,
        minSuccess: config.minCalendarios,
        clock: relojDelSistema(),
      }),
      ...(headers === undefined ? {} : { headers }),
      clock: ahora,
    }),
  ];

  const git = config.git;
  if (git !== undefined) {
    proveedores.push(
      new SignedGitProvider({
        allowedSigners: git.allowedSigners,
        signingKeyOffHost: git.signingKeyOffHost,
        forges: git.forges,
        ...(git.minForges === undefined ? {} : { minForges: git.minForges }),
        clock: ahora,
        forgeClients: git.repos.map((repo) => {
          const opciones = {
            owner: repo.owner,
            repo: repo.repo,
            branch: repo.branch,
            ...(repo.token === undefined ? {} : { token: repo.token }),
          };
          return repo.tipo === 'codeberg' ? codebergForge(opciones) : githubForge(opciones);
        }),
      }),
    );
  }

  const correo = config.correo;
  if (correo !== undefined) {
    const conectar = nodeConnect();
    const { auth, ...smtp } = correo.smtp;
    proveedores.push(
      new WitnessEmailProvider({
        witnesses: correo.witnesses,
        minDistinctDomains: correo.minDistinctDomains,
        selfDomains: correo.selfDomains,
        clock: ahora,
        transport: smtpWitnessTransport({
          witnesses: correo.witnesses,
          from: correo.from,
          envelopeFrom: correo.envelopeFrom,
          smtp: { ...smtp, connect: conectar, ...(auth === undefined ? {} : { auth }) },
          now: ahora,
          ...dkimDe(correo.dkim),
          ...(correo.messageIdDomain === undefined
            ? {}
            : { messageIdDomain: correo.messageIdDomain }),
        }),
        ...(correo.imap === undefined
          ? {}
          : {
              collector: imapAckCollector({
                witnesses: correo.witnesses,
                imap: imapDe(correo.imap, conectar),
              }),
            }),
      }),
    );
  }

  return proveedores;
}

function imapDe(config: ConfiguracionDeImap, connect: Conectar): ImapOptions {
  const { mailbox, ...resto } = config;
  return { ...resto, connect, ...(mailbox === undefined ? {} : { mailbox }) };
}

/**
 * La clave DKIM, leída del fichero que indica la configuración y **cacheada por ruta**.
 *
 * Se lee de disco y no de una variable de entorno porque una clave privada en el entorno acaba en
 * `docker inspect`, en el registro del orquestador y en el `ps` de cualquiera con sesión. Si el
 * fichero no se puede leer, el correo sale **sin firmar** en vez de no salir: un correo sin DKIM
 * llega peor, pero un anclaje que no se intenta no llega nunca.
 */
const CLAVES_DKIM = new Map<string, KeyObject | undefined>();

function dkimDe(config: ConfiguracionDeDkim | undefined): {
  dkim?: Omit<DkimOptions, 'timestamp'>;
} {
  if (config === undefined) return {};
  if (!CLAVES_DKIM.has(config.privateKeyPath)) {
    try {
      CLAVES_DKIM.set(
        config.privateKeyPath,
        createPrivateKey(readFileSync(config.privateKeyPath, 'utf8')),
      );
    } catch (error) {
      process.stderr.write(
        `[anclaje] no se pudo leer la clave DKIM de ${config.privateKeyPath}: ` +
          `${error instanceof Error ? error.message : String(error)}. Los correos a los testigos ` +
          'saldrán sin firmar\n',
      );
      CLAVES_DKIM.set(config.privateKeyPath, undefined);
    }
  }
  const privateKey = CLAVES_DKIM.get(config.privateKeyPath);
  if (privateKey === undefined) return {};
  return {
    dkim: {
      domain: config.domain,
      selector: config.selector,
      algorithm: config.algorithm,
      privateKey,
    },
  };
}

/**
 * `requestId` derivado del **contenido** del lote, no del reloj ni del azar.
 *
 * Lo exige `anchorLedgerPort`: reintentar el mismo ciclo tras un corte de red no debe escribir el
 * mismo hecho dos veces (§3.5). Se usa `createHash` de Node —síncrono— porque el puerto pide el
 * identificador de forma síncrona; el `sha256` de `@koinonia/crypto` es asíncrono y aquí no cabe.
 * Es el mismo algoritmo sobre los mismos bytes.
 */
export function requestIdDeLote(events: readonly AnchorEventDraft[]): string {
  const material = events.map((evento) => ({
    eventType: evento.eventType,
    occurredAt: evento.occurredAt,
    payload: evento.payload,
  }));
  const bytes = canonicalizeToBytes({ eventos: material });
  return requestIdFromHash(new Uint8Array(createHash('sha256').update(bytes).digest()));
}

export function crearTareaDeAnclaje(options: TareaDeAnclajeOptions): TareaDeAnclaje {
  const { pool, config, ahora } = options;
  const diario = options.diario ?? DIARIO_A_STDERR;
  const fuenteDeBloques = exploradorDeBloques(config.bloquesUrl);

  let temporizadores: NodeJS.Timeout[] = [];
  let enCurso: Promise<void> = Promise.resolve();

  /** Serializa los ciclos: dos a la vez pelearían por la fila `(tree_size, provider)`. */
  const enCola = (trabajo: () => Promise<unknown>): Promise<void> => {
    const siguiente = async (): Promise<void> => {
      try {
        await trabajo();
      } catch (error) {
        diario(`el ciclo falló entero: ${describir(error)}`);
      }
    };
    enCurso = enCurso.then(siguiente, siguiente);
    return enCurso;
  };

  async function conCliente<T>(trabajo: (client: PgClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      return await trabajo(client);
    } finally {
      client.release();
    }
  }

  async function proveedores(client: PgClient): Promise<readonly AnchorProvider[]> {
    if (options.providers !== undefined) return options.providers;
    return proveedoresDesde(config, ahora, await cabecerasGuardadas(client));
  }

  async function ciclo(
    checkpoint: Checkpoint,
    poll: boolean,
  ): Promise<AnchorCycleResult | undefined> {
    return conCliente(async (client) => {
      const activos = await proveedores(client);
      const clases = new Map<string, IndependenceClass>(
        activos.map((proveedor) => [proveedor.meta.id, proveedor.meta.independenceClass]),
      );

      const resultado = await runAnchorCycle({
        checkpoint: {
          treeSize: checkpoint.treeSize,
          rootHash: checkpoint.rootHash,
          headsRoot: checkpoint.headsRoot,
          checkpointHash: checkpoint.checkpointHash,
          issuedAt: checkpoint.issuedAt,
        },
        providers: activos,
        ledger: anchorLedgerPort(pool, requestIdDeLote),
        now: ahora(),
        existing: await readAnchorReceipts(client, checkpoint.treeSize),
        poll,
      });

      for (const intento of resultado.attempts) {
        await saveAnchorAttempt(client, {
          treeSize: checkpoint.treeSize,
          provider: intento.provider,
          independenceClass:
            intento.receipt?.independenceClass ?? clases.get(intento.provider) ?? 'third-party-log',
          state: estadoDe(intento.outcome?.status, intento.receipt),
          ...(intento.receipt === undefined ? {} : { receipt: intento.receipt }),
          ...motivoDelIntento(intento),
        });
      }

      await cosechar(client, resultado.receipts, checkpoint.treeSize);

      const clasesConfirmadas =
        resultado.verdict.confirmedClasses.length === 0
          ? 'ninguna clase confirmada'
          : resultado.verdict.confirmedClasses.join(', ');
      diario(
        `checkpoint ${checkpoint.treeSize.toString()}: ${resultado.verdict.state} ` +
          `(${clasesConfirmadas})`,
      );
      return resultado;
    });
  }

  async function cosechar(
    client: PgClient,
    receipts: readonly AnchorReceipt[],
    treeSize: bigint,
  ): Promise<void> {
    const cosecha = await cosecharCabeceras({ client, receipts, fuente: fuenteDeBloques });
    if (cosecha.guardadas.length > 0) {
      diario(
        `cabeceras de bloque guardadas para el checkpoint ${treeSize.toString()}: ` +
          `${cosecha.guardadas.join(', ')} — el verificador independiente ya puede cerrar el sello`,
      );
    }
    for (const fallo of cosecha.fallos) {
      diario(
        `NO se pudo obtener la cabecera del bloque ${String(fallo.height)}: ${fallo.motivo}. ` +
          'Mientras falte, el verificador dirá «incompleto» sobre este sello',
      );
    }
  }

  async function cortarYAnclar(): Promise<Checkpoint | undefined> {
    const { previo, hechos } = await conCliente(async (client) => ({
      previo: await latestCheckpoint(client),
      hechos: await contarHechos(client),
    }));

    // Cada `emitCheckpoint` escribe su propio `CheckpointEmitido` en la espina, así que un log sin
    // actividad crece exactamente un hecho por corte. Cortar otra vez sobre eso sería sellar el
    // registro de haber sellado: ruido en el ledger y una petición al calendario por nada.
    if (previo !== undefined && hechos <= previo.treeSize + 1n) {
      diario('sin hechos nuevos desde el último checkpoint: no se corta');
      return undefined;
    }

    const sello = await emitCheckpoint(pool, {
      issuedAt: ahora(),
      requestId: requestIdFromHash(
        new Uint8Array(
          createHash('sha256')
            .update(canonicalizeToBytes({ corte: hechos.toString(), instante: ahora() }))
            .digest(),
        ),
      ),
    });
    await ciclo(sello, false);
    return sello;
  }

  async function madurarPendientes(): Promise<void> {
    const pendientes = await conCliente((client) =>
      checkpointsPendientes(client, config.pendientesQueSeSiguen),
    );
    if (pendientes.length === 0) {
      diario('no hay checkpoints pendientes de madurar');
      return;
    }
    for (const checkpoint of pendientes) await ciclo(checkpoint, true);
  }

  return {
    arrancar(): void {
      if (temporizadores.length > 0) return;
      if (!config.activo) {
        diario(
          'APAGADO. Se enciende con KOINONIA_ANCLAJE=1 (por defecto ya lo está en producción)',
        );
        return;
      }
      for (const motivo of config.motivosDeAusencia) diario(motivo);

      if (config.checkpointCadaMs > 0) {
        const corte = setInterval(() => {
          void enCola(cortarYAnclar);
        }, config.checkpointCadaMs);
        corte.unref();
        temporizadores.push(corte);
      } else {
        diario(
          'no se emitirán checkpoints desde aquí (KOINONIA_ANCLAJE_CHECKPOINT_MINUTOS=0): si nadie ' +
            'más los emite, no habrá nada que anclar',
        );
      }

      const maduracion = setInterval(() => {
        void enCola(madurarPendientes);
      }, config.pollCadaMs);
      maduracion.unref();
      temporizadores.push(maduracion);

      diario(
        `encendido: corte cada ${String(config.checkpointCadaMs / 60_000)} min, maduración cada ` +
          `${String(config.pollCadaMs / 60_000)} min, ${String(config.calendarios.length)} ` +
          `calendarios, ${String(config.git === undefined ? 0 : 1)} anclaje(s) de git y ` +
          `${String(config.correo === undefined ? 0 : 1)} de correo`,
      );
    },

    detener(): void {
      for (const t of temporizadores) clearInterval(t);
      temporizadores = [];
    },

    async tras(checkpoint: Checkpoint): Promise<AnchorCycleResult | undefined> {
      if (!config.activo) return undefined;
      let resultado: AnchorCycleResult | undefined;
      await enCola(async () => {
        resultado = await ciclo(checkpoint, false);
      });
      return resultado;
    },

    cortarYAnclar,
    madurarPendientes,
    reposo: () => enCurso,
  };
}

/**
 * El motivo del intento, SIEMPRE que haya fracasado.
 *
 * Antes se guardaba sólo `intento.error`, que existe cuando algo **lanzó** —un envío que no salió,
 * una verificación que reventó—. Pero el camino más común no lanza: la verificación termina bien y
 * devuelve `invalido`, con su porqué en `outcome.detail`. Ese texto se publicaba en el evento del
 * historial y **no se guardaba en la fila del intento**, que quedaba con `error` en NULL.
 *
 * Costó no ver nada. El 2026-08-25 había veinte intentos fallidos seguidos, todos con el mismo
 * defecto detrás, y la tabla que se mira para saber cómo va el anclaje no decía ni una palabra de
 * por qué. Un fallo sin motivo guardado es un fallo que nadie arregla.
 *
 * Devuelve un trozo de objeto y no un `string | undefined` porque `exactOptionalPropertyTypes`
 * distingue «sin la clave» de «la clave con `undefined`», y la fila no quiere la clave si no hay
 * motivo.
 */
export function motivoDelIntento(intento: {
  readonly error?: string | undefined;
  readonly outcome?: { readonly status: string; readonly detail: string } | undefined;
}): { readonly error?: string } {
  if (intento.error !== undefined) return { error: intento.error };
  if (intento.outcome?.status === 'invalido') return { error: intento.outcome.detail };
  return {};
}

function estadoDe(
  status: string | undefined,
  receipt: AnchorReceipt | undefined,
): 'PENDIENTE' | 'CONFIRMADO' | 'FALLIDO' {
  if (receipt === undefined) return 'FALLIDO';
  if (status === 'confirmado') return 'CONFIRMADO';
  if (status === 'invalido') return 'FALLIDO';
  return 'PENDIENTE';
}

async function contarHechos(client: PgClient): Promise<bigint> {
  const { rows } = await client.query<{ total: string }>(
    'SELECT count(*)::text AS total FROM governance.event',
  );
  return BigInt(rows[0]?.total ?? '0');
}

interface FilaCheckpoint {
  readonly tree_size: string;
  readonly root_hash: Uint8Array;
  readonly heads_root: Uint8Array;
  readonly prev_checkpoint: Uint8Array | null;
  readonly issued_at: string;
  readonly checkpoint_hash: Uint8Array;
  readonly firm: boolean;
}

/**
 * Checkpoints que aún no están firmes, del más reciente hacia atrás.
 *
 * El `ORDER BY` va cualificado con la tabla a propósito: con `tree_size::text AS tree_size`,
 * PostgreSQL ordenaría por la columna de SALIDA —que es texto— y con diez checkpoints el «último»
 * sería el 9. La misma trampa está documentada en `latestCheckpoint()` y en `export.ts`.
 */
export async function checkpointsPendientes(
  client: PgClient,
  limite: number,
): Promise<readonly Checkpoint[]> {
  const { rows } = await client.query<FilaCheckpoint>(
    `SELECT tree_size::text AS tree_size, root_hash, heads_root, prev_checkpoint,
            issued_at, checkpoint_hash, firm
       FROM governance.checkpoint
      WHERE firm = false
      ORDER BY governance.checkpoint.tree_size DESC
      LIMIT $1`,
    [limite],
  );
  return rows.map((fila) => ({
    treeSize: BigInt(fila.tree_size),
    rootHash: new Uint8Array(fila.root_hash),
    headsRoot: new Uint8Array(fila.heads_root),
    prevCheckpoint:
      fila.prev_checkpoint === null ? undefined : new Uint8Array(fila.prev_checkpoint),
    issuedAt: fila.issued_at,
    checkpointHash: new Uint8Array(fila.checkpoint_hash),
    firm: fila.firm,
  }));
}

function describir(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
