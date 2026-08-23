'use client';

/**
 * Prestarle tu voto a alguien, y recuperarlo.
 *
 * Tres cosas mandan en esta pantalla:
 *
 *  1. **Qué lo deshace se dice ANTES, no después.** El fallo típico de la democracia líquida es que
 *     alguien presta su voto, vota igualmente, y no entiende por qué su delegado no votó por él.
 *     Votar directo gana siempre (INV-23), así que eso va arriba y en la tarjeta, no en una ayuda.
 *  2. **Recuperarlo es un toque.** Un botón, sin diálogo de confirmación y sin pasos: si prestarlo
 *     cuesta un toque, recuperarlo no puede costar tres. Y tiene efecto en el momento.
 *  3. **La concentración se ve.** Cuántas personas cargan votos ajenos y cuánto junta quien más
 *     junta, en números enteros y en una frase. Nunca el nombre de un índice (ADR-0041).
 */

import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode, type SyntheticEvent } from 'react';

import type { DelegacionesDeDecision, PanelDeDelegaciones } from '@koinonia/contracts';

import { Aviso, Cargando, ErrorVisible, useSesion } from '../../components/marco';
import { useAccionUnica } from '../../lib/acciones';
import { cerrarFrase, cuando, enviar, plazo, traer } from '../../lib/api';

function Reparto({ votacion }: { readonly votacion: DelegacionesDeDecision }): ReactNode {
  const { reparto } = votacion;
  return (
    <section aria-labelledby={`reparto-${votacion.decisionId}`}>
      <h4 id={`reparto-${votacion.decisionId}`}>Qué tan repartida está la voz</h4>
      <p>{reparto.comoEsta}</p>
      {/* Lista de definición y no una barra: los números tienen que poder leerse uno a uno. */}
      <dl className="datos-trabajo">
        <div>
          <dt>Votos prestados</dt>
          <dd>{reparto.prestaron}</dd>
        </div>
        <div>
          <dt>Personas que cargan votos ajenos</dt>
          <dd>{reparto.cargan}</dd>
        </div>
        <div>
          <dt>Quien más junta</dt>
          <dd>
            {reparto.maximo} de un tope de {reparto.tope}
          </dd>
        </div>
      </dl>
      {reparto.devueltos > 0 && (
        <Aviso tipo="atencion" titulo="Se devolvieron votos">
          {reparto.devueltos} {reparto.devueltos === 1 ? 'préstamo volvió' : 'préstamos volvieron'}{' '}
          a quien lo hizo porque quien lo recibía ya estaba en el tope. Quien lo prestó tiene que
          votar por su cuenta si quiere que cuente.
        </Aviso>
      )}
    </section>
  );
}

export default function Delegaciones(): ReactNode {
  const { sesion, cargando: cargandoSesion } = useSesion();
  const [panel, setPanel] = useState<PanelDeDelegaciones | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const [errorAccion, setErrorAccion] = useState<{ id: string; fallo: unknown } | undefined>(
    undefined,
  );
  const [hecho, setHecho] = useState<string | undefined>(undefined);
  const [elegido, setElegido] = useState<Record<string, string>>({});
  const { enCurso, ejecutar } = useAccionUnica();

  const recargar = useCallback(() => {
    setError(undefined);
    traer<PanelDeDelegaciones>('/delegaciones').then(setPanel).catch(setError);
  }, []);

  useEffect(recargar, [recargar]);

  function reemplazarVotacion(actualizada: DelegacionesDeDecision): void {
    setPanel((previo) =>
      previo === undefined
        ? previo
        : {
            ...previo,
            votaciones: previo.votaciones.map((votacion) =>
              votacion.decisionId === actualizada.decisionId ? actualizada : votacion,
            ),
          },
    );
  }

  async function prestar(evento: SyntheticEvent, votacion: DelegacionesDeDecision): Promise<void> {
    evento.preventDefault();
    setErrorAccion(undefined);
    setHecho(undefined);
    const enQuienId = elegido[votacion.decisionId] ?? '';
    if (enQuienId === '') {
      setErrorAccion({
        id: votacion.decisionId,
        fallo: new Error('Elegí a quién le prestás tu voto.'),
      });
      return;
    }
    const resultado = await ejecutar(`prestar-${votacion.decisionId}`, { enQuienId }, (requestId) =>
      enviar<DelegacionesDeDecision>(`/decisiones/${votacion.decisionId}/delegaciones`, {
        requestId,
        enQuienId,
      }),
    );
    if (resultado.estado === 'hecho') {
      reemplazarVotacion(resultado.valor);
      setHecho(`Le prestaste tu voto a ${resultado.valor.miDelegacion?.enQuien ?? 'esa persona'}.`);
    } else if (resultado.estado === 'fallo') {
      setErrorAccion({ id: votacion.decisionId, fallo: resultado.error });
    }
  }

  async function recuperar(votacion: DelegacionesDeDecision): Promise<void> {
    const delegacion = votacion.miDelegacion;
    if (delegacion === undefined) return;
    setErrorAccion(undefined);
    setHecho(undefined);
    const resultado = await ejecutar(
      `recuperar-${votacion.decisionId}`,
      { delegacionId: delegacion.id },
      (requestId) =>
        enviar<DelegacionesDeDecision>(
          `/decisiones/${votacion.decisionId}/delegaciones/${delegacion.id}/revocar`,
          { requestId },
        ),
    );
    if (resultado.estado === 'hecho') {
      reemplazarVotacion(resultado.valor);
      setHecho('Recuperaste tu voto. Desde este momento nadie lo lleva por vos.');
    } else if (resultado.estado === 'fallo') {
      setErrorAccion({ id: votacion.decisionId, fallo: resultado.error });
    }
  }

  return (
    <>
      <h1>Prestar tu voto</h1>
      <p>
        Si sabés que no vas a poder mirar una votación, podés pedirle a otra persona que lleve tu
        parte. No es darle tu voto para siempre: es un préstamo, dura hasta que la votación cierre y
        lo recuperás cuando quieras.
      </p>

      <ErrorVisible error={error} />
      {panel === undefined && error === undefined && <Cargando que="las votaciones" />}

      {panel !== undefined && (
        <section aria-labelledby="como-titulo">
          <h2 id="como-titulo">Cómo funciona</h2>
          <ul>
            {panel.comoFunciona.map((linea) => (
              <li key={linea}>{linea}</li>
            ))}
          </ul>
        </section>
      )}

      {/* El resultado de la última acción se anuncia. Sin esto, quien usa un lector de pantalla
          pulsa «Recuperar mi voto», la tarjeta cambia, y no se entera de nada. */}
      {hecho !== undefined && <Aviso tipo="bien">{hecho}</Aviso>}

      {!cargandoSesion && sesion === undefined && (
        <div className="vacio" role="status">
          <p>
            Estás mirando sin cuenta. Para prestar tu voto hay que entrar con el correo
            institucional.
          </p>
          <p>
            <Link className="boton" href="/entrar">
              Entrar
            </Link>
          </p>
        </div>
      )}

      <section aria-labelledby="votaciones-titulo">
        <h2 id="votaciones-titulo">Votaciones abiertas</h2>

        {panel !== undefined && panel.votaciones.length === 0 && (
          <div className="vacio" role="status">
            <p>
              No hay ninguna votación abierta, así que no hay nada que prestar.{' '}
              <strong>Así debe ser la mayoría del tiempo.</strong>
            </p>
            <p>
              Lo que se vota sale de un problema y de una conversación previa:{' '}
              <Link href="/problemas">mirá los problemas abiertos</Link> o{' '}
              <Link href="/deliberaciones">las conversaciones en curso</Link>.
            </p>
          </div>
        )}

        {panel?.votaciones.map((votacion) => {
          const claveDeError =
            errorAccion?.id === votacion.decisionId ? errorAccion.fallo : undefined;
          const trabajando =
            enCurso === `prestar-${votacion.decisionId}` ||
            enCurso === `recuperar-${votacion.decisionId}`;
          return (
            <article className="tarjeta-trabajo" key={votacion.decisionId}>
              <h3>
                <Link href={`/decisiones/${votacion.decisionId}`}>{votacion.titulo}</Link>
              </h3>
              <p className="suave">
                {plazo(votacion.cierraEn)} · cierra el {cuando(votacion.cierraEn)}
              </p>

              {votacion.yaVote && (
                <Aviso tipo="bien" titulo="Ya votaste">
                  Tu voto manda sobre cualquier préstamo. Si le habías prestado tu voto a alguien,
                  votar ya lo deshizo: no hace falta que hagas nada más.
                </Aviso>
              )}

              {votacion.miDelegacion !== undefined && (
                <>
                  <p>
                    Le prestaste tu voto a <strong>{votacion.miDelegacion.enQuien}</strong> el{' '}
                    {cerrarFrase(cuando(votacion.miDelegacion.desde))} Vence al cerrar la votación,
                    el {cerrarFrase(cuando(votacion.miDelegacion.hasta))}
                  </p>
                  <p>
                    <button
                      className="boton"
                      type="button"
                      disabled={enCurso !== undefined}
                      onClick={() => {
                        void recuperar(votacion);
                      }}
                    >
                      {enCurso === `recuperar-${votacion.decisionId}`
                        ? 'Recuperando…'
                        : 'Recuperar mi voto'}
                    </button>
                  </p>
                  <p className="suave">
                    Tiene efecto en el momento, aunque esa persona ya haya votado. También podés
                    dejarlo como está y{' '}
                    <Link href={`/decisiones/${votacion.decisionId}`}>votar vos</Link>: votar
                    deshace el préstamo.
                  </p>
                </>
              )}

              {votacion.miDelegacion === undefined && votacion.sePuedeDelegar && (
                <form
                  className="formulario-acotado"
                  onSubmit={(evento) => {
                    void prestar(evento, votacion);
                  }}
                >
                  <div className="campo">
                    <label htmlFor={`a-quien-${votacion.decisionId}`}>
                      ¿A quién le prestás tu voto?
                    </label>
                    <p className="ayuda" id={`ayuda-${votacion.decisionId}`}>
                      Tiene que ser alguien que también podía decidir en esta votación. Podés
                      recuperarlo cuando quieras.
                    </p>
                    <select
                      id={`a-quien-${votacion.decisionId}`}
                      aria-describedby={`ayuda-${votacion.decisionId}`}
                      value={elegido[votacion.decisionId] ?? ''}
                      onChange={(evento) => {
                        setElegido((previo) => ({
                          ...previo,
                          [votacion.decisionId]: evento.target.value,
                        }));
                      }}
                    >
                      <option value="">Elegí a una persona</option>
                      {votacion.podesDelegarEn.map((persona) => (
                        <option key={persona.id} value={persona.id}>
                          {persona.alias}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p>
                    <button className="boton" type="submit" disabled={enCurso !== undefined}>
                      {enCurso === `prestar-${votacion.decisionId}`
                        ? 'Prestando…'
                        : 'Prestar mi voto'}
                    </button>
                  </p>
                </form>
              )}

              {!votacion.sePuedeDelegar && votacion.porQueNo !== undefined && !votacion.yaVote && (
                <p className="suave">{votacion.porQueNo}</p>
              )}

              {votacion.miDelegacion === undefined &&
                votacion.sePuedeDelegar &&
                votacion.podesDelegarEn.length === 0 && (
                  <div className="vacio" role="status">
                    <p>
                      No hay nadie más en la lista de quienes podían decidir acá, así que no hay a
                      quién prestárselo.
                    </p>
                  </div>
                )}

              <ErrorVisible error={claveDeError} />
              {trabajando && <span className="suave">Un momento…</span>}

              <Reparto votacion={votacion} />
            </article>
          );
        })}
      </section>
    </>
  );
}
