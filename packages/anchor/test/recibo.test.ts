/**
 * Recibos: forma canónica y validación de un dato hostil.
 *
 * Un recibo viaja en un export público que sirve el mismo servidor que se está auditando. Todo lo
 * que lo lee tiene que desconfiar de él antes de usarlo.
 */

import {
  assertAnchorReceipt,
  canonicalReceipt,
  InvalidReceiptError,
  parseReceipt,
  receiptHash,
  type AnchorReceipt,
} from '@koinonia/anchor';
import { toHex } from '@koinonia/crypto';
import { describe, expect, it } from 'vitest';

const RECIBO: AnchorReceipt = {
  provider: 'ots',
  independenceClass: 'blockchain',
  checkpointHash: 'a'.repeat(64),
  externalRef: 'bitcoin:921447',
  submittedAt: '2026-08-21T03:00:00.000Z',
  confirmedAt: '2026-08-21T03:14:00.000Z',
  proof: 'AA-_',
  raw: { blockHeight: 921_447, calendar: 'https://ejemplo.invalid' },
};

describe('forma canónica del recibo', () => {
  it('las claves salen ordenadas y sin espacios, siempre igual', () => {
    const texto = canonicalReceipt(RECIBO);
    expect(texto.startsWith('{"checkpointHash":')).toBe(true);
    expect(texto).not.toContain(' ');
    // El orden del objeto de entrada no cambia el resultado.
    const revuelto: AnchorReceipt = {
      raw: RECIBO.raw,
      ...(RECIBO.proof === undefined ? {} : { proof: RECIBO.proof }),
      submittedAt: RECIBO.submittedAt,
      ...(RECIBO.confirmedAt === undefined ? {} : { confirmedAt: RECIBO.confirmedAt }),
      externalRef: RECIBO.externalRef,
      checkpointHash: RECIBO.checkpointHash,
      independenceClass: RECIBO.independenceClass,
      provider: RECIBO.provider,
    };
    expect(canonicalReceipt(revuelto)).toBe(texto);
  });

  it('el hash del recibo cambia si cambia cualquier byte', async () => {
    const original = toHex(await receiptHash(RECIBO));
    const tocado = toHex(await receiptHash({ ...RECIBO, externalRef: 'bitcoin:921448' }));
    expect(tocado).not.toBe(original);
    expect(original).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('un recibo sin `confirmedAt` OMITE la clave: no emite null', () => {
    const { confirmedAt: _confirmedAt, ...pendiente } = RECIBO;
    expect(canonicalReceipt(pendiente)).not.toContain('confirmedAt');
  });

  it('parseReceipt exige la forma canónica exacta, no «equivalente»', () => {
    const texto = canonicalReceipt(RECIBO);
    expect(parseReceipt(texto).externalRef).toBe('bitcoin:921447');
    // Reordenar dos claves produce el MISMO objeto lógico y otro texto: se rechaza.
    const reordenado = JSON.stringify(JSON.parse(texto), ['provider', 'checkpointHash']);
    expect(() => parseReceipt(reordenado)).toThrow();
    // Un espacio de más también.
    expect(() => parseReceipt(`${texto.slice(0, 1)} ${texto.slice(1)}`)).toThrow();
  });
});

describe('validación de un recibo hostil', () => {
  it.each([
    ['provider', { provider: 'OTS' }, /provider/u],
    ['independenceClass', { independenceClass: 'inventada' }, /independenceClass/u],
    ['checkpointHash corto', { checkpointHash: 'ab' }, /checkpointHash/u],
    ['checkpointHash en mayúsculas', { checkpointHash: 'A'.repeat(64) }, /checkpointHash/u],
    ['externalRef vacío', { externalRef: '' }, /externalRef/u],
    ['submittedAt sin milisegundos', { submittedAt: '2026-08-21T03:00:00Z' }, /submittedAt/u],
    ['confirmedAt nulo', { confirmedAt: null }, /confirmedAt/u],
    ['proof no base64url', { proof: 'no válido!' }, /proof/u],
    ['raw que no es objeto', { raw: [] }, /raw/u],
  ])('rechaza %s', (_nombre, parche, patron) => {
    expect(() => {
      assertAnchorReceipt({ ...RECIBO, ...parche });
    }).toThrow(patron);
  });

  it('rechaza claves desconocidas: un campo de más cambia la preimagen', () => {
    expect(() => {
      assertAnchorReceipt({ ...RECIBO, extra: 1 });
    }).toThrow(InvalidReceiptError);
  });

  it('rechaza lo que ni siquiera es un objeto', () => {
    for (const basura of [null, 42, 'texto', [], undefined]) {
      expect(() => {
        assertAnchorReceipt(basura);
      }).toThrow(/no es un objeto JSON plano/u);
    }
  });
});
