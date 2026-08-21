'use client';

/**
 * Piezas comunes de la interfaz.
 *
 * Todas cumplen tres reglas que en la práctica se saltan siempre:
 *
 *  1. **Los mensajes que aparecen solos se anuncian.** Un error que se pinta y no lleva `role`
 *     adecuado no existe para quien usa un lector de pantalla: la página cambia y no se entera.
 *  2. **Nada depende sólo del color.** Verde y rojo llevan símbolo y palabra.
 *  3. **Cargando también se dice.** Un hueco en blanco durante dos segundos es una página rota para
 *     quien no ve el spinner.
 */

import Link from 'next/link';
import { type ReactNode, useEffect, useState } from 'react';

import { ErrorDeApi, traer } from '../lib/api';
import type { Sesion } from '@koinonia/contracts';

export function Cargando({ que }: { readonly que: string }): ReactNode {
  return (
    <p className="cargando" role="status">
      Cargando {que}…
    </p>
  );
}

export function Aviso({
  tipo,
  titulo,
  children,
}: {
  readonly tipo: 'error' | 'bien' | 'atencion';
  readonly titulo?: string;
  readonly children: ReactNode;
}): ReactNode {
  const simbolo = tipo === 'error' ? '✕' : tipo === 'bien' ? '✓' : '!';
  const palabra = tipo === 'error' ? 'Problema' : tipo === 'bien' ? 'Todo bien' : 'Atención';
  return (
    <div className={`aviso ${tipo}`} role={tipo === 'error' ? 'alert' : 'status'}>
      <strong>
        <span aria-hidden="true">{simbolo} </span>
        {titulo ?? palabra}:{' '}
      </strong>
      {children}
    </div>
  );
}

export function ErrorVisible({ error }: { readonly error: unknown }): ReactNode {
  if (error === null || error === undefined) return null;
  const mensaje =
    error instanceof ErrorDeApi
      ? error.message
      : error instanceof Error
        ? error.message
        : 'Algo no salió bien.';
  const queHacer = error instanceof ErrorDeApi ? error.queHacer : undefined;
  return (
    <Aviso tipo="error" titulo="No se pudo">
      {mensaje}
      {queHacer !== undefined && (
        <>
          {' '}
          <span>{queHacer}</span>
        </>
      )}
    </Aviso>
  );
}

/** La sesión, para saber qué mostrar. **Nunca** para decidir si algo se puede hacer. */
export function useSesion(): {
  readonly sesion: Sesion | undefined;
  readonly cargando: boolean;
  readonly recargar: () => void;
} {
  const [sesion, setSesion] = useState<Sesion | undefined>(undefined);
  const [cargando, setCargando] = useState(true);
  const [tic, setTic] = useState(0);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    traer<Sesion>('/auth/yo')
      .then((s) => {
        if (vivo) setSesion(s);
      })
      .catch(() => {
        if (vivo) setSesion(undefined);
      })
      .finally(() => {
        if (vivo) setCargando(false);
      });
    return () => {
      vivo = false;
    };
  }, [tic]);

  return {
    sesion,
    cargando,
    recargar: () => {
      setTic((n) => n + 1);
    },
  };
}

export function BarraSesion(): ReactNode {
  const { sesion, cargando } = useSesion();
  if (cargando) return null;
  if (sesion === undefined) {
    return (
      <p className="suave">
        Estás mirando sin cuenta. <Link href="/entrar">Entrar con el correo institucional</Link>.
      </p>
    );
  }
  return (
    <p className="suave">
      Entraste como <strong>{sesion.alias}</strong>.{' '}
      {sesion.roles.includes('facilitator') && (
        <span className="etiqueta">Cuidás el procedimiento</span>
      )}
    </p>
  );
}
