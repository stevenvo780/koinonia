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
 *  3. **Qué comprueba la herramienta independiente.** El historial público se descarga y verifica
 *     fuera del servidor. La disponibilidad de ciphertexts privados se marca como auditoría local:
 *     el export no los incluye y no se finge una independencia que no existe.
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
        anterior. Si alguien cambiara, borrara o moviera una sola, el enganche dejaría de cuadrar.
      </p>

      {/*
       * La salvedad iba en el tercer párrafo y la promesa iba en el primero, que es el orden que
       * convierte una herramienta honesta en una garantía fingida. Este informe lo produce el mismo
       * servidor que guarda el historial: si ese servidor estuviera comprometido, podría enseñar
       * verde. Decirlo primero es lo que hace que el paso de comprobarlo por tu cuenta —abajo— se
       * entienda como el que de verdad importa, y no como una curiosidad para gente técnica.
       * «Prefiero un hueco declarado a una garantía fingida» sostiene el proyecto entero, y esta es
       * la pantalla donde se cobra.
       */}
      <p>
        <strong>Esta página no es prueba de sí misma.</strong> El informe que ves abajo lo hace el
        mismo servidor que guarda el historial, así que comprueba su propio trabajo: sirve para
        detectar un fallo o una manipulación torpe, no para descartar que el servidor entero esté
        mintiendo. Lo único que no depende de nosotros es que lo compruebes vos, y por eso al final
        de esta página está el historial completo para descargar y la herramienta independiente que
        lo revisa, que es aparte y de código abierto. No hace falta que entiendas cómo funciona;
        hace falta que puedas hacerlo.
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
                ? 'Todas las comprobaciones pasaron'
                : 'Una comprobación necesita atención'}
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
                <strong>Esto es una alarma pública, no un arreglo silencioso.</strong> El detalle
                distingue si no cuadra el historial público o la disponibilidad local de material
                privado; no son la misma prueba.
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
            <h2 id="solo-titulo">Comprobar el historial público por tu cuenta</h2>
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
                  Compará las comprobaciones del historial público. La herramienta no recibe los
                  ciphertexts privados y por eso no puede reproducir su fila local. Si el historial
                  te da distinto,{' '}
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
