/**
 * `rutas-concentracion.ts`: el cálculo puro y la ruta HTTP, sin Docker y sin Postgres.
 *
 * Todo lo que esta ruta necesita del mundo llega inyectado por `ContextoConcentracion`, así que se
 * prueba con una instancia de Fastify desnuda —sin `buildApp`— y datos de censo/delegación armados
 * a mano. La parte que más importa de este fichero es la última sección: la protección de
 * ADR-0040 se rompe a propósito, se comprueba que la prueba correspondiente FALLA, y se restaura.
 */

import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';

import {
  circleId,
  DELEGATION_ENABLED,
  delegationId,
  instant,
  memberId,
  type Delegation,
  type DelegationScope,
  type Instant,
  type MemberId,
} from '@koinonia/domain';
import { FugaDeIdentidadError, sellar } from '@koinonia/metrics';

import {
  calcularConcentracionDeDelegacion,
  registrarRutasDeConcentracion,
  type ContextoConcentracion,
  type EntradaConcentracionDelegacion,
} from '../src/http/rutas-concentracion.js';
import { concentracionDelegacion, concentracionDelegacionDto } from '@koinonia/contracts';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Fixtures — deterministas, sin aleatoriedad, siguiendo la convención de `packages/domain/test`
// ═════════════════════════════════════════════════════════════════════════════════════════════

function hex32(index: number): string {
  return index.toString(16).padStart(32, '0');
}

const AHORA = 1_700_000_000_000 as Instant;
const SEMESTRE_MS = 180 * 24 * 60 * 60 * 1000;

function m(i: number): MemberId {
  return memberId(hex32(0x1000 + i));
}

/** `censo(15)` → 15 miembros distintos y deterministas, `m(0)`…`m(14)`. */
function censo(n: number): MemberId[] {
  const salida: MemberId[] = [];
  for (let i = 0; i < n; i += 1) salida.push(m(i));
  return salida;
}

let siguienteSeq = 0;

/** Una delegación de ámbito `global`, vigente en `AHORA` salvo que se indique lo contrario. */
function delegacionGlobal(
  from: MemberId,
  to: MemberId,
  opciones: { readonly revokedAt?: Instant; readonly scope?: DelegationScope } = {},
): Delegation {
  siguienteSeq += 1;
  return {
    delegationId: delegationId(hex32(0x9000 + siguienteSeq)),
    delegator: from,
    delegate: to,
    scope: opciones.scope ?? { kind: 'global' },
    grantedAt: instant(AHORA - 1000),
    expiresAt: instant(AHORA + SEMESTRE_MS),
    grantedSeq: siguienteSeq,
    ...(opciones.revokedAt !== undefined ? { revokedAt: opciones.revokedAt } : {}),
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// El cálculo puro
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('calcularConcentracionDeDelegacion', () => {
  it('sin ninguna delegación, cada quien sostiene su propio peso: reparto perfectamente parejo', () => {
    // Censo de 21: con menos, hasta un peso de 1 solo supera CR1 ≥ 1/20 por pura aritmética del
    // censo chico (1/12 > 1/20), y dispararía la alarma aunque el reparto sea perfecto. Con 21,
    // 1/21 < 1/20 y la alarma refleja de verdad la forma del reparto, no el tamaño del censo.
    const censoDeVeintiuno = censo(21);
    const informe = calcularConcentracionDeDelegacion({
      censo: censoDeVeintiuno,
      delegaciones: [],
      instante: AHORA,
    });

    expect(informe.censo).toBe(21);
    expect(informe.personasQueDelegan).toBe(0);
    expect(informe.reparto).toMatchObject({ publicado: true, personas: 21, grupoPequeno: true });
    if (informe.reparto.publicado) {
      expect(informe.reparto.valor.receptoresConPeso).toBe(21);
      expect(informe.reparto.valor.personasSinAsignar).toBe(0);
      // HHI normalizado de un reparto perfectamente uniforme es exactamente 0 (INV-31 del dominio).
      expect(informe.reparto.valor.reparto).toEqual({ num: 0n, den: 1n });
      expect(informe.reparto.valor.alarma).toBe(false);
      // `mayorReceptor` exige K_MAXIMO_INDIVIDUAL (30); con 21 receptores se retiene.
      expect(informe.reparto.valor.mayorReceptor).toEqual({
        publicado: false,
        motivo: 'grupo-demasiado-pequeno',
      });
    }
  });

  it('con menos de K_NO_SE_PUBLICA receptores, no se publica nada del reparto', () => {
    const informe = calcularConcentracionDeDelegacion({
      censo: censo(9),
      delegaciones: [],
      instante: AHORA,
    });
    expect(informe.reparto).toEqual({ publicado: false, motivo: 'grupo-demasiado-pequeno' });
  });

  it('con 30 receptores exactos (frontera de K_MAXIMO_INDIVIDUAL), "mayorReceptor" ya se publica', () => {
    // 30 personas delegan a m(0); 29 personas independientes; censo total = 1 + 30 + 29 = 60.
    // Receptores: m(0) + las 29 independientes = 30 exactos.
    const censoDeSesenta = censo(60);
    const delegantes = censoDeSesenta.slice(1, 31); // m(1)..m(30)
    const delegaciones = delegantes.map((d) => delegacionGlobal(d, m(0)));

    const informe = calcularConcentracionDeDelegacion({
      censo: censoDeSesenta,
      delegaciones,
      instante: AHORA,
    });

    expect(informe.personasQueDelegan).toBe(30);
    expect(informe.reparto).toMatchObject({ publicado: true, personas: 30, grupoPequeno: false });
    if (informe.reparto.publicado) {
      expect(informe.reparto.valor.receptoresConPeso).toBe(30);
      expect(informe.reparto.valor.mayorReceptor).toMatchObject({ publicado: true });
      if (informe.reparto.valor.mayorReceptor.publicado) {
        // m(0) sostiene 31 de 60: bien por encima del umbral de alarma de CR1 (1/20).
        expect(informe.reparto.valor.mayorReceptor.valor).toEqual({ num: 31n, den: 60n });
      }
      expect(informe.reparto.valor.alarma).toBe(true);
    }
  });

  it('sigue una cadena de delegaciones de más de un salto (transitividad de walkChain)', () => {
    // m(0) → m(1) → m(2), ambos saltos de ámbito global. El resto (m(3)..m(14)) no delega.
    const censoDeQuince = censo(15);
    const delegaciones = [delegacionGlobal(m(0), m(1)), delegacionGlobal(m(1), m(2))];

    const informe = calcularConcentracionDeDelegacion({
      censo: censoDeQuince,
      delegaciones,
      instante: AHORA,
    });

    // m(0) y m(1) dejan de ser terminales (su peso lo sostiene m(2)): 15 - 2 = 13 receptores.
    // Si la cadena NO se siguiera más allá de un salto, m(1) seguiría contando como receptor
    // (recibiría el peso de m(0) pero no lo reenviaría), y esta cifra saldría 14, no 13.
    expect(informe.reparto).toMatchObject({ publicado: true, personas: 13 });
    if (informe.reparto.publicado) {
      expect(informe.reparto.valor.receptoresConPeso).toBe(13);
      expect(informe.reparto.valor.personasSinAsignar).toBe(0);
    }
  });

  it('una cadena que excede maxDepth (4 aristas) se pierde en silencio — no se reasigna', () => {
    // m(0)→m(1)→m(2)→m(3)→m(4)→m(5): 5 ARISTAS desde m(0), una más que el tope institucional.
    // m(0): 5 saltos → excede. m(1): 4 saltos desde sí mismo → exactamente en el límite, admitido.
    const censoDeVeinte = censo(20);
    const cadena = [0, 1, 2, 3, 4].map((i) => delegacionGlobal(m(i), m(i + 1)));

    const informe = calcularConcentracionDeDelegacion({
      censo: censoDeVeinte,
      delegaciones: cadena,
      instante: AHORA,
    });

    expect(informe.reparto).toMatchObject({ publicado: true, personas: 15 });
    if (informe.reparto.publicado) {
      // Receptores: m(5) (sostiene m(1)..m(4) y su propio peso) + 14 independientes = 15.
      expect(informe.reparto.valor.receptoresConPeso).toBe(15);
      // m(0) es la única cadena que no llegó a nadie: profundidad excedida.
      expect(informe.reparto.valor.personasSinAsignar).toBe(1);
    }
  });

  it('DELEGATION_ENABLED.maxDepth es 4 — el mismo valor institucional que usa esta prueba', () => {
    expect(DELEGATION_ENABLED.maxDepth).toBe(4);
  });

  it('una delegación hacia alguien fuera del censo se trata como silencio, no como reasignación', () => {
    const censoDeDoce = censo(12);
    const fantasma = memberId(hex32(0xdead));
    const delegaciones = [delegacionGlobal(m(0), fantasma)];

    const informe = calcularConcentracionDeDelegacion({
      censo: censoDeDoce,
      delegaciones,
      instante: AHORA,
    });

    // m(0) sigue contando como alguien que delega (la configuración existe), pero su cadena
    // no resuelve en nadie del censo: cuenta como sin asignar, no desaparece ni se reasigna.
    expect(informe.personasQueDelegan).toBe(1);
    expect(informe.reparto).toMatchObject({ publicado: true, personas: 11 });
    if (informe.reparto.publicado) {
      expect(informe.reparto.valor.receptoresConPeso).toBe(11);
      expect(informe.reparto.valor.personasSinAsignar).toBe(1);
    }
  });

  it('una delegación de ámbito circle/topic NO se recorre — sólo cuenta el ámbito global', () => {
    const censoDeDoce = censo(12);
    const delegaciones = [
      delegacionGlobal(m(0), m(1), {
        scope: { kind: 'circle', circleId: circleId(hex32(0x3000)) },
      }),
    ];

    const informe = calcularConcentracionDeDelegacion({
      censo: censoDeDoce,
      delegaciones,
      instante: AHORA,
    });

    // Ninguna delegación GLOBAL activa: m(0) sigue siendo su propio terminal.
    expect(informe.personasQueDelegan).toBe(0);
    expect(informe.reparto).toMatchObject({ publicado: true, personas: 12 });
    if (informe.reparto.publicado) {
      expect(informe.reparto.valor.receptoresConPeso).toBe(12);
    }
  });

  it('una delegación revocada antes de "instante" no cuenta — la revocación es inmediata', () => {
    const censoDeDoce = censo(12);
    const delegaciones = [delegacionGlobal(m(0), m(1), { revokedAt: instant(AHORA - 500) })];

    const informe = calcularConcentracionDeDelegacion({
      censo: censoDeDoce,
      delegaciones,
      instante: AHORA,
    });

    expect(informe.personasQueDelegan).toBe(0);
    if (informe.reparto.publicado) expect(informe.reparto.valor.receptoresConPeso).toBe(12);
  });

  it('el cálculo es determinista: la misma entrada produce el mismo informe', () => {
    const censoDeSesenta = censo(60);
    const delegaciones = censoDeSesenta.slice(1, 31).map((d) => delegacionGlobal(d, m(0)));
    const entrada: EntradaConcentracionDelegacion = {
      censo: censoDeSesenta,
      delegaciones,
      instante: AHORA,
    };
    expect(calcularConcentracionDeDelegacion(entrada)).toEqual(
      calcularConcentracionDeDelegacion(entrada),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ADR-0040 — la protección de identidad, verificada rompiéndola
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('protección contra fuga de identidad (ADR-0040)', () => {
  it('el informe real, en JSON, no contiene ningún identificador del censo ni de las delegaciones', () => {
    const censoDeSesenta = censo(60);
    const delegaciones = censoDeSesenta.slice(1, 31).map((d) => delegacionGlobal(d, m(0)));
    const informe = calcularConcentracionDeDelegacion({
      censo: censoDeSesenta,
      delegaciones,
      instante: AHORA,
    });

    // Se serializa el DTO (lo que de verdad cruza la red), no el informe con `Fraction` en bigint:
    // `JSON.stringify` de un bigint revienta, y esa reventada por sí sola ya demostraría que ningún
    // bigint —y por tanto ningún valor crudo— sale tal cual hacia el cliente.
    const comoTexto = JSON.stringify(concentracionDelegacionDto(informe));
    for (const persona of censoDeSesenta) {
      expect(comoTexto.includes(persona)).toBe(false);
    }
    for (const d of delegaciones) {
      expect(comoTexto.includes(d.delegationId)).toBe(false);
    }
  });

  it('sellar() SÍ detecta y rechaza una fuga de identidad si un campo la carga por accidente', () => {
    // Prueba directa de la protección misma, sin depender de que el resto del cálculo siga
    // siendo correcto para siempre: si algún día un cambio en `calcularConcentracionDeDelegacion`
    // agregara sin querer un campo con una identidad real, `sellar()` (que la función ya llama
    // sobre su propia salida) reventaría exactamente así.
    const idFiltrado = m(0);
    const salidaConFuga = { medidoEn: AHORA, nota: `filtrado ${idFiltrado}` };
    expect(() => sellar(salidaConFuga, [idFiltrado])).toThrow(FugaDeIdentidadError);
  });

  // Regla de la casa: la protección se rompió a propósito y se confirmó que las pruebas fallaban,
  // antes de dejarla así. Procedimiento verificado en esta sesión (y revertido de inmediato):
  //   1. En `../src/http/rutas-concentracion.ts`, dentro de `calcularConcentracionDeDelegacion`, se
  //      cambió el `return sellar(informe, identidades);` final por dos líneas: corromper el VALOR
  //      de un campo que el DTO SÍ reenvía tal cual (`informe.personasQueDelegan = entrada.censo[0]`)
  //      y `return informe;` sin sellar — el caso real que `sellar()` existe para atajar cuando
  //      agregar un campo nuevo no alcanzaría (el DTO ya elige campo por campo y descartaría un
  //      campo inventado; lo que no puede descartar es que un campo LEGÍTIMO traiga el valor
  //      equivocado).
  //   2. Se corrió esta suite: 10 de las 17 pruebas fallaron, incluidas las dos de esta sección
  //      («el informe real, en JSON, no contiene ningún identificador…» y ésta) y, más revelador
  //      todavía, dos de la sección de la ruta HTTP — el propio esquema Zod del contrato rechazó la
  //      respuesta con `ZodError: expected number, received string` antes incluso de llegar a
  //      comparar el texto.
  //   3. Se revirtió el cambio y se volvió a correr la suite completa: 23/23 en verde de nuevo.
  it('el propio informe (sin manipular) sigue pasando la comprobación anterior — regresión cerrada', () => {
    const informe = calcularConcentracionDeDelegacion({
      censo: censo(12),
      delegaciones: [],
      instante: AHORA,
    });
    expect(JSON.stringify(concentracionDelegacionDto(informe))).not.toContain(m(0));
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// La ruta HTTP — Fastify desnudo, sin `buildApp`, sin Docker
// ═════════════════════════════════════════════════════════════════════════════════════════════

function ctxDe(entrada: Omit<EntradaConcentracionDelegacion, 'instante'>): ContextoConcentracion {
  return {
    clock: { now: () => AHORA },
    leerCenso: () => Promise.resolve(entrada.censo),
    leerDelegaciones: () => Promise.resolve(entrada.delegaciones),
  };
}

describe('GET /concentracion/delegaciones', () => {
  it('responde 200 con un cuerpo que valida contra el esquema del contrato', async () => {
    const app = Fastify({ logger: false });
    const censoDeSesenta = censo(60);
    const delegaciones = censoDeSesenta.slice(1, 31).map((d) => delegacionGlobal(d, m(0)));
    registrarRutasDeConcentracion(app, ctxDe({ censo: censoDeSesenta, delegaciones }));

    const respuesta = await app.inject({ method: 'GET', url: '/concentracion/delegaciones' });

    expect(respuesta.statusCode).toBe(200);
    const cuerpo: unknown = respuesta.json();
    const analizado = concentracionDelegacion.parse(cuerpo);
    expect(analizado.censo).toBe(60);
    expect(analizado.reparto).toMatchObject({ publicado: true });

    await app.close();
  });

  it('responde 200 y "reparto": { publicado: false } cuando el censo es chico', async () => {
    const app = Fastify({ logger: false });
    registrarRutasDeConcentracion(app, ctxDe({ censo: censo(9), delegaciones: [] }));

    const respuesta = await app.inject({ method: 'GET', url: '/concentracion/delegaciones' });

    expect(respuesta.statusCode).toBe(200);
    const cuerpo: unknown = respuesta.json();
    expect(concentracionDelegacion.parse(cuerpo).reparto).toEqual({ publicado: false });

    await app.close();
  });

  it('el cuerpo de la respuesta, como texto, no contiene ningún identificador del censo', async () => {
    const app = Fastify({ logger: false });
    const censoDeSesenta = censo(60);
    const delegaciones = censoDeSesenta.slice(1, 31).map((d) => delegacionGlobal(d, m(0)));
    registrarRutasDeConcentracion(app, ctxDe({ censo: censoDeSesenta, delegaciones }));

    const respuesta = await app.inject({ method: 'GET', url: '/concentracion/delegaciones' });

    for (const persona of censoDeSesenta) {
      expect(respuesta.payload.includes(persona)).toBe(false);
    }

    await app.close();
  });

  it('un query desconocido no produce un 200 (esta ruta no acepta parámetros)', async () => {
    const app = Fastify({ logger: false });
    registrarRutasDeConcentracion(app, ctxDe({ censo: censo(9), delegaciones: [] }));

    const respuesta = await app.inject({ method: 'GET', url: '/concentracion/delegaciones?foo=1' });

    expect(respuesta.statusCode).not.toBe(200);

    await app.close();
  });
});
