'use client';

/**
 * Resultado, con la demostración en lenguaje humano.
 *
 * La pregunta que responde esta pantalla no es «¿qué salió?» sino **«¿por qué salió eso?»**. Andrés
 * no participa porque cree que esto es teatro; lo único que lo convence es un número que no se pueda
 * maquillar y la posibilidad de recalcularlo por su cuenta. Por eso los pasos del escrutinio se
 * muestran uno por uno, en castellano, con sus cifras, y al final está el botón para descargarlo
 * todo y comprobarlo con una herramienta que no es esta página.
 */

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import type { ResultadoDecision } from '@koinonia/contracts';

import { Cargando, ErrorVisible } from '../../../../components/marco';
import { traer } from '../../../../lib/api';

export default function Resultado(): ReactNode {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [resultado, setResultado] = useState<ResultadoDecision | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);

  useEffect(() => {
    traer<ResultadoDecision>(`/decisiones/${id}/resultado`).then(setResultado).catch(setError);
  }, [id]);

  if (error !== undefined) return <ErrorVisible error={error} />;
  if (resultado === undefined) return <Cargando que="el resultado" />;

  const aprobada = resultado.desenlace === 'approved';

  return (
    <>
      <h1>Resultado</h1>

      {/* El desenlace, con símbolo y palabra: nada depende sólo del color. */}
      <div className={`comprobacion ${aprobada ? 'bien' : 'mal'}`}>
        <span className="marca-estado">
          <span aria-hidden="true">{aprobada ? '✓' : '✕'} </span>
          {resultado.desenlaceEnPalabras}
        </span>
        <p>{resultado.relato}</p>
      </div>

      <section aria-labelledby="participacion-titulo">
        <h2 id="participacion-titulo">Quiénes participaron</h2>
        <table className="datos">
          <caption className="suave">
            La lista de quiénes podían decidir se cerró al abrir la votación y no cambió después.
          </caption>
          <tbody>
            <tr>
              <th scope="row">Podían decidir</th>
              <td>{resultado.participacion.podianDecidir}</td>
            </tr>
            <tr>
              <th scope="row">Se manifestaron</th>
              <td>{resultado.participacion.representadas}</td>
            </tr>
            <tr>
              <th scope="row">Respuestas contadas</th>
              <td>{resultado.participacion.emitidas}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section aria-labelledby="porque-titulo">
        <h2 id="porque-titulo">Por qué salió esto, paso por paso</h2>
        <ol className="traza">
          {resultado.pasos.map((paso) => (
            <li key={paso.id}>
              <p>{paso.explicacion}</p>
            </li>
          ))}
        </ol>
      </section>

      {resultado.tablas.map((tabla) => (
        <section key={tabla.titulo} aria-labelledby={`tabla-${tabla.titulo}`}>
          <h2 id={`tabla-${tabla.titulo}`}>{tabla.titulo}</h2>
          <table className="datos">
            <thead>
              <tr>
                {tabla.columnas.map((columna) => (
                  <th scope="col" key={columna}>
                    {columna}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tabla.filas.map((fila, i) => (
                <tr key={`${tabla.titulo}-${String(i)}`}>
                  {fila.map((celda, j) => (
                    <td key={`${String(i)}-${String(j)}`}>{celda}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <section aria-labelledby="comprobar-titulo">
        <h2 id="comprobar-titulo">Comprobarlo por tu cuenta</h2>
        <p>
          Este resultado no es algo que nosotros guardemos: es algo que se vuelve a calcular desde
          las respuestas cada vez que alguien lo pide. Si querés comprobarlo sin confiar en esta
          página, descargá todo y pasalo por la herramienta de comprobación.
        </p>
        <p>
          <Link className="boton" href="/verificar">
            Ir a comprobar que nada se cambió
          </Link>
        </p>
        <details>
          <summary>Ver los comprobantes de esta decisión</summary>
          <p className="suave">
            Tres números que identifican, uno a uno: el resultado, las reglas con las que se decidió
            y la lista de quiénes podían decidir. Si cualquiera de las tres cosas cambiara, su
            número cambiaría.
          </p>
          <h3>Comprobante del resultado</h3>
          <code className="comprobante">{resultado.comprobante}</code>
          <h3>Comprobante de las reglas</h3>
          <code className="comprobante">{resultado.comprobanteReglas}</code>
          <h3>Comprobante de la lista de quiénes podían decidir</h3>
          <code className="comprobante">{resultado.comprobanteLista}</code>
        </details>
      </section>
    </>
  );
}
