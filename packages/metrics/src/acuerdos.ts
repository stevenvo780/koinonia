/**
 * Métrica 1 — **tasa de cumplimiento de acuerdos** y su stock complementario, la **deuda de
 * acuerdos**.
 *
 * §6 la llama la métrica maestra: mide si decidir sirve para algo. «Bajo 0.5 sostenido, la
 * plataforma es teatro y todo lo demás es decoración.»
 *
 * # Lo que el ADR-0040 obliga a hacer distinto de la versión ingenua
 *
 *  - **El desglose es por círculo y por tipo de tarea, jamás por persona.** No es una regla de uso:
 *    `AcuerdoProyectado` no tiene campo de persona. Lo que no entra no se puede desglosar.
 *  - **Declarar bloqueo o pedir ayuda detiene el reloj.** Un acuerdo con `relojDetenido` no cuenta
 *    como incumplido ni entra en la deuda; se cuenta aparte. «Si avisar castiga, nadie avisa», y un
 *    sistema que se entera tarde de una sobrecarga es peor que uno con la cifra fea.
 *  - **Prescripción.** Los atrasos caducan a los dos semestres. La ventana llega como dato en
 *    `prescripcionMs`: un vencimiento más viejo sale de la deuda, y con él sale la tentación de
 *    arrastrar el historial de alguien indefinidamente.
 *  - **k-anonimato por círculo.** Un círculo de cuatro personas con un acuerdo vencido es una
 *    persona señalada ante cualquiera que sepa quién está en ese círculo. Por debajo de
 *    `K_NO_SE_PUBLICA` el desglose no se publica. El desglose por *tipo de tarea* no lo necesita:
 *    un tipo de tarea no es un grupo de personas.
 *
 * La tasa es una fracción exacta porque alimenta una alarma con consecuencia (el 0,5 de §6), y una
 * comparación de umbral en coma flotante es cómo un 0,5 clavado se convierte en «por debajo».
 */

import { cmpFraction, HALF, ratio, type Fraction } from '@koinonia/domain';

import {
  agruparPorEtiqueta,
  compararEtiquetas,
  dentroDe,
  EntradaInvalidaError,
  medida,
  publicarSiHayGente,
  sellar,
  SIN_DATOS,
  validarVentana,
  type Agregado,
  type AcuerdoProyectado,
  type CuentaDeAcuerdos,
  type CumplimientoDeCirculo,
  type CumplimientoDeTipo,
  type EntradaAcuerdos,
  type InformeAcuerdos,
  type Instante,
  type Medida,
} from './types.js';

/** Estado de un acuerdo respecto del instante del informe. Es interno: no sale del módulo. */
type Estado = 'cumplido' | 'deuda' | 'reloj-detenido' | 'prescrito' | 'en-curso';

function estadoDe(acuerdo: AcuerdoProyectado, instante: Instante, prescripcionMs: number): Estado {
  if (acuerdo.cerradoEn !== null) return 'cumplido';
  // El orden importa: el reloj detenido gana sobre todo lo demás. Un acuerdo bloqueado no está
  // «vencido y además bloqueado»; está bloqueado, y su plazo dejó de correr (ADR-0040).
  if (acuerdo.relojDetenido) return 'reloj-detenido';
  if (acuerdo.vencimiento >= instante) return 'en-curso';
  if (instante - acuerdo.vencimiento > prescripcionMs) return 'prescrito';
  return 'deuda';
}

function contar(
  acuerdos: readonly AcuerdoProyectado[],
  instante: Instante,
  prescripcionMs: number,
): CuentaDeAcuerdos {
  let cumplidos = 0;
  let cumplidosTarde = 0;
  let deuda = 0;
  let conRelojDetenido = 0;
  let prescritos = 0;
  let enCurso = 0;

  for (const acuerdo of acuerdos) {
    switch (estadoDe(acuerdo, instante, prescripcionMs)) {
      case 'cumplido':
        cumplidos += 1;
        // `cerradoEn` no es null en esta rama, pero el compilador no lo sabe desde `estadoDe`.
        if (acuerdo.cerradoEn !== null && acuerdo.cerradoEn > acuerdo.vencimiento) {
          cumplidosTarde += 1;
        }
        break;
      case 'deuda':
        deuda += 1;
        break;
      case 'reloj-detenido':
        conRelojDetenido += 1;
        break;
      case 'prescrito':
        prescritos += 1;
        break;
      case 'en-curso':
        enCurso += 1;
        break;
    }
  }

  const resueltos = cumplidos + deuda;
  const cumplimiento: Medida = resueltos === 0 ? SIN_DATOS : medida(ratio(cumplidos, resueltos));

  return {
    vencianEnLaVentana: acuerdos.length,
    cumplidos,
    cumplidosTarde,
    deuda,
    conRelojDetenido,
    prescritos,
    enCurso,
    cumplimiento,
  };
}

/**
 * ¿La tasa está por debajo de la mitad?
 *
 * Con `hay: false` la respuesta es **no**, y no «sí por defecto»: que no venciera ningún acuerdo no
 * es un incumplimiento del 100 %. Es el error que enciende la alarma el primer día.
 */
function bajoLaMitad(cumplimiento: Medida): boolean {
  return cumplimiento.hay && cmpFraction(cumplimiento.valor, HALF) < 0;
}

/** El umbral de §6, expuesto como fracción exacta para que quien audite lo pueda recomputar. */
export const CUMPLIMIENTO_MINIMO: Fraction = HALF;

/**
 * Cumplimiento y deuda de los acuerdos que vencían en la ventana.
 *
 * El retorno es `Agregado<InformeAcuerdos>`: si algún día alguien añade un campo con personas al
 * informe, este `return` deja de compilar.
 */
export function informeDeAcuerdos(entrada: EntradaAcuerdos): Agregado<InformeAcuerdos> {
  validarVentana(entrada.ventana);
  if (!Number.isFinite(entrada.instante)) {
    throw new EntradaInvalidaError('el instante del informe debe ser finito');
  }
  if (!Number.isFinite(entrada.prescripcionMs) || entrada.prescripcionMs < 0) {
    throw new EntradaInvalidaError('la prescripción debe ser una duración no negativa');
  }

  const enVentana = entrada.acuerdos.filter((a) => dentroDe(entrada.ventana, a.vencimiento));
  const total = contar(enVentana, entrada.instante, entrada.prescripcionMs);

  const personasPorCirculo = new Map<string, number>();
  for (const { circulo, personas } of entrada.circulos) {
    if (!Number.isInteger(personas) || personas < 0) {
      throw new EntradaInvalidaError(
        `el tamaño del círculo «${circulo}» debe ser un entero no negativo`,
      );
    }
    personasPorCirculo.set(circulo, personas);
  }

  let circulosNoPublicados = 0;
  const porCirculo: CumplimientoDeCirculo[] = [];
  for (const [circulo, acuerdos] of agruparPorEtiqueta(enVentana, (a) => a.circulo)) {
    // Un círculo del que no se sabe cuánta gente tiene se trata como el peor caso: no se publica.
    // Fallar cerrado es la única postura defendible cuando el coste del error es señalar a alguien.
    const personas = personasPorCirculo.get(circulo) ?? 0;
    const desglose = publicarSiHayGente(personas, () =>
      contar(acuerdos, entrada.instante, entrada.prescripcionMs),
    );
    if (!desglose.publicado) circulosNoPublicados += 1;
    porCirculo.push({ circulo, desglose });
  }

  const porTipo: CumplimientoDeTipo[] = agruparPorEtiqueta(enVentana, (a) => a.tipo).map(
    ([tipo, acuerdos]) => ({
      tipo,
      cuenta: contar(acuerdos, entrada.instante, entrada.prescripcionMs),
    }),
  );

  const informe: InformeAcuerdos = {
    ventana: entrada.ventana,
    total,
    bajoLaMitad: bajoLaMitad(total.cumplimiento),
    porCirculo: porCirculo.sort((a, b) => compararEtiquetas(a.circulo, b.circulo)),
    porTipo,
    circulosNoPublicados,
  };

  // Este `sellar` no tiene identidades que buscar —la entrada no trae ninguna— y se deja a
  // propósito: si mañana alguien añade una persona a `AcuerdoProyectado`, la comprobación ya está
  // puesta y basta con alimentarla.
  return sellar(informe, []);
}
