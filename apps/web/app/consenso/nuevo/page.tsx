'use client';

/**
 * Abrir un sondeo.
 *
 * Este trámite sólo cubre de qué se trata y por qué es controvertido. Sembrar las doce afirmaciones
 * fundacionales —al menos tres contrarias a la propia postura de quien convoca— pasa en la pantalla
 * siguiente, una por una, con su propio contador: es la condición que ADR-0038 exige para que el
 * sondeo se abra solo a que cualquiera lo valore, y no hay forma de saltársela desde acá.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode, type SyntheticEvent } from 'react';

import type {
  AsuntoSondeo,
  ProblemaResumen,
  PropuestaResumen,
  SondeoResumen,
} from '@koinonia/contracts';

import { Aviso, Cargando, ErrorVisible, useSesion } from '../../../components/marco';
import { useAccionUnica } from '../../../lib/acciones';
import { enviar, traer } from '../../../lib/api';

interface AsuntoElegible {
  readonly id: string;
  readonly titulo: string;
}

const RUTA_POR_TIPO: Readonly<Record<AsuntoSondeo, string>> = {
  problema: '/problemas',
  propuesta: '/propuestas',
};

const NOMBRE_POR_TIPO: Readonly<Record<AsuntoSondeo, string>> = {
  problema: 'problema',
  propuesta: 'propuesta',
};

export default function NuevoSondeo(): ReactNode {
  const router = useRouter();
  const { sesion, cargando } = useSesion();

  const [asuntoTipo, setAsuntoTipo] = useState<AsuntoSondeo>('problema');
  const [asuntos, setAsuntos] = useState<readonly AsuntoElegible[] | undefined>(undefined);
  const [errorAsuntos, setErrorAsuntos] = useState<unknown>(undefined);
  const [asuntoId, setAsuntoId] = useState('');
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<unknown>(undefined);
  const { enCurso, ejecutar } = useAccionUnica();

  const cargarAsuntos = useCallback((tipo: AsuntoSondeo) => {
    setAsuntos(undefined);
    setErrorAsuntos(undefined);
    setAsuntoId('');
    traer<(ProblemaResumen | PropuestaResumen)[]>(RUTA_POR_TIPO[tipo])
      .then((lista) => {
        const simple = lista.map((item) => ({ id: item.id, titulo: item.titulo }));
        setAsuntos(simple);
        setAsuntoId(simple[0]?.id ?? '');
      })
      .catch(setErrorAsuntos);
  }, []);

  useEffect(() => {
    cargarAsuntos(asuntoTipo);
  }, [asuntoTipo, cargarAsuntos]);

  async function guardar(evento: SyntheticEvent): Promise<void> {
    evento.preventDefault();
    setError(undefined);
    const resultado = await ejecutar('abrir', { asuntoTipo, asuntoId, motivo }, (requestId) =>
      enviar<SondeoResumen>('/sondeos', { requestId, asuntoId, asuntoTipo, motivo }),
    );
    if (resultado.estado === 'hecho') router.push(`/consenso/${resultado.valor.id}`);
    else if (resultado.estado === 'fallo') setError(resultado.error);
  }

  return (
    <div className="pagina-prosa">
      <h1>Abrir un sondeo</h1>

      <p>
        Un sondeo sirve para un asunto controvertido, o con propuestas contradictorias circulando,
        donde conviene saber qué reúne acuerdo transversal antes de seguir discutiendo.{' '}
        <strong>No decide nada:</strong> sólo filtra qué entra a la agenda siguiente.
      </p>

      <Aviso tipo="atencion" titulo="Antes de abrirlo">
        Te vas a comprometer a sembrar doce afirmaciones cortas antes de que cualquier otra persona
        pueda valorar algo, y al menos tres de esas doce tienen que contradecir tu propia postura.
        Sin eso, el sondeo se queda armándose.
      </Aviso>

      {!cargando && sesion === undefined && (
        <Aviso tipo="atencion" titulo="Antes de convocarlo">
          Para que quede a tu nombre hay que entrar con el correo institucional.{' '}
          <Link href="/entrar">Entrar ahora</Link>.
        </Aviso>
      )}

      <ErrorVisible error={error} />

      {errorAsuntos !== undefined ? (
        <>
          <ErrorVisible error={errorAsuntos} />
          <p>
            No pudimos traer la lista para elegir, y sin ella no se puede abrir el sondeo. No perdés
            nada por intentarlo otra vez.
          </p>
          <button
            className="boton"
            type="button"
            onClick={() => {
              cargarAsuntos(asuntoTipo);
            }}
          >
            Volver a intentar
          </button>
        </>
      ) : asuntos === undefined ? (
        <>
          <div aria-hidden="true">
            <div className="esqueleto-linea" style={{ width: '55%' }} />
            <div
              className="esqueleto-linea"
              style={{ height: '2.75rem', marginTop: 'var(--e2)' }}
            />
          </div>
          <div className="solo-lectores">
            <Cargando que="los problemas y las propuestas" />
          </div>
        </>
      ) : (
        <form onSubmit={(e) => void guardar(e)} noValidate>
          <fieldset className="opciones">
            <legend>¿Sobre qué es?</legend>
            <div className="opcion">
              <input
                type="radio"
                id="tipo-problema"
                name="tipo"
                checked={asuntoTipo === 'problema'}
                onChange={() => {
                  setAsuntoTipo('problema');
                }}
              />
              <label htmlFor="tipo-problema">Un problema</label>
            </div>
            <div className="opcion">
              <input
                type="radio"
                id="tipo-propuesta"
                name="tipo"
                checked={asuntoTipo === 'propuesta'}
                onChange={() => {
                  setAsuntoTipo('propuesta');
                }}
              />
              <label htmlFor="tipo-propuesta">Una propuesta</label>
            </div>
          </fieldset>

          {asuntos.length === 0 ? (
            <Aviso tipo="atencion" titulo="No hay nada para elegir">
              Todavía no hay ningún {NOMBRE_POR_TIPO[asuntoTipo]} escrito.{' '}
              <Link href={RUTA_POR_TIPO[asuntoTipo]}>
                Ver {asuntoTipo === 'problema' ? 'los problemas' : 'las propuestas'}
              </Link>
              .
            </Aviso>
          ) : (
            <div className="campo">
              <label htmlFor="asunto">
                {asuntoTipo === 'problema' ? 'Qué problema' : 'Qué propuesta'}
              </label>
              <select
                id="asunto"
                value={asuntoId}
                onChange={(e) => {
                  setAsuntoId(e.target.value);
                }}
              >
                {asuntos.map((asunto) => (
                  <option key={asunto.id} value={asunto.id}>
                    {asunto.titulo}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="campo">
            <label htmlFor="motivo">¿Por qué este asunto necesita un sondeo?</label>
            <span className="ayuda" id="ayuda-motivo">
              Decí por qué es controvertido o tiene propuestas contradictorias circulando. Entre 20
              y 500 caracteres.
            </span>
            <textarea
              id="motivo"
              required
              minLength={20}
              maxLength={500}
              aria-describedby="ayuda-motivo"
              value={motivo}
              onChange={(e) => {
                setMotivo(e.target.value);
              }}
            />
          </div>

          <button
            className="boton"
            type="submit"
            disabled={enCurso !== undefined || asuntos.length === 0}
          >
            {enCurso === 'abrir' ? 'Abriendo…' : 'Abrir el sondeo y empezar a sembrar'}
          </button>
        </form>
      )}
    </div>
  );
}
