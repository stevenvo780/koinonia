'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

import {
  ESTADO_PROBLEMA_EN_PALABRAS,
  type EstadoProblema,
  type ProblemaResumen,
} from '@koinonia/contracts';

import { ErrorVisible } from '../../components/marco';
import {
  Esqueleto,
  Ficha,
  Meta,
  Tarjeta,
  Vacio,
  type VarianteFicha,
} from '../../components/piezas';
import { cuando, fechaCortaEnFrase, traer } from '../../lib/api';

/**
 * Qué variante de `<Ficha>` le toca a cada estado del problema. `bien` sólo para el desenlace real
 * (resuelto); `neutra` para lo que ya salió del recorrido sin ese desenlace (archivado, que no es un
 * fracaso, es simplemente que dejó de tramitarse); `en-curso` para todo lo que sigue vivo y sin
 * desenlace todavía, incluido «con-propuesta» —ya avanzó, pero la propuesta puede no prosperar—.
 */
const ESTADO_A_VARIANTE: Readonly<Record<EstadoProblema, VarianteFicha>> = {
  'recogiendo-evidencia': 'en-curso',
  'con-propuesta': 'en-curso',
  resuelto: 'bien',
  archivado: 'neutra',
};

export default function Problemas(): ReactNode {
  const [problemas, setProblemas] = useState<ProblemaResumen[] | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);

  useEffect(() => {
    traer<ProblemaResumen[]>('/problemas').then(setProblemas).catch(setError);
  }, []);

  return (
    <div className="pagina-indice">
      <h1>Problemas</h1>
      <p className="lede">Lo que está mal y todavía no tiene solución propuesta.</p>

      <p>
        <Link className="boton" href="/problemas/nuevo">
          Escribir un problema
        </Link>
      </p>

      <ErrorVisible error={error} />

      {/* El `h2` queda montado incluso durante la carga: si sólo aparece junto con los datos, el
          esqueleto de abajo no anuncia bajo qué título va la lista que está por llegar. */}
      <section aria-labelledby="lista-problemas-titulo">
        <h2 id="lista-problemas-titulo">Problemas abiertos</h2>

        {problemas === undefined && error === undefined && (
          <Esqueleto que="los problemas" cuantos={6} />
        )}

        {problemas !== undefined &&
          (problemas.length === 0 ? (
            <Vacio
              titulo="Nadie ha escrito todavía un problema"
              salida={{ href: '/problemas/nuevo', texto: 'Escribir un problema' }}
            >
              <p>
                El primero que se escriba va a ser el primero del Instituto. Si el tuyo le toca a
                otro grupo, no importa: se reenvía solo y te decimos por qué.
              </p>
            </Vacio>
          ) : (
            <ul className="tarjetas">
              {problemas.map((problema) => (
                <Tarjeta
                  key={problema.id}
                  titulo={problema.titulo}
                  enlace={`/problemas/${problema.id}`}
                >
                  <Ficha variante={ESTADO_A_VARIANTE[problema.estado]}>
                    {ESTADO_PROBLEMA_EN_PALABRAS[problema.estado]}
                  </Ficha>
                  <Meta>
                    {/* Forma corta en la tarjeta: la larga —con hora y minuto— se queda en el
                        detalle, donde la precisión importa. Acá viaja en el `title`. */}
                    <>
                      desde{' '}
                      <time
                        dateTime={new Date(problema.desde).toISOString()}
                        title={cuando(problema.desde)}
                      >
                        {fechaCortaEnFrase(problema.desde)}
                      </time>
                    </>
                    {/* Los trozos en cero se omiten: «a 0 personas más les pasa lo mismo» no dice
                        nada que valga la pena leer, y `<Meta>` descarta los hijos `null`. */}
                    {problema.lesPasaLoMismo > 0
                      ? `a ${String(problema.lesPasaLoMismo)} ${
                          problema.lesPasaLoMismo === 1
                            ? 'persona más le pasa'
                            : 'personas más les pasa'
                        } lo mismo`
                      : null}
                    {problema.aportes > 0
                      ? `${String(problema.aportes)} ${problema.aportes === 1 ? 'aporte' : 'aportes'}`
                      : null}
                    {problema.propuestas > 0
                      ? `${String(problema.propuestas)} ${
                          problema.propuestas === 1 ? 'propuesta' : 'propuestas'
                        }`
                      : null}
                  </Meta>
                </Tarjeta>
              ))}
            </ul>
          ))}
      </section>
    </div>
  );
}
