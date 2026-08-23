'use client';

/**
 * Todo lo que quedó escrito.
 *
 * Es la puerta a comprobar la integridad, y por eso el enlace a «Comprobar que nada se cambió» va
 * arriba y no al final: quien llega acá con desconfianza tiene que encontrar en el primer golpe de
 * vista el camino para no confiar en nosotros.
 *
 * ═══ Aquí NO dice quién ═══
 *
 * Cada línea cuenta qué pasó y cuándo, nunca a nombre de quién. Mientras una conversación tiene la
 * autoría sellada, una lista que dijera «Fulana escribió un aporte a las 14:03» rompería el sello
 * desde fuera, sin tocar la pantalla que lo protege: bastaría cruzar dos listas. Para comprobar que
 * no falta nada y que nada se movió, el nombre no hace falta; el número y el orden, sí.
 */

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

import type { Historial } from '@koinonia/contracts';

import { ErrorVisible } from '../../components/marco';
import { Esqueleto, Meta, Tarjeta } from '../../components/piezas';
import { cerrarFrase, cuando, fechaCorta, traer } from '../../lib/api';

export default function HistorialPantalla(): ReactNode {
  const [historial, setHistorial] = useState<Historial | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);

  useEffect(() => {
    traer<Historial>('/historial').then(setHistorial).catch(setError);
  }, []);

  return (
    <div className="pagina-indice">
      <h1>Todo lo que quedó escrito</h1>
      <p>
        Acá está, en orden, cada cosa que pasó en Koinonía. Nada se borra y nada se corrige por
        detrás: si algo estuvo mal, lo que se escribe es la corrección, y las dos quedan.
      </p>

      <div className="veredicto bien" role="note">
        <span className="marca-estado">
          <span aria-hidden="true">✓ </span>Esto se puede comprobar sin confiar en nosotros
        </span>
        <p>
          Cada cosa escrita va enganchada a la anterior. Si alguien cambiara, borrara o moviera una
          sola, el enganche dejaría de cuadrar y se notaría desde fuera.
        </p>
        <p>
          <Link className="boton accion" href="/verificar">
            Comprobar que nada se cambió
          </Link>
        </p>
      </div>

      <ErrorVisible error={error} />
      {historial === undefined && error === undefined && <Esqueleto que="el historial" />}

      {historial !== undefined && historial.total === 0 && (
        <div className="vacio" role="status">
          <p>
            Todavía no pasó nada. El historial se llena solo, a medida que la comunidad escribe
            problemas, conversa y decide.
          </p>
          <p>
            <Link href="/problemas/nuevo">Escribí el primer problema</Link> o{' '}
            <Link href="/problemas">mirá los que ya hay</Link>.
          </p>
        </div>
      )}

      {historial !== undefined && historial.total > 0 && (
        <section aria-labelledby="hechos-titulo">
          <h2 id="hechos-titulo">Lo último que pasó</h2>
          <p className="suave">
            Van {historial.total} {historial.total === 1 ? 'cosa escrita' : 'cosas escritas'}
            {historial.desde !== undefined ? (
              <> desde el {cerrarFrase(cuando(historial.desde))}</>
            ) : (
              '.'
            )}{' '}
            Acá abajo están las más recientes, de la última a la primera.
          </p>
          <p className="suave">
            Esta lista <strong>no dice quién hizo cada cosa</strong>: mientras una conversación
            tiene la autoría oculta, decirlo acá la destaparía por el costado.
          </p>

          <ol className="tarjetas">
            {historial.hechos.map((hecho) =>
              hecho.enlace === undefined ? (
                <li key={hecho.numero}>
                  <h3>{hecho.que}</h3>
                  <Meta>
                    {hecho.sobre}
                    <time
                      dateTime={new Date(hecho.cuando).toISOString()}
                      title={cuando(hecho.cuando)}
                    >
                      {fechaCorta(hecho.cuando)}
                    </time>
                    {`número ${String(hecho.numero)}`}
                  </Meta>
                </li>
              ) : (
                <Tarjeta key={hecho.numero} titulo={hecho.que} enlace={hecho.enlace}>
                  <Meta>
                    {hecho.sobre}
                    <time
                      dateTime={new Date(hecho.cuando).toISOString()}
                      title={cuando(hecho.cuando)}
                    >
                      {fechaCorta(hecho.cuando)}
                    </time>
                    {`número ${String(hecho.numero)}`}
                  </Meta>
                </Tarjeta>
              ),
            )}
          </ol>

          {historial.hayMas && (
            <p>
              Hay más de las que caben acá. El historial completo se descarga entero desde{' '}
              <Link href="/verificar">la página de comprobación</Link>, y ahí sí va todo: cada cosa
              escrita, con su contenido y su enganche.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
