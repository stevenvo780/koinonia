'use client';

/**
 * Reuniones: el puente entre lo presencial y el resto del recorrido (PRODUCT §4).
 *
 * Dos secciones, no una lista sola: **próximas** —lo que todavía no tiene acta, con su orden del
 * día publicado con antelación— y **pasadas** —lo que ya se hizo, con su acta y las propuestas que
 * salieron de ella enlazadas como tales—. El corte es `actaPublicada`, no la fecha: una reunión
 * convocada para ayer y sin acta todavía sigue siendo «próxima» en el sentido que importa acá —
 * falta contar qué pasó—, y una convocada para dentro de un mes pero con el acta ya publicada de
 * antemano (una reunión que se adelantó, o se reprogramó) ya cuenta lo que se acordó.
 */

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

import type { ReunionResumen } from '@koinonia/contracts';

import { ErrorVisible } from '../../components/marco';
import { Esqueleto, Ficha, Meta, Tarjeta, Vacio } from '../../components/piezas';
import { cuando, fechaCortaEnFrase, traer } from '../../lib/api';

function TarjetaReunion({ reunion }: { readonly reunion: ReunionResumen }): ReactNode {
  return (
    <Tarjeta titulo={reunion.titulo} enlace={`/reuniones/${reunion.id}`}>
      <Ficha variante={reunion.actaPublicada ? 'neutra' : 'en-curso'}>
        {reunion.actaPublicada ? 'Con acta publicada' : 'Próxima'}
      </Ficha>
      <Meta>
        <>
          <time dateTime={new Date(reunion.cuando).toISOString()} title={cuando(reunion.cuando)}>
            {fechaCortaEnFrase(reunion.cuando)}
          </time>
        </>
        {reunion.lugar !== undefined ? reunion.lugar : null}
        {reunion.lugar === undefined && reunion.enlaceRemoto !== undefined
          ? 'Remota'
          : reunion.lugar !== undefined && reunion.enlaceRemoto !== undefined
            ? 'y remota'
            : null}
        {`${String(reunion.puntosOrdenDelDia)} ${
          reunion.puntosOrdenDelDia === 1
            ? 'punto en el orden del día'
            : 'puntos en el orden del día'
        }`}
        {reunion.laConvoqueYo ? 'La convocaste vos' : null}
      </Meta>
    </Tarjeta>
  );
}

export default function Reuniones(): ReactNode {
  const [reuniones, setReuniones] = useState<ReunionResumen[] | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);

  useEffect(() => {
    traer<ReunionResumen[]>('/reuniones').then(setReuniones).catch(setError);
  }, []);

  const proximas = reuniones?.filter((r) => !r.actaPublicada) ?? [];
  const pasadas = reuniones?.filter((r) => r.actaPublicada) ?? [];

  return (
    <div className="pagina-indice">
      <h1>Reuniones</h1>
      <p className="lede">
        Que lo presencial entre como insumo trazable, no como sede del gobierno.
      </p>

      <p>
        <Link className="boton" href="/reuniones/nueva">
          Convocar una reunión
        </Link>
      </p>

      <ErrorVisible error={error} />

      {reuniones === undefined && error === undefined && (
        <Esqueleto que="las reuniones" cuantos={4} />
      )}

      {reuniones !== undefined && reuniones.length === 0 && (
        <Vacio
          titulo="No hay reuniones convocadas"
          salida={{ href: '/reuniones/nueva', texto: 'Convocar una reunión' }}
        >
          <p>
            Se puede decidir sin reunirse: la mayoría de lo que hay acá se resolvió sin que nadie
            tuviera que ir a ningún lado a una hora fija.
          </p>
        </Vacio>
      )}

      {reuniones !== undefined && reuniones.length > 0 && (
        <>
          <section aria-labelledby="proximas-titulo">
            <h2 id="proximas-titulo">Próximas</h2>
            {proximas.length === 0 ? (
              <p className="suave">No hay ninguna reunión sin acta todavía.</p>
            ) : (
              <ul className="tarjetas">
                {proximas.map((reunion) => (
                  <TarjetaReunion key={reunion.id} reunion={reunion} />
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="pasadas-titulo">
            <h2 id="pasadas-titulo">Pasadas</h2>
            {pasadas.length === 0 ? (
              <p className="suave">Todavía ninguna reunión tiene acta publicada.</p>
            ) : (
              <ul className="tarjetas">
                {pasadas.map((reunion) => (
                  <TarjetaReunion key={reunion.id} reunion={reunion} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
