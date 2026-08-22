/**
 * **Rebotes**: un testigo al que el correo ya no llega.
 *
 * El umbral del anclaje por testigos se mide en dominios distintos, y el padrón se erosiona solo:
 * gente que se va del instituto, direcciones institucionales que caducan, dominios que cambian de
 * manos. Si eso no se registra, el número de testigos alcanzables baja en silencio hasta el día en
 * que ya no se llega al umbral, y nadie sabe desde cuándo. Por eso un rebote **es una falla de
 * anclaje** y se escribe en el recibo, no una anécdota del servidor de correo.
 *
 * Aquí no hay SMTP: el transporte y la recogida son puertos, y estos dobles devuelven lo que
 * devolvería un servidor real. El transporte de verdad —SMTP con DKIM, IMAP— vive en `services/api`
 * y se prueba allí, con su diálogo guionizado.
 */

import {
  ackPreimage,
  ackSignedBytes,
  withAcks,
  WITNESS_SIGNATURE_NAMESPACE,
  WitnessEmailProvider,
  type AckCollection,
  type AckCollector,
  type AnchorReceipt,
  type EmailDeliveryReport,
  type EmailTransport,
  type Witness,
  type WitnessAck,
  type WitnessBounce,
} from '@koinonia/anchor';
import { toHex } from '@koinonia/crypto';
import { describe, expect, it } from 'vitest';

import { type Firmante, nuevoFirmante, relojFijo, T_AHORA } from './testigos.js';

const CHECKPOINT = new Uint8Array(32).fill(0x21);
const HEX = toHex(CHECKPOINT);

const DIRECCIONES: readonly (readonly [string, string])[] = [
  ['representacion_estudiantil', 'estudiantes@representacion.example'],
  ['docente_uno', 'ana@correo.example'],
  ['docente_dos', 'bruno@otrocorreo.example'],
  ['externa', 'carla@externa.example'],
];

interface Padron {
  readonly witnesses: readonly Witness[];
  readonly firmantes: ReadonlyMap<string, Firmante>;
}

async function padron(): Promise<Padron> {
  const witnesses: Witness[] = [];
  const firmantes = new Map<string, Firmante>();
  for (const [id, address] of DIRECCIONES) {
    const firmante = await nuevoFirmante();
    firmantes.set(id, firmante);
    witnesses.push({ id, address, publicKey: firmante.publicKey });
  }
  return { witnesses, firmantes };
}

function proveedor(
  p: Padron,
  extra: {
    readonly transport?: EmailTransport;
    readonly collector?: AckCollector;
    readonly minDistinctDomains?: number;
  } = {},
): WitnessEmailProvider {
  return new WitnessEmailProvider({
    witnesses: p.witnesses,
    minDistinctDomains: extra.minDistinctDomains ?? 3,
    clock: relojFijo(T_AHORA),
    ...(extra.transport === undefined ? {} : { transport: extra.transport }),
    ...(extra.collector === undefined ? {} : { collector: extra.collector }),
  });
}

function transporte(report: EmailDeliveryReport): EmailTransport {
  return { send: () => Promise.resolve(report) };
}

function recolector(coleccion: AckCollection): AckCollector {
  return { collect: () => Promise.resolve(coleccion) };
}

async function acuseFirmado(p: Padron, id: string, messageId: string): Promise<WitnessAck> {
  const witness = p.witnesses.find((w) => w.id === id)!;
  const seenAt = '2026-08-21T03:30:00.000Z';
  const preimagen = ackPreimage({
    address: witness.address,
    checkpointHash: HEX,
    messageId,
    seenAt,
    witness: id,
  });
  const signature = await p.firmantes
    .get(id)!
    .firmar(WITNESS_SIGNATURE_NAMESPACE, ackSignedBytes(preimagen));
  return { witness: id, address: witness.address, seenAt, signature };
}

const REBOTE_PERMANENTE: WitnessBounce = {
  witness: 'docente_uno',
  address: 'ana@correo.example',
  kind: 'permanente',
  status: '5.1.1',
  detail: 'Recipient address rejected: User unknown in local recipient table',
};

const REBOTE_TRANSITORIO: WitnessBounce = {
  witness: 'docente_dos',
  address: 'bruno@otrocorreo.example',
  kind: 'transitorio',
  status: '4.2.2',
  detail: 'Mailbox full',
};

describe('rebote en el acto (el servidor rechaza el destinatario al enviar)', () => {
  it('el recibo registra quién aceptó y quién rebotó', async () => {
    const p = await padron();
    const provider = proveedor(p, {
      transport: transporte({
        accepted: ['estudiantes@representacion.example', 'carla@externa.example'],
        bounced: [REBOTE_PERMANENTE],
      }),
    });

    const recibo = await provider.submit(CHECKPOINT);
    expect(recibo.raw['accepted']).toStrictEqual([
      'estudiantes@representacion.example',
      'carla@externa.example',
    ]);
    expect(recibo.raw['bounces']).toStrictEqual([
      {
        witness: 'docente_uno',
        address: 'ana@correo.example',
        kind: 'permanente',
        status: '5.1.1',
        detail: 'Recipient address rejected: User unknown in local recipient table',
      },
    ]);
  });

  it('sin transporte no se inventan campos: el recibo queda como antes', async () => {
    const p = await padron();
    const recibo = await proveedor(p).submit(CHECKPOINT);
    expect(Object.hasOwn(recibo.raw, 'bounces')).toBe(false);
    expect(Object.hasOwn(recibo.raw, 'accepted')).toBe(false);
  });
});

describe('verify ante rebotes', () => {
  it('el rebote sale como comprobación FALLIDA, con el código y en castellano', async () => {
    const p = await padron();
    const provider = proveedor(p, {
      transport: transporte({ accepted: [], bounced: [REBOTE_PERMANENTE, REBOTE_TRANSITORIO] }),
    });

    const recibo = await provider.submit(CHECKPOINT);
    const resultado = await provider.verify(recibo, CHECKPOINT);

    const rebotes = resultado.checks.filter((c) => c.name === 'rebote');
    expect(rebotes).toHaveLength(2);
    expect(rebotes.every((c) => !c.ok)).toBe(true);
    expect(rebotes[0]!.detail).toMatch(/el correo NO llegó a docente_uno \[5\.1\.1\]/u);
    expect(rebotes[0]!.detail).toMatch(/rebote permanente/u);
    expect(rebotes[1]!.detail).toMatch(/Es transitorio: puede llegar en el reintento/u);
  });

  it('un rebote permanente deja constancia de que hay que reponer el padrón', async () => {
    const p = await padron();
    const provider = proveedor(p, {
      transport: transporte({ accepted: [], bounced: [REBOTE_PERMANENTE] }),
    });

    const resultado = await provider.verify(await provider.submit(CHECKPOINT), CHECKPOINT);
    const claim = resultado.residualClaims.find((r) => /ya no reciben el correo/u.test(r.claim));
    expect(claim?.claim).toBe('1 testigo(s) del padrón ya no reciben el correo: docente_uno');
    expect(claim?.verifyBy).toMatch(/actualizá el padrón/u);
  });

  it('cuando los rebotes hacen INALCANZABLE el umbral, lo dice con esas palabras', async () => {
    // Cuatro testigos en cuatro dominios; se caen dos permanentemente y el umbral son tres. Esto no
    // es «está tardando»: con este padrón el anclaje por testigos ya no puede confirmarse nunca.
    const p = await padron();
    const provider = proveedor(p, {
      transport: transporte({
        accepted: [],
        bounced: [
          REBOTE_PERMANENTE,
          { ...REBOTE_TRANSITORIO, kind: 'permanente', status: '5.1.1' },
        ],
      }),
    });

    const resultado = await provider.verify(await provider.submit(CHECKPOINT), CHECKPOINT);
    const claim = resultado.residualClaims.find((r) => /ya no reciben el correo/u.test(r.claim));

    expect(claim?.verifyBy).toMatch(/quedan 2 dominios alcanzables y hacen falta 3/u);
    expect(claim?.verifyBy).toMatch(/NO puede confirmarse/u);
    expect(resultado.status).toBe('pendiente');
  });

  it('un testigo que rebotó y AUN ASÍ firmó su acuse cuenta: manda la firma, no el rebote', async () => {
    // Pasa de verdad: el rebote fue de la dirección institucional y la persona contestó desde el
    // móvil. Descontarla por el rebote sería castigar a un testigo que sí atestiguó.
    const p = await padron();
    const provider = proveedor(p, {
      transport: transporte({ accepted: [], bounced: [REBOTE_PERMANENTE] }),
      minDistinctDomains: 1,
    });

    const base = await provider.submit(CHECKPOINT);
    const recibo = withAcks(
      base,
      [await acuseFirmado(p, 'docente_uno', base.externalRef)],
      T_AHORA,
    );
    const resultado = await provider.verify(recibo, CHECKPOINT);

    expect(resultado.status).toBe('confirmado');
    expect(resultado.checks.some((c) => c.name === 'acuse' && c.ok)).toBe(true);
    expect(resultado.checks.some((c) => c.name === 'rebote' && !c.ok)).toBe(true);
  });

  it('una lista de rebotes mal formada invalida el recibo en vez de ignorarse', async () => {
    const p = await padron();
    const provider = proveedor(p);
    const base = await provider.submit(CHECKPOINT);
    const recibo: AnchorReceipt = {
      ...base,
      raw: { ...base.raw, bounces: [{ address: 'x@y.example', kind: 'quizás', detail: 'eh' }] },
    };

    const resultado = await provider.verify(recibo, CHECKPOINT);
    expect(resultado.status).toBe('invalido');
    expect(resultado.detail).toMatch(/la lista de rebotes del recibo está mal formada/u);
  });
});

describe('poll recoge acuses y rebotes a la vez', () => {
  it('un rebote diferido llega por el buzón y se guarda con el acuse', async () => {
    const p = await padron();
    const base = await proveedor(p).submit(CHECKPOINT);
    const acuse = await acuseFirmado(p, 'externa', base.externalRef);

    const provider = proveedor(p, {
      collector: recolector({ acks: [acuse], bounces: [REBOTE_PERMANENTE] }),
    });

    const recibo = await provider.poll(base);
    expect((recibo.raw['acks'] as readonly unknown[]).length).toBe(1);
    expect((recibo.raw['bounces'] as readonly unknown[]).length).toBe(1);
  });

  it('un rebote NO se borra porque la recogida siguiente no lo repita', async () => {
    // Un acuse es el estado actual de un testigo y el último gana. Un rebote es un hecho que ocurrió
    // una vez: si cada recogida lo sobrescribiera, el desgaste del padrón se borraría solo.
    const p = await padron();
    const base = await proveedor(p).submit(CHECKPOINT);

    const primero = await proveedor(p, {
      collector: recolector({ acks: [], bounces: [REBOTE_PERMANENTE] }),
    }).poll(base);

    const segundo = await proveedor(p, {
      collector: recolector({
        acks: [await acuseFirmado(p, 'externa', base.externalRef)],
        bounces: [],
      }),
    }).poll(primero);

    expect(segundo.raw['bounces']).toStrictEqual(primero.raw['bounces']);
    expect((segundo.raw['acks'] as readonly unknown[]).length).toBe(1);
  });

  it('sin acuses ni rebotes, `poll` devuelve el recibo intacto', async () => {
    const p = await padron();
    const base = await proveedor(p).submit(CHECKPOINT);
    const provider = proveedor(p, { collector: recolector({ acks: [], bounces: [] }) });
    expect(await provider.poll(base)).toStrictEqual(base);
  });
});
