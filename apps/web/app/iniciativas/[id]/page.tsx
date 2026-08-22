'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import type { IniciativaDetalle } from '@koinonia/contracts';

import { Cargando, ErrorVisible } from '../../../components/marco';
import { cuando, traer } from '../../../lib/api';

export default function DetalleIniciativa(): ReactNode {
  const params = useParams<{ id: string }>();
  const [iniciativa, setIniciativa] = useState<IniciativaDetalle | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);

  useEffect(() => {
    traer<IniciativaDetalle>(`/iniciativas/${params.id}`).then(setIniciativa).catch(setError);
  }, [params.id]);

  if (error !== undefined) return <ErrorVisible error={error} />;
  if (iniciativa === undefined) return <Cargando que="la iniciativa" />;

  return (
    <>
      <p className="suave">
        Nace de un{' '}
        <Link href={`/decisiones/${iniciativa.decisionId}/resultado`}>resultado aprobado</Link>.
      </p>
      <h1>El cambio que buscamos</h1>
      <p className="texto destacado">{iniciativa.objetivo}</p>

      <section aria-labelledby="estado-iniciativa-titulo">
        <h2 id="estado-iniciativa-titulo">Estado</h2>
        <div className="aviso atencion" role="note">
          <strong>Por empezar. </strong>
          Aún está en revisión. No implica comenzar trabajo irreversible hasta que el acuerdo quede
          ratificado.
        </div>
      </section>

      <section aria-labelledby="responsable-iniciativa-titulo">
        <h2 id="responsable-iniciativa-titulo">Quién asumió el primer paso</h2>
        <p>
          La persona que escribió la versión aprobada se asumió a sí misma como responsable inicial.
          La plataforma no permite asignárselo a otra persona sin su aceptación.
        </p>
      </section>

      <section aria-labelledby="revision-iniciativa-titulo">
        <h2 id="revision-iniciativa-titulo">Cuándo volvemos a mirar</h2>
        <p>{cuando(iniciativa.revisarEn)}.</p>
      </section>

      <section aria-labelledby="criterios-iniciativa-titulo">
        <h2 id="criterios-iniciativa-titulo">Cómo sabremos si funcionó</h2>
        <ul>
          {iniciativa.criteriosDeExito.map((criterio) => (
            <li key={`${criterio.descripcion}-${criterio.fuenteDeVerificacion}`}>
              <p>{criterio.descripcion}</p>
              <p className="suave">Lo comprobamos en: {criterio.fuenteDeVerificacion}.</p>
            </li>
          ))}
        </ul>
      </section>

      <details>
        <summary>Ver comprobantes relacionados</summary>
        <p className="suave">
          Estos comprobantes permiten revisar que esta iniciativa corresponde a esa decisión y a la
          versión que se consideró. No hace falta entenderlos para participar.
        </p>
        <h2>Comprobante de la decisión</h2>
        <code className="comprobante">{iniciativa.comprobanteDecision}</code>
        <h2>Comprobante de la versión</h2>
        <code className="comprobante">{iniciativa.comprobanteVersion}</code>
      </details>
    </>
  );
}
