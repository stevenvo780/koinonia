'use client';

import { useEffect, useState, type ReactNode } from 'react';

import type { IniciativaResumen } from '@koinonia/contracts';

import { ErrorVisible } from '../../components/marco';
import { Esqueleto, Ficha, Meta, Tarjeta, Vacio } from '../../components/piezas';
import { cuando, fechaCortaEnFrase, traer } from '../../lib/api';

export default function Iniciativas(): ReactNode {
  const [iniciativas, setIniciativas] = useState<IniciativaResumen[] | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);

  useEffect(() => {
    traer<IniciativaResumen[]>('/iniciativas').then(setIniciativas).catch(setError);
  }, []);

  return (
    <div className="pagina-indice">
      <h1>Iniciativas</h1>
      <p>
        Acá seguimos los cambios que una decisión aprobada dejó listos para revisar. No es un
        tablero de personas: miramos lo acordado, la fecha y la evidencia.
      </p>

      <ErrorVisible error={error} />
      {iniciativas === undefined && error === undefined && <Esqueleto que="las iniciativas" />}

      {iniciativas !== undefined && (
        // `<Tarjeta>` y `<Vacio>` imponen `h3`: sin esta sección con su propio `h2` alrededor de
        // las DOS ramas —vacía y con datos—, el salto pasaría de `h1` a `h3` directo cuando la
        // lista está vacía, saltándose un nivel (ver el informe de cimientos, componentes/piezas.tsx).
        <section aria-labelledby="lista-iniciativas-titulo">
          <h2 id="lista-iniciativas-titulo">Todas las iniciativas</h2>
          {iniciativas.length === 0 ? (
            <Vacio
              titulo="Todavía no hay iniciativas"
              salida={{ href: '/decisiones', texto: 'Ver las decisiones' }}
            >
              <p>
                Cuando aparezca el primer resultado aprobado, acá quedará su siguiente paso en
                revisión hasta que pueda ratificarse, junto con la forma de comprobarlo.
              </p>
            </Vacio>
          ) : (
            <ul className="tarjetas">
              {iniciativas.map((iniciativa) => (
                <Tarjeta
                  key={iniciativa.id}
                  titulo={iniciativa.objetivo}
                  enlace={`/iniciativas/${iniciativa.id}`}
                >
                  {/*
                   * Misma lectura bien/atención que ya usa el detalle de esta iniciativa para el
                   * mismo par de estados (`<Aviso tipo="bien">`/`<Aviso tipo="atencion">` en
                   * `iniciativas/[id]/page.tsx`): activa es un resultado logrado, en revisión
                   * todavía pide cuidado porque puede impugnarse.
                   */}
                  <Ficha variante={iniciativa.activa ? 'bien' : 'atencion'}>
                    {iniciativa.activa ? 'Activa' : 'En revisión'}
                  </Ficha>
                  <Meta>
                    {!iniciativa.activa && iniciativa.ratificableEn !== undefined ? (
                      <>
                        Puede ratificarse desde{' '}
                        <time
                          dateTime={new Date(iniciativa.ratificableEn).toISOString()}
                          title={cuando(iniciativa.ratificableEn)}
                        >
                          {fechaCortaEnFrase(iniciativa.ratificableEn)}
                        </time>
                      </>
                    ) : null}
                    <>
                      Volvemos a mirar{' '}
                      <time
                        dateTime={new Date(iniciativa.revisarEn).toISOString()}
                        title={cuando(iniciativa.revisarEn)}
                      >
                        {fechaCortaEnFrase(iniciativa.revisarEn)}
                      </time>
                    </>
                  </Meta>
                </Tarjeta>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
