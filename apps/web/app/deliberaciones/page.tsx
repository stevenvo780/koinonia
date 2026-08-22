'use client';

/**
 * Las conversaciones abiertas sobre un problema.
 *
 * La pantalla dice dos cosas que ninguna lista suele decir: **hasta cuándo** se puede escribir en la
 * etapa que va, y si en ese momento se ve o no quién escribió cada aporte. Lo segundo no es un
 * adorno: es la única forma de que alguien decida con conocimiento si le conviene escribir ahora.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode, type SyntheticEvent } from 'react';

import type { DeliberacionResumen, ProblemaResumen } from '@koinonia/contracts';

import { Aviso, Cargando, ErrorVisible, useSesion } from '../../components/marco';
import { enviar, nuevoRequestId, plazo, traer } from '../../lib/api';

/** Dos días. Lo bastante para que quien no entra a diario alcance a leer y escribir. */
const HORAS_POR_DEFECTO = 48;

export default function Deliberaciones(): ReactNode {
  const { sesion } = useSesion();
  const [lista, setLista] = useState<DeliberacionResumen[] | undefined>(undefined);
  const [problemas, setProblemas] = useState<ProblemaResumen[]>([]);
  const [error, setError] = useState<unknown>(undefined);
  const [errorAbrir, setErrorAbrir] = useState<unknown>(undefined);
  const [problemaId, setProblemaId] = useState('');
  const [horas, setHoras] = useState(String(HORAS_POR_DEFECTO));
  const [guardando, setGuardando] = useState(false);

  const recargar = useCallback(() => {
    traer<DeliberacionResumen[]>('/deliberaciones').then(setLista).catch(setError);
    traer<ProblemaResumen[]>('/problemas')
      .then(setProblemas)
      .catch(() => undefined);
  }, []);

  useEffect(recargar, [recargar]);

  // Sólo para pintar. Quién puede abrir una conversación lo decide el motor, y lo vuelve a decidir
  // aunque alguien llame a la API sin pasar por acá.
  const cuidaElProcedimiento =
    sesion?.roles.includes('facilitator') === true || sesion?.roles.includes('guarantees') === true;

  async function abrir(evento: SyntheticEvent): Promise<void> {
    evento.preventDefault();
    setErrorAbrir(undefined);
    setGuardando(true);
    try {
      await enviar<DeliberacionResumen>('/deliberaciones', {
        requestId: nuevoRequestId(),
        problemaId,
        duracionHoras: Number(horas),
      });
      setProblemaId('');
      recargar();
    } catch (fallo) {
      setErrorAbrir(fallo);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <h1>Deliberaciones</h1>
      <p>
        Una deliberación es una conversación con etapas y con plazo. Primero se entiende el
        problema, después cada quien dice cómo lo ve, y sólo entonces se arman salidas. Cada etapa
        se cierra y no se vuelve atrás: lo que se escribe tarde no entra.
      </p>

      <ErrorVisible error={error} />
      {lista === undefined && error === undefined && <Cargando que="las conversaciones" />}

      {lista !== undefined && lista.length === 0 && (
        <div className="vacio">
          <p>
            Todavía no hay ninguna conversación abierta. Se abre sobre un problema que ya esté
            escrito: <Link href="/problemas">mirá la lista de problemas</Link>.
          </p>
        </div>
      )}

      {lista !== undefined && lista.length > 0 && (
        <ul className="tarjetas">
          {lista.map((deliberacion) => (
            <li key={deliberacion.id}>
              <h2>
                <Link href={`/deliberaciones/${deliberacion.id}`}>
                  {deliberacion.problemaTitulo}
                </Link>
              </h2>
              <p className="suave">
                <span className="etiqueta">{deliberacion.etapaEnPalabras}</span>{' '}
                {plazo(deliberacion.cierraEn)} · {deliberacion.cuantosAportes}{' '}
                {deliberacion.cuantosAportes === 1 ? 'aporte' : 'aportes'}
              </p>
              <p>{deliberacion.queSeHaceEnEstaEtapa}</p>
              {!deliberacion.autoriaVisible && (
                <p>
                  <span aria-hidden="true">◍ </span>
                  Ahora mismo no se ve quién escribió cada aporte.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {cuidaElProcedimiento && (
        <section aria-labelledby="abrir-titulo" className="accion-procedimiento">
          <h2 id="abrir-titulo">Abrir una conversación</h2>
          <p className="suave">
            Cuidás el procedimiento, así que podés abrirla. Queda a tu nombre en el historial.
          </p>
          <ErrorVisible error={errorAbrir} />
          <form className="formulario-acotado" onSubmit={(e) => void abrir(e)} noValidate>
            <div className="campo">
              <label htmlFor="problema">¿Sobre qué problema?</label>
              <span className="ayuda" id="ayuda-problema">
                Sólo se conversa sobre un problema que alguien ya escribió.
              </span>
              <select
                id="problema"
                required
                aria-describedby="ayuda-problema"
                value={problemaId}
                onChange={(e) => {
                  setProblemaId(e.target.value);
                }}
              >
                <option value="">Elegí un problema</option>
                {problemas.map((problema) => (
                  <option key={problema.id} value={problema.id}>
                    {problema.titulo}
                  </option>
                ))}
              </select>
            </div>

            <div className="campo">
              <label htmlFor="horas">¿Cuántas horas dura la primera etapa?</label>
              <span className="ayuda" id="ayuda-horas">
                Entre 1 y 720. Se muestra siempre en pantalla, y cuando vence no se escribe más.
              </span>
              <input
                id="horas"
                type="number"
                inputMode="numeric"
                min={1}
                max={720}
                required
                aria-describedby="ayuda-horas"
                value={horas}
                onChange={(e) => {
                  setHoras(e.target.value);
                }}
              />
            </div>

            <button className="boton" type="submit" disabled={guardando || problemaId === ''}>
              {guardando ? 'Abriendo…' : 'Abrir la conversación'}
            </button>
          </form>
        </section>
      )}

      {sesion === undefined && (
        <Aviso tipo="atencion" titulo="Estás mirando sin cuenta">
          Podés leer todo. Para aportar hay que entrar con el correo institucional.{' '}
          <Link href="/entrar">Entrar</Link>.
        </Aviso>
      )}
    </>
  );
}
