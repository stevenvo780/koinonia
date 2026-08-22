/**
 * Métrica 4 — rotación del núcleo activo.
 *
 * La prueba que de verdad importa aquí es la de la asamblea capturada: cuatro de las cinco métricas
 * en verde y el mismo grupo mandando desde hace tres semestres. Si esta métrica no lo ve, el panel
 * entero es decorativo.
 */

import { toFractionString } from '@koinonia/domain';
import { describe, expect, it } from 'vitest';

import { informeDeRotacion } from '../src/index.js';
import { aportes, entradaRotacion, VENTANA, VENTANA_ANTERIOR } from './datos.js';

/** Aportes de las personas `desde..desde+cuantas-1`, `cada` aportes cada una. */
function grupoActivo(desde: number, cuantas: number, cada: number, ventana = VENTANA) {
  const lista = [];
  for (let i = 0; i < cuantas; i += 1) lista.push(...aportes(desde + i, cada, ventana));
  return lista;
}

describe('4 — rotación del núcleo', () => {
  it('sin participantes no se publica', () => {
    const informe = informeDeRotacion(entradaRotacion([], []));
    expect(informe.cambio.publicado).toBe(false);
    expect(informe.participantesAnteriores).toBe(0);
  });

  it('un núcleo de menos de 10 personas no se publica: sería una frase sobre cuatro personas', () => {
    const antes = grupoActivo(0, 8, 3, VENTANA_ANTERIOR);
    const ahora = grupoActivo(0, 8, 3);
    expect(informeDeRotacion(entradaRotacion(antes, ahora)).cambio.publicado).toBe(false);
  });

  it('LA CAPTURA: los mismos de siempre ⇒ rotación 0 y ninguna persona nueva', () => {
    // 100 personas participando lo mismo: el núcleo es todo el mundo y no cambia nadie.
    const antes = grupoActivo(0, 100, 4, VENTANA_ANTERIOR);
    const ahora = grupoActivo(0, 100, 4);
    const informe = informeDeRotacion(entradaRotacion(antes, ahora));
    expect(informe.cambio.publicado).toBe(true);
    if (!informe.cambio.publicado) return;
    // La fracción NO viene reducida a propósito: «0 de 100» dice más que «0», y el par es
    // justamente lo que una asamblea necesita leer en su serie histórica.
    expect(toFractionString(informe.cambio.valor.rotacion)).toBe('0/100');
    expect(informe.cambio.valor.personasNuevas).toBe(0);
    expect(toFractionString(informe.cambio.valor.proporcionDePersonasNuevas)).toBe('0/100');
  });

  it('renovación total ⇒ rotación 1 y todas las personas nuevas', () => {
    const antes = grupoActivo(0, 40, 4, VENTANA_ANTERIOR);
    const ahora = grupoActivo(40, 40, 4);
    const informe = informeDeRotacion(entradaRotacion(antes, ahora));
    expect(informe.cambio.publicado).toBe(true);
    if (!informe.cambio.publicado) return;
    expect(toFractionString(informe.cambio.valor.rotacion)).toBe('40/40');
    expect(toFractionString(informe.cambio.valor.proporcionDePersonasNuevas)).toBe('40/40');
  });

  it('el núcleo se define por un CORTE de aportes, y los empates entran completos', () => {
    // 40 personas con 1 aporte y 20 con 9. La décima parte de 60 es 6, pero el corte cae en 9 y
    // entran las 20 que empatan: el núcleo es 20, no 6. Cortar por la mitad a personas que hicieron
    // exactamente lo mismo exigiría un criterio de desempate entre personas, y no existe ninguno
    // defendible.
    const antes = [
      ...grupoActivo(0, 40, 1, VENTANA_ANTERIOR),
      ...grupoActivo(40, 20, 9, VENTANA_ANTERIOR),
    ];
    const ahora = [...grupoActivo(0, 40, 1), ...grupoActivo(40, 20, 9)];
    const informe = informeDeRotacion(entradaRotacion(antes, ahora));
    expect(informe.cambio.publicado).toBe(true);
    if (!informe.cambio.publicado) return;
    expect(informe.cambio.valor.corteAnterior).toBe(9);
    expect(informe.cambio.valor.nucleoAnterior).toBe(20);
  });

  it('el corte se publica para que la cifra sea recomputable', () => {
    const antes = grupoActivo(0, 30, 5, VENTANA_ANTERIOR);
    const ahora = grupoActivo(0, 30, 7);
    const informe = informeDeRotacion(entradaRotacion(antes, ahora));
    expect(informe.cambio.publicado).toBe(true);
    if (!informe.cambio.publicado) return;
    expect(informe.cambio.valor.corteAnterior).toBe(5);
    expect(informe.cambio.valor.corteActual).toBe(7);
  });

  it('media renovación ⇒ 10/20, exacto y sin reducir', () => {
    const antes = grupoActivo(0, 20, 3, VENTANA_ANTERIOR);
    const ahora = [...grupoActivo(0, 10, 3), ...grupoActivo(20, 10, 3)];
    const informe = informeDeRotacion(entradaRotacion(antes, ahora));
    expect(informe.cambio.publicado).toBe(true);
    if (!informe.cambio.publicado) return;
    expect(toFractionString(informe.cambio.valor.rotacion)).toBe('10/20');
    expect(toFractionString(informe.cambio.valor.proporcionDePersonasNuevas)).toBe('10/20');
  });

  it('los aportes fuera de su período no cuentan', () => {
    // Aportes del período anterior colocados en la ventana actual: no deben contarse como previos.
    const informe = informeDeRotacion(
      entradaRotacion(grupoActivo(0, 30, 3), grupoActivo(0, 30, 3)),
    );
    expect(informe.participantesAnteriores).toBe(0);
    expect(informe.cambio.publicado).toBe(false);
  });
});
