'use client';

import Link from 'next/link';
import { useState, type SyntheticEvent, type ReactNode } from 'react';

import type { RespuestaEnlace } from '@koinonia/contracts';

import { Aviso, ErrorVisible } from '../../components/marco';
import { enviar } from '../../lib/api';

export default function Entrar(): ReactNode {
  const [correo, setCorreo] = useState('');
  const [enviado, setEnviado] = useState<RespuestaEnlace | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const [enviando, setEnviando] = useState(false);

  async function pedir(evento: SyntheticEvent): Promise<void> {
    evento.preventDefault();
    setError(undefined);
    setEnviando(true);
    try {
      setEnviado(await enviar<RespuestaEnlace>('/auth/enlace', { correo }));
    } catch (fallo) {
      setError(fallo);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <h1>Entrar</h1>
      <p>
        Te mandamos un enlace al correo institucional. No hay contraseña que recordar ni que perder.
        Lo único que comprobamos es que tu correo termina en <strong>@udea.edu.co</strong>.
      </p>

      <ErrorVisible error={error} />

      {enviado !== undefined ? (
        <Aviso tipo="bien" titulo="Revisá tu correo">
          <p>
            Si ese correo es del Instituto, ya salió el enlace. Sirve <strong>una sola vez</strong>{' '}
            y vence en {enviado.duraMinutos} minutos.
          </p>
          <p className="suave">
            Decimos «si ese correo es del Instituto» a propósito: esta pantalla no revela quién
            tiene cuenta y quién no.
          </p>
          {enviado.enlaceDeDesarrollo !== undefined && (
            <p>
              Estás en modo de desarrollo, así que acá va el enlace directo:{' '}
              <a href={enviado.enlaceDeDesarrollo}>entrar ahora</a>.
            </p>
          )}
        </Aviso>
      ) : (
        <form onSubmit={(e) => void pedir(e)} noValidate>
          <div className="campo">
            <label htmlFor="correo">Tu correo institucional</label>
            <span className="ayuda" id="ayuda-correo">
              Por ejemplo: nombre.apellido@udea.edu.co
            </span>
            <input
              id="correo"
              name="correo"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              aria-describedby="ayuda-correo"
              value={correo}
              onChange={(e) => {
                setCorreo(e.target.value);
              }}
            />
          </div>
          <button className="boton" type="submit" disabled={enviando}>
            {enviando ? 'Mandando…' : 'Mandame el enlace'}
          </button>
        </form>
      )}

      <p className="suave">
        ¿Sólo querés mirar? Lo público se lee sin cuenta:{' '}
        <Link href="/problemas">ver los problemas</Link>.
      </p>
    </>
  );
}
