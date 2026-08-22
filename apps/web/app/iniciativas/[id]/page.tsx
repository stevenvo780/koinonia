'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from 'react';

import {
  MOTIVO_RESPUESTA_TAREA_EN_PALABRAS,
  instanteColombia,
  type IniciativaDetalle,
  type MiembrosCirculo,
  type MotivoRespuestaTarea,
  type Tarea,
} from '@koinonia/contracts';

import { Aviso, Cargando, ErrorVisible, useSesion } from '../../../components/marco';
import { cuando, enviar, ErrorDeApi, nuevoRequestId, traer } from '../../../lib/api';

type RespuestaElegida = 'aceptar' | 'rechazar' | 'pedir-reasignacion';

const ESTADO_TAREA_EN_PALABRAS: Readonly<Record<Tarea['estado'], string>> = {
  ofrecida: 'Esperando respuesta',
  aceptada: 'Aceptada',
  rechazada: 'No fue aceptada',
  'reasignacion-solicitada': 'Necesita otra persona',
};

export default function DetalleIniciativa(): ReactNode {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { sesion, cargando: cargandoSesion, recargar: recargarSesion } = useSesion();
  const [iniciativa, setIniciativa] = useState<IniciativaDetalle | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const [errorAccion, setErrorAccion] = useState<unknown>(undefined);
  const [mensaje, setMensaje] = useState<string | undefined>(undefined);
  const [accionEnCurso, setAccionEnCurso] = useState<string | undefined>(undefined);
  const accionEnCursoRef = useRef<string | undefined>(undefined);
  const resultadoAccionRef = useRef<HTMLDivElement | null>(null);
  const intentos = useRef(
    new Map<string, { readonly huella: string; readonly requestId: string }>(),
  );

  const [miembros, setMiembros] = useState<MiembrosCirculo | undefined>(undefined);
  const [errorMiembros, setErrorMiembros] = useState<unknown>(undefined);

  const [tituloHito, setTituloHito] = useState('');
  const [criterioHito, setCriterioHito] = useState('');
  const [venceHito, setVenceHito] = useState('');

  const [hitoTarea, setHitoTarea] = useState('');
  const [destinatarioTarea, setDestinatarioTarea] = useState('');
  const [tituloTarea, setTituloTarea] = useState('');
  const [descripcionTarea, setDescripcionTarea] = useState('');
  const [venceTarea, setVenceTarea] = useState('');
  const [esfuerzoTarea, setEsfuerzoTarea] = useState('60');
  const [dependencias, setDependencias] = useState<readonly string[]>([]);

  const [respuestaPorTarea, setRespuestaPorTarea] = useState<
    Readonly<Record<string, RespuestaElegida>>
  >({});
  const [motivoPorTarea, setMotivoPorTarea] = useState<
    Readonly<Record<string, MotivoRespuestaTarea>>
  >({});
  const [reofertaPorTarea, setReofertaPorTarea] = useState<Readonly<Record<string, string>>>({});

  const recargar = useCallback(() => {
    setError(undefined);
    traer<IniciativaDetalle>(`/iniciativas/${id}`).then(setIniciativa).catch(setError);
  }, [id]);

  useEffect(recargar, [recargar]);

  useEffect(() => {
    const alVolver = (): void => {
      recargarSesion();
    };
    window.addEventListener('focus', alVolver);
    return () => {
      window.removeEventListener('focus', alVolver);
    };
  }, [recargarSesion]);

  useEffect(() => {
    if (mensaje !== undefined || errorAccion !== undefined) {
      resultadoAccionRef.current?.focus();
    }
  }, [errorAccion, mensaje]);

  useEffect(() => {
    if (iniciativa?.activa !== true || !iniciativa.esResponsableInicial) {
      setMiembros(undefined);
      setErrorMiembros(undefined);
      return;
    }
    let vivo = true;
    setErrorMiembros(undefined);
    traer<MiembrosCirculo>(`/circulos/${iniciativa.circuloId}/miembros`)
      .then((lista) => {
        if (vivo) setMiembros(lista);
      })
      .catch((fallo: unknown) => {
        if (vivo) setErrorMiembros(fallo);
      });
    return () => {
      vivo = false;
    };
  }, [iniciativa?.activa, iniciativa?.circuloId, iniciativa?.esResponsableInicial]);

  async function ejecutar(
    clave: string,
    ruta: string,
    cuerpo: Readonly<Record<string, unknown>>,
    confirmacion: string,
  ): Promise<boolean> {
    // Un segundo submit local nunca corre en paralelo con el primero. Además de evitar una vista
    // que retrocede cuando las respuestas llegan desordenadas, esto reduce dobles toques móviles.
    if (accionEnCursoRef.current !== undefined) return false;
    const huella = JSON.stringify([ruta, cuerpo]);
    const previo = intentos.current.get(clave);
    const requestId = previo?.huella === huella ? previo.requestId : nuevoRequestId();
    intentos.current.set(clave, { huella, requestId });
    setErrorAccion(undefined);
    setMensaje(undefined);
    accionEnCursoRef.current = clave;
    setAccionEnCurso(clave);
    try {
      const actualizada = await enviar<IniciativaDetalle>(ruta, {
        ...cuerpo,
        requestId,
      });
      setIniciativa(actualizada);
      setMensaje(confirmacion);
      intentos.current.delete(clave);
      return true;
    } catch (fallo) {
      setErrorAccion(fallo);
      return false;
    } finally {
      accionEnCursoRef.current = undefined;
      setAccionEnCurso(undefined);
    }
  }

  async function ratificar(): Promise<void> {
    await ejecutar(
      'ratificar',
      `/decisiones/${iniciativa?.decisionId ?? ''}/ratificar`,
      {},
      'La decisión quedó ratificada. Ya se pueden organizar hitos y ofrecer tareas.',
    );
  }

  async function planificarHito(evento: SyntheticEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    let venceEn: number;
    try {
      venceEn = instanteColombia(venceHito);
    } catch (fallo) {
      setErrorAccion(fallo);
      return;
    }
    const guardado = await ejecutar(
      'crear-hito',
      `/iniciativas/${id}/hitos`,
      {
        titulo: tituloHito,
        criterioDeTerminacion: criterioHito,
        venceEn,
      },
      'El hito quedó agregado al historial de la iniciativa.',
    );
    if (guardado) {
      setTituloHito('');
      setCriterioHito('');
      setVenceHito('');
    }
  }

  async function ofrecerTarea(evento: SyntheticEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    let venceEn: number;
    try {
      venceEn = instanteColombia(venceTarea);
    } catch (fallo) {
      setErrorAccion(fallo);
      return;
    }
    const guardada = await ejecutar(
      'ofrecer-tarea',
      `/iniciativas/${id}/tareas`,
      {
        hitoId: hitoTarea,
        destinatarioId: destinatarioTarea,
        titulo: tituloTarea,
        descripcion: descripcionTarea,
        venceEn,
        esfuerzoMinutos: Number(esfuerzoTarea),
        dependeDe: dependencias,
      },
      'La tarea quedó ofrecida. Sólo tendrá responsable si la persona la acepta.',
    );
    if (guardada) {
      setHitoTarea('');
      setDestinatarioTarea('');
      setTituloTarea('');
      setDescripcionTarea('');
      setVenceTarea('');
      setEsfuerzoTarea('60');
      setDependencias([]);
    }
  }

  async function responderTarea(
    evento: SyntheticEvent<HTMLFormElement>,
    tarea: Tarea,
  ): Promise<void> {
    evento.preventDefault();
    // Una tarea ya aceptada sólo admite pedir reasignación. No se reutiliza la opción «aceptar»
    // que el formulario anterior pudiera conservar en memoria después de actualizar la vista.
    const tipo = tarea.estado === 'aceptada' ? 'pedir-reasignacion' : respuestaPorTarea[tarea.id];
    if (tipo === undefined) {
      setErrorAccion(new Error('Elegí una respuesta antes de registrarla.'));
      return;
    }
    const motivo = motivoPorTarea[tarea.id];
    if (tipo !== 'aceptar' && motivo === undefined) {
      setErrorAccion(new Error('Elegí un motivo general o “Prefiero no publicar el motivo”.'));
      return;
    }
    const cuerpo =
      tipo === 'aceptar'
        ? { offerId: tarea.ofertaId, revision: tarea.revision, tipo }
        : { offerId: tarea.ofertaId, revision: tarea.revision, tipo, motivo };
    const registrado = await ejecutar(
      `responder-${tarea.id}`,
      `/iniciativas/${id}/tareas/${tarea.id}/respuestas`,
      cuerpo,
      tipo === 'aceptar'
        ? 'Aceptaste la tarea. Desde ahora figura a tu cargo.'
        : tipo === 'rechazar'
          ? 'Tu respuesta quedó registrada. La tarea no figura a tu cargo.'
          : 'Pediste otra persona. La tarea dejó de figurar a tu cargo inmediatamente.',
    );
    if (registrado) {
      setMotivoPorTarea((actual) => {
        const { [tarea.id]: _eliminado, ...resto } = actual;
        return resto;
      });
    }
  }

  async function reofrecerTarea(
    evento: SyntheticEvent<HTMLFormElement>,
    tarea: Tarea,
  ): Promise<void> {
    evento.preventDefault();
    const registrada = await ejecutar(
      `reofrecer-${tarea.id}`,
      `/iniciativas/${id}/tareas/${tarea.id}/reofertas`,
      { offerId: tarea.ofertaId, destinatarioId: reofertaPorTarea[tarea.id] ?? '' },
      'La nueva oferta reemplazó la anterior. Ahora espera respuesta.',
    );
    if (registrada) {
      setReofertaPorTarea((actual) => ({ ...actual, [tarea.id]: '' }));
    }
  }

  if (error !== undefined) return <ErrorVisible error={error} />;
  if (iniciativa === undefined) return <Cargando que="la iniciativa" />;

  const puedeRatificar =
    !cargandoSesion &&
    sesion !== undefined &&
    sesion.circulos.includes(iniciativa.circuloId) &&
    (sesion.roles.includes('facilitator') || sesion.roles.includes('guarantees'));

  return (
    <>
      <p className="suave">
        Nace de un{' '}
        <Link href={`/decisiones/${iniciativa.decisionId}/resultado`}>resultado aprobado</Link>.
      </p>
      <h1>El cambio que buscamos</h1>
      <p className="texto destacado">{iniciativa.objetivo}</p>

      <section aria-labelledby="estado-iniciativa-titulo">
        <h2 id="estado-iniciativa-titulo">Estado</h2>
        {iniciativa.activa ? (
          <Aviso tipo="bien" titulo="Iniciativa activa">
            La decisión ya fue ratificada. Se pueden organizar hitos y ofrecer tareas sin borrar las
            decisiones anteriores.
            {iniciativa.activadaEn !== undefined && (
              <> Quedó activa el {cuando(iniciativa.activadaEn)}.</>
            )}
          </Aviso>
        ) : (
          <Aviso tipo="atencion" titulo="En revisión">
            La decisión fue aprobada, pero todavía puede impugnarse. No corresponde iniciar trabajo
            irreversible hasta que quede ratificada.
            {iniciativa.ratificableEn !== undefined && (
              <> La ratificación puede hacerse desde el {cuando(iniciativa.ratificableEn)}.</>
            )}
          </Aviso>
        )}

        {!iniciativa.activa && puedeRatificar && (
          <div className="accion-procedimiento">
            <p className="suave" id="ayuda-ratificacion">
              Este acto abre la organización del trabajo. Si el plazo aún no terminó, el historial
              no cambia y la pantalla explica cuánto falta.
            </p>
            <button
              className="boton"
              type="button"
              aria-describedby="ayuda-ratificacion"
              disabled={accionEnCurso !== undefined}
              onClick={() => void ratificar()}
            >
              {accionEnCurso === 'ratificar'
                ? 'Ratificando…'
                : 'Ratificar y abrir la organización del trabajo'}
            </button>
          </div>
        )}
      </section>

      <div id="resultado-accion" ref={resultadoAccionRef} tabIndex={-1}>
        <ErrorVisible error={errorAccion} />
        {errorAccion instanceof ErrorDeApi && errorAccion.estado === 401 && (
          <Aviso tipo="atencion" titulo="Tu sesión terminó">
            El formulario y su reintento se conservan mientras esta página siga abierta.{' '}
            <Link href="/entrar" target="_blank" rel="noopener noreferrer">
              Entrá de nuevo en otra pestaña
            </Link>{' '}
            y, al volver, enviá la misma acción otra vez.
          </Aviso>
        )}
        {mensaje !== undefined && (
          <Aviso tipo="bien" titulo="Quedó registrado">
            {mensaje}
          </Aviso>
        )}
      </div>

      <section aria-labelledby="responsable-iniciativa-titulo">
        <h2 id="responsable-iniciativa-titulo">Quién organiza el primer paso</h2>
        <p>
          El plan aprobado dejó una persona responsable inicial. Puede dividir el acuerdo en hitos y
          ofrecer tareas, pero una oferta no obliga a nadie: cada persona decide si la acepta.
        </p>
        {iniciativa.esResponsableInicial && (
          <p>
            <span className="etiqueta">Sos la persona responsable inicial</span>
          </p>
        )}
      </section>

      <section aria-labelledby="revision-iniciativa-titulo">
        <h2 id="revision-iniciativa-titulo">Cuándo volvemos a mirar</h2>
        <p>{cuando(iniciativa.revisarEn)}.</p>
      </section>

      <section aria-labelledby="criterios-iniciativa-titulo">
        <h2 id="criterios-iniciativa-titulo">Cómo sabremos si funcionó</h2>
        <ul>
          {iniciativa.criteriosDeExito.map((criterio) => (
            <li key={`${criterio.descripcion}-${criterio.fuenteDeVerificacion}`}>
              <p>{criterio.descripcion}</p>
              <p className="suave">Lo comprobamos en: {criterio.fuenteDeVerificacion}.</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="hitos-titulo">
        <h2 id="hitos-titulo">Hitos y tareas</h2>
        {!iniciativa.activa && (
          <div className="vacio">
            <p>Los hitos aparecerán acá después de la ratificación.</p>
          </div>
        )}
        {iniciativa.activa && iniciativa.hitos.length === 0 && (
          <div className="vacio">
            <p>Todavía no se organizó ningún hito.</p>
          </div>
        )}
        {iniciativa.activa && iniciativa.hitos.length > 0 && (
          <ol className="hitos" aria-label="Hitos de la iniciativa">
            {iniciativa.hitos.map((hito) => {
              const tareas = iniciativa.tareas.filter((tarea) => tarea.hitoId === hito.id);
              return (
                <li key={hito.id}>
                  <article className="tarjeta-trabajo" aria-labelledby={`hito-${hito.id}`}>
                    <h3 id={`hito-${hito.id}`}>{hito.titulo}</h3>
                    <p>{hito.criterioDeTerminacion}</p>
                    <p className="suave">Fecha límite: {cuando(hito.venceEn)}.</p>
                    {tareas.length === 0 ? (
                      <p className="suave">Este hito todavía no tiene tareas ofrecidas.</p>
                    ) : (
                      <ul className="tareas" aria-label={`Tareas de ${hito.titulo}`}>
                        {tareas.map((tarea) => (
                          <TareaVisible
                            key={tarea.id}
                            tarea={tarea}
                            todas={iniciativa.tareas}
                            esResponsableInicial={iniciativa.esResponsableInicial}
                            miembros={miembros}
                            accionEnCurso={accionEnCurso}
                            respuesta={respuestaPorTarea[tarea.id]}
                            motivo={motivoPorTarea[tarea.id]}
                            reoferta={reofertaPorTarea[tarea.id] ?? ''}
                            onRespuesta={(respuesta) => {
                              setRespuestaPorTarea((actual) => ({
                                ...actual,
                                [tarea.id]: respuesta,
                              }));
                            }}
                            onMotivo={(motivo) => {
                              setMotivoPorTarea((actual) => ({
                                ...actual,
                                [tarea.id]: motivo,
                              }));
                            }}
                            onReoferta={(destinatario) => {
                              setReofertaPorTarea((actual) => ({
                                ...actual,
                                [tarea.id]: destinatario,
                              }));
                            }}
                            onResponder={(evento) => void responderTarea(evento, tarea)}
                            onReofrecer={(evento) => void reofrecerTarea(evento, tarea)}
                          />
                        ))}
                      </ul>
                    )}
                  </article>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {iniciativa.activa && iniciativa.esResponsableInicial && (
        <section aria-labelledby="organizar-titulo">
          <h2 id="organizar-titulo">Organizar el trabajo inicial</h2>
          <p className="suave">
            Acá registrás plazos y ofertas. La plataforma todavía no calcula carga disponible ni
            afirma que una tarea está en seguimiento completo.
          </p>

          <form className="formulario-acotado" onSubmit={(e) => void planificarHito(e)}>
            <fieldset disabled={accionEnCurso !== undefined}>
              <legend>Agregar un hito</legend>
              <div className="campo">
                <label htmlFor="titulo-hito">¿Qué momento concreto queremos alcanzar?</label>
                <input
                  id="titulo-hito"
                  required
                  minLength={10}
                  maxLength={140}
                  value={tituloHito}
                  onChange={(e) => {
                    setTituloHito(e.target.value);
                  }}
                />
              </div>
              <div className="campo">
                <label htmlFor="criterio-hito">
                  ¿Qué tendría que verse para decir que se logró?
                </label>
                <textarea
                  id="criterio-hito"
                  required
                  minLength={20}
                  maxLength={500}
                  value={criterioHito}
                  onChange={(e) => {
                    setCriterioHito(e.target.value);
                  }}
                />
              </div>
              <div className="campo">
                <label htmlFor="vence-hito">Fecha y hora límite, en hora de Colombia</label>
                <input
                  id="vence-hito"
                  type="datetime-local"
                  required
                  value={venceHito}
                  onChange={(e) => {
                    setVenceHito(e.target.value);
                  }}
                />
                <span className="ayuda">
                  No puede ser posterior a la revisión acordada: {cuando(iniciativa.revisarEn)}.
                </span>
              </div>
              <button className="boton secundario" disabled={accionEnCurso !== undefined}>
                {accionEnCurso === 'crear-hito' ? 'Guardando…' : 'Agregar el hito'}
              </button>
            </fieldset>
          </form>

          {iniciativa.hitos.length > 0 && (
            <form className="formulario-acotado" onSubmit={(e) => void ofrecerTarea(e)}>
              <fieldset disabled={accionEnCurso !== undefined}>
                <legend>Ofrecer una tarea</legend>
                <div className="campo">
                  <label htmlFor="hito-tarea">¿A qué hito aporta?</label>
                  <select
                    id="hito-tarea"
                    required
                    value={hitoTarea}
                    onChange={(e) => {
                      setHitoTarea(e.target.value);
                    }}
                  >
                    <option value="">Elegí un hito</option>
                    {iniciativa.hitos.map((hito) => (
                      <option key={hito.id} value={hito.id}>
                        {hito.titulo}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="campo">
                  <label htmlFor="titulo-tarea">¿Qué hay que hacer?</label>
                  <input
                    id="titulo-tarea"
                    required
                    minLength={10}
                    maxLength={140}
                    value={tituloTarea}
                    onChange={(e) => {
                      setTituloTarea(e.target.value);
                    }}
                  />
                </div>
                <div className="campo">
                  <label htmlFor="descripcion-tarea">¿Qué incluye esta tarea?</label>
                  <textarea
                    id="descripcion-tarea"
                    required
                    minLength={20}
                    maxLength={4000}
                    value={descripcionTarea}
                    onChange={(e) => {
                      setDescripcionTarea(e.target.value);
                    }}
                  />
                  <span className="ayuda">
                    Esto queda en el historial público. Describí el trabajo, no datos personales ni
                    situaciones privadas de quien lo hará.
                  </span>
                </div>
                <div className="campo">
                  <label htmlFor="destinatario-tarea">¿A quién querés ofrecérsela?</label>
                  {miembros === undefined && errorMiembros === undefined ? (
                    <Cargando que="las personas del círculo" />
                  ) : (
                    <select
                      id="destinatario-tarea"
                      required
                      value={destinatarioTarea}
                      onChange={(e) => {
                        setDestinatarioTarea(e.target.value);
                      }}
                    >
                      <option value="">Elegí una persona</option>
                      {miembros?.map((miembro) => (
                        <option key={miembro.id} value={miembro.id}>
                          {miembro.alias}
                        </option>
                      ))}
                    </select>
                  )}
                  <span className="ayuda">
                    Elegís un alias del círculo; nunca tenés que copiar un identificador técnico.
                  </span>
                  <ErrorVisible error={errorMiembros} />
                </div>
                <div className="campo">
                  <label htmlFor="vence-tarea">Fecha y hora límite, en hora de Colombia</label>
                  <input
                    id="vence-tarea"
                    type="datetime-local"
                    required
                    value={venceTarea}
                    onChange={(e) => {
                      setVenceTarea(e.target.value);
                    }}
                  />
                </div>
                <div className="campo">
                  <label htmlFor="esfuerzo-tarea">Tiempo estimado, en minutos</label>
                  <input
                    id="esfuerzo-tarea"
                    type="number"
                    required
                    min={1}
                    max={10_080}
                    step={1}
                    inputMode="numeric"
                    value={esfuerzoTarea}
                    onChange={(e) => {
                      setEsfuerzoTarea(e.target.value);
                    }}
                  />
                  <span className="ayuda">
                    Es sólo una estimación compartida; todavía no se usa para medir ni comparar
                    personas.
                  </span>
                </div>
                {iniciativa.tareas.length > 0 && (
                  <fieldset className="opciones">
                    <legend>¿Necesita que otra tarea termine primero?</legend>
                    {iniciativa.tareas.map((tarea) => (
                      <div className="opcion" key={tarea.id}>
                        <input
                          id={`dependencia-${tarea.id}`}
                          type="checkbox"
                          checked={dependencias.includes(tarea.id)}
                          onChange={(e) => {
                            setDependencias((actuales) =>
                              e.target.checked
                                ? [...actuales, tarea.id]
                                : actuales.filter((idTarea) => idTarea !== tarea.id),
                            );
                          }}
                        />
                        <label htmlFor={`dependencia-${tarea.id}`}>{tarea.titulo}</label>
                      </div>
                    ))}
                  </fieldset>
                )}
                <button className="boton" disabled={accionEnCurso !== undefined}>
                  {accionEnCurso === 'ofrecer-tarea' ? 'Ofreciendo…' : 'Ofrecer la tarea'}
                </button>
              </fieldset>
            </form>
          )}
        </section>
      )}

      <details>
        <summary>Ver comprobantes relacionados</summary>
        <p className="suave">
          Estos comprobantes permiten revisar que esta iniciativa corresponde a esa decisión y a la
          versión que se consideró. No hace falta entenderlos para participar.
        </p>
        <h2>Comprobante de la decisión</h2>
        <code className="comprobante">{iniciativa.comprobanteDecision}</code>
        <h2>Comprobante de la versión</h2>
        <code className="comprobante">{iniciativa.comprobanteVersion}</code>
      </details>
    </>
  );
}

function TareaVisible({
  tarea,
  todas,
  esResponsableInicial,
  miembros,
  accionEnCurso,
  respuesta,
  motivo,
  reoferta,
  onRespuesta,
  onMotivo,
  onReoferta,
  onResponder,
  onReofrecer,
}: {
  readonly tarea: Tarea;
  readonly todas: readonly Tarea[];
  readonly esResponsableInicial: boolean;
  readonly miembros: MiembrosCirculo | undefined;
  readonly accionEnCurso: string | undefined;
  readonly respuesta: RespuestaElegida | undefined;
  readonly motivo: MotivoRespuestaTarea | undefined;
  readonly reoferta: string;
  readonly onRespuesta: (respuesta: RespuestaElegida) => void;
  readonly onMotivo: (motivo: MotivoRespuestaTarea) => void;
  readonly onReoferta: (destinatario: string) => void;
  readonly onResponder: (evento: SyntheticEvent<HTMLFormElement>) => void;
  readonly onReofrecer: (evento: SyntheticEvent<HTMLFormElement>) => void;
}): ReactNode {
  const respuestaVigente = tarea.estado === 'aceptada' ? 'pedir-reasignacion' : respuesta;
  const puedeResponder =
    tarea.esMia && (tarea.estado === 'ofrecida' || tarea.estado === 'aceptada');
  const puedeReofrecer =
    esResponsableInicial &&
    (tarea.estado === 'rechazada' || tarea.estado === 'reasignacion-solicitada');
  const titulosDependencias = tarea.dependeDe.map(
    (dependencia) =>
      todas.find((candidata) => candidata.id === dependencia)?.titulo ?? 'Una tarea anterior',
  );

  return (
    <li>
      <article className="tarea" aria-labelledby={`tarea-${tarea.id}`}>
        <h4 id={`tarea-${tarea.id}`}>{tarea.titulo}</h4>
        <p>{tarea.descripcion}</p>
        <dl className="datos-trabajo">
          <div>
            <dt>Estado</dt>
            <dd>{ESTADO_TAREA_EN_PALABRAS[tarea.estado]}</dd>
          </div>
          <div>
            <dt>Fecha límite</dt>
            <dd>{cuando(tarea.venceEn)}</dd>
          </div>
          <div>
            <dt>Tiempo estimado</dt>
            <dd>{tarea.esfuerzoMinutos} minutos</dd>
          </div>
        </dl>
        {titulosDependencias.length > 0 && (
          <p className="suave">Necesita primero: {titulosDependencias.join(', ')}.</p>
        )}

        {tarea.esMia && tarea.estado === 'ofrecida' && (
          <p className="aviso atencion" role="note">
            Te ofrecieron esta tarea. Todavía no figura a tu cargo.
          </p>
        )}
        {tarea.esMia && tarea.estado === 'aceptada' && (
          <p className="aviso bien" role="note">
            La aceptaste y ahora figura a tu cargo.
          </p>
        )}

        {puedeResponder && (
          <form className="respuesta-tarea" onSubmit={onResponder}>
            {tarea.estado === 'ofrecida' ? (
              <fieldset className="opciones" disabled={accionEnCurso !== undefined}>
                <legend>Tu respuesta a esta oferta</legend>
                {(
                  [
                    ['aceptar', 'La acepto'],
                    ['rechazar', 'No puedo aceptarla'],
                    ['pedir-reasignacion', 'Necesito que se la ofrezcan a otra persona'],
                  ] as const
                ).map(([valor, etiqueta]) => (
                  <div className="opcion" key={valor}>
                    <input
                      id={`${valor}-${tarea.id}`}
                      type="radio"
                      name={`respuesta-${tarea.id}`}
                      value={valor}
                      required
                      checked={respuestaVigente === valor}
                      onChange={() => {
                        onRespuesta(valor);
                      }}
                    />
                    <label htmlFor={`${valor}-${tarea.id}`}>{etiqueta}</label>
                  </div>
                ))}
              </fieldset>
            ) : (
              <p>
                Si ya no podés sostener el compromiso, podés pedir otra persona. La tarea deja de
                figurar a tu cargo de inmediato.
              </p>
            )}
            {respuestaVigente !== 'aceptar' && (
              <div className="campo">
                <label htmlFor={`motivo-${tarea.id}`}>Motivo general</label>
                <select
                  id={`motivo-${tarea.id}`}
                  required
                  disabled={accionEnCurso !== undefined}
                  value={motivo ?? ''}
                  onChange={(e) => {
                    onMotivo(e.target.value as MotivoRespuestaTarea);
                  }}
                >
                  <option value="">Elegí una opción</option>
                  {Object.entries(MOTIVO_RESPUESTA_TAREA_EN_PALABRAS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <span className="ayuda">
                  No pedimos texto libre porque podría dejar datos personales para siempre en el
                  historial público. Podés elegir “Prefiero no publicar el motivo”.
                </span>
              </div>
            )}
            <button
              className="boton secundario"
              disabled={
                accionEnCurso !== undefined ||
                (tarea.estado === 'ofrecida' && respuestaVigente === undefined) ||
                (respuestaVigente !== 'aceptar' && motivo === undefined)
              }
            >
              {accionEnCurso === `responder-${tarea.id}`
                ? 'Registrando…'
                : tarea.estado === 'aceptada'
                  ? 'Pedir otra persona'
                  : 'Registrar mi respuesta'}
            </button>
          </form>
        )}

        {puedeReofrecer && (
          <form className="respuesta-tarea" onSubmit={onReofrecer}>
            <fieldset disabled={accionEnCurso !== undefined}>
              <legend>Ofrecerla de nuevo</legend>
              <div className="campo">
                <label htmlFor={`reoferta-${tarea.id}`}>Nueva persona</label>
                {miembros?.find((miembro) => miembro.id === tarea.destinatarioId) !== undefined && (
                  <span className="ayuda">
                    La oferta anterior fue para{' '}
                    {miembros.find((miembro) => miembro.id === tarea.destinatarioId)?.alias}. Elegí
                    otra persona.
                  </span>
                )}
                <select
                  id={`reoferta-${tarea.id}`}
                  required
                  value={reoferta}
                  onChange={(e) => {
                    onReoferta(e.target.value);
                  }}
                >
                  <option value="">Elegí un alias del círculo</option>
                  {miembros
                    ?.filter((miembro) => miembro.id !== tarea.destinatarioId)
                    .map((miembro) => (
                      <option key={miembro.id} value={miembro.id}>
                        {miembro.alias}
                      </option>
                    ))}
                </select>
              </div>
              <button className="boton secundario" disabled={accionEnCurso !== undefined}>
                {accionEnCurso === `reofrecer-${tarea.id}`
                  ? 'Ofreciendo…'
                  : 'Hacer la nueva oferta'}
              </button>
            </fieldset>
          </form>
        )}
      </article>
    </li>
  );
}
