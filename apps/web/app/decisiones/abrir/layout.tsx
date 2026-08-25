import type { ReactNode } from 'react';

import { tituloDe } from '@/app/titulo';

export const metadata = tituloDe('Abrir una decisión');

export default function Capa({ children }: { readonly children: ReactNode }): ReactNode {
  return children;
}
