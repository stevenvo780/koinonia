'use client';

/**
 * Verificar integridad, para alguien que no sabe qué es una huella.
 *
 * Tres decisiones de esta pantalla:
 *
 *  1. **Qué se comprobó, en verde o en rojo, y qué significa.** Un semáforo sin explicación no
 *     informa: informa que hay un semáforo. Cada comprobación dice qué se miró y qué querría decir
 *     que estuviera mal.
 *  2. **Nada depende del color.** Verde lleva «✓ Está bien» y rojo lleva «✕ Algo no cuadra».
 *  3. **Cómo comprobarlo con la herramienta independiente.** Si sólo verifica nuestra web, no
 *     probamos nada: le estaríamos pidiendo a la gente que nos crea, que es exactamente lo que este
 *     proyecto existe para no tener que pedir.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';

import type { InformeIntegridad } from '@koinonia/contracts';

import { Cargando, ErrorVisible } from '../../components/marco';
import { cuando, traer } from '../../lib/api';

export default function Verificar(): ReactNode {
  const [informe, setInforme] = useState<InformeIntegridad | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const [comprobando, setComprobando] = useState(false);

  const comprobar = useCallback(() => {
    setComprobando(true);
    setError(undefined);
    traer<InformeIntegridad>('/integridad')
      .then(setInforme)
      .catch(setError)
      .finally(() => {
        setComprobando(false);
      });
  }, []);

  useEffect(comprobar, [comprobar]);

  return (
    <>
      <h1>Comprobar que nada se cambió</h1>

      <p>
        Todo lo que pasa acá queda escrito en orden, y cada cosa escrita va enganchada a la
        anterior. Si alguien cambiara, borrara o moviera una sola, el enganche dejaría de cuadrar y
        esta página lo diría. No hace falta que entiendas cómo funciona: hace falta que puedas
        comprobarlo.
      </p>

      <p>
        <button className="boton" type="button" onClick={comprobar} disabled={comprobando}>
          {comprobando ? 'Comprobando…' : 'Comprobar ahora'}
        </button>
      </p>

      <ErrorVisible error={error} />
      {informe === undefined && error === undefined && <Cargando que="la comprobación" />}

      {informe !== undefined && (
        <>
          <div
            className={`comprobacion ${informe.todoBien ? 'bien' : 'mal'}`}
            role="status"
            aria-live="polite"
          >
            <span className="marca-estado">
              <span aria-hidden="true">{informe.todoBien ? '✓' : '✕'} </span>
              {informe.todoBien
                ? 'El historial está completo y sin alteraciones'
                : 'Algo en el historial no cuadra'}
            </span>
            <p>
              Se revisaron {informe.hechosRevisados} hechos
              {informe.historialDesde !== undefined && (
                <> registrados desde el {cuando(informe.historialDesde)}</>
              )}
              . Comprobado el {cuando(informe.comprobadoEn)}.
            </p>
            {!informe.todoBien && (
              <p>
                <strong>Esto es una alarma pública, no un arreglo silencioso.</strong> Las
                decisiones afectadas quedan en cuarentena hasta que alguien explique de dónde salió
                el cambio.
              </p>
            )}
          </div>

          <section aria-labelledby="detalle-titulo">
            <h2 id="detalle-titulo">Qué se comprobó</h2>
            {informe.comprobaciones.map((comprobacion) => (
              <article
                className={`comprobacion ${comprobacion.bien ? 'bien' : 'mal'}`}
                key={comprobacion.id}
                aria-labelledby={`c-${comprobacion.id}`}
              >
                <span className="marca-estado" id={`c-${comprobacion.id}`}>
                  <span aria-hidden="true">{comprobacion.bien ? '✓' : '✕'} </span>
                  {comprobacion.bien ? 'Está bien' : 'Algo no cuadra'}
                </span>
                <p>
                  <strong>Qué se comprobó:</strong> {comprobacion.queSeComprobo}
                </p>
                <p>
                  <strong>Qué significa:</strong> {comprobacion.queSignifica}
                </p>
                {comprobacion.detalle !== undefined && (
                  <details>
                    <summary>Ver el detalle técnico</summary>
                    <code className="comprobante">{comprobacion.detalle}</code>
                  </details>
                )}
              </article>
            ))}
          </section>

          <section aria-labelledby="solo-titulo">
            <h2 id="solo-titulo">Comprobarlo vos mismo, sin confiar en esta página</h2>
            <p>{informe.comoComprobarloVosMismo.explicacion}</p>
            <ol>
              <li>
                <p>
                  Descargá el historial completo:{' '}
                  <a
                    className="boton secundario"
                    href={`/api${informe.comoComprobarloVosMismo.urlDeDescarga}`}
                    download
                  >
                    Descargar todo
                  </a>
                </p>
              </li>
              <li>
                <p>Corré la herramienta de comprobación, que es aparte y de código abierto:</p>
                <code className="comprobante">{informe.comoComprobarloVosMismo.comando}</code>
              </li>
              <li>
                <p>
                  Compará. Si te da lo mismo que dice esta página, es porque es verdad, no porque lo
                  digamos nosotros. Si te da distinto,{' '}
                  <strong>publicalo: eso es exactamente lo que hay que hacer</strong>.
                </p>
              </li>
            </ol>
          </section>
        </>
      )}
    </>
  );
}
