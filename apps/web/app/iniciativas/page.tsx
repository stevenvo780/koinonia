'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

import type { IniciativaResumen } from '@koinonia/contracts';

import { Cargando, ErrorVisible } from '../../components/marco';
import { cuando, traer } from '../../lib/api';

export default function Iniciativas(): ReactNode {
  const [iniciativas, setIniciativas] = useState<IniciativaResumen[] | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);

  useEffect(() => {
    traer<IniciativaResumen[]>('/iniciativas').then(setIniciativas).catch(setError);
  }, []);

  return (
    <>
      <h1>Iniciativas</h1>
      <p>
        Acá seguimos los cambios que una decisión aprobada dejó listos para revisar. No es un
        tablero de personas: miramos lo acordado, la fecha y la evidencia.
      </p>

      <ErrorVisible error={error} />
      {iniciativas === undefined && error === undefined && <Cargando que="las iniciativas" />}

      {iniciativas !== undefined && iniciativas.length === 0 ? (
        <section className="vacio" aria-labelledby="sin-iniciativas-titulo">
          <h2 id="sin-iniciativas-titulo">Todavía no hay iniciativas</h2>
          <p>
            Cuando aparezca el primer resultado aprobado, acá quedará su siguiente paso como «por
            empezar» mientras termina la revisión, junto con la forma de comprobarlo.
          </p>
        </section>
      ) : (
        <ul className="tarjetas" aria-label="Iniciativas por revisar">
          {iniciativas?.map((iniciativa) => (
            <li key={iniciativa.id}>
              <h2>
                <Link href={`/iniciativas/${iniciativa.id}`}>{iniciativa.objetivo}</Link>
              </h2>
              <p>
                <span className="etiqueta">Por empezar</span>
              </p>
              <p className="suave">Volvemos a mirar el {cuando(iniciativa.revisarEn)}.</p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
