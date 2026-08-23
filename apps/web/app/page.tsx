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
import { Medidor, Meta, Tarjeta, Vacio } from '../components/piezas';
import { cerrarFrase, cuando, fechaCortaEnFrase, plazo, traer } from '../lib/api';

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
    <div className="pagina-indice">
      <h1>Koinonía</h1>
      <BarraSesion />

      <p className="lede">
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

      {/* Un esqueleto con la forma real —no una línea suelta— para que el pie de página no quede
          pegado al título mientras la petición está en vuelo, ni todo el contenido se abra de
          golpe cuando responda. */}
      {portada === undefined && error === undefined && (
        <>
          <div className="aviso atencion" aria-hidden="true">
            <div className="esqueleto-linea esqueleto-titulo" />
            <div className="esqueleto-linea" style={{ width: '80%' }} />
          </div>
          <section aria-hidden="true">
            <div
              className="esqueleto-linea esqueleto-titulo"
              style={{ marginTop: 'var(--e6)', width: '40%' }}
            />
            <ul className="tarjetas esqueleto">
              {Array.from({ length: 3 }, (_valor, indice) => (
                <li key={indice}>
                  <div className="esqueleto-linea esqueleto-titulo" />
                  <div className="esqueleto-linea" />
                </li>
              ))}
            </ul>
          </section>
          <div className="solo-lectores">
            <Cargando que="la portada" />
          </div>
        </>
      )}

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
              <Vacio
                titulo="No hay ninguna decisión abierta"
                salida={{ href: '/problemas', texto: 'Ver los problemas' }}
              >
                <p>
                  <strong>Así debe ser la mayoría del tiempo:</strong> si hay más de tres por
                  semana, algo está mal en cómo estamos decidiendo.
                </p>
              </Vacio>
            ) : (
              <ul className="tarjetas">
                {portada.decisionesAbiertas.map((decision) => (
                  <Tarjeta
                    key={decision.id}
                    titulo={decision.titulo}
                    enlace={`/decisiones/${decision.id}`}
                  >
                    <Meta>{plazo(decision.cierraEn)}</Meta>
                    <Medidor
                      etiqueta="Se manifestaron"
                      valor={decision.seManifestaron}
                      total={decision.podianDecidir}
                    />
                  </Tarjeta>
                ))}
              </ul>
            )}
          </section>

          {portada.ultimasCerradas.length > 0 && (
            <section aria-labelledby="cerradas-titulo">
              <h2 id="cerradas-titulo">Últimas cerradas</h2>
              <ul className="tarjetas">
                {portada.ultimasCerradas.map((decision) => (
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
    </div>
  );
}
