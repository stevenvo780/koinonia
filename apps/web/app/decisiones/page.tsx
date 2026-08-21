'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

import type { DecisionResumen } from '@koinonia/contracts';

import { Cargando, ErrorVisible } from '../../components/marco';
import { cuando, plazo, traer } from '../../lib/api';

export default function Decisiones(): ReactNode {
  const [decisiones, setDecisiones] = useState<DecisionResumen[] | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);

  useEffect(() => {
    traer<DecisionResumen[]>('/decisiones').then(setDecisiones).catch(setError);
  }, []);

  const abiertas = decisiones?.filter((d) => d.estado === 'Open') ?? [];
  const cerradas = decisiones?.filter((d) => d.estado !== 'Open' && d.estado !== 'Draft') ?? [];

  return (
    <>
      <h1>Decisiones</h1>
      <p>
        Abrir una votación es el acto más caro del sistema, no el más barato: exige que antes haya
        habido discusión y evidencia.
      </p>

      <ErrorVisible error={error} />
      {decisiones === undefined && error === undefined && <Cargando que="las decisiones" />}

      <section aria-labelledby="abiertas-titulo">
        <h2 id="abiertas-titulo">Abiertas</h2>
        {decisiones !== undefined && abiertas.length === 0 ? (
          <div className="vacio">
            <p>
              No hay ninguna decisión abierta. <strong>Así debe ser la mayoría del tiempo:</strong>{' '}
              si hay más de tres por semana, algo está mal en cómo estamos decidiendo.
            </p>
          </div>
        ) : (
          <ul className="tarjetas">
            {abiertas.map((decision) => (
              <li key={decision.id}>
                <h3>
                  <Link href={`/decisiones/${decision.id}`}>{decision.titulo}</Link>
                </h3>
                <p className="suave">
                  {plazo(decision.cierraEn)} · se manifestaron {decision.seManifestaron} de{' '}
                  {decision.podianDecidir}
                </p>
                <p>{decision.queHaceFaltaParaQuePase}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {cerradas.length > 0 && (
        <section aria-labelledby="cerradas-titulo">
          <h2 id="cerradas-titulo">Cerradas</h2>
          <ul className="tarjetas">
            {cerradas.map((decision) => (
              <li key={decision.id}>
                <h3>
                  <Link href={`/decisiones/${decision.id}/resultado`}>{decision.titulo}</Link>
                </h3>
                <p className="suave">Cerró el {cuando(decision.cierraEn)}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
