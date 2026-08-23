'use client';

/**
 * Un plan: la vista de conjunto.
 *
 * Es el «hub» al que se vuelve entre preguntas: la frase tal como va, el mapa de las 27 con su
 * marca, y las dos acciones que sólo tienen sentido acá —decidir el consentimiento y cerrar el
 * borrador—. La pregunta en sí vive en su propia pantalla (`preguntas/[numero]`): PRODUCT.md §5 pide
 * una por pantalla, y mezclar el formulario de una pregunta con el resumen de las 27 sería romper
 * esa regla en el sitio que más la necesita.
 */

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import type { BorradorDetalleDto, PreguntaAsistenteDto } from '@koinonia/contracts';

import {
  ConsentimientoIA,
  FichaEstadoBorrador,
  FraseCierre,
  MapaDePreguntas,
  marcasDePreguntas,
  necesitaMostrarConsentimiento,
} from '../../../components/asistente';
import { Aviso, Cargando, ErrorVisible } from '../../../components/marco';
import { useAccionUnica } from '../../../lib/acciones';
import { cerrarFrase, cuando, enviar, respuestaEsperada, traer } from '../../../lib/api';

export default function DetalleBorrador(): ReactNode {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [detalle, setDetalle] = useState<BorradorDetalleDto | undefined>(undefined);
  const [preguntas, setPreguntas] = useState<PreguntaAsistenteDto[] | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  // Separado del error de carga a propósito: un fallo al cerrar no puede reemplazar la pantalla
  // entera por la rama de «no pudimos abrir este plan» cuando el plan sí se abrió.
  const [errorAccion, setErrorAccion] = useState<unknown>(undefined);
  const [sinPermiso, setSinPermiso] = useState<string | undefined>(undefined);
  const { enCurso, ejecutar } = useAccionUnica();

  const cargar = useCallback(async (): Promise<void> => {
    try {
      const actual = await traer<BorradorDetalleDto>(`/asistente/borradores/${id}`);
      setDetalle(actual);
      setError(undefined);
      setSinPermiso(undefined);
    } catch (fallo: unknown) {
      if (respuestaEsperada(fallo, 401)) {
        setSinPermiso('Para ver este plan hay que entrar con el correo institucional.');
        return;
      }
      if (respuestaEsperada(fallo, 403)) {
        setSinPermiso('Este plan es de otra persona: cada quien ve y escribe sólo el suyo.');
        return;
      }
      setError(fallo);
    }
  }, [id]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    traer<PreguntaAsistenteDto[]>('/asistente/preguntas')
      .then(setPreguntas)
      .catch(() => undefined);
  }, []);

  async function cerrar(): Promise<void> {
    setErrorAccion(undefined);
    const resultado = await ejecutar('cerrar', {}, () =>
      enviar<BorradorDetalleDto>(`/asistente/borradores/${id}/cerrar`, {}),
    );
    if (resultado.estado === 'hecho') setDetalle(resultado.valor);
    else if (resultado.estado === 'fallo') setErrorAccion(resultado.error);
  }

  if (sinPermiso !== undefined) {
    return (
      <div className="pagina-prosa">
        <h1>No podés ver este plan</h1>
        <p>{sinPermiso}</p>
        <p>
          <Link className="boton secundario" href="/asistente">
            Ver tus planes
          </Link>
        </p>
      </div>
    );
  }

  if (error !== undefined) {
    return (
      <div className="pagina-prosa">
        <h1>No pudimos abrir este plan</h1>
        <ErrorVisible error={error} />
        <p>
          <button className="boton" type="button" onClick={() => void cargar()}>
            Volver a intentar
          </button>{' '}
          <Link className="boton secundario" href="/asistente">
            Ver tus planes
          </Link>
        </p>
      </div>
    );
  }

  if (detalle === undefined) return <Cargando que="el plan" completa />;

  const marcas = marcasDePreguntas(detalle);

  return (
    <div className="pagina-detalle">
      <h1>Tu plan</h1>

      <aside className="carril-estado" aria-label="Estado del plan">
        <section aria-labelledby="estado-plan-titulo">
          <h2 id="estado-plan-titulo">Estado</h2>
          <p>
            <FichaEstadoBorrador estado={detalle.estado} />
          </p>
          <p className="suave">
            {String(detalle.cuantasRespondidas)} de 27 preguntas respondidas.
            {detalle.cerradoEn !== undefined && (
              <> Se cerró el {cerrarFrase(cuando(detalle.cerradoEn))}</>
            )}
          </p>

          {detalle.estado === 'redactando' && (
            <p>
              <Link
                className="boton accion"
                href={`/asistente/${id}/preguntas/${String(detalle.siguiente ?? 1)}`}
              >
                {detalle.cuantasRespondidas === 0 ? 'Empezar a responder' : 'Seguir donde ibas'}
              </Link>
            </p>
          )}
        </section>

        {detalle.estado === 'redactando' && (
          <section aria-labelledby="cerrar-plan-titulo">
            <h2 id="cerrar-plan-titulo">Cerrar el plan</h2>
            {detalle.puedeCerrarse ? (
              <div className="accion-procedimiento">
                <p className="suave" id="ayuda-cerrar">
                  Cerrarlo no borra nada ni impide seguir usándolo: sólo deja constancia de que este
                  plan, tal como está, es el que se usó para escribir el problema o la propuesta.
                </p>
                <button
                  className="boton secundario"
                  type="button"
                  aria-describedby="ayuda-cerrar"
                  disabled={enCurso !== undefined}
                  onClick={() => void cerrar()}
                >
                  {enCurso === 'cerrar' ? 'Cerrando…' : 'Cerrar este plan'}
                </button>
                <ErrorVisible error={errorAccion} />
              </div>
            ) : (
              <p className="suave">
                Todavía faltan la 1 o la 11 —las dos únicas obligatorias— para poder cerrarlo. Las
                otras 25 se pueden dejar con «todavía no sé».
              </p>
            )}
          </section>
        )}
      </aside>

      <div className="cuerpo-detalle">
        <section aria-labelledby="frase-plan-titulo">
          <h2 id="frase-plan-titulo">Cómo va quedando</h2>
          <FraseCierre frase={detalle.frase} borradorId={id} />
        </section>

        {detalle.desajustes.length > 0 && (
          <Aviso tipo="atencion" titulo="Una lista quedó desalineada">
            {detalle.desajustes.map((desajuste) => (
              <p key={desajuste.pregunta}>
                La pregunta {desajuste.pregunta} tiene {desajuste.tiene}{' '}
                {desajuste.tiene === 1 ? 'línea' : 'líneas'}, pero la {desajuste.deLaPregunta} ahora
                tiene {desajuste.deberiaTener}.{' '}
                <Link href={`/asistente/${id}/preguntas/${String(desajuste.pregunta)}`}>
                  Revisar la {desajuste.pregunta}
                </Link>
                .
              </p>
            ))}
          </Aviso>
        )}

        {necesitaMostrarConsentimiento(detalle) && (
          <section aria-labelledby="consentimiento-titulo">
            <h2 id="consentimiento-titulo">Ayuda automática</h2>
            <ConsentimientoIA
              borradorId={id}
              consentimiento={detalle.consentimiento}
              onDecidido={setDetalle}
            />
          </section>
        )}

        <section aria-labelledby="preguntas-titulo">
          <h2 id="preguntas-titulo">Las 27 preguntas</h2>
          {preguntas === undefined ? (
            <Cargando que="las preguntas" />
          ) : (
            <MapaDePreguntas preguntas={preguntas} marcas={marcas} borradorId={id} />
          )}
        </section>
      </div>
    </div>
  );
}
