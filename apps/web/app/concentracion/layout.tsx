import type { ReactNode } from 'react';

import { tituloDe } from '@/app/titulo';

// No es el rótulo de la navegación —«Cómo está repartido el voto prestado»—, y es a propósito.
// Ese rótulo es largo porque en un enlace el largo no cuesta nada y ayuda a reconocerlo; una
// pestaña, en cambio, se recorta cerca del carácter doce, y ahí queda «Cómo está rep…», que
// empieza igual que cualquier otra pantalla que explique cómo funciona algo. El nombre de la
// pestaña arranca por lo único que esta pantalla tiene: el reparto.
export const metadata = tituloDe('Reparto del voto prestado');

export default function Capa({ children }: { readonly children: ReactNode }): ReactNode {
  return children;
}
