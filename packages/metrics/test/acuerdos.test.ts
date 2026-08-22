/**
 * Métrica 1 — cumplimiento de acuerdos y deuda.
 *
 * Los casos que importan no son los del centro de la distribución sino los bordes: cero acuerdos,
 * todos vencidos, todos bloqueados. Es en los bordes donde una métrica de salud miente, y una
 * métrica de salud que miente en el borde es peor que no tenerla, porque nadie la revisa.
 */

import { toFractionString } from '@koinonia/domain';
import { describe, expect, it } from 'vitest';

import { CUMPLIMIENTO_MINIMO, informeDeAcuerdos } from '../src/index.js';
import { acuerdo, DIA, DOS_SEMESTRES, entradaAcuerdos, ORIGEN, VENTANA } from './datos.js';

describe('1 — cumplimiento de acuerdos', () => {
  it('sin ningún acuerdo no hay tasa, y NO hay alarma', () => {
    const informe = informeDeAcuerdos(entradaAcuerdos([]));
    expect(informe.total.cumplimiento.hay).toBe(false);
    // El error que enciende el panel en rojo el primer día de vida del sistema.
    expect(informe.bajoLaMitad).toBe(false);
    expect(informe.total.deuda).toBe(0);
    expect(informe.porCirculo).toEqual([]);
  });

  it('la tasa es exacta: 2 de 3 es 2/3, no 0,6666…', () => {
    const informe = informeDeAcuerdos(
      entradaAcuerdos([
        acuerdo({ cerradoEn: ORIGEN + 5 * DIA }),
        acuerdo({ cerradoEn: ORIGEN + 6 * DIA }),
        acuerdo({ cerradoEn: null }),
      ]),
    );
    expect(informe.total.cumplimiento.hay).toBe(true);
    if (!informe.total.cumplimiento.hay) return;
    expect(toFractionString(informe.total.cumplimiento.valor)).toBe('2/3');
    expect(informe.bajoLaMitad).toBe(false);
  });

  it('todos los acuerdos vencidos sin cerrar: tasa 0/n, deuda completa y alarma', () => {
    const informe = informeDeAcuerdos(
      entradaAcuerdos([acuerdo(), acuerdo(), acuerdo(), acuerdo()]),
    );
    expect(informe.total.deuda).toBe(4);
    expect(informe.total.cumplidos).toBe(0);
    expect(
      informe.total.cumplimiento.hay && toFractionString(informe.total.cumplimiento.valor),
    ).toBe('0/4');
    expect(informe.bajoLaMitad).toBe(true);
  });

  it('exactamente la mitad NO dispara la alarma: el umbral es «bajo 0,5», no «0,5 o menos»', () => {
    const informe = informeDeAcuerdos(
      entradaAcuerdos([acuerdo({ cerradoEn: ORIGEN + 5 * DIA }), acuerdo()]),
    );
    expect(
      informe.total.cumplimiento.hay && toFractionString(informe.total.cumplimiento.valor),
    ).toBe('1/2');
    expect(informe.bajoLaMitad).toBe(false);
    expect(toFractionString(CUMPLIMIENTO_MINIMO)).toBe('1/2');
  });

  it('declarar bloqueo detiene el reloj: no cuenta como incumplido ni entra en la deuda', () => {
    const informe = informeDeAcuerdos(
      entradaAcuerdos([
        acuerdo({ cerradoEn: ORIGEN + 5 * DIA }),
        acuerdo({ relojDetenido: true }),
        acuerdo({ relojDetenido: true }),
      ]),
    );
    expect(informe.total.conRelojDetenido).toBe(2);
    expect(informe.total.deuda).toBe(0);
    // 1 de 1, no 1 de 3: si avisar bajara la cifra del círculo, nadie avisaría (ADR-0040).
    expect(
      informe.total.cumplimiento.hay && toFractionString(informe.total.cumplimiento.valor),
    ).toBe('1/1');
    expect(informe.bajoLaMitad).toBe(false);
  });

  it('los atrasos prescriben a los dos semestres y salen de la deuda', () => {
    const viejo = acuerdo({ vencimiento: ORIGEN + DIA });
    const informe = informeDeAcuerdos(
      entradaAcuerdos([viejo], undefined, ORIGEN + DOS_SEMESTRES + 2 * DIA),
    );
    expect(informe.total.prescritos).toBe(1);
    expect(informe.total.deuda).toBe(0);
    expect(informe.total.cumplimiento.hay).toBe(false);
  });

  it('cumplir tarde cuenta como cumplir, y además se cuenta aparte', () => {
    const informe = informeDeAcuerdos(
      entradaAcuerdos([
        acuerdo({ vencimiento: ORIGEN + 5 * DIA, cerradoEn: ORIGEN + 9 * DIA }),
        acuerdo({ vencimiento: ORIGEN + 5 * DIA, cerradoEn: ORIGEN + 4 * DIA }),
      ]),
    );
    expect(informe.total.cumplidos).toBe(2);
    expect(informe.total.cumplidosTarde).toBe(1);
  });

  it('lo que todavía no vencía no es deuda', () => {
    const informe = informeDeAcuerdos(
      entradaAcuerdos([acuerdo({ vencimiento: ORIGEN + 25 * DIA })], undefined, ORIGEN + 20 * DIA),
    );
    expect(informe.total.enCurso).toBe(1);
    expect(informe.total.deuda).toBe(0);
  });

  it('sólo entran los acuerdos que vencían DENTRO de la ventana', () => {
    const informe = informeDeAcuerdos(
      entradaAcuerdos([
        acuerdo({ vencimiento: VENTANA.desde - DIA }),
        acuerdo({ vencimiento: VENTANA.hasta }),
        acuerdo({ vencimiento: VENTANA.desde }),
      ]),
    );
    // El extremo derecho es abierto: `hasta` pertenece a la ventana siguiente, no a ésta.
    expect(informe.total.vencianEnLaVentana).toBe(1);
  });
});

describe('1 — desglose por círculo y por tipo, nunca por persona', () => {
  it('un círculo con menos de 10 personas NO publica su desglose', () => {
    const informe = informeDeAcuerdos(
      entradaAcuerdos(
        [acuerdo({ circulo: 'finanzas' }), acuerdo({ circulo: 'secretaría' })],
        [
          { circulo: 'finanzas', personas: 4 },
          { circulo: 'secretaría', personas: 40 },
        ],
      ),
    );
    const finanzas = informe.porCirculo.find((c) => c.circulo === 'finanzas');
    const secretaria = informe.porCirculo.find((c) => c.circulo === 'secretaría');
    expect(finanzas?.desglose.publicado).toBe(false);
    expect(secretaria?.desglose.publicado).toBe(true);
    expect(informe.circulosNoPublicados).toBe(1);
  });

  it('entre 10 y 29 personas se publica CON advertencia', () => {
    const informe = informeDeAcuerdos(
      entradaAcuerdos(
        [acuerdo({ circulo: 'comunicación' })],
        [{ circulo: 'comunicación', personas: 12 }],
      ),
    );
    const celda = informe.porCirculo[0]?.desglose;
    expect(celda?.publicado).toBe(true);
    expect(celda?.publicado === true && celda.grupoPequeno).toBe(true);
  });

  it('un círculo sin tamaño declarado se trata como el peor caso: no se publica', () => {
    const informe = informeDeAcuerdos(entradaAcuerdos([acuerdo({ circulo: 'fantasma' })], []));
    expect(informe.porCirculo[0]?.desglose.publicado).toBe(false);
  });

  it('el desglose por tipo de tarea no necesita k-anonimato: un tipo no es un grupo de personas', () => {
    const informe = informeDeAcuerdos(
      entradaAcuerdos([acuerdo({ tipo: 'actas' }), acuerdo({ tipo: 'redacción' })]),
    );
    expect(informe.porTipo.map((t) => t.tipo)).toEqual(['actas', 'redacción']);
  });

  it('el orden de los círculos y los tipos es por etiqueta, NUNCA por cifra', () => {
    const informe = informeDeAcuerdos(
      entradaAcuerdos(
        [
          acuerdo({ circulo: 'zeta', cerradoEn: ORIGEN + DIA }),
          acuerdo({ circulo: 'alfa' }),
          acuerdo({ circulo: 'mu' }),
        ],
        [
          { circulo: 'zeta', personas: 30 },
          { circulo: 'alfa', personas: 30 },
          { circulo: 'mu', personas: 30 },
        ],
      ),
    );
    // Ordenar por cumplimiento sería una tabla de posiciones entre círculos, y de ahí a una tabla
    // entre personas hay un solo commit.
    expect(informe.porCirculo.map((c) => c.circulo)).toEqual(['alfa', 'mu', 'zeta']);
  });
});

describe('1 — entradas mal formadas', () => {
  it('una ventana invertida se rechaza', () => {
    expect(() =>
      informeDeAcuerdos({
        ventana: { desde: ORIGEN + DIA, hasta: ORIGEN },
        instante: ORIGEN,
        acuerdos: [],
        circulos: [],
        prescripcionMs: DOS_SEMESTRES,
      }),
    ).toThrow(/termina antes de empezar/u);
  });

  it('una prescripción negativa se rechaza', () => {
    expect(() => informeDeAcuerdos({ ...entradaAcuerdos([]), prescripcionMs: -1 })).toThrow(
      /prescripción/u,
    );
  });

  it('un tamaño de círculo no entero se rechaza', () => {
    expect(() => informeDeAcuerdos(entradaAcuerdos([], [{ circulo: 'x', personas: 2.5 }]))).toThrow(
      /entero no negativo/u,
    );
  });
});
