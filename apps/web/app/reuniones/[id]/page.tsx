'use client';

/**
 * El detalle de una reunión (PRODUCT §4).
 *
 * Antes de que haya acta, esto enseña el orden del día —con sus problemas y deliberaciones
 * enlazados, para que quien no puede ir sepa exactamente de qué se va a hablar—. Después de
 * publicarse, enseña qué pasó: quién estuvo (o la ausencia declarada de esa lista), qué se acordó,
 * y qué acuerdo ya se convirtió en una propuesta real del recorrido.
 *
 * ═══ El enlace automático tras crear la propuesta ═══
 *
 * «Convertir este acuerdo en propuesta» manda a `/propuestas/nueva` —la única puerta para crear una
 * propuesta— con el problema, la reunión y el acuerdo ya elegidos. Al guardar, esa pantalla vuelve
 * ACÁ con `?propuesta-creada=…&acuerdo=…` en vez de ir directo al detalle de la propuesta nueva, y
 * este componente hace el enlace él mismo, en cuanto carga. Es a propósito y no un rodeo: si el
 * enlace fallara —una red que se corta entre las dos llamadas—, la persona ya está en la pantalla
 * correcta para reintentarlo con un botón, en vez de perdida en el detalle de una propuesta que no
 * sabe si quedó enlazada. Y el reintento es seguro: si ya estaba enlazada, el servidor lo dice con
 * su propio código y esta pantalla lo trata como éxito, no como error.
 */

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from 'react';

import type {
  AcuerdoDeReunion,
  MiembroCirculo,
  ProblemaResumen,
  ReunionDetalle,
} from '@koinonia/contracts';

import { Aviso, Cargando, ErrorVisible, useSesion } from '../../../components/marco';
import { Ficha, Meta } from '../../../components/piezas';
import { useAccionUnica } from '../../../lib/acciones';
import { cuando, enviar, miembrosDelCirculo, nuevoRequestId, traer } from '../../../lib/api';

interface AcuerdoBorrador {
  readonly texto: string;
  readonly problemaId: string;
}

function acuerdoVacio(): AcuerdoBorrador {
  return { texto: '', problemaId: '' };
}

function FormularioActa({
  reunion,
  onPublicada,
}: {
  readonly reunion: ReunionDetalle;
  readonly onPublicada: (siguiente: ReunionDetalle) => void;
}): ReactNode {
  const [problemas, setProblemas] = useState<ProblemaResumen[] | undefined>(undefined);
  const [roster, setRoster] = useState<MiembroCirculo[] | undefined>(undefined);
  const [rosterVisible, setRosterVisible] = useState(true);
  const [resumen, setResumen] = useState('');
  const [asistentes, setAsistentes] = useState<string[]>([]);
  const [acuerdos, setAcuerdos] = useState<AcuerdoBorrador[]>([acuerdoVacio()]);
  const [error, setError] = useState<unknown>(undefined);
  const { enCurso, ejecutar } = useAccionUnica();

  useEffect(() => {
    traer<ProblemaResumen[]>('/problemas')
      .then(setProblemas)
      .catch(() => {
        setProblemas([]);
      });
    miembrosDelCirculo(reunion.circuloId)
      .then((lista) => {
        setRosterVisible(lista !== undefined);
        setRoster(lista ?? []);
      })
      .catch(() => {
        setRosterVisible(false);
        setRoster([]);
      });
  }, [reunion.circuloId]);

  function actualizarAcuerdo(indice: number, cambios: Partial<AcuerdoBorrador>): void {
    setAcuerdos((actual) => actual.map((a, i) => (i === indice ? { ...a, ...cambios } : a)));
  }

  async function publicar(evento: SyntheticEvent): Promise<void> {
    evento.preventDefault();
    setError(undefined);
    const acuerdosEnviar = acuerdos
      .filter((a) => a.texto.trim() !== '')
      .map((a) => ({
        texto: a.texto,
        ...(a.problemaId === '' ? {} : { problemaId: a.problemaId }),
      }));
    const resultado = await ejecutar(
      'publicar-acta',
      { resumen, asistentes, acuerdosEnviar },
      (requestId) =>
        enviar<ReunionDetalle>(`/reuniones/${reunion.id}/acta`, {
          requestId,
          resumen,
          asistentes,
          acuerdos: acuerdosEnviar,
        }),
    );
    if (resultado.estado === 'hecho') onPublicada(resultado.valor);
    else if (resultado.estado === 'fallo') setError(resultado.error);
  }

  return (
    <section aria-labelledby="publicar-acta-titulo">
      <h2 id="publicar-acta-titulo">Publicar el acta</h2>
      <p className="suave">
        Deja constancia de lo que pasó, para que quien no pudo ir no pierda participación.
      </p>

      <ErrorVisible error={error} />

      <form onSubmit={(e) => void publicar(e)}>
        <div className="campo">
          <label htmlFor="resumen">¿Qué pasó?</label>
          <span className="ayuda" id="ayuda-resumen">
            Mínimo 30 caracteres: lo que se discutió y hacia dónde quedó, aunque no se haya acordado
            nada concreto.
          </span>
          <textarea
            id="resumen"
            required
            minLength={30}
            maxLength={4000}
            aria-describedby="ayuda-resumen"
            value={resumen}
            onChange={(e) => {
              setResumen(e.target.value);
            }}
          />
        </div>

        {rosterVisible ? (
          <fieldset className="seleccion-evidencias">
            <legend>¿Quién estuvo?</legend>
            <p className="suave">
              Podés dejarlo vacío: se publica igual, marcado como acta sin asistentes.
            </p>
            {(roster ?? []).map((persona) => (
              <label key={persona.id}>
                <input
                  type="checkbox"
                  checked={asistentes.includes(persona.id)}
                  onChange={(evento) => {
                    setAsistentes((actual) =>
                      evento.target.checked
                        ? [...actual, persona.id]
                        : actual.filter((id) => id !== persona.id),
                    );
                  }}
                />{' '}
                {persona.alias}
              </label>
            ))}
            {(roster ?? []).length === 0 && (
              <p className="suave">Todavía no hay nadie inscrito en este grupo.</p>
            )}
          </fieldset>
        ) : (
          <Aviso tipo="atencion" titulo="No se puede marcar quién estuvo">
            No podés ver la lista de integrantes de este grupo, así que el acta se publica sin
            asistentes marcados. No es un impedimento para publicarla: sólo significa que no va a
            servir para decisiones que dependan de quiénes estaban.
          </Aviso>
        )}

        <fieldset className="formulario-acotado">
          <legend>Acuerdos</legend>
          <p className="suave">
            Los que nombran a qué problema responden pueden convertirse después en una propuesta.
          </p>
          {acuerdos.map((acuerdo, indice) => (
            // El índice como clave es correcto: la lista sólo crece al final y se quita por
            // posición, igual que el orden del día al convocar.
            <fieldset key={indice} className="formulario-acotado">
              <legend>Acuerdo {indice + 1}</legend>
              <div className="campo">
                <label htmlFor={`acuerdo-${String(indice)}-texto`}>¿Qué se acordó?</label>
                <textarea
                  id={`acuerdo-${String(indice)}-texto`}
                  minLength={15}
                  maxLength={4000}
                  value={acuerdo.texto}
                  onChange={(e) => {
                    actualizarAcuerdo(indice, { texto: e.target.value });
                  }}
                />
              </div>
              <div className="campo">
                <label htmlFor={`acuerdo-${String(indice)}-problema`}>
                  ¿A qué problema responde? (opcional)
                </label>
                <select
                  id={`acuerdo-${String(indice)}-problema`}
                  value={acuerdo.problemaId}
                  onChange={(e) => {
                    actualizarAcuerdo(indice, { problemaId: e.target.value });
                  }}
                >
                  <option value="">Ninguno</option>
                  {(problemas ?? []).map((problema) => (
                    <option key={problema.id} value={problema.id}>
                      {problema.titulo}
                    </option>
                  ))}
                </select>
              </div>
              {acuerdos.length > 1 && (
                <button
                  className="boton texto"
                  type="button"
                  onClick={() => {
                    setAcuerdos((actual) => actual.filter((_a, i) => i !== indice));
                  }}
                >
                  Quitar este acuerdo
                </button>
              )}
            </fieldset>
          ))}
          <p>
            <button
              className="boton secundario"
              type="button"
              onClick={() => {
                setAcuerdos((actual) => [...actual, acuerdoVacio()]);
              }}
            >
              Agregar otro acuerdo
            </button>
          </p>
        </fieldset>

        <button className="boton" type="submit" disabled={enCurso !== undefined}>
          {enCurso === 'publicar-acta' ? 'Publicando…' : 'Publicar el acta'}
        </button>
      </form>
    </section>
  );
}

function Acuerdo({
  acuerdo,
  reunionId,
}: {
  readonly acuerdo: AcuerdoDeReunion;
  readonly reunionId: string;
}): ReactNode {
  return (
    <li>
      <p>{acuerdo.texto}</p>
      {acuerdo.problemaTitulo !== undefined && acuerdo.problemaId !== undefined && (
        <p className="suave">
          Responde a:{' '}
          <Link href={`/problemas/${acuerdo.problemaId}`}>{acuerdo.problemaTitulo}</Link>
        </p>
      )}
      {acuerdo.propuestaId !== undefined ? (
        <p>
          Se convirtió en la propuesta:{' '}
          <Link href={`/propuestas/${acuerdo.propuestaId}`}>verla</Link>
        </p>
      ) : acuerdo.puedeConvertirseEnPropuesta && acuerdo.problemaId !== undefined ? (
        <p>
          <Link
            className="boton secundario"
            href={`/propuestas/nueva?problema=${acuerdo.problemaId}&reunion=${reunionId}&acuerdo=${acuerdo.id}`}
          >
            Convertir este acuerdo en propuesta
          </Link>
        </p>
      ) : null}
    </li>
  );
}

function Detalle(): ReactNode {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const searchParams = useSearchParams();
  const { sesion } = useSesion();

  const [reunion, setReunion] = useState<ReunionDetalle | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const [errorEnlace, setErrorEnlace] = useState<unknown>(undefined);
  const [enlazando, setEnlazando] = useState(false);
  // Evita repetir el enlace automático dos veces en el mismo montaje (React StrictMode, o una
  // segunda pasada del efecto por otro motivo): una vez que se intentó para este par no se reintenta
  // solo, sólo con el botón de «Volver a intentar» de más abajo.
  const yaIntentado = useRef(false);

  const recargar = useCallback(() => {
    setError(undefined);
    traer<ReunionDetalle>(`/reuniones/${id}`).then(setReunion).catch(setError);
  }, [id]);

  useEffect(recargar, [recargar]);

  const propuestaCreada = searchParams.get('propuesta-creada');
  const acuerdoDeLaCreacion = searchParams.get('acuerdo');

  const enlazarConLaPropuestaCreada = useCallback(async (): Promise<void> => {
    if (propuestaCreada === null || acuerdoDeLaCreacion === null) return;
    setErrorEnlace(undefined);
    setEnlazando(true);
    try {
      const siguiente = await enviar<ReunionDetalle>(
        `/reuniones/${id}/acuerdos/${acuerdoDeLaCreacion}/propuesta`,
        { requestId: nuevoRequestId(), propuestaId: propuestaCreada },
      );
      setReunion(siguiente);
    } catch (fallo) {
      // Ya enlazada (por ejemplo, un reintento tras haber tenido éxito) no es un error: es el
      // resultado que se estaba buscando.
      if (fallo instanceof Error && fallo.message.includes('ya se había convertido')) {
        recargar();
      } else {
        setErrorEnlace(fallo);
      }
    } finally {
      setEnlazando(false);
    }
  }, [propuestaCreada, acuerdoDeLaCreacion, id, recargar]);

  useEffect(() => {
    if (propuestaCreada === null || acuerdoDeLaCreacion === null || reunion === undefined) return;
    const yaEnlazado = reunion.acuerdos.some(
      (a) => a.id === acuerdoDeLaCreacion && a.propuestaId === propuestaCreada,
    );
    if (yaEnlazado || yaIntentado.current) return;
    yaIntentado.current = true;
    void enlazarConLaPropuestaCreada();
    // Limpia la dirección para que recargar la página no reintente el enlace de nuevo, y para que
    // compartir el enlace de esta reunión no arrastre el estado de una conversión ajena.
    router.replace(`/reuniones/${id}`);
  }, [propuestaCreada, acuerdoDeLaCreacion, reunion, enlazarConLaPropuestaCreada, router, id]);

  if (error !== undefined) {
    return (
      <div className="pagina-prosa">
        <h1>No pudimos abrir esta reunión</h1>
        <ErrorVisible error={error} />
        <p>
          <button className="boton" type="button" onClick={recargar}>
            Volver a intentar
          </button>{' '}
          <Link className="boton secundario" href="/reuniones">
            Ver todas las reuniones
          </Link>
        </p>
      </div>
    );
  }

  if (reunion === undefined) {
    return (
      <div className="pagina-prosa cargando-completa">
        <Cargando que="la reunión" completa />
      </div>
    );
  }

  return (
    <div className="pagina-prosa">
      <h1>{reunion.titulo}</h1>

      <Ficha variante={reunion.actaPublicada ? 'neutra' : 'en-curso'}>
        {reunion.actaPublicada ? 'Con acta publicada' : 'Próxima'}
      </Ficha>
      <Meta>
        <time dateTime={new Date(reunion.cuando).toISOString()}>{cuando(reunion.cuando)}</time>
        {reunion.lugar}
        {reunion.enlaceRemoto !== undefined ? (
          <a href={reunion.enlaceRemoto} target="_blank" rel="noreferrer noopener">
            Entrar de forma remota
          </a>
        ) : null}
      </Meta>

      {(enlazando || errorEnlace !== undefined) && (
        <Aviso tipo={errorEnlace === undefined ? 'atencion' : 'error'}>
          {errorEnlace === undefined ? (
            'Enlazando la propuesta que acabás de crear con este acuerdo…'
          ) : (
            <>
              <ErrorVisible error={errorEnlace} />
              <button
                className="boton"
                type="button"
                onClick={() => void enlazarConLaPropuestaCreada()}
              >
                Volver a intentar el enlace
              </button>
            </>
          )}
        </Aviso>
      )}

      <section aria-labelledby="orden-del-dia-titulo">
        <h2 id="orden-del-dia-titulo">Orden del día</h2>
        <ol>
          {reunion.ordenDelDia.map((punto) => (
            <li key={punto.id}>
              <p>{punto.texto}</p>
              {punto.problemaTitulo !== undefined && punto.problemaId !== undefined && (
                <p className="suave">
                  Problema:{' '}
                  <Link href={`/problemas/${punto.problemaId}`}>{punto.problemaTitulo}</Link>
                </p>
              )}
              {punto.deliberacionTitulo !== undefined && punto.deliberacionId !== undefined && (
                <p className="suave">
                  Retoma la conversación sobre:{' '}
                  <Link href={`/deliberaciones/${punto.deliberacionId}`}>
                    {punto.deliberacionTitulo}
                  </Link>
                </p>
              )}
            </li>
          ))}
        </ol>
      </section>

      {reunion.actaPublicada ? (
        <section aria-labelledby="acta-titulo">
          <h2 id="acta-titulo">Lo que pasó</h2>
          {reunion.actaSinAsistentes && (
            <Aviso tipo="atencion" titulo="Acta sin asistentes">
              Se permite, pero no sirve para decisiones que dependan de quiénes estaban.
            </Aviso>
          )}
          <p>{reunion.resumenActa}</p>

          <h3>Quién estuvo</h3>
          {reunion.asistentes.length === 0 ? (
            <p className="suave">Ningún asistente quedó registrado.</p>
          ) : (
            <p>{reunion.asistentes.length} personas asistieron.</p>
          )}

          <h3>Acuerdos</h3>
          {reunion.acuerdos.length === 0 ? (
            <p className="suave">Esta reunión no dejó ningún acuerdo.</p>
          ) : (
            <ul>
              {reunion.acuerdos.map((acuerdo) => (
                <Acuerdo key={acuerdo.id} acuerdo={acuerdo} reunionId={reunion.id} />
              ))}
            </ul>
          )}
        </section>
      ) : reunion.laConvoqueYo ? (
        <FormularioActa reunion={reunion} onPublicada={setReunion} />
      ) : (
        <Aviso tipo="atencion" titulo="Todavía no hay acta">
          {sesion === undefined
            ? 'Sólo quien convocó esta reunión puede publicar su acta.'
            : 'Sólo quien convocó esta reunión puede publicar su acta. Si vos la convocaste desde ' +
              'otra cuenta, entrá con esa cuenta para publicarla.'}
        </Aviso>
      )}
    </div>
  );
}

export default function DetalleReunion(): ReactNode {
  return (
    <Suspense
      fallback={
        <div className="pagina-prosa cargando-completa">
          <Cargando que="la reunión" completa />
        </div>
      }
    >
      <Detalle />
    </Suspense>
  );
}
