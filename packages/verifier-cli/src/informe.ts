/**
 * El informe: lo que lee una persona que no sabe qué es un hash.
 *
 * Tres reglas, y las tres son de fondo, no de estilo:
 *
 *  1. **Nada de hexadecimal en la primera pantalla.** Los valores técnicos van al final, bajo
 *     «Detalle para el acta», porque hacen falta para denunciar pero estorban para entender.
 *  2. **Verde nunca significa «todo está bien».** Significa «las cuentas cuadran y además el
 *     resumen está registrado fuera de este servidor». Sin lo segundo el resultado es ámbar, por
 *     muy limpias que estén las cuentas: un servidor comprometido produce cuentas impecables.
 *  3. **Cada fallo dice qué hacer.** Un diagnóstico sin conducta es ruido, y el ruido se ignora.
 */

import { CATALOGO, type Hallazgo, SALIDA, severidadDe } from './hallazgos.js';
import type { ResultadoVerificacion } from './verificar.js';

export interface OpcionesInforme {
  readonly ruta: string;
  /** Ancho de las reglas horizontales. */
  readonly ancho?: number;
}

const VISTO = '✓';
const CRUZ = '✗';
const AVISO = '!';

export function renderInforme(
  resultado: ResultadoVerificacion,
  opciones: OpcionesInforme,
): readonly string[] {
  const ancho = opciones.ancho ?? 78;
  const regla = '─'.repeat(ancho);
  const lineas: string[] = [];

  lineas.push('', `Koinonía · comprobación independiente de «${opciones.ruta}»`, regla, '');

  for (const paso of resultado.pasos) {
    lineas.push(`  ${paso.ok ? VISTO : CRUZ} ${paso.detalle}`);
  }

  const anclaje = resultado.anclaje;
  if (anclaje !== undefined) {
    for (const salida of anclaje.resultados) {
      lineas.push(`    · ${salida.provider}: ${salida.detail}`);
    }
  }

  lineas.push('', regla, '');
  lineas.push(...veredicto(resultado, ancho));

  const alarmas = resultado.hallazgos.filter((h) => severidadDe(h.codigo) === 'alarma');
  const avisos = resultado.hallazgos.filter((h) => severidadDe(h.codigo) === 'aviso');

  if (alarmas.length > 0) {
    lineas.push('', regla, '', 'QUÉ SE ENCONTRÓ', '');
    lineas.push(...hallazgosEnProsa(alarmas, ancho));
  }
  if (avisos.length > 0) {
    lineas.push('', regla, '', 'AVISOS', '');
    lineas.push(...hallazgosEnProsa(avisos, ancho));
  }

  if (resultado.hallazgos.length > 0) {
    lineas.push('', regla, '', 'DETALLE PARA EL ACTA', '');
    for (const hallazgo of resultado.hallazgos) {
      lineas.push(`  [${hallazgo.codigo}] ${hallazgo.detalle}`);
      const ubicacion = [
        hallazgo.agregado === undefined ? undefined : `expediente=${hallazgo.agregado}`,
        hallazgo.leafIndex === undefined ? undefined : `registro=${String(hallazgo.leafIndex)}`,
        hallazgo.seq === undefined ? undefined : `posicion=${String(hallazgo.seq)}`,
        hallazgo.treeSize === undefined ? undefined : `sello=${String(hallazgo.treeSize)}`,
      ].filter((parte): parte is string => parte !== undefined);
      if (ubicacion.length > 0) lineas.push(`      ${ubicacion.join('  ')}`);
      if (hallazgo.esperado !== undefined) lineas.push(`      esperado: ${hallazgo.esperado}`);
      if (hallazgo.obtenido !== undefined) lineas.push(`      obtenido: ${hallazgo.obtenido}`);
    }
  }

  lineas.push('', regla, '');
  lineas.push(
    ...envolver(
      'Este programa no habló con ningún servidor: todo lo anterior se comprobó sobre los ficheros ' +
        'del paquete. Si querés desconfiar también de este programa, `README-VERIFICACION.txt`, ' +
        'dentro del paquete, describe el procedimiento completo en prosa para que cualquiera lo ' +
        'reimplemente desde cero.',
      ancho,
      '  ',
    ),
  );
  lineas.push('');

  return lineas;
}

function veredicto(resultado: ResultadoVerificacion, ancho: number): readonly string[] {
  const alarmas = resultado.hallazgos.filter((h) => severidadDe(h.codigo) === 'alarma');
  const anclaje = resultado.anclaje;

  if (alarmas.length > 0) {
    return [
      '  ROJO — Hay una diferencia.',
      '',
      ...envolver(
        'Las cuentas no cuadran. Esto NO debería ocurrir nunca. No prueba por sí solo que alguien ' +
          'haya actuado de mala fe —un disco defectuoso también rompe cuentas—, pero sí que lo que ' +
          'este paquete contiene no es lo que se registró en su momento.',
        ancho,
        '  ',
      ),
      '',
      '  Guardá este paquete SIN MODIFICARLO y avisá a la veeduría hoy mismo.',
    ];
  }

  if (anclaje === undefined || !anclaje.verdict.firm) {
    return [
      '  ÁMBAR — Las cuentas cuadran; falta la confirmación externa.',
      '',
      ...envolver(
        anclaje === undefined
          ? 'Este paquete no trae comprobantes de registro externo. Todo lo comprobado es coherencia ' +
              'interna, y quien controle el servidor puede producir una historia falsa perfectamente ' +
              'coherente. Sin un testigo de fuera, este verde interno prueba mucho menos de lo que parece.'
          : anclaje.verdict.explanation,
        ancho,
        '  ',
      ),
    ];
  }

  return [
    '  VERDE — Todo cuadra.',
    '',
    ...envolver(
      `Se revisaron ${String(resultado.eventos)} registros` +
        (resultado.desde === undefined ? '' : ` desde el ${fecha(resultado.desde)}`) +
        '. Ninguno fue modificado ni eliminado. ' +
        anclaje.verdict.explanation,
      ancho,
      '  ',
    ),
  ];
}

function hallazgosEnProsa(hallazgos: readonly Hallazgo[], ancho: number): readonly string[] {
  const lineas: string[] = [];
  const vistos = new Set<string>();
  for (const hallazgo of hallazgos) {
    if (vistos.has(hallazgo.codigo)) continue;
    vistos.add(hallazgo.codigo);
    const cuantos = hallazgos.filter((otro) => otro.codigo === hallazgo.codigo).length;
    const descripcion = CATALOGO[hallazgo.codigo];
    const marca = descripcion.severidad === 'alarma' ? CRUZ : AVISO;

    lineas.push(
      `  ${marca} ${descripcion.titulo}${cuantos > 1 ? `  (${String(cuantos)} veces)` : ''}`,
      '',
      ...envolver(descripcion.queSignifica, ancho, '      '),
      '',
      ...envolver(`Qué hacer: ${descripcion.queHacer}`, ancho, '      '),
      '',
    );
  }
  return lineas;
}

/** Corta por palabras, sin partir ninguna. Nada de tipografía: sólo legibilidad en una terminal. */
export function envolver(texto: string, ancho: number, sangria: string): readonly string[] {
  const util = Math.max(20, ancho - sangria.length);
  const palabras = texto.split(/\s+/u).filter((palabra) => palabra !== '');
  const lineas: string[] = [];
  let actual = '';
  for (const palabra of palabras) {
    if (actual === '') {
      actual = palabra;
    } else if (actual.length + 1 + palabra.length <= util) {
      actual += ` ${palabra}`;
    } else {
      lineas.push(sangria + actual);
      actual = palabra;
    }
  }
  if (actual !== '') lineas.push(sangria + actual);
  return lineas;
}

function fecha(iso: string): string {
  const meses = [
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre',
  ];
  const instante = new Date(iso);
  if (Number.isNaN(instante.getTime())) return iso;
  const mes = meses[instante.getUTCMonth()] ?? '';
  return `${String(instante.getUTCDate())} de ${mes} de ${String(instante.getUTCFullYear())}`;
}

/** Nombre humano del código de salida, para documentarlo en la ayuda. */
export const SALIDAS_EXPLICADAS: readonly (readonly [number, string])[] = [
  [SALIDA.ok, 'todo cuadra y el resumen está registrado fuera'],
  [SALIDA.uso, 'error de uso (faltan argumentos, la ruta no existe)'],
  [SALIDA.exportIlegible, 'el paquete no se puede leer o le faltan piezas'],
  [SALIDA.sinAnclajeFirme, 'íntegro por dentro, pero falta la confirmación externa'],
  [SALIDA.anclajeInvalido, 'un comprobante externo es falso o registra otra historia'],
  [SALIDA.checkpoints, 'los sellos periódicos no cuadran con la historia'],
  [SALIDA.integridadInterna, 'la historia está manipulada por dentro'],
];
