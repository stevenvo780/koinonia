'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

import type { PropuestaResumen } from '@koinonia/contracts';

import { ErrorVisible } from '../../components/marco';
import {
  Esqueleto,
  Ficha,
  Meta,
  Tarjeta,
  Vacio,
  type VarianteFicha,
} from '../../components/piezas';
import { traer } from '../../lib/api';

/**
 * Índice de propuestas.
 *
 * `GET /propuestas` (`services/api/src/http/app.ts`) devuelve `PropuestaResumen[]`, no
 * `PropuestaDetalle[]`: cada fila trae `problemaId` pero no el título del problema —eso sólo llega
 * con el detalle, en `/propuestas/:id`, junto con `problemaTitulo`—. Pedirlo acá por cada tarjeta
 * sería un N+1 sobre una pantalla que puede listar decenas de propuestas a la vez, así que esta
 * lista no repite «Responde a: …» como sí hace el detalle (PRODUCT §4 lo pide ahí, donde el costo es
 * un único fetch); acá el nombre de la propuesta y su estado alcanzan para decidir en cuál entrar, y
 * el problema de origen se lee un clic después.
 *
 * `PropuestaResumen.decisiones` es la misma señal que ya usa `/propuestas/[id]`
 * (`hayVotacion = propuesta.decisiones.length > 0`) para decidir entre «En votación» y «Sin votación
 * abierta»: se repite acá la misma frase, para que abrir la tarjeta no cambie el vocabulario.
 */
const ESTADO_A_VARIANTE: Readonly<Record<'en-votacion' | 'sin-votacion', VarianteFicha>> = {
  'en-votacion': 'en-curso',
  'sin-votacion': 'neutra',
};

export default function Propuestas(): ReactNode {
  const [propuestas, setPropuestas] = useState<PropuestaResumen[] | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);

  useEffect(() => {
    traer<PropuestaResumen[]>('/propuestas').then(setPropuestas).catch(setError);
  }, []);

  return (
    <div className="pagina-indice">
      <h1>Propuestas</h1>
      <p className="lede">
        Textos concretos que responden a un problema, con su historial de versiones.
      </p>

      <p>
        <Link className="boton" href="/propuestas/nueva">
          Escribir una propuesta
        </Link>
      </p>

      <ErrorVisible error={error} />

      {/* El `h2` queda montado incluso durante la carga, igual que en `/problemas`: si sólo
          aparece junto con los datos, el esqueleto de abajo no anuncia bajo qué título va la lista
          que está por llegar. */}
      <section aria-labelledby="lista-propuestas-titulo">
        <h2 id="lista-propuestas-titulo">Todas las propuestas</h2>

        {propuestas === undefined && error === undefined && (
          <Esqueleto que="las propuestas" cuantos={6} />
        )}

        {propuestas !== undefined &&
          (propuestas.length === 0 ? (
            <Vacio
              titulo="Todavía no hay ninguna propuesta escrita"
              salida={{ href: '/problemas', texto: 'Ver los problemas' }}
            >
              <p>
                Toda propuesta responde a un problema. Elegí uno de la lista y, si ya tiene
                evidencia y conversación, convertilo en un texto concreto.
              </p>
            </Vacio>
          ) : (
            <ul className="tarjetas">
              {propuestas.map((propuesta) => {
                const enVotacion = propuesta.decisiones.length > 0;
                return (
                  <Tarjeta
                    key={propuesta.id}
                    titulo={propuesta.titulo}
                    enlace={`/propuestas/${propuesta.id}`}
                  >
                    <Ficha
                      variante={ESTADO_A_VARIANTE[enVotacion ? 'en-votacion' : 'sin-votacion']}
                    >
                      {enVotacion ? 'En votación' : 'Sin votación abierta'}
                    </Ficha>
                    <Meta>
                      {`Versión ${String(propuesta.versionVigente)}`}
                      {propuesta.esMia ? 'Es tuya' : null}
                    </Meta>
                  </Tarjeta>
                );
              })}
            </ul>
          ))}
      </section>
    </div>
  );
}
