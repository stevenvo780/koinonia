import type { ReactNode } from 'react';

import { tituloDe } from '@/app/titulo';

export const metadata = tituloDe('Convocar una reunión');

export default function Capa({ children }: { readonly children: ReactNode }): ReactNode {
  return children;
}
