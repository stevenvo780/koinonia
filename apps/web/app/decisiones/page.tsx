'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

import type { DecisionResumen } from '@koinonia/contracts';

import { ErrorVisible, useSesion } from '../../components/marco';
import { Esqueleto, Medidor, Meta, Tarjeta, Vacio } from '../../components/piezas';
import { cuando, fechaCortaEnFrase, plazo, traer } from '../../lib/api';
import { nombreDelMetodo } from './metodos-en-palabras';

export default function Decisiones(): ReactNode {
  const { sesion } = useSesion();
  const [decisiones, setDecisiones] = useState<DecisionResumen[] | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);

  useEffect(() => {
    traer<DecisionResumen[]>('/decisiones').then(setDecisiones).catch(setError);
  }, []);

  const abiertas = decisiones?.filter((d) => d.estado === 'Open') ?? [];
  const cerradas = decisiones?.filter((d) => d.estado !== 'Open' && d.estado !== 'Draft') ?? [];

  return (
    <div className="pagina-indice">
      <h1>Decisiones</h1>
      <p>
        Abrir una votación es el acto más caro del sistema, no el más barato: exige que antes haya
        habido discusión y evidencia.
      </p>

      {/*
       * La entrada a abrir una votación vivía sólo dentro de `/propuestas/{id}`, y con dos reglas
       * escritas a mano en un desplegable. Acá está la puerta, y detrás están las nueve reglas con
       * la explicación de en qué caso conviene cada una.
       */}
      {sesion?.roles.includes('facilitator') === true && (
        <p>
          <Link className="boton" href="/decisiones/abrir">
            Abrir una votación
          </Link>
        </p>
      )}

      <ErrorVisible error={error} />
      {decisiones === undefined && error === undefined && <Esqueleto que="las decisiones" />}

      <section aria-labelledby="abiertas-titulo">
        <h2 id="abiertas-titulo">Abiertas</h2>
        {decisiones !== undefined && abiertas.length === 0 ? (
          <Vacio
            titulo="No hay ninguna decisión abierta"
            salida={{ href: '/problemas', texto: 'Ver los problemas' }}
          >
            <p>
              <strong>Así debe ser la mayoría del tiempo:</strong> si hay más de tres por semana,
              algo está mal en cómo estamos decidiendo.
            </p>
            <p>
              Lo que se decide sale de un problema y de una propuesta escrita antes, o de{' '}
              <Link href="/deliberaciones">las conversaciones en curso</Link>.
            </p>
          </Vacio>
        ) : (
          <ul className="tarjetas">
            {abiertas.map((decision) => (
              <Tarjeta
                key={decision.id}
                titulo={decision.titulo}
                enlace={`/decisiones/${decision.id}`}
              >
                {/*
                 * Con qué regla se decide, en la tarjeta. Antes sólo estaba la frase larga de
                 * «qué hace falta»; el nombre de la regla es lo que permite reconocer de un
                 * vistazo que dos votaciones abiertas no se cuentan igual.
                 */}
                <Meta>
                  {plazo(decision.cierraEn)}
                  {nombreDelMetodo(decision.metodo)}
                </Meta>
                <Medidor
                  etiqueta="Se manifestaron"
                  valor={decision.seManifestaron}
                  total={decision.podianDecidir}
                />
                <p>{decision.queHaceFaltaParaQuePase}</p>
              </Tarjeta>
            ))}
          </ul>
        )}
      </section>

      {cerradas.length > 0 && (
        <section aria-labelledby="cerradas-titulo">
          <h2 id="cerradas-titulo">Cerradas</h2>
          <ul className="tarjetas">
            {cerradas.map((decision) => (
              <Tarjeta
                key={decision.id}
                titulo={decision.titulo}
                enlace={`/decisiones/${decision.id}/resultado`}
              >
                <Meta>
                  <time
                    dateTime={new Date(decision.cierraEn).toISOString()}
                    title={cuando(decision.cierraEn)}
                  >
                    Cerró {fechaCortaEnFrase(decision.cierraEn)}
                  </time>
                </Meta>
              </Tarjeta>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
