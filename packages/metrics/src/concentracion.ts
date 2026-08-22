/**
 * Métrica 2 — **concentración de voz**: qué tan repartida está la palabra.
 *
 * §6: índice de concentración sobre **autoría**, ventana de 30 días, alarma en 0,15. Mide si esto
 * es un colectivo o un club con auditorio.
 *
 * # No es el índice que ya existía
 *
 * `packages/domain/src/tally/common.ts` calcula la concentración de **delegaciones** dentro de una
 * decisión: quién acumula peso de voto. Ésta es la concentración de **habla** a lo largo de una
 * ventana de tiempo: quién ocupa el espacio de la conversación. Son dos fenómenos distintos —una
 * asamblea puede repartir perfectamente el voto y estar copada por tres voces— y por eso son dos
 * métricas.
 *
 * Lo que **sí** se reutiliza es la aritmética: `herfindahl`, `normalizedHerfindahl` y
 * `concentrationRatio` del dominio, exactas en fracciones y ya probadas contra INV-31. Reescribir
 * aquí la fórmula habría creado un segundo lugar donde equivocarse, y dos números que se llaman
 * igual y no coinciden destruyen más confianza que la que cualquiera de los dos aporta.
 *
 * # Qué umbral, y por qué no el literal
 *
 * §6 dice «alarma en 0.15» sin decir sobre cuál de los dos índices. Se toma el **normalizado**, que
 * es el que `HIGH_CONCENTRATION_HHI` (3/20) fija en C.6.a para la concentración de delegaciones. El
 * bruto depende de cuánta gente hable: con 300 personas hablando su mínimo es 1/300 y con 6
 * personas es 1/6, así que un 0,15 sobre el bruto significaría cosas opuestas en dos semanas
 * consecutivas, y una serie histórica en la que el umbral cambia de sentido no es una serie. El
 * normalizado vale 0 con reparto perfecto y 1 con una sola voz, hable quien hable. Ambos se
 * publican, para que quien quiera aplicar el literal pueda.
 *
 * # k-anonimato
 *
 * Con menos de `K_NO_SE_PUBLICA` personas hablando no se publica nada: describir el reparto de la
 * palabra entre cuatro personas es describir a esas cuatro personas. Y «cuánto puso quien más
 * habló» —que es el dato de **una** persona sin nombrarla— exige `K_MAXIMO_INDIVIDUAL`.
 */

import {
  cmpFraction,
  concentrationRatio,
  herfindahl,
  HIGH_CONCENTRATION_HHI,
  normalizedHerfindahl,
  type Fraction,
} from '@koinonia/domain';

import {
  dentroDe,
  EntradaInvalidaError,
  K_MAXIMO_INDIVIDUAL,
  NO_SE_PUBLICA,
  publicarSiHayGente,
  sellar,
  validarVentana,
  type Agregado,
  type Aporte,
  type Desglose,
  type EntradaVoz,
  type InformeVoz,
  type RepartoDeVoz,
} from './types.js';

/** El umbral de §6 y de C.6.a, exacto: `3/20`. Nunca `0.15` en coma flotante. */
export const REPARTO_EN_ALARMA: Fraction = HIGH_CONCENTRATION_HHI;

/**
 * Cuántos aportes puso cada persona, **sin las personas**.
 *
 * Devuelve una lista de conteos ordenada de mayor a menor. Ordena números, no gente: al salir de
 * aquí ya no existe la correspondencia entre una posición de la lista y una persona, así que ni
 * este módulo ni ninguno de sus llamantes puede reconstruir un ranking aunque quiera.
 */
function repartoSinNombres(aportes: readonly Aporte[]): readonly number[] {
  const porAutor = new Map<string, number>();
  for (const aporte of aportes) {
    porAutor.set(aporte.autor, (porAutor.get(aporte.autor) ?? 0) + 1);
  }
  return [...porAutor.values()].sort((a, b) => b - a);
}

/**
 * Reparto de la palabra en la ventana.
 *
 * El retorno es `Agregado<InformeVoz>` y además pasa por `sellar()` con las identidades de los
 * autores de la entrada: si alguna sobreviviera al cálculo, la llamada revienta aquí y no en la
 * pantalla de 300 personas.
 */
export function informeDeVoz(entrada: EntradaVoz): Agregado<InformeVoz> {
  validarVentana(entrada.ventana);
  if (!Number.isInteger(entrada.censo) || entrada.censo < 0) {
    throw new EntradaInvalidaError('el censo debe ser un entero no negativo');
  }

  const enVentana = entrada.aportes.filter((a) => dentroDe(entrada.ventana, a.instante));
  const pesos = repartoSinNombres(enVentana);

  const reparto: Desglose<RepartoDeVoz> = publicarSiHayGente(pesos.length, () => {
    const normalizado = normalizedHerfindahl(pesos);
    const mayorParticipacion: Desglose<Fraction> =
      pesos.length < K_MAXIMO_INDIVIDUAL
        ? NO_SE_PUBLICA
        : {
            publicado: true,
            personas: pesos.length,
            grupoPequeno: false,
            valor: concentrationRatio(pesos, entrada.censo),
          };
    return {
      personasQueHablaron: pesos.length,
      reparto: normalizado,
      repartoBruto: herfindahl(pesos),
      mayorParticipacion,
      alarma: cmpFraction(normalizado, REPARTO_EN_ALARMA) >= 0,
    };
  });

  const informe: InformeVoz = {
    ventana: entrada.ventana,
    censo: entrada.censo,
    aportesContados: enVentana.length,
    reparto,
  };

  return sellar(
    informe,
    entrada.aportes.map((a) => a.autor),
  );
}
