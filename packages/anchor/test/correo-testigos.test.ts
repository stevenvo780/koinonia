/**
 * Testigos por correo: lo que cuenta son los acuses **firmados por el otro lado**, y el umbral se
 * mide en dominios distintos.
 */

import {
  ackPreimage,
  ackSignedBytes,
  domainOf,
  withAcks,
  WITNESS_SIGNATURE_NAMESPACE,
  WitnessEmailProvider,
  type AnchorReceipt,
  type Witness,
  type WitnessAck,
} from '@koinonia/anchor';
import { toHex } from '@koinonia/crypto';
import { describe, expect, it } from 'vitest';

import { type Firmante, nuevoFirmante, relojFijo, T_AHORA, texto } from './testigos.js';

const CHECKPOINT = new Uint8Array(32).fill(0x21);
const HEX = toHex(CHECKPOINT);

interface Padron {
  readonly witnesses: readonly Witness[];
  readonly firmantes: ReadonlyMap<string, Firmante>;
}

const DIRECCIONES: readonly (readonly [string, string])[] = [
  ['representacion_estudiantil', 'estudiantes@representacion.example'],
  ['direccion_instituto', 'direccion@udea.example'],
  ['docente_uno', 'ana@correo.example'],
  ['docente_dos', 'bruno@otrocorreo.example'],
  ['externa', 'carla@externa.example'],
];

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

function proveedor(p: Padron, minDistinctDomains = 3, selfDomains: readonly string[] = []) {
  return new WitnessEmailProvider({
    witnesses: p.witnesses,
    minDistinctDomains,
    selfDomains,
    clock: relojFijo(T_AHORA),
  });
}

async function acuse(
  p: Padron,
  id: string,
  messageId: string,
  opciones: {
    readonly checkpointHash?: string;
    readonly namespace?: string;
    readonly firmadoPor?: string;
    readonly sinFirma?: boolean;
    readonly address?: string;
  } = {},
): Promise<WitnessAck> {
  const witness = p.witnesses.find((w) => w.id === id)!;
  const address = opciones.address ?? witness.address;
  const seenAt = '2026-08-21T03:30:00.000Z';
  const base = { witness: id, address, seenAt };
  if (opciones.sinFirma === true) return base;

  const preimagen = ackPreimage({
    address,
    checkpointHash: opciones.checkpointHash ?? HEX,
    messageId,
    seenAt,
    witness: id,
  });
  const firmante = p.firmantes.get(opciones.firmadoPor ?? id)!;
  const signature = await firmante.firmar(
    opciones.namespace ?? WITNESS_SIGNATURE_NAMESPACE,
    ackSignedBytes(preimagen),
  );
  return { ...base, signature };
}

async function reciboCon(
  p: Padron,
  acuses: readonly WitnessAck[],
  provider = proveedor(p),
): Promise<AnchorReceipt> {
  const base = await provider.submit(CHECKPOINT);
  return withAcks(base, acuses, T_AHORA);
}

describe('dominios', () => {
  it('el dominio se extrae en minúsculas', () => {
    expect(domainOf('Ana@Correo.Example')).toBe('correo.example');
    expect(domainOf('sin-arroba')).toBe('');
  });
});

describe('WitnessEmailProvider', () => {
  it('un envío sin acuses queda PENDIENTE', async () => {
    const p = await padron();
    const provider = proveedor(p);
    const recibo = await provider.submit(CHECKPOINT);

    expect(recibo.externalRef).toMatch(/^<koinonia-[0-9a-f]{32}@/u);
    expect(texto(recibo.raw['subject'])).toContain(HEX.slice(0, 16));

    const resultado = await provider.verify(recibo, CHECKPOINT);
    expect(resultado.status).toBe('pendiente');
    expect(resultado.detail).toMatch(/0 de 3 dominios distintos/u);
  });

  it('tres acuses firmados de tres dominios distintos CONFIRMAN', async () => {
    const p = await padron();
    const provider = proveedor(p);
    const base = await provider.submit(CHECKPOINT);
    const recibo = await reciboCon(
      p,
      [
        await acuse(p, 'docente_uno', base.externalRef),
        await acuse(p, 'docente_dos', base.externalRef),
        await acuse(p, 'externa', base.externalRef),
      ],
      provider,
    );

    const resultado = await provider.verify(recibo, CHECKPOINT);
    expect(resultado.status).toBe('confirmado');
    expect(resultado.offline).toBe(true);
    expect(resultado.detail).toMatch(/3 personas de dominios de correo distintos/u);
    // Verificación offline de verdad: este proveedor NO necesita red nunca.
    expect(provider.meta.verificationNeedsNetwork).toBe(false);
  });

  it('cinco acuses del MISMO dominio no llegan al umbral: un proveedor de correo es un punto de falla', async () => {
    const mismoDominio: Witness[] = [];
    const firmantes = new Map<string, Firmante>();
    for (const [id] of DIRECCIONES) {
      const firmante = await nuevoFirmante();
      firmantes.set(id, firmante);
      mismoDominio.push({ id, address: `${id}@unico.example`, publicKey: firmante.publicKey });
    }
    const p: Padron = { witnesses: mismoDominio, firmantes };
    const provider = proveedor(p);
    const base = await provider.submit(CHECKPOINT);
    const recibo = await reciboCon(
      p,
      await Promise.all(DIRECCIONES.map(([id]) => acuse(p, id, base.externalRef))),
      provider,
    );

    const resultado = await provider.verify(recibo, CHECKPOINT);
    expect(resultado.status).toBe('pendiente');
    expect(resultado.detail).toMatch(/1 de 3 dominios distintos/u);
  });

  it('un acuse SIN firmar se registra como informativo y no cuenta', async () => {
    const p = await padron();
    const provider = proveedor(p, 1);
    const base = await provider.submit(CHECKPOINT);
    const recibo = await reciboCon(
      p,
      [await acuse(p, 'docente_uno', base.externalRef, { sinFirma: true })],
      provider,
    );

    const resultado = await provider.verify(recibo, CHECKPOINT);
    expect(resultado.status).toBe('pendiente');
    expect(resultado.checks.some((c) => /queda como informativo/u.test(c.detail))).toBe(true);
    expect(resultado.residualClaims.some((r) => /sin firmar/u.test(r.claim))).toBe(true);
  });

  it('un acuse firmado sobre OTRO checkpoint no vale', async () => {
    const p = await padron();
    const provider = proveedor(p, 1);
    const base = await provider.submit(CHECKPOINT);
    const recibo = await reciboCon(
      p,
      [await acuse(p, 'docente_uno', base.externalRef, { checkpointHash: 'f'.repeat(64) })],
      provider,
    );

    const resultado = await provider.verify(recibo, CHECKPOINT);
    expect(resultado.status).toBe('pendiente');
    expect(resultado.checks.some((c) => /NO es válida/u.test(c.detail))).toBe(true);
  });

  it('un acuse firmado por otra persona del padrón no vale como acuse suyo', async () => {
    const p = await padron();
    const provider = proveedor(p, 1);
    const base = await provider.submit(CHECKPOINT);
    const recibo = await reciboCon(
      p,
      [await acuse(p, 'docente_uno', base.externalRef, { firmadoPor: 'docente_dos' })],
      provider,
    );

    const resultado = await provider.verify(recibo, CHECKPOINT);
    expect(resultado.status).toBe('pendiente');
    expect(resultado.checks.some((c) => /lo firmó otra clave/u.test(c.detail))).toBe(true);
  });

  it('un acuse firmado en otro contexto no vale', async () => {
    const p = await padron();
    const provider = proveedor(p, 1);
    const base = await provider.submit(CHECKPOINT);
    const recibo = await reciboCon(
      p,
      [await acuse(p, 'docente_uno', base.externalRef, { namespace: 'file' })],
      provider,
    );

    const resultado = await provider.verify(recibo, CHECKPOINT);
    expect(resultado.checks.some((c) => /firma de otro contexto/u.test(c.detail))).toBe(true);
  });

  it('un testigo de un dominio NUESTRO no es testigo', async () => {
    const p = await padron();
    const provider = proveedor(p, 1, ['udea.example']);
    const base = await provider.submit(CHECKPOINT);
    const recibo = await reciboCon(
      p,
      [await acuse(p, 'direccion_instituto', base.externalRef)],
      provider,
    );

    const resultado = await provider.verify(recibo, CHECKPOINT);
    expect(resultado.status).toBe('pendiente');
    expect(resultado.checks.some((c) => /un testigo de casa no es testigo/u.test(c.detail))).toBe(
      true,
    );
  });

  it('un acuse de alguien que no está en el padrón no cuenta', async () => {
    const p = await padron();
    const provider = proveedor(p, 1);
    const base = await provider.submit(CHECKPOINT);
    const recibo = withAcks(
      base,
      [{ witness: 'desconocido', address: 'x@y.example', seenAt: T_AHORA }],
      T_AHORA,
    );

    const resultado = await provider.verify(recibo, CHECKPOINT);
    expect(resultado.checks.some((c) => /no está en el padrón de testigos/u.test(c.detail))).toBe(
      true,
    );
  });

  it('un recibo con la lista de acuses mal formada es INVÁLIDO, no «vacío»', async () => {
    const p = await padron();
    const provider = proveedor(p);
    const base = await provider.submit(CHECKPOINT);

    const resultado = await provider.verify(
      { ...base, raw: { ...base.raw, acks: ['no soy un objeto'] } },
      CHECKPOINT,
    );
    expect(resultado.status).toBe('invalido');
    expect(resultado.detail).toMatch(/mal formada/u);
  });
});
