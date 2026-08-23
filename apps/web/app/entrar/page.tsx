'use client';

/**
 * Entrar con el correo institucional.
 *
 * ═══ Lo que esta pantalla NO dice, y por qué ═══
 *
 * La respuesta es **idéntica** exista o no la cuenta: «si ese correo es del Instituto, ya salió el
 * enlace». Es deliberado y se conserva entero acá. Averiguar quién tiene cuenta probando correos es
 * el primer paso de casi todo lo demás, y en un instituto de 300 personas la lista de quién
 * participa es información política.
 *
 * Esa propiedad no obliga, sin embargo, a dejar a nadie sin salida, que es lo que pasaba:
 *
 *  · el campo no se marcaba como inválido cuando la API rechazaba el correo, y el `campo` que ya
 *    viene en el error se estaba tirando a la basura;
 *  · quien no recibía el correo no tenía ni instrucción ni sitio adonde ir;
 *  · y al equivocarse de dirección **el formulario desaparecía**, así que no había manera de pedir
 *    otro enlace sin recargar la página a mano.
 *
 * Las tres se arreglan sin decir una palabra más sobre quién tiene cuenta: reintentar y explicar no
 * revelan nada, porque la respuesta sigue siendo la misma para todo el mundo.
 */

import Link from 'next/link';
import { useRef, useState, type SyntheticEvent, type ReactNode } from 'react';

import type { RespuestaEnlace } from '@koinonia/contracts';

import { Aviso, ErrorVisible } from '../../components/marco';
import { useAccionUnica } from '../../lib/acciones';
import { enviar, ErrorDeApi } from '../../lib/api';

export default function Entrar(): ReactNode {
  const [correo, setCorreo] = useState('');
  const [enviado, setEnviado] = useState<RespuestaEnlace | undefined>(undefined);
  const [correoEnviado, setCorreoEnviado] = useState('');
  const [error, setError] = useState<unknown>(undefined);
  const { enCurso, ejecutar } = useAccionUnica();
  const campo = useRef<HTMLInputElement | null>(null);

  // El error trae `campo`, y el servidor lo rellena con «correo» tanto cuando el dominio no es el
  // del Instituto como cuando el esquema rechaza la dirección. Ese dato existía desde el principio
  // y esta pantalla lo tiraba. `aria-invalid` sólo se pone cuando el campo *es* el problema: un 429
  // por pedir muchos enlaces no significa que la dirección esté mal, y decirlo sería mentir.
  const correoInvalido = error instanceof ErrorDeApi && error.campo === 'correo';
  // Describir, en cambio, se describe siempre que haya error: quien está en el campo tiene que
  // enterarse de por qué no salió, sea culpa del campo o no.
  const describenAlCampo = error === undefined ? 'ayuda-correo' : 'ayuda-correo error-correo';

  async function pedir(evento: SyntheticEvent): Promise<void> {
    evento.preventDefault();
    setError(undefined);
    const resultado = await ejecutar('enlace', { correo }, () =>
      enviar<RespuestaEnlace>('/auth/enlace', { correo }),
    );
    if (resultado.estado === 'hecho') {
      setEnviado(resultado.valor);
      setCorreoEnviado(correo);
    } else if (resultado.estado === 'fallo') {
      setError(resultado.error);
      requestAnimationFrame(() => campo.current?.focus());
    }
  }

  function volverAlFormulario(): void {
    setEnviado(undefined);
    setError(undefined);
    requestAnimationFrame(() => campo.current?.focus());
  }

  return (
    <div className="pagina-prosa">
      <h1>Entrar</h1>
      <p>
        Te mandamos un enlace al correo institucional. No hay contraseña que recordar ni que perder.
        Lo único que comprobamos es que tu correo termina en <strong>@udea.edu.co</strong>.
      </p>

      <ErrorVisible error={error} id="error-correo" />

      {enviado !== undefined && (
        <Aviso tipo="bien" titulo="Revisá tu correo">
          <p>
            Si ese correo es del Instituto, ya salió el enlace. Sirve <strong>una sola vez</strong>{' '}
            y vence en{' '}
            {enviado.duraMinutos === 1 ? '1 minuto' : `${String(enviado.duraMinutos)} minutos`}.
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
      )}

      {enviado !== undefined ? (
        <section aria-labelledby="no-llega-titulo">
          <h2 id="no-llega-titulo">¿No te llega?</h2>
          <p>
            Escribimos a <strong>{correoEnviado}</strong>. Puede tardar un par de minutos.
          </p>
          <ol>
            <li>Mirá la carpeta de correo no deseado o de promociones.</li>
            <li>
              Comprobá que la dirección esté bien escrita. Si te equivocaste en una letra, el enlace
              salió hacia otro sitio y no va a llegar nunca.
            </li>
            <li>
              Si pasaron más de cinco minutos, pedí otro. El anterior deja de servir en cuanto usás
              el nuevo.
            </li>
          </ol>
          <p>
            <button className="boton" type="button" onClick={volverAlFormulario}>
              Escribir otro correo o pedir otro enlace
            </button>
          </p>
          <p className="suave">
            Si tenés correo del Instituto y aun así no llega, escribile a quien lleva el
            procedimiento en tu grupo: puede comprobarlo sin que nadie tenga que publicar su
            dirección acá.
          </p>
        </section>
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
              ref={campo}
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              aria-describedby={describenAlCampo}
              aria-invalid={correoInvalido}
              value={correo}
              onChange={(e) => {
                setCorreo(e.target.value);
              }}
            />
          </div>
          <button className="boton" type="submit" disabled={enCurso !== undefined}>
            {enCurso === 'enlace' ? 'Mandando…' : 'Mandame el enlace'}
          </button>
        </form>
      )}

      <p className="suave">
        ¿Sólo querés mirar? Lo público se lee sin cuenta:{' '}
        <Link href="/problemas">ver los problemas</Link>.
      </p>
    </div>
  );
}
