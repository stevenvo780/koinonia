import {
  aceptarRevisionTarea,
  agregarEvidenciaTarea,
  aperturaMaterialRestringido,
  bloquearTarea,
  entregarTarea,
  iniciarTarea,
  pausaTarea,
  pedirAyudaTarea,
  pedirCambiosTarea,
  reanudarTarea,
  tarea,
} from '@koinonia/contracts';
import { describe, expect, it } from 'vitest';

const ID = '1'.repeat(32);
const ID_2 = '2'.repeat(32);
const ID_3 = '3'.repeat(32);
const ID_4 = '4'.repeat(32);
const REQUEST = '00000000-0000-4000-8000-000000000001';
const base = { requestId: REQUEST, offerId: ID, revision: 7 } as const;

describe('contratos de seguimiento ADR-0045', () => {
  it('acepta las ocho intenciones cerradas y rechaza campos ajenos', () => {
    expect(iniciarTarea.parse(base)).toStrictEqual(base);
    expect(bloquearTarea.parse({ ...base, categoria: 'recurso' })).toMatchObject({
      categoria: 'recurso',
    });
    expect(pedirAyudaTarea.parse({ ...base, categoria: 'orientacion' })).toMatchObject({
      categoria: 'orientacion',
    });
    expect(reanudarTarea.parse({ ...base, pauseId: ID_2 })).toMatchObject({ pauseId: ID_2 });
    expect(
      agregarEvidenciaTarea.parse({
        ...base,
        contenido: 'Una nota restringida con evidencia suficiente.',
        visibilidad: 'restricted',
      }),
    ).toMatchObject({ visibilidad: 'restricted' });
    expect(
      entregarTarea.parse({
        ...base,
        evidenciaIds: [ID_2],
        resumen: 'La evidencia muestra el resultado observable que se acordó.',
      }),
    ).toMatchObject({ evidenciaIds: [ID_2] });
    expect(
      pedirCambiosTarea.parse({
        requestId: REQUEST,
        deliveryId: ID_2,
        revision: 8,
        motivo: 'evidencia-insuficiente',
      }),
    ).toMatchObject({ motivo: 'evidencia-insuficiente' });
    expect(
      aceptarRevisionTarea.parse({
        requestId: REQUEST,
        deliveryId: ID_2,
        revision: 8,
        evidenciaCriterio: 'verificada',
      }),
    ).toMatchObject({ evidenciaCriterio: 'verificada' });

    expect(iniciarTarea.safeParse({ ...base, memberId: ID_2 }).success).toBe(false);
  });

  it('la evidencia se compromete en servidor y nunca recibe metadata o digest del cliente', () => {
    const valid = {
      ...base,
      contenido: 'Una observación verificable sobre lo que se produjo.',
      visibilidad: 'restricted',
    } as const;
    expect(agregarEvidenciaTarea.safeParse(valid).success).toBe(true);
    for (const forbidden of ['filename', 'mime', 'url', 'bytes', 'commitment', 'nonce']) {
      expect(
        agregarEvidenciaTarea.safeParse({ ...valid, [forbidden]: 'dato-controlado' }).success,
      ).toBe(false);
    }
    expect(agregarEvidenciaTarea.safeParse({ ...valid, visibilidad: 'public' }).success).toBe(
      false,
    );
  });

  it('una entrega exige evidencias únicas y resumen sustantivo', () => {
    expect(
      entregarTarea.safeParse({ ...base, evidenciaIds: [], resumen: 'x'.repeat(30) }).success,
    ).toBe(false);
    expect(
      entregarTarea.safeParse({
        ...base,
        evidenciaIds: [ID_2, ID_2],
        resumen: 'Un resumen suficientemente largo para ser revisado.',
      }).success,
    ).toBe(false);
  });

  it('la proyección de tarea lleva historia operativa sin commitments ni contenido privado', () => {
    const projected = {
      id: ID,
      hitoId: ID_2,
      destinatarioId: ID,
      responsableId: ID,
      ofertaId: ID_2,
      revision: 12,
      titulo: 'Preparar un informe verificable',
      descripcion: 'Contrastar la evidencia con el criterio que aprobó la comunidad.',
      venceEn: 1_800_000_000_000,
      esfuerzoMinutos: 90,
      dependeDe: [],
      estado: 'entregada',
      iniciadaEn: 1_799_000_000_000,
      pausas: [
        {
          id: ID_2,
          tipo: 'bloqueo',
          categoria: 'recurso',
          iniciadaEn: 1_799_010_000_000,
          finalizadaEn: 1_799_020_000_000,
          causaDeFin: 'reanudacion',
        },
        {
          id: ID_3,
          tipo: 'apoyo',
          categoria: 'orientacion',
          iniciadaEn: 1_799_030_000_000,
          finalizadaEn: 1_799_050_000_000,
          causaDeFin: 'reasignacion',
        },
      ],
      solicitudesDeAyuda: [
        {
          id: ID_4,
          pausaId: ID_2,
          categoria: 'revision',
          solicitadaEn: 1_799_040_000_000,
        },
      ],
      evidencias: [
        {
          id: ID_2,
          tipo: 'texto',
          tamano: 'pequena',
          visibilidad: 'restricted',
          agregadaEn: 1_799_100_000_000,
          puedeAbrirse: true,
        },
      ],
      entregas: [
        {
          id: ID,
          evidenciaIds: [ID_2],
          entregadaEn: 1_799_200_000_000,
          puedeAbrirse: true,
        },
      ],
      entregaActualId: ID,
      esMia: true,
    } as const;
    expect(tarea.parse(projected)).toStrictEqual(projected);
    expect(tarea.safeParse({ ...projected, commitment: 'f'.repeat(64) }).success).toBe(true);
    // Zod de salida puede retirar extras; lo importante es que el DTO tipado no contiene ese campo.
    expect(tarea.parse({ ...projected, commitment: 'f'.repeat(64) })).not.toHaveProperty(
      'commitment',
    );

    const sanitized = tarea.parse({
      ...projected,
      pausas: projected.pausas.map((pausa) => ({
        ...pausa,
        privateDetailCommitment: 'a'.repeat(64),
      })),
      solicitudesDeAyuda: projected.solicitudesDeAyuda.map((solicitud) => ({
        ...solicitud,
        solicitadaPor: ID_2,
        privateDetailCommitment: 'b'.repeat(64),
      })),
      entregas: projected.entregas.map((entrega) => ({
        ...entrega,
        entregadaPor: ID_2,
        summaryCommitment: 'c'.repeat(64),
      })),
    });
    expect(JSON.stringify(sanitized)).not.toContain('Commitment');
    expect(sanitized.solicitudesDeAyuda[0]).not.toHaveProperty('solicitadaPor');
    expect(sanitized.entregas[0]).not.toHaveProperty('entregadaPor');
  });

  it('una pausa cerrada presenta juntos el fin y su causa', () => {
    const abierta = {
      id: ID,
      tipo: 'bloqueo',
      categoria: 'dependencia',
      iniciadaEn: 1_799_000_000_000,
    } as const;
    expect(pausaTarea.safeParse(abierta).success).toBe(true);
    expect(pausaTarea.safeParse({ ...abierta, finalizadaEn: 1_799_100_000_000 }).success).toBe(
      false,
    );
    expect(pausaTarea.safeParse({ ...abierta, causaDeFin: 'reasignacion' }).success).toBe(false);
    expect(
      pausaTarea.safeParse({
        ...abierta,
        finalizadaEn: 1_799_100_000_000,
        causaDeFin: 'reasignacion',
      }).success,
    ).toBe(true);
  });

  it('la apertura privada sólo devuelve contenido acotado y rechaza metadata', () => {
    expect(aperturaMaterialRestringido.parse({ contenido: 'detalle autorizado' })).toStrictEqual({
      contenido: 'detalle autorizado',
    });
    expect(
      aperturaMaterialRestringido.safeParse({ contenido: 'detalle autorizado', ownerId: ID })
        .success,
    ).toBe(false);
    expect(
      aperturaMaterialRestringido.safeParse({ contenido: 'x'.repeat(16 * 1024 + 1) }).success,
    ).toBe(false);
  });
});
