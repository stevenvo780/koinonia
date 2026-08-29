'use client';

/**
 * Convocar una reunión (PRODUCT §4).
 *
 * El orden del día no es un campo de texto libre: es una lista de puntos, y cada uno puede enlazar
 * el problema o la deliberación que va a tratar. Enlazarlo acá es lo que después permite, en el
 * detalle de la reunión, ir directo del punto a lo que ya se escribió sobre el tema — la reunión no
 * es donde arranca la conversación, es donde se retoma.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { datetimeLocalColombia, instanteColombia } from '@koinonia/contracts';
import { useCallback, useEffect, useState, type ReactNode, type SyntheticEvent } from 'react';

import type { DeliberacionResumen, ProblemaResumen, ReunionDetalle } from '@koinonia/contracts';

import { Aviso, Cargando, ErrorVisible, useSesion } from '../../../components/marco';
import { useAccionUnica } from '../../../lib/acciones';
import { enviar, traer } from '../../../lib/api';

interface Circulo {
  readonly id: string;
  readonly nombre: string;
  readonly decideSinConsultar: string;
}

interface PuntoBorrador {
  readonly texto: string;
  readonly problemaId: string;
  readonly deliberacionId: string;
}

function puntoVacio(): PuntoBorrador {
  return { texto: '', problemaId: '', deliberacionId: '' };
}

export default function NuevaReunion(): ReactNode {
  const router = useRouter();
  const { sesion, cargando } = useSesion();

  const [circulos, setCirculos] = useState<Circulo[] | undefined>(undefined);
  const [problemas, setProblemas] = useState<ProblemaResumen[] | undefined>(undefined);
  const [deliberaciones, setDeliberaciones] = useState<DeliberacionResumen[] | undefined>(
    undefined,
  );
  const [errorListas, setErrorListas] = useState<unknown>(undefined);

  const [titulo, setTitulo] = useState('');
  const [circuloId, setCirculoId] = useState('');
  const [fechaHora, setFechaHora] = useState(() => datetimeLocalColombia(Date.now() + 86_400_000));
  const [lugar, setLugar] = useState('');
  const [enlaceRemoto, setEnlaceRemoto] = useState('');
  const [puntos, setPuntos] = useState<PuntoBorrador[]>([puntoVacio()]);
  const [error, setError] = useState<unknown>(undefined);
  const { enCurso, ejecutar } = useAccionUnica();

  const cargarListas = useCallback(() => {
    setErrorListas(undefined);
    Promise.all([
      traer<Circulo[]>('/circulos'),
      traer<ProblemaResumen[]>('/problemas'),
      traer<DeliberacionResumen[]>('/deliberaciones'),
    ])
      .then(([listaCirculos, listaProblemas, listaDeliberaciones]) => {
        setCirculos(listaCirculos);
        setCirculoId(listaCirculos[0]?.id ?? '');
        setProblemas(listaProblemas);
        setDeliberaciones(listaDeliberaciones);
      })
      .catch(setErrorListas);
  }, []);

  useEffect(cargarListas, [cargarListas]);

  function actualizarPunto(indice: number, cambios: Partial<PuntoBorrador>): void {
    setPuntos((actual) => actual.map((p, i) => (i === indice ? { ...p, ...cambios } : p)));
  }

  function agregarPunto(): void {
    setPuntos((actual) => [...actual, puntoVacio()]);
  }

  function quitarPunto(indice: number): void {
    setPuntos((actual) => actual.filter((_p, i) => i !== indice));
  }

  async function guardar(evento: SyntheticEvent): Promise<void> {
    evento.preventDefault();
    setError(undefined);

    if (lugar.trim() === '' && enlaceRemoto.trim() === '') {
      setError(new Error('Decí dónde es: un lugar físico, un enlace remoto, o los dos.'));
      return;
    }
    const ordenDelDia = puntos
      .filter((p) => p.texto.trim() !== '')
      .map((p) => ({
        texto: p.texto,
        ...(p.problemaId === '' ? {} : { problemaId: p.problemaId }),
        ...(p.deliberacionId === '' ? {} : { deliberacionId: p.deliberacionId }),
      }));
    if (ordenDelDia.length === 0) {
      setError(new Error('Una reunión se convoca con orden del día: agregá al menos un punto.'));
      return;
    }

    let cuandoMs: number;
    try {
      cuandoMs = instanteColombia(fechaHora);
    } catch (errorFecha) {
      setError(errorFecha);
      return;
    }

    const datos = { titulo, circuloId, cuandoMs, lugar, enlaceRemoto, ordenDelDia };
    const resultado = await ejecutar('convocar', datos, (requestId) =>
      enviar<ReunionDetalle>('/reuniones', {
        requestId,
        titulo,
        circuloId,
        cuando: cuandoMs,
        ...(lugar.trim() === '' ? {} : { lugar }),
        ...(enlaceRemoto.trim() === '' ? {} : { enlaceRemoto }),
        ordenDelDia,
      }),
    );
    if (resultado.estado === 'hecho') router.push(`/reuniones/${resultado.valor.id}`);
    else if (resultado.estado === 'fallo') setError(resultado.error);
  }

  const listasListas =
    circulos !== undefined && problemas !== undefined && deliberaciones !== undefined;

  return (
    <div className="pagina-prosa">
      <h1>Convocar una reunión</h1>
      <p className="lede">
        Con orden del día: quien no puede ir tiene que poder saber, de antemano, qué se va a tratar.
      </p>

      {!cargando && sesion === undefined && (
        <Aviso tipo="atencion" titulo="Antes de convocar">
          Para que quede constancia hay que entrar con el correo institucional.{' '}
          <Link href="/entrar">Entrar ahora</Link>.
        </Aviso>
      )}

      <ErrorVisible error={error} />

      {errorListas !== undefined ? (
        <>
          <ErrorVisible error={errorListas} />
          <p>
            <button className="boton" type="button" onClick={cargarListas}>
              Volver a intentar
            </button>{' '}
            <Link className="boton secundario" href="/reuniones">
              Ver las reuniones que ya existen
            </Link>
          </p>
        </>
      ) : !listasListas ? (
        <>
          <div aria-hidden="true">
            <div className="esqueleto-linea" style={{ width: '55%' }} />
            <div
              className="esqueleto-linea"
              style={{ height: '2.75rem', marginTop: 'var(--e2)' }}
            />
            <div className="esqueleto-linea" style={{ width: '70%' }} />
          </div>
          <div className="solo-lectores">
            <Cargando que="los grupos, problemas y deliberaciones" />
          </div>
        </>
      ) : (
        <form onSubmit={(e) => void guardar(e)} noValidate>
          <div className="campo">
            <label htmlFor="titulo">¿De qué trata la reunión?</label>
            <input
              id="titulo"
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
            <label htmlFor="circulo">¿Qué grupo la convoca?</label>
            <select
              id="circulo"
              value={circuloId}
              onChange={(e) => {
                setCirculoId(e.target.value);
              }}
            >
              {circulos.map((circulo) => (
                <option key={circulo.id} value={circulo.id}>
                  {circulo.nombre}
                </option>
              ))}
            </select>
          </div>

          <div className="campo">
            <label htmlFor="cuando">¿Cuándo, en hora de Colombia?</label>
            <input
              id="cuando"
              type="datetime-local"
              required
              value={fechaHora}
              onChange={(e) => {
                setFechaHora(e.target.value);
              }}
            />
          </div>

          <div className="campo">
            <label htmlFor="lugar">Lugar físico</label>
            <span className="ayuda" id="ayuda-lugar">
              Un salón, un punto de encuentro. Podés dejarlo vacío si es sólo remota.
            </span>
            <input
              id="lugar"
              type="text"
              maxLength={200}
              aria-describedby="ayuda-lugar"
              value={lugar}
              onChange={(e) => {
                setLugar(e.target.value);
              }}
            />
          </div>

          <div className="campo">
            <label htmlFor="enlace-remoto">Enlace remoto</label>
            <span className="ayuda" id="ayuda-enlace-remoto">
              Si además —o en cambio— hay cómo entrar de forma remota. Un lugar, un enlace, o los
              dos: hace falta al menos uno.
            </span>
            <input
              id="enlace-remoto"
              type="text"
              maxLength={500}
              aria-describedby="ayuda-enlace-remoto"
              value={enlaceRemoto}
              onChange={(e) => {
                setEnlaceRemoto(e.target.value);
              }}
            />
          </div>

          <fieldset className="formulario-acotado">
            <legend>Orden del día</legend>
            {puntos.map((punto, indice) => (
              // El índice como clave es correcto acá: la lista sólo crece al final y se quita por
              // posición, nunca se reordena, así que no hay forma de que dos filas confundan su
              // estado entre sí.
              <fieldset key={indice} className="formulario-acotado">
                <legend>Punto {indice + 1}</legend>
                <div className="campo">
                  <label htmlFor={`punto-${String(indice)}-texto`}>¿Qué se va a tratar?</label>
                  <textarea
                    id={`punto-${String(indice)}-texto`}
                    required={indice === 0}
                    minLength={10}
                    maxLength={4000}
                    value={punto.texto}
                    onChange={(e) => {
                      actualizarPunto(indice, { texto: e.target.value });
                    }}
                  />
                </div>
                <div className="campo">
                  <label htmlFor={`punto-${String(indice)}-problema`}>
                    ¿A qué problema responde? (opcional)
                  </label>
                  <select
                    id={`punto-${String(indice)}-problema`}
                    value={punto.problemaId}
                    onChange={(e) => {
                      actualizarPunto(indice, { problemaId: e.target.value });
                    }}
                  >
                    <option value="">Ninguno</option>
                    {problemas.map((problema) => (
                      <option key={problema.id} value={problema.id}>
                        {problema.titulo}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="campo">
                  <label htmlFor={`punto-${String(indice)}-deliberacion`}>
                    ¿Qué conversación retoma? (opcional)
                  </label>
                  <select
                    id={`punto-${String(indice)}-deliberacion`}
                    value={punto.deliberacionId}
                    onChange={(e) => {
                      actualizarPunto(indice, { deliberacionId: e.target.value });
                    }}
                  >
                    <option value="">Ninguna</option>
                    {deliberaciones.map((deliberacion) => (
                      <option key={deliberacion.id} value={deliberacion.id}>
                        {deliberacion.problemaTitulo}
                      </option>
                    ))}
                  </select>
                </div>
                {puntos.length > 1 && (
                  <button
                    className="boton texto"
                    type="button"
                    onClick={() => {
                      quitarPunto(indice);
                    }}
                  >
                    Quitar este punto
                  </button>
                )}
              </fieldset>
            ))}
            <p>
              <button className="boton secundario" type="button" onClick={agregarPunto}>
                Agregar otro punto
              </button>
            </p>
          </fieldset>

          <button
            className="boton"
            type="submit"
            disabled={cargando || sesion === undefined || enCurso !== undefined}
          >
            {enCurso === 'convocar' ? 'Convocando…' : 'Convocar la reunión'}
          </button>
        </form>
      )}
    </div>
  );
}
