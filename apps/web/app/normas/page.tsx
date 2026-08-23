'use client';

/**
 * Las reglas del juego.
 *
 * ═══ Lo que esta pantalla NO hace, y por qué ═══
 *
 * No enseña una «versión 1 vigente desde tal fecha». El motor que versiona las reglas —con su
 * decisión fundacional, su caducidad y su diferencia con la anterior— está construido y probado en
 * el dominio, pero **todavía no hay ningún acto fundacional escrito en el historial**: fundarla al
 * vuelo para tener algo que enseñar sería inventar un acto de gobierno que nadie realizó, y esta
 * pantalla es justamente la que no puede permitirse eso. Prefiero un hueco declarado a una garantía
 * fingida.
 *
 * Lo que sí es verdad y sí sale: el **núcleo intangible** —que es lo más importante de esta
 * pantalla y no se reforma por ninguna vía— y **cuánto cuesta cambiar una regla**, los dos leídos
 * del dominio y no de una copia a mano.
 */

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

import type { Normas } from '@koinonia/contracts';

import { Cargando, ErrorVisible } from '../../components/marco';
import { cerrarFrase, cuando, traer } from '../../lib/api';

export default function NormasPantalla(): ReactNode {
  const [normas, setNormas] = useState<Normas | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);

  useEffect(() => {
    traer<Normas>('/normas').then(setNormas).catch(setError);
  }, []);

  return (
    <>
      <h1>Las reglas del juego</h1>

      <ErrorVisible error={error} />
      {normas === undefined && error === undefined && <Cargando que="las reglas" />}

      {normas !== undefined && (
        <>
          <p>{normas.descripcion}</p>

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
                      que la única señal de «esto es irreformable» sea visual. */}
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
            {normas.hayNormas ? (
              <ul className="tarjetas">
                {normas.versiones.map((version) => (
                  <li
                    className={`version${version.vigente ? ' vigente' : ''}`}
                    key={version.version}
                  >
                    <h3>
                      Versión {version.version}
                      {version.vigente && <span className="etiqueta"> Es la que rige hoy</span>}
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
              <div className="vacio" role="status">
                <p>
                  <strong>Todavía no hay ninguna versión aprobada dentro de Koinonía.</strong> Lo
                  que leés arriba son las reglas con las que arranca la plataforma, pero la
                  comunidad no las ha votado todavía como documento propio: no hay una versión 1 con
                  su fecha, su votación y su vencimiento.
                </p>
                <p>
                  Mientras eso no pase, acá no se puede abrir una reforma. Cuando la Asamblea las
                  apruebe, esta lista va a mostrar cada versión, desde cuándo rigió y qué cambió
                  respecto de la anterior, y ninguna se va a poder borrar.
                </p>
                <p>
                  <Link href="/decisiones">Mirá las votaciones abiertas</Link> ·{' '}
                  <Link href="/historial">Ver el historial completo</Link>
                </p>
              </div>
            )}
          </section>

          <section aria-labelledby="reformas-titulo">
            <h2 id="reformas-titulo">Reformas en curso</h2>
            {normas.reformasEnCurso.length === 0 ? (
              <div className="vacio" role="status">
                <p>
                  No hay ninguna reforma en curso. <strong>Es lo normal y lo deseable:</strong> las
                  reglas se cambian pocas veces y despacio.
                </p>
                <p>
                  <Link href="/problemas">Si algo no funciona, escribilo como problema</Link>. Las
                  reformas salen de ahí, no de una idea suelta.
                </p>
              </div>
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
    </>
  );
}
