'use client';

/**
 * Comprobar que nada se cambió, para alguien que no sabe qué es una huella.
 *
 * La jerarquía va al revés de como salió la primera vez —veredicto, hechos, comprobación de afuera,
 * detalle plegado— y por eso están anotados los motivos:
 *
 *  1. **«Sin confirmar» no es «está bien».** El informe lo produce el mismo servidor que guarda el
 *     historial: que apruebe su propio examen no es un éxito, es una presunción. Mientras nadie lo
 *     compruebe por fuera el veredicto es ámbar, y el verde queda proscrito —también en cada uno de
 *     los seis puntos, que son la nota que el servidor se pone a sí mismo—. Seis tarjetas verdes
 *     casi idénticas no informaban de nada y cobraban una confianza que no se había ganado.
 *  2. **La acción principal es la que no pasa por acá.** Descargar la copia del historial y pasarla
 *     por una herramienta que no habla con este servidor es lo único que este servidor no puede
 *     falsear: va con el botón grande. El comando, que casi nadie va a escribir, va plegado y pesa
 *     poco; la explicación en palabras pesa más porque es la que decide algo.
 *  3. **Sobre cero cosas no se enseñan seis comprobaciones.** El historial vacío es lo que más
 *     gente va a ver el primer día y merece una frase, no un tablero de comprobaciones sobre nada.
 *
 * Nada depende del color: el veredicto y el punto que falla llevan símbolo y palabra.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';

import type { Comprobacion, InformeIntegridad } from '@koinonia/contracts';

import { Cargando, ErrorVisible } from '../../components/marco';
import { cerrarFrase, cuando, traer } from '../../lib/api';

/**
 * El único punto de los seis que **no** habla del historial público.
 *
 * Importa para no gritar una cosa por otra: si lo único que falla es este, el historial no fue
 * alterado —falta o no cuadra material privado que el historial dejó anotado—, y decir «el historial
 * fue alterado» sería una alarma falsa delante de trescientas personas. Una alarma falsa gasta la
 * misma credibilidad que un verde fingido, sólo que en el otro sentido.
 */
const REVISION_LOCAL = 'material-privado';

/** «6 puntos» / «1 punto». Se pone entre paréntesis para no tener que concordar el artículo. */
function puntos(cuantos: number): string {
  return cuantos === 1 ? '1 punto' : `${String(cuantos)} puntos`;
}

/**
 * «Se revisó 1 hecho registrado desde el…» / «Se revisaron 2 hechos registrados desde el…».
 *
 * La frase se arma entera acá y no en el JSX por dos motivos que se veían en pantalla: el verbo, el
 * sustantivo y el participio tienen que concordar con el número —decía «Se revisaron 1 hechos
 * registrados»—, y el punto final depende de si la fecha ya trajo el suyo. Repartido en tres trozos
 * de JSX no había dónde mirar el número ni el texto para decidir ninguna de las dos cosas.
 */
function resumenDeLaRevision(informe: InformeIntegridad): string {
  const formateador = new Intl.NumberFormat('es-CO');
  const uno = informe.hechosRevisados === 1;
  const cuantos = uno
    ? 'Se revisó 1 hecho'
    : `Se revisaron ${formateador.format(informe.hechosRevisados)} hechos`;
  const desde =
    informe.historialDesde === undefined
      ? ''
      : ` ${uno ? 'registrado' : 'registrados'} desde el ${cuando(informe.historialDesde)}`;
  return `${cerrarFrase(cuantos + desde)} ${cerrarFrase(
    `Comprobado el ${cuando(informe.comprobadoEn)}`,
  )}`;
}

/**
 * El veredicto y su salvedad, pegados.
 *
 * Van juntos porque son inseparables: el veredicto sin la salvedad es una garantía fingida, y la
 * salvedad sin el veredicto es una advertencia sobre nada. Tres estados y ni uno verde.
 */
function Veredicto({ informe }: { readonly informe: InformeIntegridad }): ReactNode {
  if (!informe.todoBien) {
    const fallaron = informe.comprobaciones.filter((punto) => !punto.bien);
    const soloLocal = fallaron.every((punto) => punto.id === REVISION_LOCAL);
    return (
      <div className="veredicto mal" role="alert" key="alarma">
        <strong className="marca-estado">
          <span aria-hidden="true">✕ </span>
          {soloLocal
            ? 'Falta material privado que el historial dejó anotado'
            : 'El historial fue alterado'}
        </strong>
        {soloLocal ? (
          <p>
            Los enganches del historial siguen cuadrando, pero el servidor anotó en su día que
            existía cierto material privado y hoy ese material no está, sobra o no corresponde con
            lo anotado. <strong>No es un fallo de esta pantalla ni de tu conexión.</strong>{' '}
            <a href="#detalle-titulo">Qué se revisó y qué quiere decir</a>, al final de la página.
          </p>
        ) : (
          <p>
            Un enganche del historial dejó de cuadrar: algo que ya estaba escrito se cambió, se
            borró o se movió de sitio. <strong>No es un fallo técnico ni un error de carga</strong>,
            y volver a cargar la página no lo va a arreglar.{' '}
            <a href="#detalle-titulo">Qué dejó de cuadrar, exactamente</a>, al final de la página.
          </p>
        )}
        <p>
          <strong>Esta página no es prueba de sí misma</strong>, y acá eso juega a favor: el
          servidor está dando una mala noticia sobre sí mismo. Comprobalo por fuera con la copia del
          historial y contalo donde lo vea el grupo entero. Esto se publica, no se arregla en
          silencio.
        </p>
      </div>
    );
  }

  if (informe.hechosRevisados === 0) {
    return (
      <div className="veredicto pendiente" role="status" key="vacio">
        <strong className="marca-estado">Todavía no hay nada que comprobar</strong>
        <p>
          Nadie ha escrito nada todavía, así que no hay historial que se pueda haber movido. Esta
          página empieza a decir algo el día que el grupo escriba lo primero.
        </p>
        <p>
          <strong>Esta página no es prueba de sí misma.</strong> El informe lo hace el mismo
          servidor que guarda el historial, así que el día que haya algo que comprobar, lo que va a
          valer es que lo compruebes por fuera. Abajo, en{' '}
          <a href="#afuera-titulo">Comprobalo por fuera</a>, está cómo se hace.
        </p>
      </div>
    );
  }

  return (
    <div className="veredicto atencion" role="status" key="sin-confirmar">
      <strong className="marca-estado">
        <span aria-hidden="true">! </span>Sin confirmar
      </strong>
      <p>
        El servidor afirma que los enganches del historial están intactos. Eso lo dice él, que es la
        parte interesada: aprobar su propio examen no es un éxito, es una presunción.
      </p>
      <p>
        <strong>Esta página no es prueba de sí misma.</strong> El informe lo hace el mismo servidor
        que guarda el historial, así que comprueba su propio trabajo: sirve para detectar un fallo o
        una manipulación torpe, no para descartar que el servidor entero esté mintiendo. Por eso acá
        no vas a leer que está todo bien. Falta lo único que no depende de nosotros:{' '}
        <a href="#afuera-titulo">comprobarlo por fuera</a>.
      </p>
    </div>
  );
}

/** El punto que falla se enseña entero y solo: entre cinco que pasaron se diluye. */
function PuntoQueFalla({ punto }: { readonly punto: Comprobacion }): ReactNode {
  return (
    <article className="comprobacion mal" aria-labelledby={`c-${punto.id}`}>
      <span className="marca-estado" id={`c-${punto.id}`}>
        <span aria-hidden="true">✕ </span>Acá no cuadra
        <span className="solo-lectores">: {punto.queSeComprobo}</span>
      </span>
      <p>
        <strong>Qué se comprobó:</strong> {punto.queSeComprobo}
      </p>
      <p>
        <strong>Qué significa:</strong> {punto.queSignifica}
      </p>
      {punto.detalle !== undefined && (
        <details>
          <summary>Ver el detalle técnico</summary>
          <code className="comprobante">{punto.detalle}</code>
        </details>
      )}
    </article>
  );
}

/**
 * Los puntos que pasaron, en lista y **sin marca por punto**.
 *
 * La marca va una sola vez, en la frase de arriba: repetir «está bien» seis veces era lo que hacía
 * que la pantalla informara sobre nada. Sin color no hay nada que compensar con una palabra, y la
 * palabra que faltaría —«bien»— es justo la que el servidor no puede decir de sí mismo.
 */
function PuntosQuePasaron({
  puntosRevisados,
  encabezado,
}: {
  readonly puntosRevisados: readonly Comprobacion[];
  readonly encabezado: string;
}): ReactNode {
  return (
    <>
      <p className="suave">{encabezado}</p>
      <ul className="tarjetas">
        {puntosRevisados.map((punto) => (
          <li key={punto.id}>
            <p>
              <strong>{punto.queSeComprobo}</strong>
            </p>
            <p className="suave">{punto.queSignifica}</p>
          </li>
        ))}
      </ul>
    </>
  );
}

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

  const pasaron = informe?.comprobaciones.filter((punto) => punto.bien) ?? [];
  const fallaron = informe?.comprobaciones.filter((punto) => !punto.bien) ?? [];

  return (
    <>
      <h1>Comprobar que nada se cambió</h1>

      <ErrorVisible error={error} />
      {informe === undefined && error === undefined && <Cargando que="la comprobación" />}

      {/*
       * El veredicto va primero y la salvedad va con él. Al revés —la promesa arriba y el «pero»
       * tres párrafos más abajo— es exactamente el orden que convierte una herramienta honesta en
       * una garantía fingida, y esta es la pantalla donde eso se cobra.
       */}
      {informe !== undefined && <Veredicto informe={informe} />}

      {informe !== undefined && <p>{resumenDeLaRevision(informe)}</p>}

      <p>
        Todo lo que pasa acá queda escrito en orden, y cada cosa escrita va enganchada a la
        anterior. Si alguien cambiara, borrara o moviera una sola, el enganche dejaría de cuadrar.
      </p>

      <p>
        <button
          className="boton secundario"
          type="button"
          onClick={comprobar}
          disabled={comprobando}
        >
          {comprobando
            ? 'Comprobando…'
            : informe === undefined
              ? 'Comprobar ahora'
              : 'Volver a preguntarle al servidor'}
        </button>
      </p>

      {informe !== undefined && (
        <>
          <section aria-labelledby="afuera-titulo">
            <h2 id="afuera-titulo">Comprobalo por fuera</h2>
            <p>
              Lo único que no depende de nosotros es que lo compruebes vos. Llevate la copia del
              historial y revisala con una herramienta aparte, de código abierto, que corrés en tu
              computador y no acá. Esa herramienta <strong>no habla con este servidor</strong>: sólo
              lee el archivo que te llevaste, así que desde acá no se la puede engañar. No hace
              falta que entiendas cómo funciona; hace falta que puedas hacerlo.
            </p>
            <p>
              <a
                className="boton accion"
                href={`/api${informe.comoComprobarloVosMismo.urlDeDescarga}`}
                download
              >
                Descargar la copia del historial
              </a>
            </p>
            <p className="suave">{informe.comoComprobarloVosMismo.explicacion}</p>
            <p>
              <strong>
                Si te da algo distinto de lo que dice esta página, publicalo: eso es exactamente lo
                que hay que hacer.
              </strong>{' '}
              No lo consultes primero en privado con quien administra el servidor, porque si el
              servidor estuviera mintiendo eso es justo lo que necesitaría que hicieras. Contalo
              donde lo vea el grupo entero.
            </p>
            <details>
              <summary>Ver el comando, si te manejás con la consola</summary>
              <code className="comprobante">{informe.comoComprobarloVosMismo.comando}</code>
            </details>
          </section>

          <section aria-labelledby="detalle-titulo">
            <h2 id="detalle-titulo">Qué revisó el servidor</h2>

            {informe.hechosRevisados === 0 && informe.todoBien ? (
              <p>
                El archivo empieza en blanco: no hay nada registrado todavía. Cuando se escriba lo
                primero, acá vas a ver los puntos que el servidor revisa uno por uno.
              </p>
            ) : fallaron.length > 0 ? (
              <>
                {fallaron.map((punto) => (
                  <PuntoQueFalla key={punto.id} punto={punto} />
                ))}
                {pasaron.length > 0 && (
                  <details>
                    <summary>
                      Ver el resto de la revisión ({puntos(pasaron.length)} sin problemas)
                    </summary>
                    <PuntosQuePasaron
                      puntosRevisados={pasaron}
                      encabezado={
                        'Estos no dieron problemas. No cambian lo de arriba: basta con que falle ' +
                        'uno para que el historial no se pueda dar por bueno.'
                      }
                    />
                  </details>
                )}
              </>
            ) : (
              <details>
                <summary>
                  Ver la revisión que hizo el servidor ({puntos(informe.comprobaciones.length)})
                </summary>
                <PuntosQuePasaron
                  puntosRevisados={informe.comprobaciones}
                  encabezado={
                    'El servidor no encontró problemas en ninguno de estos. Los revisó él mismo, ' +
                    'y por eso el veredicto de arriba dice «Sin confirmar» y no «está bien».'
                  }
                />
              </details>
            )}
          </section>
        </>
      )}
    </>
  );
}
