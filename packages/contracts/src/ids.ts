/**
 * Esquemas de los identificadores de frontera.
 *
 * Son los mismos patrones que `@koinonia/domain/ids`, expresados en Zod para que el servidor y el
 * cliente validen con **una sola** definición. Duplicar la expresión regular en el cliente es cómo
 * se acaba con un formulario que acepta lo que el servidor rechaza.
 */

import { z } from 'zod';

/** 128 bits en hexadecimal minúscula: la forma de todo identificador opaco del sistema. */
export const opaqueId = z
  .string()
  .regex(
    /^[0-9a-f]{32}$/u,
    'debe ser un identificador de 32 caracteres hexadecimales en minúscula',
  );

/** 256 bits en hexadecimal minúscula. */
export const hash64 = z
  .string()
  .regex(/^[0-9a-f]{64}$/u, 'debe ser una huella de 64 caracteres hexadecimales en minúscula');

/** Milisegundos desde el epoch UTC. El servidor lo asigna; el cliente nunca lo envía. */
export const instantMs = z.number().int().nonnegative();

/** UUID v4 de idempotencia del comando. Lo genera el cliente. */
export const requestId = z.uuid();

/**
 * Correo institucional.
 *
 * DECISIÓN: la validación del dominio `@udea.edu.co` vive en el adaptador de identidad
 * (`IdentityProviderAdapter`), no aquí, porque es una **política** que puede cambiar —correo
 * alternativo de recuperación, otro instituto— y no una regla de forma. Aquí sólo se comprueba que
 * es un correo.
 */
export const email = z.email().max(254);

export type OpaqueId = z.infer<typeof opaqueId>;
export type Hash64 = z.infer<typeof hash64>;
