import type { ReactNode } from 'react';

import { tituloDe } from '@/app/titulo';

export const metadata = tituloDe('Una iniciativa');

export default function Capa({ children }: { readonly children: ReactNode }): ReactNode {
  return children;
}
