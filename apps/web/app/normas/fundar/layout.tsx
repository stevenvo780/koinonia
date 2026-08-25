import type { ReactNode } from 'react';

import { tituloDe } from '@/app/titulo';

export const metadata = tituloDe('Fundar las reglas');

export default function Capa({ children }: { readonly children: ReactNode }): ReactNode {
  return children;
}
