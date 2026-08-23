/**
 * El contrato de las métricas de salud, contra el paquete real.
 *
 * No se prueban esquemas contra objetos inventados a mano: se corren las cinco funciones de
 * `@koinonia/metrics` sobre entradas mínimas, se traducen con las funciones `informeXDto` de este
 * paquete y se valida el resultado con el propio esquema Zod. Si un día `@koinonia/metrics` cambia
 * de forma, esta prueba es la que se entera primero — antes que una pantalla en producción.
 *
 * Tres cosas se comprueban además de la forma:
 *
 *  1. **Nada de `bigint` sobrevive.** `JSON.stringify` de una `Fraction` revienta; aquí se comprueba
 *     que `JSON.stringify` del DTO entero no revienta y que el número vuelve exacto.
 *  2. **El k-anonimato de `@koinonia/metrics` atraviesa la traducción intacto.** Un grupo por debajo
 *     de `K_NO_SE_PUBLICA` llega al DTO como `{ publicado: false }` y nada más: ni cuenta de
 *     personas, ni el valor que se supone que no se debía publicar.
 *  3. **`.strict()` rechaza el campo de más**, sea el que sea — incluida una `Fraction` cruda
 *     colada por error, que es exactamente la clase de fallo que este contrato existe para impedir.
 */

import { describe, expect, it } from 'vitest';

import {
  identidadMiembro,
  informeDeAcuerdos,
  informeDeCobertura,
  informeDeDeliberacion,
  informeDeRotacion,
  informeDeVoz,
  K_NO_SE_PUBLICA,
  type AcuerdoProyectado,
  type Aporte,
  type EntradaCobertura,
  type Estratos,
  type MiembroDelPadron,
} from '@koinonia/metrics';

import {
  cuentaDeAcuerdos,
  ejeEstrato,
  informeAcuerdos,
  informeAcuerdosDto,
  informeCobertura,
  informeCoberturaDto,
  informeDeliberacion,
  informeDeliberacionDto,
  informeRotacion,
  informeRotacionDto,
  informeVoz,
  informeVozDto,
  porcentajeDeFraccion,
  razonDeFraccion,
  serieDeAcuerdosDto,
} from '../src/metricas.js';

const DIA = 24 * 60 * 60 * 1000;
const ORIGEN = 1_767_225_600_000;
const VENTANA = { desde: ORIGEN, hasta: ORIGEN + 30 * DIA };
const DOS_SEMESTRES = 365 * DIA;

function persona(n: number): ReturnType<typeof identidadMiembro> {
  return identidadMiembro(`p#${n.toString().padStart(4, '0')}`);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 1 — Acuerdos
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('acuerdos', () => {
  const acuerdo = (parcial: Partial<AcuerdoProyectado> = {}): AcuerdoProyectado => ({
    circulo: 'secretaría',
    tipo: 'redacción',
    acordadoEn: ORIGEN + DIA,
    vencimiento: ORIGEN + 10 * DIA,
    cerradoEn: null,
    relojDetenido: false,
    ...parcial,
  });

  it('un informe con datos reales valida contra el esquema, sin bigint sobreviviente', () => {
    const informe = informeDeAcuerdos({
      ventana: VENTANA,
      instante: ORIGEN + 20 * DIA,
      acuerdos: [
        acuerdo({ cerradoEn: ORIGEN + 5 * DIA }),
        acuerdo({ vencimiento: ORIGEN + 2 * DIA }), // vencido, sin cerrar: deuda
        acuerdo({ vencimiento: ORIGEN + 2 * DIA, relojDetenido: true }),
      ],
      circulos: [{ circulo: 'secretaría', personas: 40 }],
      prescripcionMs: DOS_SEMESTRES,
    });

    const dto = informeAcuerdosDto(informe);
    const analizado = informeAcuerdos.parse(dto);

    expect(analizado.total.cumplidos).toBe(1);
    expect(analizado.total.deuda).toBe(1);
    expect(analizado.total.conRelojDetenido).toBe(1);
    expect(analizado.total.cumplimiento).toEqual({
      hay: true,
      numerador: 1,
      denominador: 2,
      texto: '50.0 %',
    });
    // La ronda completa por JSON es la comprobación de que no quedó ningún `bigint`.
    expect(() => JSON.stringify(dto)).not.toThrow();
    expect(JSON.parse(JSON.stringify(dto))).toEqual(dto);
  });

  it('sin acuerdos vencidos, "hay" es false — no "0 % de cumplimiento"', () => {
    const informe = informeDeAcuerdos({
      ventana: VENTANA,
      instante: ORIGEN + 20 * DIA,
      acuerdos: [],
      circulos: [],
      prescripcionMs: DOS_SEMESTRES,
    });
    const dto = informeAcuerdosDto(informe);
    expect(dto.total.cumplimiento).toEqual({ hay: false });
    expect(dto.bajoLaMitad).toBe(false);
    informeAcuerdos.parse(dto);
  });

  it('un círculo por debajo de K_NO_SE_PUBLICA llega al DTO sin cuenta ni valor', () => {
    const informe = informeDeAcuerdos({
      ventana: VENTANA,
      instante: ORIGEN + 20 * DIA,
      acuerdos: [acuerdo({ circulo: 'garantías', vencimiento: ORIGEN + 2 * DIA })],
      circulos: [{ circulo: 'garantías', personas: K_NO_SE_PUBLICA - 1 }],
      prescripcionMs: DOS_SEMESTRES,
    });
    const dto = informeAcuerdosDto(informe);
    const fila = dto.porCirculo.find((p) => p.circulo === 'garantías');
    expect(fila?.desglose).toEqual({ publicado: false });
    // Y el objeto retenido no tiene NINGÚN campo de más: `.strict()` en el esquema lo demuestra.
    informeAcuerdos.parse(dto);
    expect(() =>
      cuentaDeAcuerdos.parse({
        vencianEnLaVentana: 0,
        cumplidos: 0,
        cumplidosTarde: 0,
        deuda: 0,
        conRelojDetenido: 0,
        prescritos: 0,
        enCurso: 0,
        cumplimiento: { hay: false },
        promedioPorPersona: 3, // ADR-0040: una métrica individual no debería colarse ni como campo de más
      }),
    ).toThrow();
  });

  it('la serie envuelve varios puntos con su duración y sello de tiempo', () => {
    const puntoA = informeDeAcuerdos({
      ventana: VENTANA,
      instante: ORIGEN + 20 * DIA,
      acuerdos: [],
      circulos: [],
      prescripcionMs: DOS_SEMESTRES,
    });
    const puntoB = informeDeAcuerdos({
      ventana: { desde: VENTANA.hasta, hasta: VENTANA.hasta + 30 * DIA },
      instante: VENTANA.hasta + 20 * DIA,
      acuerdos: [],
      circulos: [],
      prescripcionMs: DOS_SEMESTRES,
    });
    const serie = serieDeAcuerdosDto([puntoA, puntoB], 30 * DIA, ORIGEN + 50 * DIA);
    expect(serie.puntos).toHaveLength(2);
    expect(serie.duracionDePuntoMs).toBe(30 * DIA);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 2 — Voz
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('voz', () => {
  function aportesDeVarias(n: number): Aporte[] {
    const salida: Aporte[] = [];
    for (let i = 0; i < n; i += 1) salida.push({ autor: persona(i), instante: ORIGEN + i });
    return salida;
  }

  it('con reparto perfecto entre 30 personas, publica y no dispara la alarma', () => {
    const informe = informeDeVoz({ ventana: VENTANA, aportes: aportesDeVarias(30), censo: 300 });
    const dto = informeVozDto(informe);
    const analizado = informeVoz.parse(dto);
    expect(analizado.reparto).toMatchObject({ publicado: true });
    if (analizado.reparto.publicado) {
      expect(analizado.reparto.valor.alarma).toBe(false);
    }
  });

  it('con menos de K_NO_SE_PUBLICA personas hablando, no se publica nada del reparto', () => {
    const informe = informeDeVoz({
      ventana: VENTANA,
      aportes: aportesDeVarias(K_NO_SE_PUBLICA - 1),
      censo: 300,
    });
    const dto = informeVozDto(informe);
    expect(dto.reparto).toEqual({ publicado: false });
    informeVoz.parse(dto);
  });

  it('entre 10 y 29 personas, "mayorParticipacion" se retiene aunque el reparto se publique', () => {
    // 15 personas hablando: el reparto general se publica (≥10) pero el dato de una sola persona
    // exige K_MAXIMO_INDIVIDUAL = 30.
    const informe = informeDeVoz({ ventana: VENTANA, aportes: aportesDeVarias(15), censo: 300 });
    const dto = informeVozDto(informe);
    expect(dto.reparto).toMatchObject({ publicado: true });
    if (dto.reparto.publicado) {
      expect(dto.reparto.valor.mayorParticipacion).toEqual({ publicado: false });
    }
    informeVoz.parse(dto);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 3 — Cobertura
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('cobertura', () => {
  function estratos(semestre: string, jornada: string): Estratos {
    return { semestre, jornada, nivel: 'pregrado', participacionPrevia: 'sí' };
  }

  it('un estrato de 3 personas no se publica — el caso que motiva este encargo', () => {
    const padron: MiembroDelPadron[] = [
      { miembro: persona(0), estratos: estratos('10', 'nocturna') },
      { miembro: persona(1), estratos: estratos('10', 'nocturna') },
      { miembro: persona(2), estratos: estratos('10', 'nocturna') },
      ...Array.from({ length: 40 }, (_v, i) => ({
        miembro: persona(i + 3),
        estratos: estratos('1', 'diurna'),
      })),
    ];
    const entrada: EntradaCobertura = {
      ventana: VENTANA,
      padron,
      actos: [{ miembro: persona(0), instante: ORIGEN + DIA }],
    };
    const dto = informeCoberturaDto(informeDeCobertura(entrada));
    const celdaChica = dto.porEje.find((c) => c.eje === 'semestre' && c.valor === '10');
    expect(celdaChica?.desglose).toEqual({ publicado: false });
    expect(dto.celdasNoPublicadas).toBeGreaterThan(0);
    informeCobertura.parse(dto);
  });

  it('el género no es un eje del contrato: el esquema lo rechaza', () => {
    expect(ejeEstrato.safeParse('genero').success).toBe(false);
    expect(ejeEstrato.safeParse('género').success).toBe(false);
    expect(ejeEstrato.options).toEqual(['semestre', 'jornada', 'nivel', 'participacionPrevia']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 4 — Rotación
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('rotación', () => {
  it('con núcleos de al menos K_NO_SE_PUBLICA personas, se publica el cambio', () => {
    const anteriores: Aporte[] = [];
    const actuales: Aporte[] = [];
    for (let i = 0; i < 20; i += 1) {
      anteriores.push({ autor: persona(i), instante: VENTANA.desde - 30 * DIA + i });
      actuales.push({ autor: persona(i + 10), instante: VENTANA.desde + i }); // mitad rota
    }
    const informe = informeDeRotacion({
      periodoAnterior: { desde: VENTANA.desde - 30 * DIA, hasta: VENTANA.desde },
      periodoActual: VENTANA,
      aportesAnteriores: anteriores,
      aportesActuales: actuales,
    });
    const dto = informeRotacionDto(informe);
    informeRotacion.parse(dto);
    expect(dto.cambio).toMatchObject({ publicado: true });
  });

  it('con núcleos chicos, no se publica el cambio', () => {
    const anteriores: Aporte[] = [{ autor: persona(0), instante: VENTANA.desde - DIA }];
    const actuales: Aporte[] = [{ autor: persona(1), instante: VENTANA.desde + DIA }];
    const informe = informeDeRotacion({
      periodoAnterior: { desde: VENTANA.desde - 30 * DIA, hasta: VENTANA.desde },
      periodoActual: VENTANA,
      aportesAnteriores: anteriores,
      aportesActuales: actuales,
    });
    const dto = informeRotacionDto(informe);
    expect(dto.cambio).toEqual({ publicado: false });
    informeRotacion.parse(dto);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 5 — Deliberación (razón, no porcentaje)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('deliberación', () => {
  it('la razón puede pasar de 1 y se formatea como razón, nunca como porcentaje', () => {
    const informe = informeDeDeliberacion({
      ventana: VENTANA,
      deliberaciones: [
        { instante: ORIGEN + DIA, intervenciones: 5 },
        { instante: ORIGEN + 2 * DIA, intervenciones: 3 },
        { instante: ORIGEN + 3 * DIA, intervenciones: 2 },
      ],
      votaciones: [{ instante: ORIGEN + 4 * DIA, unanime: true, conDeliberacionPrevia: true }],
    });
    const dto = informeDeliberacionDto(informe);
    expect(dto.razon).toEqual({ hay: true, numerador: 3, denominador: 1, texto: '3,0' });
    expect(dto.razon.hay && dto.razon.texto.includes('%')).toBe(false);
    informeDeliberacion.parse(dto);
  });

  it('sin votaciones, ninguna razón tiene con qué calcularse', () => {
    const informe = informeDeDeliberacion({ ventana: VENTANA, deliberaciones: [], votaciones: [] });
    const dto = informeDeliberacionDto(informe);
    expect(dto.razon).toEqual({ hay: false });
    expect(dto.unanimidad).toEqual({ hay: false });
    informeDeliberacion.parse(dto);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Piezas comunes
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('fraccionDeXxx', () => {
  it('porcentajeDeFraccion no reduce y formatea como porcentaje', () => {
    expect(porcentajeDeFraccion({ num: 3n, den: 4n })).toEqual({
      numerador: 3,
      denominador: 4,
      texto: '75.0 %',
    });
  });

  it('razonDeFraccion formatea con coma decimal, sin signo de porcentaje', () => {
    expect(razonDeFraccion({ num: 3n, den: 2n })).toEqual({
      numerador: 3,
      denominador: 2,
      texto: '1,5',
    });
  });
});
