'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type ReactNode } from 'react';

import type { Sesion } from '@koinonia/contracts';

import { Aviso, Cargando, ErrorVisible } from '../../../components/marco';
import { enviar } from '../../../lib/api';

function Confirmacion(): ReactNode {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token');
  const [sesion, setSesion] = useState<Sesion | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);

  useEffect(() => {
    if (token === null || token === '') {
      setError(new Error('Ese enlace no trae nada. Pedí uno nuevo desde la pantalla de entrar.'));
      return;
    }
    enviar<Sesion>('/auth/sesion', { token })
      .then((abierta) => {
        setSesion(abierta);
        // Un enlace mágico sirve una vez: en cuanto se canjea se sale de la URL, para que no quede
        // en el historial del navegador ni se comparta por accidente.
        router.replace('/');
      })
      .catch(setError);
  }, [token, router]);

  if (error !== undefined) {
    return (
      <>
        <h1>No se pudo entrar</h1>
        <ErrorVisible error={error} />
        <p>
          <Link className="boton" href="/entrar">
            Pedir un enlace nuevo
          </Link>
        </p>
      </>
    );
  }

  if (sesion === undefined) return <Cargando que="tu sesión" />;

  return (
    <>
      <h1>Listo</h1>
      <Aviso tipo="bien" titulo={`Hola, ${sesion.alias}`}>
        Ya estás dentro. <Link href="/">Ir al inicio</Link>.
      </Aviso>
    </>
  );
}

export default function Confirmar(): ReactNode {
  return (
    <Suspense
      fallback={
        <p className="cargando" role="status">
          Comprobando el enlace…
        </p>
      }
    >
      <Confirmacion />
    </Suspense>
  );
}
