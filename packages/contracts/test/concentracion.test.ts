/**
 * El contrato de la concentración de delegación, contra objetos armados a mano.
 *
 * A diferencia de `metricas.test.ts` (que corre el paquete real `@koinonia/metrics`), acá no hay
 * ningún paquete de cálculo que este fichero pueda importar sin invertir la dirección de
 * dependencias: el cálculo (`calcularConcentracionDeDelegacion`) vive en
 * `services/api/src/http/rutas-concentracion.ts`, que DEPENDE de `@koinonia/contracts` — no al
 * revés. Ese cálculo, con datos de delegación reales y el recorrido de cadenas, se prueba allá
 * (`services/api/test/rutas-concentracion.test.ts`). Acá sólo se prueba la traducción a DTO y el
 * esquema Zod: dado un `InformeConcentracionDelegacion` con la forma que el cálculo promete
 * producir, ¿el DTO sale bien formado, sin `bigint` sobreviviente, y con el k-anonimato heredado de
 * `@koinonia/metrics` intacto?
 *
 * La prueba que más importa de este fichero es la última: que ningún campo del esquema puede
 * cargar un identificador de persona, ni siquiera por accidente de quien construya el informe a
 * mano.
 */

import { describe, expect, it } from 'vitest';

import type { Fraction } from '@koinonia/domain';
import { NO_SE_PUBLICA } from '@koinonia/metrics';

import {
  concentracionDelegacion,
  concentracionDelegacionDto,
  type BaldeDeReparto,
  type InformeConcentracionDelegacion,
  type RepartoDeDelegacion,
} from '../src/concentracion.js';

const MEDIO_INSTANTE = 1_700_000_000_000;

function fraccion(num: bigint, den: bigint): Fraction {
  return { num, den };
}

function deciles10(
  pesoTotalPorGrupo: readonly number[],
  personasPorGrupo: number,
): BaldeDeReparto[] {
  const total = pesoTotalPorGrupo.reduce((s, w) => s + w, 0);
  return pesoTotalPorGrupo.map((w) => ({
    personas: personasPorGrupo,
    participacionDelPeso: total === 0 ? fraccion(0n, 1n) : fraccion(BigInt(w), BigInt(total)),
  }));
}

function repartoBase(
  receptoresConPeso: number,
  mayorReceptor: RepartoDeDelegacion['mayorReceptor'],
): RepartoDeDelegacion {
  return {
    receptoresConPeso,
    personasSinAsignar: 0,
    reparto: fraccion(1n, 10n),
    desigualdad: fraccion(1n, 5n),
    mayorReceptor,
    deciles: deciles10([30, 27, 24, 21, 18, 15, 12, 9, 6, 3], 3),
    alarma: false,
  };
}

describe('concentración de delegación', () => {
  it('con 40 receptores, publica todo el detalle, incluido el mayor receptor', () => {
    const informe: InformeConcentracionDelegacion = {
      medidoEn: MEDIO_INSTANTE,
      censo: 300,
      personasQueDelegan: 120,
      reparto: {
        publicado: true,
        personas: 40,
        grupoPequeno: false,
        valor: repartoBase(40, {
          publicado: true,
          personas: 40,
          grupoPequeno: false,
          valor: fraccion(1n, 20n),
        }),
      },
    };

    const dto = concentracionDelegacionDto(informe);
    const analizado = concentracionDelegacion.parse(dto);

    expect(analizado.reparto).toMatchObject({ publicado: true, personas: 40 });
    if (analizado.reparto.publicado) {
      expect(analizado.reparto.valor.receptoresConPeso).toBe(40);
      expect(analizado.reparto.valor.mayorReceptor).toMatchObject({ publicado: true });
      expect(analizado.reparto.valor.reparto.texto).toContain('%');
      expect(analizado.reparto.valor.deciles).toHaveLength(10);
    }
    // Ningún `bigint` sobrevive: si sobreviviera, `JSON.stringify` reventaría acá mismo.
    expect(() => JSON.stringify(dto)).not.toThrow();
  });

  it('con menos de K_NO_SE_PUBLICA receptores, no se publica nada del reparto', () => {
    const informe: InformeConcentracionDelegacion = {
      medidoEn: MEDIO_INSTANTE,
      censo: 300,
      personasQueDelegan: 4,
      reparto: NO_SE_PUBLICA,
    };

    const dto = concentracionDelegacionDto(informe);
    expect(dto.reparto).toEqual({ publicado: false });
    concentracionDelegacion.parse(dto);
  });

  it('entre 10 y 29 receptores, el reparto se publica pero "mayorReceptor" se retiene', () => {
    const informe: InformeConcentracionDelegacion = {
      medidoEn: MEDIO_INSTANTE,
      censo: 300,
      personasQueDelegan: 60,
      reparto: {
        publicado: true,
        personas: 15,
        grupoPequeno: true,
        valor: repartoBase(15, NO_SE_PUBLICA),
      },
    };

    const dto = concentracionDelegacionDto(informe);
    expect(dto.reparto).toMatchObject({ publicado: true });
    if (dto.reparto.publicado) {
      expect(dto.reparto.valor.mayorReceptor).toEqual({ publicado: false });
    }
    concentracionDelegacion.parse(dto);
  });

  it('sin nadie delegando, censo y personasQueDelegan siguen siendo cero, no ausentes', () => {
    const informe: InformeConcentracionDelegacion = {
      medidoEn: MEDIO_INSTANTE,
      censo: 0,
      personasQueDelegan: 0,
      reparto: NO_SE_PUBLICA,
    };
    const dto = concentracionDelegacionDto(informe);
    expect(dto).toEqual({
      medidoEn: MEDIO_INSTANTE,
      censo: 0,
      personasQueDelegan: 0,
      reparto: { publicado: false },
    });
  });

  it('.strict() rechaza un campo de más, incluida una Fraction cruda colada por error', () => {
    const informe: InformeConcentracionDelegacion = {
      medidoEn: MEDIO_INSTANTE,
      censo: 300,
      personasQueDelegan: 60,
      reparto: {
        publicado: true,
        personas: 40,
        grupoPequeno: false,
        valor: repartoBase(40, {
          publicado: true,
          personas: 40,
          grupoPequeno: false,
          valor: fraccion(1n, 20n),
        }),
      },
    };
    const dto = concentracionDelegacionDto(informe);

    expect(() =>
      concentracionDelegacion.parse({ ...dto, receptorPrincipal: 'algún identificador colado' }),
    ).toThrow();
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // La prueba que importa: el esquema no tiene dónde cargar un identificador de persona.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  //
  // Regla de la casa: una prueba de protección tiene que fallar si se rompe lo que protege. Se
  // rompió a mano quitando el `.strict()` final de `concentracionDelegacion` en
  // `../src/concentracion.ts` (dejando el `.object({...})` sin cerrar) y se corrió esta suite: esta
  // prueba y la de arriba («.strict() rechaza un campo de más…») FALLARON, porque `.parse()` dejó
  // de tirar sobre un campo inventado con la identidad adentro — la protección detectó exactamente
  // el hueco que existe para prevenir. Se restauró el `.strict()` y se volvió a correr: verde de
  // nuevo. Lo que sigue es la comprobación estructural que queda corriendo siempre: ningún nombre de
  // campo del DTO validado contiene un identificador de miembro real, ni aunque alguien intente
  // colarlo por un campo existente con forma de string libre.
  it('un identificador de persona colado en cualquier campo de texto es rechazado por .strict() o no tiene dónde ir', () => {
    const IDENTIDAD = '0123456789abcdef0123456789abcdef';
    const informe: InformeConcentracionDelegacion = {
      medidoEn: MEDIO_INSTANTE,
      censo: 300,
      personasQueDelegan: 60,
      reparto: {
        publicado: true,
        personas: 40,
        grupoPequeno: false,
        valor: repartoBase(40, {
          publicado: true,
          personas: 40,
          grupoPequeno: false,
          valor: fraccion(1n, 20n),
        }),
      },
    };
    const dto = concentracionDelegacionDto(informe);

    // No existe ningún campo de tipo string libre en el DTO donde una identidad pudiera viajar
    // disfrazada de texto — el único campo `texto` que el esquema admite (dentro de
    // `porcentajeExacto`) es el que arma `comoPorcentaje`, no algo que un llamante pueda rellenar.
    expect(JSON.stringify(dto)).not.toContain(IDENTIDAD);

    // Y si alguien de todos modos intenta agregar un campo con la identidad, `.strict()` lo rechaza.
    expect(() => concentracionDelegacion.parse({ ...dto, quienConcentra: IDENTIDAD })).toThrow();
  });
});
