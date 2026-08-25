import type { ReactNode } from 'react';

import { tituloDe } from '@/app/titulo';

export const metadata = tituloDe('Tengo un problema o una idea');

export default function Capa({ children }: { readonly children: ReactNode }): ReactNode {
  return children;
}
