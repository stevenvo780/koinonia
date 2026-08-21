'use client';

/**
 * Detalle de una propuesta, con **el historial de versiones visible**.
 *
 * La versión 1 se muestra entera, con su texto y su fecha, después de que exista la 2. No es un
 * adorno de transparencia: es lo que hace comprobable que enmendar **añade** y no edita, y por tanto
 * que una respuesta dada sobre la V1 tenía un referente que sigue existiendo.
 *
 * Arriba va el problema del que cuelga: una propuesta no se lee sin ver a qué responde (PRODUCT §4).
 */

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type SyntheticEvent, type ReactNode } from 'react';

import type { PropuestaDetalle } from '@koinonia/contracts';

import { Aviso, Cargando, ErrorVisible, useSesion } from '../../../components/marco';
import { cuando, enviar, nuevoRequestId, traer } from '../../../lib/api';

export default function DetallePropuesta(): ReactNode {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { sesion } = useSesion();

  const [propuesta, setPropuesta] = useState<PropuestaDetalle | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const [errorEnmienda, setErrorEnmienda] = useState<unknown>(undefined);
  const [enmendando, setEnmendando] = useState(false);
  const [titulo, setTitulo] = useState('');
  const [cuerpo, setCuerpo] = useState('');
  const [motivo, setMotivo] = useState('');

  const recargar = useCallback(() => {
    traer<PropuestaDetalle>(`/propuestas/${id}`).then(setPropuesta).catch(setError);
  }, [id]);

  useEffect(recargar, [recargar]);

  function abrirEnmienda(): void {
    const vigente = propuesta?.versiones.at(-1);
    setTitulo(vigente?.titulo ?? '');
    setCuerpo(vigente?.cuerpo ?? '');
    setMotivo('');
    setEnmendando(true);
  }

  async function guardarEnmienda(evento: SyntheticEvent): Promise<void> {
    evento.preventDefault();
    setErrorEnmienda(undefined);
    try {
      setPropuesta(
        await enviar<PropuestaDetalle>(`/propuestas/${id}/enmiendas`, {
          requestId: nuevoRequestId(),
          titulo,
          cuerpo,
          motivo,
        }),
      );
      setEnmendando(false);
    } catch (fallo) {
      setErrorEnmienda(fallo);
    }
  }

  if (error !== undefined) return <ErrorVisible error={error} />;
  if (propuesta === undefined) return <Cargando que="la propuesta" />;

  const versionesAlReves = [...propuesta.versiones].reverse();

  return (
    <>
      {/* El problema de origen, arriba: no se lee una propuesta sin ver a qué responde. */}
      <p className="suave">
        Responde a:{' '}
        <Link href={`/problemas/${propuesta.problemaId}`}>{propuesta.problemaTitulo}</Link>
      </p>

      <h1>{propuesta.titulo}</h1>
      <p className="suave">
        Va por la versión {propuesta.versionVigente}.{' '}
        {propuesta.versionVigente > 1 &&
          'Las versiones anteriores siguen abajo, tal como estaban: enmendar agrega, no borra.'}
      </p>

      <ErrorVisible error={errorEnmienda} />

      {propuesta.decisiones.length > 0 && (
        <Aviso tipo="atencion" titulo="Hay una votación sobre esta propuesta">
          {propuesta.decisiones.map((decision) => (
            <span key={decision.decisionId}>
              <Link href={`/decisiones/${decision.decisionId}`}>Ir a la votación</Link>{' '}
            </span>
          ))}
        </Aviso>
      )}

      <section aria-labelledby="versiones-titulo">
        <h2 id="versiones-titulo">Historial de versiones</h2>

        {versionesAlReves.map((version) => {
          const esVigente = version.version === propuesta.versionVigente;
          return (
            <article
              className={`version${esVigente ? ' vigente' : ''}`}
              key={version.version}
              aria-labelledby={`v-${String(version.version)}`}
            >
              <h3 id={`v-${String(version.version)}`}>
                Versión {version.version}
                {esVigente ? ' · la que está sobre la mesa' : ' · anterior, y sigue acá entera'}
              </h3>
              <p className="suave">Escrita el {cuando(version.cuando)}</p>
              {version.motivo !== undefined && (
                <p>
                  <strong>Qué cambió y por qué:</strong> {version.motivo}
                </p>
              )}
              <p className="texto">{version.cuerpo}</p>
              <details>
                <summary>Ver el comprobante de esta versión</summary>
                <p className="suave">
                  Este número identifica <em>exactamente</em> este texto. Si alguien le cambiara una
                  coma, el número cambiaría y la pantalla de{' '}
                  <Link href="/verificar">Verificar</Link> lo diría en rojo.
                </p>
                <code className="comprobante">{version.huella}</code>
              </details>
            </article>
          );
        })}
      </section>

      {sesion !== undefined && (
        <section aria-labelledby="enmendar-titulo">
          <h2 id="enmendar-titulo">Proponer una enmienda</h2>
          {propuesta.esMia ? (
            enmendando ? (
              <form onSubmit={(e) => void guardarEnmienda(e)} noValidate>
                <div className="campo">
                  <label htmlFor="titulo-enmienda">Título</label>
                  <input
                    id="titulo-enmienda"
                    type="text"
                    required
                    minLength={10}
                    maxLength={140}
                    value={titulo}
                    onChange={(e) => {
                      setTitulo(e.target.value);
                    }}
                  />
                </div>
                <div className="campo">
                  <label htmlFor="cuerpo-enmienda">Texto de la propuesta</label>
                  <span className="ayuda" id="ayuda-cuerpo-enmienda">
                    La versión anterior no se toca: esto crea la siguiente.
                  </span>
                  <textarea
                    id="cuerpo-enmienda"
                    required
                    minLength={50}
                    maxLength={4000}
                    aria-describedby="ayuda-cuerpo-enmienda"
                    value={cuerpo}
                    onChange={(e) => {
                      setCuerpo(e.target.value);
                    }}
                  />
                </div>
                <div className="campo">
                  <label htmlFor="motivo-enmienda">¿Qué cambia y por qué?</label>
                  <span className="ayuda" id="ayuda-motivo">
                    Mínimo 20 caracteres. Sin esto, «versión 2» es un número sin información.
                  </span>
                  <textarea
                    id="motivo-enmienda"
                    required
                    minLength={20}
                    maxLength={1000}
                    aria-describedby="ayuda-motivo"
                    value={motivo}
                    onChange={(e) => {
                      setMotivo(e.target.value);
                    }}
                  />
                </div>
                <button className="boton" type="submit">
                  Guardar la versión nueva
                </button>{' '}
                <button
                  className="boton secundario"
                  type="button"
                  onClick={() => {
                    setEnmendando(false);
                  }}
                >
                  Dejarlo así
                </button>
              </form>
            ) : (
              <button className="boton" type="button" onClick={abrirEnmienda}>
                Enmendar mi propuesta
              </button>
            )
          ) : (
            <Aviso tipo="atencion" titulo="Esta propuesta la escribió otra persona">
              Sólo quien la escribió puede cambiar su texto. Vos podés escribir otra propuesta al
              mismo problema, que queda con tu nombre y su propio historial.{' '}
              <Link href={`/propuestas/nueva?problema=${propuesta.problemaId}`}>
                Escribir otra propuesta
              </Link>
              .
            </Aviso>
          )}
        </section>
      )}
    </>
  );
}
