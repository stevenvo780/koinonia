import type { ReactNode } from 'react';

import { tituloDe } from '@/app/titulo';

export const metadata = tituloDe('Todo lo que quedó escrito');

export default function Capa({ children }: { readonly children: ReactNode }): ReactNode {
  return children;
}
