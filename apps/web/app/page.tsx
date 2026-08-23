'use client';

/**
 * Inicio.
 *
 * ═══ El estado vacío ═══
 *
 * Es la pantalla más importante del producto y la que todos olvidan: es lo único que ve la comunidad
 * el primer día. Por eso aquí **no hay un tablero de ceros**. «0 problemas · 0 propuestas · 0
 * decisiones» comunica fracaso el día uno, y la gente que se va el día uno no vuelve el día dos.
 * En su lugar: el botón, una frase que dice que ser el primero es el punto, y tres ejemplos escritos
 * a mano para que nadie tenga que inventarse el formato de un problema desde cero.
 */

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

import type { Portada } from '@koinonia/contracts';

import { BarraSesion, Cargando, ErrorVisible } from '../components/marco';
import { cerrarFrase, cuando, plazo, traer } from '../lib/api';

const EJEMPLOS: readonly string[] = [
  'La sala de estudio cierra a las 6 y los de la nocturna no tenemos dónde leer.',
  'Los de primer semestre no sabemos qué leer ni en qué orden, y los PDF circulan por WhatsApp sin criterio.',
  'Se decidió hacer una carta hace cuatro meses y nadie sabe si se escribió.',
];

export default function Inicio(): ReactNode {
  const [portada, setPortada] = useState<Portada | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);

  useEffect(() => {
    traer<Portada>('/portada').then(setPortada).catch(setError);
  }, []);

  return (
    <>
      <h1>Koinonía</h1>
      <BarraSesion />

      <p>
        Acá se escribe lo que está mal, se discute con plazo y se decide dejando constancia que
        cualquiera puede comprobar. No hay muro, no hay seguidores y no hay nadie decidiendo qué
        ves.
      </p>

      <p>
        <Link className="boton grande" href="/problemas/nuevo">
          Tengo un problema o una idea
        </Link>
      </p>

      <ErrorVisible error={error} />
      {portada === undefined && error === undefined && <Cargando que="la portada" />}

      {portada?.primerDia === true && (
        <section className="vacio" aria-labelledby="vacio-titulo">
          <h2 id="vacio-titulo">Todavía no hay nada acá</h2>
          <p>
            Lo primero que se escriba va a ser el primer problema del Instituto. No hace falta que
            esté bien redactado ni que traigas la solución: para eso está el resto.
          </p>
          <p>Tres ejemplos, por si ayuda a arrancar:</p>
          <ul>
            {EJEMPLOS.map((ejemplo) => (
              <li key={ejemplo}>«{ejemplo}»</li>
            ))}
          </ul>
        </section>
      )}

      {portada !== undefined && !portada.primerDia && (
        <>
          {portada.loQueTeToca !== undefined && (
            <section aria-labelledby="toca-titulo">
              <h2 id="toca-titulo">Lo que te toca a vos</h2>
              <div className="aviso atencion" role="status">
                <p>
                  <strong>{portada.loQueTeToca.que}</strong>
                </p>
                {portada.loQueTeToca.cierraEn !== undefined && (
                  <p>
                    {plazo(portada.loQueTeToca.cierraEn)} —{' '}
                    {cerrarFrase(cuando(portada.loQueTeToca.cierraEn))}
                  </p>
                )}
                <p>
                  <Link className="boton accion" href={portada.loQueTeToca.enlace}>
                    Ir a responder
                  </Link>
                </p>
              </div>
              <p className="suave">
                Una sola cosa a la vez. Si hubiera más, te avisamos de la que cierra primero.
              </p>
            </section>
          )}

          <section aria-labelledby="abiertas-titulo">
            <h2 id="abiertas-titulo">Decisiones abiertas</h2>
            {portada.decisionesAbiertas.length === 0 ? (
              <div className="vacio">
                <p>
                  No hay ninguna decisión abierta.{' '}
                  <strong>Así debe ser la mayoría del tiempo:</strong> si hay más de tres por
                  semana, algo está mal en cómo estamos decidiendo.
                </p>
              </div>
            ) : (
              <ul className="tarjetas">
                {portada.decisionesAbiertas.map((decision) => (
                  <li key={decision.id}>
                    <h3>
                      <Link href={`/decisiones/${decision.id}`}>{decision.titulo}</Link>
                    </h3>
                    <p className="suave">
                      {plazo(decision.cierraEn)} · se manifestaron {decision.seManifestaron} de{' '}
                      {decision.podianDecidir}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {portada.ultimasCerradas.length > 0 && (
            <section aria-labelledby="cerradas-titulo">
              <h2 id="cerradas-titulo">Últimas cerradas</h2>
              <ul className="tarjetas">
                {portada.ultimasCerradas.map((decision) => (
                  <li key={decision.id}>
                    <h3>
                      <Link href={`/decisiones/${decision.id}/resultado`}>{decision.titulo}</Link>
                    </h3>
                    <p className="suave">{cuando(decision.cierraEn)}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {portada.iniciativasActivas > 0 && (
            <section aria-labelledby="iniciativas-titulo">
              <h2 id="iniciativas-titulo">Cambios por seguir</h2>
              <p>
                Hay {portada.iniciativasActivas}{' '}
                {portada.iniciativasActivas === 1
                  ? 'iniciativa por revisar'
                  : 'iniciativas por revisar'}
                . <Link href="/iniciativas">Ver los acuerdos y cómo se comprobarán</Link>.
              </p>
            </section>
          )}

          <p>
            Hay {portada.problemas}{' '}
            {portada.problemas === 1 ? 'problema escrito' : 'problemas escritos'} y{' '}
            {portada.propuestas} {portada.propuestas === 1 ? 'propuesta' : 'propuestas'}.{' '}
            <Link href="/problemas">Verlos todos</Link>.
          </p>
        </>
      )}
    </>
  );
}
