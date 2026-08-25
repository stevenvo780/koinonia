import type { ReactNode } from 'react';

import { tituloDe } from '@/app/titulo';

export const metadata = tituloDe('En qué coincidimos');

export default function Capa({ children }: { readonly children: ReactNode }): ReactNode {
  return children;
}
