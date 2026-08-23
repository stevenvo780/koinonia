'use client';

/**
 * Quién decide qué.
 *
 * La pregunta que hunde a cualquier organización horizontal es «¿esto quién lo decide?», y la
 * respuesta no puede estar detrás de un enlace: va en la misma tarjeta que el nombre. Por eso
 * `decideSinConsultar` se pinta siempre y no en un desplegable.
 */

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

import type { Circulo, Sesion } from '@koinonia/contracts';

import { Cargando, ErrorVisible, useSesion } from '../../components/marco';
import { traer } from '../../lib/api';

/**
 * Si esta persona pertenece al grupo. Sólo decide qué se OFRECE; el permiso lo decide la API.
 *
 * Devuelve `undefined` cuando todavía no sabemos —la sesión está cargando— para no afirmar una
 * pertenencia que aún no se consultó. Pintar «No estás en este grupo» mientras `/auth/yo` no
 * contestó sería un destello: cada tarjeta mentiría por un instante con la misma mentira.
 */
function pertenece(sesion: Sesion | undefined, circulo: Circulo): boolean | undefined {
  return sesion?.circulos.includes(circulo.id);
}

export default function Circulos(): ReactNode {
  const [circulos, setCirculos] = useState<Circulo[] | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const { sesion } = useSesion();

  useEffect(() => {
    traer<Circulo[]>('/circulos').then(setCirculos).catch(setError);
  }, []);

  return (
    <>
      <h1>Quién decide qué</h1>
      <p>
        Koinonía no es una asamblea permanente. Hay grupos con asuntos propios, y cada uno decide lo
        suyo <strong>sin pedirle permiso a nadie</strong>. Lo que no le corresponde a ninguno, lo
        decide la Asamblea.
      </p>

      <ErrorVisible error={error} />
      {circulos === undefined && error === undefined && <Cargando que="los grupos" />}

      {circulos !== undefined && circulos.length === 0 && (
        <div className="vacio" role="status">
          <p>
            Todavía no hay ningún grupo definido. Mientras tanto, todo lo decide la Asamblea
            completa.
          </p>
          <p>
            <Link href="/problemas">Mirá los problemas abiertos</Link> o{' '}
            <Link href="/normas">leé las reglas del juego</Link>.
          </p>
        </div>
      )}

      {circulos !== undefined && circulos.length > 0 && (
        <ul className="tarjetas">
          {circulos.map((circulo) => (
            <li key={circulo.id}>
              <h2>
                {/*
                 * `prefetch={false}` porque esta lista crece con los grupos y la precarga no: por
                 * defecto, Next se descarga en segundo plano el detalle de **cada** tarjeta que
                 * entre en la pantalla, y de esas se abre una. Quien lee esto desde el bus paga por
                 * megabyte las que no abrió, y al salir de la página las que iban a medias se
                 * cancelan y quedan escritas en la consola como peticiones abortadas. El enlace
                 * sigue navegando igual; lo único que cambia es que el detalle se pide cuando se
                 * pulsa.
                 */}
                <Link href={`/circulos/${circulo.id}`} prefetch={false}>
                  {circulo.nombre}
                </Link>
              </h2>
              <p>
                <strong>Decide sin consultar a nadie:</strong> {circulo.decideSinConsultar}
              </p>
              <p className="suave">
                {(() => {
                  const soy = pertenece(sesion, circulo);
                  if (soy === undefined) return 'Todavía no sé si estás en este grupo.';
                  if (soy) return 'Estás en este grupo.';
                  return 'No estás en este grupo, así que no podés ver quiénes lo integran.';
                })()}
              </p>
            </li>
          ))}
        </ul>
      )}

      <section aria-labelledby="limites-titulo">
        <h2 id="limites-titulo">Lo que ningún grupo puede hacer</h2>
        <p>
          Ninguno puede decidir sobre lo que le toca a otro, ni cambiar{' '}
          <Link href="/normas">las reglas del juego</Link>, que se reforman por un procedimiento
          aparte y más lento. Y quien administra la plataforma no decide nada de esto: puede
          desplegar y hacer copias, no gobernar.
        </p>
      </section>
    </>
  );
}
