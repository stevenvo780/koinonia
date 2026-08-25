'use client';

/**
 * Las reglas del juego.
 *
 * ═══ Lo que esta pantalla NO hace, y por qué ═══
 *
 * No inventa una «versión 1 vigente desde tal fecha» mientras nadie la fundó. El motor que
 * versiona las reglas —con su decisión fundacional, su caducidad y su diferencia con la anterior—
 * está construido y probado en el dominio, y ahora esta pantalla ofrece el camino para escribir
 * ese acto: `/normas/fundar`, sólo para quien cuida el procedimiento o las garantías. Mientras
 * nadie lo use, acá no se finge que ya existe: fundarla al vuelo para tener algo que enseñar sería
 * inventar un acto de gobierno que nadie realizó.
 *
 * Lo que sí es verdad y sí sale desde el primer día: el **núcleo intangible** —que es lo más
 * importante de esta pantalla y no se reforma por ninguna vía— y **cuánto cuesta cambiar una
 * regla**, los dos leídos del dominio y no de una copia a mano.
 */

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

import type { Normas } from '@koinonia/contracts';

import { Cargando, ErrorVisible, useSesion } from '../../components/marco';
import { Ficha, Vacio } from '../../components/piezas';
import { cerrarFrase, cuando, traer } from '../../lib/api';

export default function NormasPantalla(): ReactNode {
  const [normas, setNormas] = useState<Normas | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const { sesion } = useSesion();
  // Quién puede fundar o refundar (`constitution:found` en `access.ts`: facilitación o
  // Garantías, nunca `tech-admin`). Sólo decide qué CTA mostrar; el servidor vuelve a exigirlo.
  const puedeFundar =
    sesion?.roles.includes('facilitator') === true || sesion?.roles.includes('guarantees') === true;

  useEffect(() => {
    traer<Normas>('/normas').then(setNormas).catch(setError);
  }, []);

  return (
    <div className="pagina-prosa">
      <h1>Las reglas del juego</h1>

      <ErrorVisible error={error} />

      {/* Esta pantalla es la que más crece al llegar los datos (núcleo, vías de reforma y todas
          las versiones): un esqueleto de una sola línea dejaba el pie de página pegado al título
          mientras cargaba, y todo el resto aparecía de golpe. Acá se reserva la forma de las tres
          secciones que van a aparecer. */}
      {normas === undefined && error === undefined && (
        <>
          <div aria-hidden="true">
            <div className="esqueleto-linea" style={{ width: '90%' }} />
            <div className="esqueleto-linea" style={{ width: '70%' }} />

            <div
              className="esqueleto-linea esqueleto-titulo"
              style={{ marginTop: 'var(--e6)', width: '45%' }}
            />
            <div className="aviso atencion">
              <div className="esqueleto-linea" style={{ width: '80%' }} />
            </div>
            {Array.from({ length: 4 }, (_valor, indice) => (
              <div key={indice} style={{ marginTop: 'var(--e4)' }}>
                <div className="esqueleto-linea esqueleto-titulo" style={{ width: '35%' }} />
                <div className="esqueleto-linea" />
              </div>
            ))}

            <div
              className="esqueleto-linea esqueleto-titulo"
              style={{ marginTop: 'var(--e6)', width: '45%' }}
            />
            {Array.from({ length: 2 }, (_valor, indice) => (
              <div key={indice} style={{ marginTop: 'var(--e4)' }}>
                <div className="esqueleto-linea esqueleto-titulo" style={{ width: '30%' }} />
                <div className="esqueleto-linea" />
              </div>
            ))}

            <div
              className="esqueleto-linea esqueleto-titulo"
              style={{ marginTop: 'var(--e6)', width: '45%' }}
            />
            <ul className="tarjetas esqueleto">
              {Array.from({ length: 3 }, (_valor, indice) => (
                <li key={indice}>
                  <div className="esqueleto-linea esqueleto-titulo" />
                  <div className="esqueleto-linea" />
                </li>
              ))}
            </ul>
          </div>

          <div className="solo-lectores">
            <Cargando que="las reglas" />
          </div>
        </>
      )}

      {normas !== undefined && (
        <>
          <p className="lede">{normas.descripcion}</p>

          {/*
            El núcleo va PRIMERO y no al final. Es lo que la gente necesita saber antes que nada:
            hay seis cosas que ninguna mayoría puede quitarle, y saberlo cambia cómo se lee todo lo
            demás. Enterrarlo debajo del procedimiento de reforma sería enterrar la garantía debajo
            del trámite.
          */}
          <section aria-labelledby="nucleo-titulo">
            <h2 id="nucleo-titulo">{normas.nucleo.titulo}</h2>
            <div className="aviso atencion" role="note">
              <strong>
                <span aria-hidden="true">! </span>No se puede reformar:{' '}
              </strong>
              {normas.nucleo.explicacion}
            </div>
            <ol>
              {normas.nucleo.reglas.map((regla) => (
                <li key={regla.id}>
                  <h3>{regla.titulo}</h3>
                  <p>{regla.texto}</p>
                  {/* En palabras y no sólo con un borde de color: el criterio 1.4.1 no admite
                      que la única señal de «esto es irreformable» sea visual.
                      `.etiqueta` y no `<Ficha>`: esto no es un estado que cambia con el tiempo
                      —como «Cerrada» o «Te toca»—, es una clasificación permanente de la regla,
                      y esa es justo la distinción que documenta `.etiqueta` en globals.css. */}
                  <p className="etiqueta">No se puede cambiar por ninguna vía</p>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="cambiar-titulo">
            <h2 id="cambiar-titulo">Qué cuesta cambiar una regla</h2>
            <p>
              Todo lo demás sí se puede cambiar, y a propósito no es fácil ni rápido. Quien
              administra la plataforma no puede tocarlo por ningún camino: puede desplegar y hacer
              copias, no gobernar.
            </p>
            {normas.vias.map((via) => (
              <article className="tarjeta-trabajo" key={via.nombre}>
                <h3>{via.nombre}</h3>
                <p>{via.paraQue}</p>
                <ul>
                  {via.requisitos.map((requisito) => (
                    <li key={requisito}>{requisito}</li>
                  ))}
                </ul>
              </article>
            ))}
          </section>

          <section aria-labelledby="versiones-titulo">
            <h2 id="versiones-titulo">Cada versión y qué cambió</h2>
            {normas.hayNormas &&
              // Aparece también cuando las reglas caducaron (`versionVigente === 0` con
              // `hayNormas === true`): la lista de abajo sigue mostrando la última versión, con
              // fecha de vencimiento, pero ninguna rige. `normas.descripcion` ya dice la caducidad
              // en palabras (viene del aviso del dominio); acá sólo va la salida.
              normas.versionVigente === 0 && (
                <div className="aviso atencion" role="note">
                  <strong>
                    <span aria-hidden="true">! </span>Sin reglas vigentes:{' '}
                  </strong>
                  Nadie queda gobernado por reglas que nadie volvió a aprobar. Mientras esto siga
                  así, sólo se puede leer y exportar la historia: no se puede reformar, votar ni
                  ratificar nada.{' '}
                  {puedeFundar ? (
                    <Link href="/normas/fundar">Refundarlas con una asamblea nueva</Link>
                  ) : (
                    'Refundarlas es un acto de quien cuida el procedimiento o las garantías, con ' +
                    'los números de esa asamblea.'
                  )}
                </div>
              )}
            {normas.hayNormas ? (
              <ul className="tarjetas">
                {normas.versiones.map((version) => (
                  <li
                    className={`version${version.vigente ? ' vigente' : ''}`}
                    key={version.version}
                  >
                    <h3>
                      Versión {version.version}
                      {version.vigente && (
                        <>
                          {' '}
                          <Ficha variante="en-curso">Es la que rige hoy</Ficha>
                        </>
                      )}
                    </h3>
                    <p className="suave">
                      Rige desde el {cerrarFrase(cuando(version.rigeDesde))} y vence el{' '}
                      {cerrarFrase(cuando(version.caduca))}
                    </p>
                    <ul>
                      {version.reglas.map((regla) => (
                        <li key={regla.id}>{regla.titulo}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            ) : (
              // Estado vacío diseñado, y honesto sobre por qué está vacío. Sin esto, la pantalla
              // insinuaría que las reglas de arriba están fijadas y fechadas dentro de la
              // plataforma, y no lo están todavía.
              <Vacio
                titulo="Todavía no hay ninguna versión aprobada dentro de Koinonía"
                salida={
                  puedeFundar
                    ? { href: '/normas/fundar', texto: 'Fundar la primera versión' }
                    : { href: '/decisiones', texto: 'Mirá las votaciones abiertas' }
                }
              >
                <p>
                  Lo que leés arriba son las reglas con las que arranca la plataforma, pero la
                  comunidad no las ha votado todavía como documento propio: no hay una versión 1 con
                  su fecha, su votación y su vencimiento.
                </p>
                <p>
                  Mientras eso no pase, acá no se puede abrir una reforma.{' '}
                  {puedeFundar
                    ? 'Fundarla registra el acto de la asamblea que ya pasó: el censo, los votos y ' +
                      'desde cuándo rige, para que cualquiera los contraste con el acta.'
                    : 'Fundarla es un acto de quien cuida el procedimiento o las garantías, con ' +
                      'los números de esa asamblea.'}{' '}
                  Cuando exista, esta lista va a mostrar cada versión, desde cuándo rigió y qué
                  cambió respecto de la anterior, y ninguna se va a poder borrar.
                </p>
                <p>
                  <Link href="/historial">Ver el historial completo</Link>
                </p>
              </Vacio>
            )}
          </section>

          <section aria-labelledby="reformas-titulo">
            <h2 id="reformas-titulo">Reformas en curso</h2>
            {normas.reformasEnCurso.length === 0 ? (
              <Vacio
                titulo="No hay ninguna reforma en curso"
                salida={{
                  href: '/problemas',
                  texto: 'Si algo no funciona, escribilo como problema',
                }}
              >
                <p>
                  <strong>Es lo normal y lo deseable:</strong> las reglas se cambian pocas veces y
                  despacio.
                </p>
                <p>Las reformas salen de ahí, no de una idea suelta.</p>
              </Vacio>
            ) : (
              <ul className="tarjetas">
                {normas.reformasEnCurso.map((reforma) => (
                  <li key={reforma.titulo}>
                    <h3>{reforma.titulo}</h3>
                    <p>{reforma.estado}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
