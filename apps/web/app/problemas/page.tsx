'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

import type { ProblemaResumen } from '@koinonia/contracts';

import { Cargando, ErrorVisible } from '../../components/marco';
import { cuando, traer } from '../../lib/api';

const ESTADO_EN_PALABRAS: Readonly<Record<string, string>> = {
  'recogiendo-evidencia': 'Recogiendo evidencia',
  'con-propuesta': 'Ya tiene propuesta',
  resuelto: 'Resuelto',
  archivado: 'Archivado',
};

export default function Problemas(): ReactNode {
  const [problemas, setProblemas] = useState<ProblemaResumen[] | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);

  useEffect(() => {
    traer<ProblemaResumen[]>('/problemas').then(setProblemas).catch(setError);
  }, []);

  return (
    <>
      <h1>Problemas</h1>
      <p>Lo que está mal y todavía no tiene solución propuesta.</p>

      <p>
        <Link className="boton" href="/problemas/nuevo">
          Escribir un problema
        </Link>
      </p>

      <ErrorVisible error={error} />
      {problemas === undefined && error === undefined && <Cargando que="los problemas" />}

      {problemas?.length === 0 && (
        <div className="vacio">
          <h2>Nadie ha escrito todavía un problema</h2>
          <p>
            El primero que se escriba va a ser el primero del Instituto. Si el tuyo le toca a otro
            grupo, no importa: se reenvía solo y te decimos por qué.
          </p>
        </div>
      )}

      {problemas !== undefined && problemas.length > 0 && (
        <ul className="tarjetas">
          {problemas.map((problema) => (
            <li key={problema.id}>
              <h2>
                <Link href={`/problemas/${problema.id}`}>{problema.titulo}</Link>
              </h2>
              <p>
                <span className="etiqueta">
                  {ESTADO_EN_PALABRAS[problema.estado] ?? problema.estado}
                </span>{' '}
                <span className="suave">desde el {cuando(problema.desde)}</span>
              </p>
              <p className="suave">
                A {problema.lesPasaLoMismo}{' '}
                {problema.lesPasaLoMismo === 1 ? 'persona más le pasa' : 'personas más les pasa'} lo
                mismo · {problema.aportes} {problema.aportes === 1 ? 'aporte' : 'aportes'} ·{' '}
                {problema.propuestas} {problema.propuestas === 1 ? 'propuesta' : 'propuestas'}
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
