import { describe, expect, it } from 'vitest';

import { forbiddenTermsIn } from '../src/glossary.js';
import { desestimarObjecion, objecionDesestimada } from '../src/objeciones.js';

const id = '0123456789abcdef0123456789abcdef';
const otroId = 'fedcba9876543210fedcba9876543210';
const reqId = '11111111-1111-4111-8111-111111111111';

describe('desestimar una objeción', () => {
  it('acepta un cuerpo completo: votos, y una motivación con sustancia', () => {
    const resultado = desestimarObjecion.safeParse({
      requestId: reqId,
      votos: 2,
      motivacion: 'El objetivo dañado ya está contemplado en el plan aprobado del círculo.',
    });
    expect(resultado.success).toBe(true);
  });

  it('B.3.a — rechaza una motivación en blanco o demasiado corta para leerse', () => {
    for (const motivacion of ['', '   ', 'no']) {
      const resultado = desestimarObjecion.safeParse({ requestId: reqId, votos: 2, motivacion });
      expect(resultado.success, JSON.stringify(motivacion)).toBe(false);
    }
  });

  it('rechaza votos negativos o no enteros', () => {
    for (const votos of [-1, 1.5]) {
      const resultado = desestimarObjecion.safeParse({
        requestId: reqId,
        votos,
        motivacion: 'El objetivo dañado ya está contemplado en el plan aprobado del círculo.',
      });
      expect(resultado.success, String(votos)).toBe(false);
    }
  });

  it('no acepta que el cliente mande el panel: eso lo sortea el servidor', () => {
    const resultado = desestimarObjecion.safeParse({
      requestId: reqId,
      votos: 2,
      motivacion: 'El objetivo dañado ya está contemplado en el plan aprobado del círculo.',
      panel: [id],
    });
    expect(resultado.success).toBe(false);
  });

  it('no acepta campos de más', () => {
    const resultado = desestimarObjecion.safeParse({
      requestId: reqId,
      votos: 2,
      motivacion: 'El objetivo dañado ya está contemplado en el plan aprobado del círculo.',
      urgente: true,
    });
    expect(resultado.success).toBe(false);
  });
});

describe('la objeción desestimada publicada', () => {
  const base = {
    decisionId: id,
    objectionId: otroId,
    panel: [id, otroId],
    tamanoPanel: 3,
    votos: 2,
    umbral: '2/3',
    motivacion: 'El objetivo dañado ya está contemplado en el plan aprobado del círculo.',
    desestimadaEn: 1_700_000_000_000,
  };

  it('valida la forma completa', () => {
    expect(objecionDesestimada.safeParse(base).success).toBe(true);
  });

  it('el tamaño del panel es siempre positivo: un panel de cero no es un panel', () => {
    const resultado = objecionDesestimada.safeParse({ ...base, tamanoPanel: 0 });
    expect(resultado.success).toBe(false);
  });

  it('ninguna cadena de este contrato lleva vocabulario prohibido en pantalla (ADR-0041)', () => {
    const textos = [
      'El objetivo dañado ya está contemplado en el plan aprobado del círculo.',
      base.umbral,
    ];
    for (const texto of textos) {
      expect(forbiddenTermsIn(texto), texto).toEqual([]);
    }
  });
});
