'use client';

/**
 * Sondeo de consenso: qué afirmaciones reúnen acuerdo en todos los grupos, antes de discutir.
 *
 * ═══ Qué es esto y qué NO es (ADR-0038) ═══
 *
 * Un sondeo **filtra la agenda; nunca decide**. Se responde de acuerdo, en desacuerdo o paso a una
 * afirmación corta por vez, sin poder contestarle a nadie, y la salida no tiene ganador: es qué
 * afirmaciones reúnen apoyo en todos los grupos a la vez —eso pasa a la conversación siguiente— y
 * cuáles dividen —eso se deja fuera del temario—. Esta frase va arriba de todo, antes que cualquier
 * lista, en las dos pantallas de esta función (acá y en `[id]/page.tsx`): un mapa de grupos sin ella
 * se lee como un veredicto sobre las personas, y nunca lo es.
 *
 * ═══ Por qué esta pantalla reemplaza la que había ═══
 *
 * Lo que había acá antes leía `GET /consenso` —un análisis de votaciones ya cerradas, sin ninguna
 * acción— y no es lo que PRODUCT.md §4 promete para la fila «Consenso» de la tabla de pantallas: esa
 * fila describe, palabra por palabra, este mecanismo —«una afirmación corta a la vez con tres
 * botones», «vota ~15 afirmaciones en tres minutos», el estado vacío que exige exactamente doce
 * afirmaciones sembradas y tres contrarias—. `GET /consenso` sigue viva en el servidor —no la tocó
 * nadie— pero no vuelve a llamarse desde ninguna pantalla que yo posea; si en algún momento hace
 * falta un lugar para ese análisis distinto, es una pantalla propia, no esta.
 *
 * ═══ Por qué índice + detalle, y no un salto directo a votar ═══
 *
 * PRODUCT.md describe la acción principal como si al entrar ya hubiera un sondeo abierto esperando.
 * Con varios sondeos pudiendo coexistir —cada uno sobre su propio problema o propuesta— un salto
 * automático tendría que adivinar cuál, así que esta pantalla lista los que hay (el de menos trabajo
 * hecho, primero) y cada tarjeta lleva a su propio «una afirmación a la vez» en `/consenso/[id]`.
 */

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

import type { SondeoResumen } from '@koinonia/contracts';

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

const VARIANTE_POR_ESTADO: Readonly<Record<SondeoResumen['estado'], VarianteFicha>> = {
  sembrando: 'atencion',
  abierto: 'en-curso',
  cerrado: 'neutra',
};

export default function Consenso(): ReactNode {
  const [sondeos, setSondeos] = useState<SondeoResumen[] | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);

  useEffect(() => {
    traer<SondeoResumen[]>('/sondeos').then(setSondeos).catch(setError);
  }, []);

  return (
    <div className="pagina-indice">
      <h1>En qué coincidimos</h1>
      <p className="lede">
        Un sondeo pregunta, afirmación corta por afirmación corta, quién está de acuerdo, en
        desacuerdo o pasa —nunca se le puede responder a nadie—. La salida es qué afirmaciones
        reúnen acuerdo en todos los grupos a la vez y cuáles dividen: eso decide qué entra a la
        conversación siguiente. <strong>El sondeo en sí no aprueba ni rechaza nada.</strong>
      </p>

      <p>
        <Link className="boton" href="/consenso/nuevo">
          Abrir un sondeo
        </Link>
      </p>

      <ErrorVisible error={error} />

      <section aria-labelledby="lista-sondeos-titulo">
        <h2 id="lista-sondeos-titulo">Todos los sondeos</h2>

        {sondeos === undefined && error === undefined && <Esqueleto que="los sondeos" />}

        {sondeos !== undefined &&
          (sondeos.length === 0 ? (
            <Vacio
              titulo="Todavía no hay ningún sondeo"
              salida={{ href: '/consenso/nuevo', texto: 'Abrir un sondeo' }}
            >
              <p>
                No es un hueco, es la regla: un sondeo no puede abrirse a valorar hasta que quien lo
                convoca siembre doce afirmaciones cortas, y al menos tres de ellas tienen que
                contradecir su propia postura. Nadie se salta ese paso, ni siquiera quien lo abre.
              </p>
            </Vacio>
          ) : (
            <ul className="tarjetas">
              {sondeos.map((sondeo) => (
                <Tarjeta
                  key={sondeo.id}
                  titulo={sondeo.asuntoTitulo}
                  enlace={`/consenso/${sondeo.id}`}
                >
                  <Ficha variante={VARIANTE_POR_ESTADO[sondeo.estado]}>
                    {sondeo.estadoEnPalabras}
                  </Ficha>
                  <p>{sondeo.motivo}</p>
                  <Meta>
                    {`${String(sondeo.totalAfirmaciones)} ${
                      sondeo.totalAfirmaciones === 1 ? 'afirmación' : 'afirmaciones'
                    }`}
                    {`${String(sondeo.totalValoraciones)} ${
                      sondeo.totalValoraciones === 1 ? 'valoración' : 'valoraciones'
                    }`}
                    {sondeo.convocaEsMi ? 'Lo convocaste vos' : null}
                  </Meta>
                </Tarjeta>
              ))}
            </ul>
          ))}
      </section>
    </div>
  );
}
