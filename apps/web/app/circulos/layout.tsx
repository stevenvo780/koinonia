import type { ReactNode } from 'react';

import { tituloDe } from '@/app/titulo';

export const metadata = tituloDe('Quién decide qué');

export default function Capa({ children }: { readonly children: ReactNode }): ReactNode {
  return children;
}
