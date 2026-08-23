'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type SyntheticEvent, type ReactNode } from 'react';

import {
  CERTEZA_EN_PALABRAS,
  ESTADO_PROBLEMA_EN_PALABRAS,
  type Certeza,
  type EstadoProblema,
  type ProblemaDetalle,
  type PropuestaResumen,
} from '@koinonia/contracts';

import { DialogoTexto } from '../../../components/dialogo';
import { Aviso, Cargando, ErrorVisible, useSesion } from '../../../components/marco';
import { Ficha, Meta, Tarjeta, Vacio, type VarianteFicha } from '../../../components/piezas';
import { useAccionUnica } from '../../../lib/acciones';
import { cerrarFrase, cuando, enviar, traer } from '../../../lib/api';

const CERTEZAS: readonly Certeza[] = ['visto', 'me-lo-contaron', 'lo-supongo'];

/** Ver el mismo razonamiento en `app/problemas/page.tsx`, que consume la misma tabla. */
const ESTADO_A_VARIANTE: Readonly<Record<EstadoProblema, VarianteFicha>> = {
  'recogiendo-evidencia': 'en-curso',
  'con-propuesta': 'en-curso',
  resuelto: 'bien',
  archivado: 'neutra',
};

export default function DetalleProblema(): ReactNode {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { sesion } = useSesion();

  const [problema, setProblema] = useState<ProblemaDetalle | undefined>(undefined);
  const [propuestas, setPropuestas] = useState<PropuestaResumen[]>([]);
  const [error, setError] = useState<unknown>(undefined);
  // Un error por acción y pintado junto a su botón. Antes había uno solo, arriba del todo, para
  // tres acciones repartidas por la pantalla: quien pulsaba «Retirar mi aporte» al final de una
  // lista larga recibía la explicación fuera de la vista, y con un lector de pantalla, en un sitio
  // que no tiene nada que ver con lo que acababa de hacer.
  const [errorMePasa, setErrorMePasa] = useState<unknown>(undefined);
  const [errorAporte, setErrorAporte] = useState<unknown>(undefined);
  const [errorRetiro, setErrorRetiro] = useState<{ id: string; fallo: unknown } | undefined>(
    undefined,
  );
  const [aporte, setAporte] = useState('');
  const [certeza, setCerteza] = useState<Certeza>('visto');
  const [retirando, setRetirando] = useState<string | undefined>(undefined);
  const { enCurso, ejecutar, olvidar } = useAccionUnica();

  const recargar = useCallback(() => {
    setError(undefined);
    traer<ProblemaDetalle>(`/problemas/${id}`).then(setProblema).catch(setError);
    traer<PropuestaResumen[]>(`/propuestas?problema=${id}`)
      .then(setPropuestas)
      .catch(() => undefined);
  }, [id]);

  useEffect(recargar, [recargar]);

  async function mePasa(): Promise<void> {
    setErrorMePasa(undefined);
    const resultado = await ejecutar('me-pasa', {}, (requestId) =>
      enviar<ProblemaDetalle>(`/problemas/${id}/me-pasa`, { requestId }),
    );
    if (resultado.estado === 'hecho') setProblema(resultado.valor);
    else if (resultado.estado === 'fallo') setErrorMePasa(resultado.error);
  }

  async function aportar(evento: SyntheticEvent): Promise<void> {
    evento.preventDefault();
    setErrorAporte(undefined);
    const resultado = await ejecutar('aportar', { certeza, cuerpo: aporte }, (requestId) =>
      enviar<ProblemaDetalle>(`/problemas/${id}/evidencia`, {
        requestId,
        certeza,
        cuerpo: aporte,
      }),
    );
    if (resultado.estado === 'hecho') {
      setProblema(resultado.valor);
      setAporte('');
    } else if (resultado.estado === 'fallo') setErrorAporte(resultado.error);
  }

  async function retirar(evidenciaId: string, motivo: string): Promise<void> {
    setErrorRetiro(undefined);
    const resultado = await ejecutar(`retirar-${evidenciaId}`, { motivo }, (requestId) =>
      enviar<ProblemaDetalle>(`/problemas/${id}/evidencia/${evidenciaId}/retirar`, {
        requestId,
        motivo,
      }),
    );
    if (resultado.estado === 'hecho') {
      setProblema(resultado.valor);
      setRetirando(undefined);
    } else if (resultado.estado === 'fallo') {
      setErrorRetiro({ id: evidenciaId, fallo: resultado.error });
      setRetirando(undefined);
    }
  }

  // Un error de carga sin salida es un callejón: la pantalla quedaba con el aviso y nada más, ni
  // manera de reintentar ni manera de volver. Las dos cosas van acá.
  if (error !== undefined) {
    return (
      <>
        <h1>No pudimos abrir este problema</h1>
        <ErrorVisible error={error} />
        <p>
          <button className="boton" type="button" onClick={recargar}>
            Volver a intentar
          </button>{' '}
          <Link className="boton secundario" href="/problemas">
            Ver todos los problemas
          </Link>
        </p>
      </>
    );
  }
  // Un esqueleto con la forma real de los dos carriles —título, píldora de estado, cuerpo y un par
  // de tarjetas de evidencia—, no una línea suelta: sin esto la pantalla queda casi vacía y se
  // infla de golpe a más del doble de alto cuando llega la respuesta.
  if (problema === undefined) {
    return (
      <div className="pagina-detalle">
        <h1 aria-hidden="true">
          <span
            className="esqueleto-linea esqueleto-titulo"
            style={{ height: '1.6em', margin: 0 }}
          />
        </h1>
        <aside className="carril-estado" aria-hidden="true">
          <div className="esqueleto-linea esqueleto-titulo" style={{ width: '40%' }} />
          <div className="esqueleto-linea" style={{ width: '65%' }} />
          <div className="esqueleto-linea" style={{ width: '50%', marginTop: 'var(--e5)' }} />
          <div className="esqueleto-linea" style={{ width: '70%' }} />
        </aside>
        <div className="cuerpo-detalle" aria-hidden="true">
          <div className="esqueleto-linea" />
          <div className="esqueleto-linea" />
          <div className="esqueleto-linea" style={{ width: '85%' }} />
          <div
            className="esqueleto-linea esqueleto-titulo"
            style={{ marginTop: 'var(--e6)', width: '40%' }}
          />
          <ul className="tarjetas esqueleto">
            {Array.from({ length: 2 }, (_valor, indice) => (
              <li key={indice}>
                <div className="esqueleto-linea esqueleto-titulo" />
                <div className="esqueleto-linea" />
              </li>
            ))}
          </ul>
        </div>
        <div className="solo-lectores">
          <Cargando que="el problema" />
        </div>
      </div>
    );
  }

  return (
    <div className="pagina-detalle">
      <h1>{problema.titulo}</h1>

      {/*
       * El carril: el estado del problema y la única acción de un clic que cuelga directamente de
       * ese estado —«a vos también te pasa»—. Aportar evidencia es un formulario entero, así que
       * vive en el cuerpo junto con el resto de la lectura, no acá.
       */}
      <aside className="carril-estado" aria-label="Estado del problema">
        <Ficha variante={ESTADO_A_VARIANTE[problema.estado]}>
          {ESTADO_PROBLEMA_EN_PALABRAS[problema.estado]}
        </Ficha>
        <Meta>{`escrito el ${cuando(problema.desde)}`}</Meta>

        <section aria-labelledby="me-pasa-titulo">
          <h2 id="me-pasa-titulo">¿A vos también te pasa?</h2>
          <p>
            A <strong>{problema.lesPasaLoMismo}</strong>{' '}
            {problema.lesPasaLoMismo === 1 ? 'persona más le pasa' : 'personas más les pasa'} lo
            mismo. No se muestra quiénes: es un colectivo formándose, no una lista de nombres.
          </p>
          <ErrorVisible error={errorMePasa} />
          {problema.yaDijeQueMePasa ? (
            <p>
              <span aria-hidden="true">✓ </span>Ya dijiste que te pasa. No se cuenta dos veces.
            </p>
          ) : (
            <button
              className="boton secundario"
              type="button"
              disabled={enCurso !== undefined}
              onClick={() => void mePasa()}
            >
              {enCurso === 'me-pasa' ? 'Guardando…' : 'A mí también me pasa'}
            </button>
          )}
        </section>
      </aside>

      <div className="cuerpo-detalle">
        <p style={{ whiteSpace: 'pre-wrap' }}>{problema.cuerpo}</p>

        <section aria-labelledby="evidencia-titulo">
          <h2 id="evidencia-titulo">Lo que sabemos</h2>
          {problema.evidencias.length === 0 && (
            <Vacio
              titulo="Todavía nadie aportó nada"
              salida={
                sesion !== undefined
                  ? { href: '#aporte', texto: 'Aportar lo que sepas' }
                  : { href: '/entrar', texto: 'Entrar para aportar' }
              }
            >
              <p>
                Sirve una foto, un dato de matrícula, un correo que nadie respondió, o simplemente
                lo que te contaron: cada aporte dice de dónde sale.
              </p>
            </Vacio>
          )}

          <ul className="tarjetas">
            {problema.evidencias.map((evidencia) => (
              <li key={evidencia.id}>
                <p>
                  {/*
                   * `.etiqueta`, no `<Ficha>`: la certeza («lo vi» / «me lo contaron» / «lo
                   * supongo») no es un estado con desenlace bien/mal/en curso, es un rótulo de
                   * contexto —de qué clase de fuente sale este aporte—, que es exactamente lo que
                   * `.etiqueta` describe en `globals.css` y `<Ficha>` no.
                   */}
                  <span className="etiqueta">{CERTEZA_EN_PALABRAS[evidencia.certeza]}</span>{' '}
                  <span className="suave">{cuando(evidencia.cuando)}</span>
                </p>
                {evidencia.retirada === undefined ? (
                  <>
                    <p style={{ whiteSpace: 'pre-wrap' }}>{evidencia.cuerpo}</p>
                    {evidencia.fuente !== undefined && (
                      <p className="suave">Fuente: {evidencia.fuente}</p>
                    )}
                    {evidencia.esMia && (
                      <>
                        {errorRetiro?.id === evidencia.id && (
                          <ErrorVisible error={errorRetiro.fallo} />
                        )}
                        <button
                          className="boton secundario"
                          type="button"
                          disabled={enCurso !== undefined}
                          onClick={() => {
                            setErrorRetiro(undefined);
                            setRetirando(evidencia.id);
                          }}
                        >
                          {enCurso === `retirar-${evidencia.id}`
                            ? 'Retirando…'
                            : 'Retirar mi aporte'}
                        </button>
                      </>
                    )}
                  </>
                ) : (
                  // Nunca una ausencia silenciosa: el hueco se declara, con su fecha y su motivo.
                  <p className="suave">
                    <span aria-hidden="true">— </span>Se retiró este aporte el{' '}
                    {cerrarFrase(cuando(evidencia.retirada.cuando))} Motivo: «
                    {evidencia.retirada.motivo}».
                  </p>
                )}
              </li>
            ))}
          </ul>

          <DialogoTexto
            abierto={retirando !== undefined}
            titulo="Retirar tu aporte"
            etiqueta="¿Por qué lo retirás?"
            ayuda="Queda escrito en el historial, junto al hueco que deja. El aporte no se borra: se marca como retirado con este motivo."
            confirmar="Retirar el aporte"
            cancelar="Dejarlo como está"
            trabajando={retirando !== undefined && enCurso === `retirar-${retirando}`}
            onConfirmar={(motivo) => {
              if (retirando !== undefined) void retirar(retirando, motivo);
            }}
            onCancelar={() => {
              // Cancelar es cambiar de intención: la clave de idempotencia guardada ya no vale.
              if (retirando !== undefined) olvidar(`retirar-${retirando}`);
              setRetirando(undefined);
            }}
          />

          {sesion !== undefined && (
            <form onSubmit={(e) => void aportar(e)} noValidate>
              <h3>Aportar algo</h3>
              <div className="campo">
                <label htmlFor="aporte">¿Qué sabés?</label>
                <span className="ayuda" id="ayuda-aporte">
                  Mínimo 20 caracteres. Contá el hecho, no la opinión.
                </span>
                <textarea
                  id="aporte"
                  required
                  minLength={20}
                  aria-describedby="ayuda-aporte"
                  value={aporte}
                  onChange={(e) => {
                    setAporte(e.target.value);
                  }}
                />
              </div>
              <fieldset className="opciones">
                <legend>
                  Eso que escribiste, ¿lo viste, te lo contaron, o lo estás suponiendo?
                </legend>
                {CERTEZAS.map((valor) => (
                  <div className="opcion" key={valor}>
                    <input
                      type="radio"
                      id={`certeza-${valor}`}
                      name="certeza"
                      value={valor}
                      checked={certeza === valor}
                      onChange={() => {
                        setCerteza(valor);
                      }}
                    />
                    <label htmlFor={`certeza-${valor}`}>{CERTEZA_EN_PALABRAS[valor]}</label>
                  </div>
                ))}
              </fieldset>
              <ErrorVisible error={errorAporte} />
              <button className="boton" type="submit" disabled={enCurso !== undefined}>
                {enCurso === 'aportar' ? 'Aportando…' : 'Aportar'}
              </button>
            </form>
          )}
        </section>

        <section aria-labelledby="propuestas-titulo">
          <h2 id="propuestas-titulo">Propuestas</h2>
          {propuestas.length === 0 ? (
            <Vacio
              titulo="Este problema no tiene propuestas todavía"
              salida={{ href: `/propuestas/nueva?problema=${id}`, texto: 'Me ofrezco a redactar' }}
            >
              <p>La siguiente tarea es que alguien escriba una: no hace falta permiso de nadie.</p>
            </Vacio>
          ) : (
            <>
              <ul className="tarjetas">
                {propuestas.map((propuesta) => (
                  <Tarjeta
                    key={propuesta.id}
                    titulo={propuesta.titulo}
                    enlace={`/propuestas/${propuesta.id}`}
                  >
                    <Meta>
                      {`Versión ${String(propuesta.versionVigente)}${
                        propuesta.versionVigente > 1 ? ' — las anteriores siguen visibles' : ''
                      }`}
                    </Meta>
                  </Tarjeta>
                ))}
              </ul>
              <p>
                <Link className="boton secundario" href={`/propuestas/nueva?problema=${id}`}>
                  Escribir otra propuesta
                </Link>
              </p>
            </>
          )}
        </section>

        {sesion === undefined && (
          <Aviso tipo="atencion" titulo="Estás mirando sin cuenta">
            Para aportar o proponer hay que entrar con el correo institucional.{' '}
            <Link href="/entrar">Entrar</Link>.
          </Aviso>
        )}
      </div>
    </div>
  );
}
