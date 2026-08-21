/**
 * Encadenado genérico de agregados de trabajo (problemas y propuestas).
 *
 * Es la misma construcción que `events.ts` usa para las decisiones —`SHA256(0x02 ‖ prevHash ‖
 * jcs_utf8(cuerpo))`, `seq` denso desde 1, `prevHash` del anterior— generalizada sobre el tipo del
 * payload. No se reutiliza `appendEvent` de `events.ts` porque aquel está tipado contra
 * `DecisionEventPayload`, y ensanchar aquella unión con eventos que no son de una decisión rompería
 * la exhaustividad de los `switch` del motor, que es justo lo que impide olvidarse de un caso.
 *
 * Lo importante: **la cadena es la misma**. Un problema borrado a mano rompe su cadena exactamente
 * igual que una papeleta borrada a mano, y el mismo verificador lo denuncia.
 */

import { fromHex, hashEvent, toHex } from '@koinonia/crypto';

import { toCanonicalJson } from '../canonical.js';
import { BrokenLogError } from '../errors.js';
import {
  type EventId,
  type Hash,
  hash as toHashBrand,
  type Instant,
  type MemberId,
  ZERO_HASH,
} from '../ids.js';

/** Un evento de agregado de trabajo, con su eslabón. `P` es la unión de payloads del agregado. */
export interface ChainedEvent<P> {
  readonly eventId: EventId;
  /** Identificador opaco del agregado (problema o propuesta). */
  readonly aggregateId: string;
  /** Denso desde 1, único por agregado. Orden canónico de replay. */
  readonly seq: number;
  /** Reloj del servidor. Entra como dato: el dominio no lee relojes. */
  readonly occurredAt: Instant;
  readonly actor: MemberId | 'system';
  readonly payload: P;
  readonly prevHash: Hash;
  readonly hash: Hash;
}

export type ChainedLog<P> = readonly ChainedEvent<P>[];

/** Lo que aporta el llamante; `seq`, `prevHash` y `hash` los calcula `appendChained`. */
export interface ChainedInput<P> {
  readonly eventId: EventId;
  readonly aggregateId: string;
  readonly occurredAt: Instant;
  readonly actor: MemberId | 'system';
  readonly payload: P;
}

/** El cuerpo hasheado: todo menos `prevHash` (prefijo binario) y `hash` (el resultado). */
export function chainedBody<P>(event: Omit<ChainedEvent<P>, 'prevHash' | 'hash'>): unknown {
  return {
    eventId: event.eventId,
    aggregateId: event.aggregateId,
    seq: event.seq,
    occurredAt: event.occurredAt,
    actor: event.actor,
    payload: event.payload,
  };
}

async function linkHash(prevHash: Hash, body: unknown): Promise<Hash> {
  return toHashBrand(toHex(await hashEvent(fromHex(prevHash), toCanonicalJson(body))));
}

/** Sella un evento: `seq` denso, encadenado al anterior, con su hash calculado. */
export async function appendChained<P>(
  log: ChainedLog<P>,
  input: ChainedInput<P>,
): Promise<ChainedEvent<P>> {
  const previous = log.at(-1);
  const seq = log.length + 1;
  const prevHash = previous?.hash ?? ZERO_HASH;
  const partial = {
    eventId: input.eventId,
    aggregateId: input.aggregateId,
    seq,
    occurredAt: input.occurredAt,
    actor: input.actor,
    payload: input.payload,
  };
  return { ...partial, prevHash, hash: await linkHash(prevHash, chainedBody(partial)) };
}

/**
 * Verifica la cadena: `seq` denso, `prevHash` encadenado y cada `hash` recomputable.
 *
 * Detecta borrado, inserción y reordenamiento. Es lo mismo que `verifyLogChain` hace con las
 * decisiones, y por eso la pantalla «Verificar integridad» puede decir una sola frase sobre todo el
 * historial en vez de una por tipo de cosa.
 */
export async function verifyChain<P>(log: ChainedLog<P>): Promise<void> {
  let expectedPrev: Hash = ZERO_HASH;
  for (let i = 0; i < log.length; i++) {
    const event = log[i];
    if (event === undefined) throw new BrokenLogError(i + 1, 'hueco en el arreglo de eventos');
    if (event.seq !== i + 1) {
      throw new BrokenLogError(
        event.seq,
        `seq debe ser denso: se esperaba ${String(i + 1)} y llegó ${String(event.seq)}`,
      );
    }
    if (event.prevHash !== expectedPrev) {
      throw new BrokenLogError(event.seq, 'prevHash no coincide con el hash del evento anterior');
    }
    const recomputed = await linkHash(event.prevHash, chainedBody(event));
    if (recomputed !== event.hash) {
      throw new BrokenLogError(event.seq, 'el hash almacenado no corresponde al contenido');
    }
    expectedPrev = event.hash;
  }
}

/** ¿La cadena está intacta? Variante no excepcional. */
export async function isChainIntact<P>(log: ChainedLog<P>): Promise<boolean> {
  try {
    await verifyChain(log);
    return true;
  } catch (error) {
    if (error instanceof BrokenLogError) return false;
    throw error;
  }
}
