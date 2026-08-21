/**
 * Los círculos del primer semestre (GOVERNANCE §3 y PRODUCT §9).
 *
 * «El primer semestre sólo existen la Asamblea y dos o tres círculos planos.» Están aquí, con
 * identificadores fijos y legibles en hexadecimal, porque son **configuración del despliegue**, no
 * un dato que la aplicación invente: si los generara al azar, dos despliegues del mismo Instituto
 * tendrían identificadores distintos para la misma Asamblea y ningún export sería comparable.
 *
 * Los nombres que se muestran salen de aquí; los identificadores nunca se muestran.
 */

export interface CirculoFijo {
  /** 32 hex. Es lo que viaja por el ledger. */
  readonly id: string;
  /** Cómo se llama en pantalla. */
  readonly nombre: string;
  /** Qué decide sin preguntarle a nadie, en una frase (GOVERNANCE §3). */
  readonly decideSinConsultar: string;
}

export const CIRCULOS = {
  asamblea: {
    id: 'a55a11b1ea00000000000000000000a1',
    nombre: 'Asamblea del Instituto',
    decideSinConsultar:
      'Todo lo que no le haya entregado a otro grupo, los pronunciamientos públicos y estas reglas',
  },
  espacios: {
    id: 'e5bac105b1e00000000000000000000b',
    nombre: 'Espacios y Bienestar',
    decideSinConsultar: 'El uso de los espacios, los horarios y las peticiones de infraestructura',
  },
  academico: {
    id: 'acade31c0000000000000000000000c1',
    nombre: 'Académico',
    decideSinConsultar:
      'La posición estudiantil sobre el plan de estudios, las electivas y los seminarios',
  },
} as const satisfies Readonly<Record<string, CirculoFijo>>;

export const CIRCULOS_LISTA: readonly CirculoFijo[] = Object.values(CIRCULOS);

/** Nombre para pantalla. Si el identificador no está en la lista, se dice así, no se inventa. */
export function nombreDeCirculo(id: string): string {
  return CIRCULOS_LISTA.find((c) => c.id === id)?.nombre ?? 'Un grupo que ya no existe';
}

export function existeCirculo(id: string): boolean {
  return CIRCULOS_LISTA.some((c) => c.id === id);
}
