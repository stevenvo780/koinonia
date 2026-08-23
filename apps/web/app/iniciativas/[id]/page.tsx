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
  CATEGORIA_AYUDA_EN_PALABRAS,
  CATEGORIA_BLOQUEO_EN_PALABRAS,
  EVIDENCIA_CRITERIO_EN_PALABRAS,
  MOTIVO_CAMBIOS_EN_PALABRAS,
  MOTIVO_RESPUESTA_TAREA_EN_PALABRAS,
  datetimeLocalColombia,
  instanteColombia,
  type CategoriaAyudaTarea,
  type CategoriaBloqueoTarea,
  type EvidenciaCriterioResultado,
  type IniciativaDetalle,
  type MiembrosCirculo,
  type MotivoCambiosTarea,
  type MotivoRespuestaTarea,
  type Tarea,
} from '@koinonia/contracts';

import { Aviso, Cargando, ErrorVisible, useSesion } from '../../../components/marco';
import { useAccionUnica } from '../../../lib/acciones';
import { cerrarFrase, cuando, enviar, ErrorDeApi, traer } from '../../../lib/api';

type RespuestaElegida = 'aceptar' | 'rechazar' | 'pedir-reasignacion';

const ESTADO_TAREA_EN_PALABRAS: Readonly<Record<Tarea['estado'], string>> = {
  ofrecida: 'Esperando respuesta',
  aceptada: 'Aceptada',
  'en-curso': 'En curso',
  bloqueada: 'Bloqueada',
  'en-apoyo': 'En apoyo',
  entregada: 'Entregada para revisión',
  completada: 'Completada',
  rechazada: 'No fue aceptada',
  'reasignacion-solicitada': 'Necesita otra persona',
};

export default function DetalleIniciativa(): ReactNode {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { sesion, cargando: cargandoSesion } = useSesion();
  const claveSesion = cargandoSesion ? 'cargando' : (sesion?.miembroId ?? 'anonima');
  const claveSesionRef = useRef(claveSesion);
  claveSesionRef.current = claveSesion;
  const [iniciativa, setIniciativa] = useState<IniciativaDetalle | undefined>(undefined);
  const [iniciativaPara, setIniciativaPara] = useState<string | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const [errorAccion, setErrorAccion] = useState<unknown>(undefined);
  const [mensaje, setMensaje] = useState<string | undefined>(undefined);
  // Una acción a la vez y una clave de idempotencia por intención. Esta pantalla lo tenía copiado
  // a mano; el helper es el mismo que usan las demás, y arreglarlo una vez las arregla a todas.
  // Las claves llevan el id de la tarea —`iniciar-${tarea.id}`— y por eso doce acciones sobre
  // muchas tareas conviven sin mezclar idempotencias.
  const {
    enCurso: accionEnCurso,
    ejecutar: ejecutarUnica,
    olvidarTodo,
    reiniciar,
  } = useAccionUnica();
  const cargaGeneracionRef = useRef(0);
  const resultadoAccionRef = useRef<HTMLDivElement | null>(null);

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
  const ultimaIdentidadConfirmada = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (cargandoSesion) return;
    const identidadActual = sesion?.miembroId ?? 'anonima';
    const anterior = ultimaIdentidadConfirmada.current;
    ultimaIdentidadConfirmada.current = identidadActual;
    if (anterior === undefined || anterior === identidadActual) return;

    // Los borradores no publicados pueden contener información de la cuenta anterior. Se
    // preservan durante una reautenticación de la misma persona, pero nunca cruzan a otra.
    setTituloHito('');
    setCriterioHito('');
    setVenceHito('');
    setHitoTarea('');
    setDestinatarioTarea('');
    setTituloTarea('');
    setDescripcionTarea('');
    setVenceTarea('');
    setEsfuerzoTarea('60');
    setDependencias([]);
    setRespuestaPorTarea({});
    setMotivoPorTarea({});
    setReofertaPorTarea({});
    setErrorAccion(undefined);
    setMensaje(undefined);
    reiniciar();
    // Y aquí sí se olvidan las claves: pertenecen a la intención de otra persona, y reusarlas
    // haría que el servidor tomara el envío de esta por un duplicado del de aquella.
    olvidarTodo();
  }, [cargandoSesion, olvidarTodo, reiniciar, sesion]);

  const recargar = useCallback(
    async (para: string): Promise<void> => {
      const generacion = ++cargaGeneracionRef.current;
      try {
        const actual = await traer<IniciativaDetalle>(`/iniciativas/${id}`);
        if (claveSesionRef.current !== para || cargaGeneracionRef.current !== generacion) return;
        setIniciativa(actual);
        setError(undefined);
        setIniciativaPara(para);
      } catch (fallo: unknown) {
        if (claveSesionRef.current !== para || cargaGeneracionRef.current !== generacion) return;
        setIniciativa(undefined);
        setError(fallo);
        setIniciativaPara(para);
      }
    },
    [id],
  );

  useEffect(() => {
    if (claveSesion === 'cargando') {
      // Una respuesta de la misma cuenta iniciada antes del foco tampoco puede ganar luego de que
      // la cookie se revalidó y volvió al mismo miembro. Las claves **no** se olvidan: si sigue
      // siendo la misma persona, su reintento tiene que llevar el mismo `requestId`.
      cargaGeneracionRef.current += 1;
      reiniciar();
      return;
    }
    setIniciativa(undefined);
    setError(undefined);
    setIniciativaPara(undefined);
    void recargar(claveSesion);
  }, [claveSesion, recargar, reiniciar]);

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
    destinoFoco?: string,
  ): Promise<boolean> {
    const ejecutadaPara = claveSesionRef.current;
    if (ejecutadaPara === 'cargando') return false;

    const enfocarResultado = (): void => {
      requestAnimationFrame(() => {
        (destinoFoco === undefined
          ? resultadoAccionRef.current
          : document.getElementById(destinoFoco)
        )?.focus();
      });
    };

    // El cerrojo síncrono y la clave de idempotencia los pone `useAccionUnica`. Lo que queda acá
    // es lo que sólo esta pantalla sabe: qué proyección se pinta y qué recarga exige cada rechazo.
    const resultado = await ejecutarUnica<IniciativaDetalle>(clave, [ruta, cuerpo], (requestId) => {
      // Dentro de `llamar`, que sólo corre si el cerrojo se tomó: un segundo toque descartado no
      // puede borrar el aviso anterior sin haber hecho nada a cambio.
      setErrorAccion(undefined);
      setMensaje(undefined);
      return enviar<IniciativaDetalle>(ruta, { ...cuerpo, requestId });
    });

    // `ignorado` es el toque que no entró o la respuesta de una sesión ya jubilada. Nada que pintar.
    if (resultado.estado === 'ignorado') return false;
    // Una proyección lleva permisos de una identidad concreta: si la identidad cambió mientras la
    // llamada volaba, esta respuesta describe permisos que ya no son los de quien mira.
    if (claveSesionRef.current !== ejecutadaPara) return false;

    if (resultado.estado === 'hecho') {
      setIniciativa(resultado.valor);
      setIniciativaPara(ejecutadaPara);
      setMensaje(confirmacion);
      enfocarResultado();
      return true;
    }

    const fallo = resultado.error;
    setErrorAccion(fallo);
    if (
      fallo instanceof ErrorDeApi &&
      [
        'STALE_TASK_OFFER',
        'STALE_TASK_REVISION',
        'STALE_TASK_PAUSE',
        'STALE_TASK_DELIVERY',
        'TASK_OFFER_ALREADY_ANSWERED',
      ].includes(fallo.codigo)
    ) {
      await recargar(ejecutadaPara);
    }
    enfocarResultado();
    return false;
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
    const tipo = tarea.estado === 'ofrecida' ? respuestaPorTarea[tarea.id] : 'pedir-reasignacion';
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
      `tarea-${tarea.id}`,
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
      `tarea-${tarea.id}`,
    );
    if (registrada) {
      setReofertaPorTarea((actual) => ({ ...actual, [tarea.id]: '' }));
    }
  }

  // Una proyección lleva permisos derivados de una identidad concreta. Nunca se muestra si la
  // sesión está revalidándose o si fue descargada para otra cuenta.
  if (claveSesion === 'cargando' || iniciativaPara !== claveSesion) {
    return <Cargando que="la iniciativa y tus permisos actuales" />;
  }
  if (error !== undefined) return <ErrorVisible error={error} />;
  if (iniciativa === undefined) return <Cargando que="la iniciativa" />;

  const puedeRatificar =
    !cargandoSesion &&
    sesion !== undefined &&
    sesion.circulos.includes(iniciativa.circuloId) &&
    (sesion.roles.includes('facilitator') || sesion.roles.includes('guarantees'));

  // Tope de la fecha de una tarea: el del hito al que aporta, y si todavía no se eligió ninguno,
  // el de la revisión de la iniciativa. Es la misma regla que aplica el servidor.
  const topeTarea =
    iniciativa.hitos.find((hito) => hito.id === hitoTarea)?.venceEn ?? iniciativa.revisarEn;

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
              <> Quedó activa el {cerrarFrase(cuando(iniciativa.activadaEn))}</>
            )}
          </Aviso>
        ) : (
          <Aviso tipo="atencion" titulo="En revisión">
            La decisión fue aprobada, pero todavía puede impugnarse. No corresponde iniciar trabajo
            irreversible hasta que quede ratificada.
            {iniciativa.ratificableEn !== undefined && (
              <>
                {' '}
                La ratificación puede hacerse desde el{' '}
                {cerrarFrase(cuando(iniciativa.ratificableEn))}
              </>
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
        <p>{cerrarFrase(cuando(iniciativa.revisarEn))}</p>
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
                    <p className="suave">Fecha límite: {cerrarFrase(cuando(hito.venceEn))}</p>
                    {tareas.length === 0 ? (
                      <p className="suave">Este hito todavía no tiene tareas ofrecidas.</p>
                    ) : (
                      <ul className="tareas" aria-label={`Tareas de ${hito.titulo}`}>
                        {tareas.map((tarea) => (
                          <TareaVisible
                            key={tarea.id}
                            iniciativaId={id}
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
                            onEjecutar={ejecutar}
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
            Acá registrás plazos y ofertas. La capacidad exacta sólo se valida con la persona al
            aceptar; después cada tarea conserva su seguimiento y revisión.
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
                  aria-describedby="ayuda-vence-hito"
                  type="datetime-local"
                  required
                  // El servidor ya rechaza una fecha posterior a la revisión; el campo lo dice
                  // antes, para que el selector del teléfono no ofrezca meses imposibles.
                  max={datetimeLocalColombia(iniciativa.revisarEn)}
                  value={venceHito}
                  onChange={(e) => {
                    setVenceHito(e.target.value);
                  }}
                />
                <span className="ayuda" id="ayuda-vence-hito">
                  No puede ser posterior a la revisión acordada:{' '}
                  {cerrarFrase(cuando(iniciativa.revisarEn))}
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
                {/* Mientras no haya hito elegido, el tope que se puede prometer es el de la
                    revisión de la iniciativa; en cuanto lo hay, manda el del hito. */}
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
                    aria-describedby="ayuda-descripcion-tarea"
                    required
                    minLength={20}
                    maxLength={4000}
                    value={descripcionTarea}
                    onChange={(e) => {
                      setDescripcionTarea(e.target.value);
                    }}
                  />
                  <span className="ayuda" id="ayuda-descripcion-tarea">
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
                      aria-describedby="ayuda-destinatario-tarea"
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
                  <span className="ayuda" id="ayuda-destinatario-tarea">
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
                    aria-describedby="ayuda-vence-tarea"
                    // El tope es el del hito elegido, que es lo que el servidor comprueba; si
                    // todavía no hay hito elegido, el de la revisión de la iniciativa.
                    max={datetimeLocalColombia(topeTarea)}
                    value={venceTarea}
                    onChange={(e) => {
                      setVenceTarea(e.target.value);
                    }}
                  />
                  <span className="ayuda" id="ayuda-vence-tarea">
                    No puede pasar de la fecha de su hito: {cerrarFrase(cuando(topeTarea))}
                  </span>
                </div>
                <div className="campo">
                  <label htmlFor="esfuerzo-tarea">Tiempo estimado, en minutos</label>
                  <input
                    id="esfuerzo-tarea"
                    aria-describedby="ayuda-esfuerzo-tarea"
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
                  <span className="ayuda" id="ayuda-esfuerzo-tarea">
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
  iniciativaId,
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
  onEjecutar,
}: {
  readonly iniciativaId: string;
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
  readonly onEjecutar: (
    clave: string,
    ruta: string,
    cuerpo: Readonly<Record<string, unknown>>,
    confirmacion: string,
    destinoFoco?: string,
  ) => Promise<boolean>;
}): ReactNode {
  const [categoriaBloqueo, setCategoriaBloqueo] = useState<CategoriaBloqueoTarea | ''>('');
  const [categoriaAyuda, setCategoriaAyuda] = useState<CategoriaAyudaTarea | ''>('');
  const [notaEvidencia, setNotaEvidencia] = useState('');
  const [evidenciasEntrega, setEvidenciasEntrega] = useState<readonly string[]>([]);
  const [resumenEntrega, setResumenEntrega] = useState('');
  const [motivoCambios, setMotivoCambios] = useState<MotivoCambiosTarea | ''>('');
  const [evidenciaCriterio, setEvidenciaCriterio] = useState<EvidenciaCriterioResultado | ''>('');
  const [contenidoAbierto, setContenidoAbierto] = useState<Readonly<Record<string, string>>>({});
  const [resumenAbierto, setResumenAbierto] = useState<Readonly<Record<string, string>>>({});
  const [cargandoPrivado, setCargandoPrivado] = useState<string | undefined>(undefined);
  const [errorPrivado, setErrorPrivado] = useState<unknown>(undefined);
  const privadoRef = useRef<HTMLDivElement>(null);
  const privadoAbortRef = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    return () => {
      privadoAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (errorPrivado !== undefined) privadoRef.current?.focus();
  }, [errorPrivado]);

  const respuestaVigente = tarea.estado === 'ofrecida' ? respuesta : 'pedir-reasignacion';
  const puedeResponder =
    tarea.esMia &&
    (tarea.estado === 'ofrecida' ||
      tarea.estado === 'aceptada' ||
      tarea.estado === 'en-curso' ||
      tarea.estado === 'bloqueada' ||
      tarea.estado === 'en-apoyo');
  const puedeReofrecer =
    esResponsableInicial &&
    (tarea.estado === 'rechazada' || tarea.estado === 'reasignacion-solicitada');
  const estadoDependencias = tarea.dependeDe.map((dependencia) => {
    const encontrada = todas.find((candidata) => candidata.id === dependencia);
    return {
      titulo: encontrada?.titulo ?? 'Una tarea anterior',
      completada: encontrada?.estado === 'completada',
    };
  });
  const dependenciasPendientes = estadoDependencias.filter(
    (dependencia) => !dependencia.completada,
  );
  const ayudaPorPausa = new Map(
    tarea.solicitudesDeAyuda.map((solicitud) => [solicitud.pausaId, solicitud] as const),
  );
  const baseTarea = `/iniciativas/${iniciativaId}/tareas/${tarea.id}`;
  const cas = { offerId: tarea.ofertaId, revision: tarea.revision };

  async function mutar(
    accion: string,
    sufijo: string,
    cuerpo: Readonly<Record<string, unknown>>,
    mensaje: string,
  ): Promise<boolean> {
    return await onEjecutar(
      `${accion}-${tarea.id}`,
      `${baseTarea}/${sufijo}`,
      cuerpo,
      mensaje,
      `tarea-${tarea.id}`,
    );
  }

  async function abrirPrivado(tipo: 'evidencia' | 'resumen', identificador: string): Promise<void> {
    const clave = `${tipo}-${identificador}`;
    if (cargandoPrivado !== undefined) return;
    const controlador = new AbortController();
    privadoAbortRef.current = controlador;
    setErrorPrivado(undefined);
    setCargandoPrivado(clave);
    try {
      const ruta =
        tipo === 'evidencia'
          ? `${baseTarea}/evidencias/${identificador}`
          : `${baseTarea}/entregas/${identificador}/resumen`;
      const respuesta = await traer<Readonly<Record<string, unknown>>>(ruta, controlador.signal);
      const contenido = respuesta['contenido'];
      if (typeof contenido !== 'string') throw new Error('El contenido privado llegó incompleto.');
      if (tipo === 'evidencia') {
        setContenidoAbierto((actual) => ({ ...actual, [identificador]: contenido }));
      } else {
        setResumenAbierto((actual) => ({ ...actual, [identificador]: contenido }));
      }
      requestAnimationFrame(() => {
        document.getElementById(`privado-${tipo}-${identificador}`)?.focus();
      });
    } catch (fallo: unknown) {
      if (!controlador.signal.aborted) setErrorPrivado(fallo);
    } finally {
      if (privadoAbortRef.current === controlador) {
        privadoAbortRef.current = undefined;
        setCargandoPrivado(undefined);
      }
    }
  }

  function ocultarPrivado(tipo: 'evidencia' | 'resumen', identificador: string): void {
    if (tipo === 'evidencia') {
      setContenidoAbierto((actual) => {
        const { [identificador]: _eliminado, ...resto } = actual;
        return resto;
      });
    } else {
      setResumenAbierto((actual) => {
        const { [identificador]: _eliminado, ...resto } = actual;
        return resto;
      });
    }
    requestAnimationFrame(() => {
      document.getElementById(`abrir-${tipo}-${identificador}`)?.focus();
    });
  }

  return (
    <li>
      <article
        className="tarea"
        id={`tarea-${tarea.id}`}
        tabIndex={-1}
        aria-labelledby={`tarea-titulo-${tarea.id}`}
      >
        <h4 id={`tarea-titulo-${tarea.id}`}>{tarea.titulo}</h4>
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
            <dd>
              {tarea.esfuerzoMinutos === 1
                ? '1 minuto'
                : `${String(tarea.esfuerzoMinutos)} minutos`}
            </dd>
          </div>
        </dl>
        {estadoDependencias.length > 0 && (
          <p className="suave">
            Necesita primero:{' '}
            {estadoDependencias
              .map(
                (dependencia) =>
                  `${dependencia.titulo} (${dependencia.completada ? 'completada' : 'pendiente'})`,
              )
              .join(', ')}
            .
          </p>
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

        {(tarea.iniciadaEn !== undefined ||
          tarea.pausas.length > 0 ||
          tarea.solicitudesDeAyuda.length > 0 ||
          tarea.evidencias.length > 0 ||
          tarea.entregas.length > 0 ||
          tarea.completadaEn !== undefined) && (
          <section className="historia-tarea" aria-labelledby={`historia-${tarea.id}`}>
            <h5 id={`historia-${tarea.id}`}>Historia del trabajo</h5>
            {tarea.iniciadaEn !== undefined && (
              <p>Comenzó el {cerrarFrase(cuando(tarea.iniciadaEn))}</p>
            )}
            {tarea.pausas.length > 0 && (
              <div>
                <h6>Pausas, bloqueos y apoyos</h6>
                <ol className="lista-pausas">
                  {tarea.pausas.map((pausa) => {
                    const solicitud = ayudaPorPausa.get(pausa.id);
                    const categoria =
                      pausa.tipo === 'bloqueo'
                        ? CATEGORIA_BLOQUEO_EN_PALABRAS[pausa.categoria as CategoriaBloqueoTarea]
                        : CATEGORIA_AYUDA_EN_PALABRAS[pausa.categoria as CategoriaAyudaTarea];
                    return (
                      <li key={pausa.id}>
                        {pausa.tipo === 'bloqueo' ? 'Bloqueo' : 'Pedido de ayuda'}: {categoria}.
                        Comenzó el{' '}
                        {cerrarFrase(cuando(solicitud?.solicitadaEn ?? pausa.iniciadaEn))}{' '}
                        {pausa.finalizadaEn === undefined
                          ? 'Sigue vigente.'
                          : `Terminó el ${cuando(pausa.finalizadaEn)} por ${
                              pausa.causaDeFin === 'reasignacion' ? 'reasignación' : 'reanudación'
                            }.`}
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}
            {tarea.evidencias.length > 0 && (
              <div>
                <h6>Evidencias</h6>
                <ul className="lista-evidencias">
                  {tarea.evidencias.map((evidencia) => (
                    <li key={evidencia.id}>
                      <span>
                        {evidencia.tipo}, tamaño {evidencia.tamano},{' '}
                        {evidencia.visibilidad === 'restricted' ? 'restringida' : 'pública'} ·{' '}
                        {cuando(evidencia.agregadaEn)}
                      </span>
                      {evidencia.puedeAbrirse && contenidoAbierto[evidencia.id] === undefined && (
                        <button
                          className="boton texto"
                          id={`abrir-evidencia-${evidencia.id}`}
                          type="button"
                          disabled={cargandoPrivado !== undefined}
                          onClick={() => void abrirPrivado('evidencia', evidencia.id)}
                        >
                          {cargandoPrivado === `evidencia-${evidencia.id}`
                            ? 'Abriendo…'
                            : 'Abrir evidencia'}
                        </button>
                      )}
                      {contenidoAbierto[evidencia.id] !== undefined && (
                        <div
                          className="contenido-privado"
                          id={`privado-evidencia-${evidencia.id}`}
                          tabIndex={-1}
                          role="status"
                        >
                          <strong>Contenido restringido solicitado:</strong>
                          <p>{contenidoAbierto[evidencia.id]}</p>
                          <button
                            className="boton texto"
                            type="button"
                            onClick={() => {
                              ocultarPrivado('evidencia', evidencia.id);
                            }}
                          >
                            Ocultar y borrar de esta vista
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {tarea.entregas.length > 0 && (
              <div>
                <h6>Entregas</h6>
                <ol className="lista-entregas">
                  {tarea.entregas.map((entrega) => (
                    <li key={entrega.id}>
                      Entregada el {cuando(entrega.entregadaEn)} con {entrega.evidenciaIds.length}{' '}
                      {entrega.evidenciaIds.length === 1 ? 'evidencia' : 'evidencias'}.
                      {entrega.revision?.tipo === 'cambios-solicitados' && (
                        <>
                          {' '}
                          Se pidieron cambios: {MOTIVO_CAMBIOS_EN_PALABRAS[entrega.revision.motivo]}
                          .
                        </>
                      )}
                      {entrega.revision?.tipo === 'aceptada' && (
                        <>
                          {' '}
                          Revisión aceptada:{' '}
                          {EVIDENCIA_CRITERIO_EN_PALABRAS[entrega.revision.evidenciaCriterio]}.
                        </>
                      )}
                      {entrega.puedeAbrirse && resumenAbierto[entrega.id] === undefined && (
                        <button
                          className="boton texto"
                          id={`abrir-resumen-${entrega.id}`}
                          type="button"
                          disabled={cargandoPrivado !== undefined}
                          onClick={() => void abrirPrivado('resumen', entrega.id)}
                        >
                          {cargandoPrivado === `resumen-${entrega.id}`
                            ? 'Abriendo…'
                            : 'Abrir resumen'}
                        </button>
                      )}
                      {resumenAbierto[entrega.id] !== undefined && (
                        <div
                          className="contenido-privado"
                          id={`privado-resumen-${entrega.id}`}
                          tabIndex={-1}
                          role="status"
                        >
                          <strong>Resumen restringido solicitado:</strong>
                          <p>{resumenAbierto[entrega.id]}</p>
                          <button
                            className="boton texto"
                            type="button"
                            onClick={() => {
                              ocultarPrivado('resumen', entrega.id);
                            }}
                          >
                            Ocultar y borrar de esta vista
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {tarea.completadaEn !== undefined && (
              <p>Quedó completada el {cerrarFrase(cuando(tarea.completadaEn))}</p>
            )}
          </section>
        )}

        <div ref={privadoRef} tabIndex={-1}>
          <ErrorVisible error={errorPrivado} />
        </div>

        {tarea.esMia && tarea.estado === 'aceptada' && (
          <div className="acciones-tarea">
            <p className="suave" id={`ayuda-iniciar-${tarea.id}`}>
              {dependenciasPendientes.length === 0
                ? 'Aceptar no inicia el reloj. Comenzá cuando el trabajo realmente empiece.'
                : `Antes deben completarse: ${dependenciasPendientes
                    .map((dependencia) => dependencia.titulo)
                    .join(', ')}.`}
            </p>
            <button
              className="boton"
              type="button"
              aria-describedby={`ayuda-iniciar-${tarea.id}`}
              disabled={accionEnCurso !== undefined || dependenciasPendientes.length > 0}
              onClick={() =>
                void mutar('iniciar', 'iniciar', cas, 'La tarea quedó en curso desde ahora.')
              }
            >
              {accionEnCurso === `iniciar-${tarea.id}` ? 'Comenzando…' : 'Comenzar la tarea'}
            </button>
          </div>
        )}

        {tarea.esMia && tarea.estado === 'en-curso' && (
          <div className="acciones-tarea dos-columnas">
            <form
              onSubmit={(evento) => {
                evento.preventDefault();
                if (categoriaBloqueo === '') return;
                void mutar(
                  'bloquear',
                  'bloquear',
                  { ...cas, categoria: categoriaBloqueo },
                  'El bloqueo quedó registrado y la tarea dejó de correr.',
                ).then((ok) => {
                  if (ok) setCategoriaBloqueo('');
                });
              }}
            >
              <fieldset disabled={accionEnCurso !== undefined}>
                <legend>Declarar un bloqueo</legend>
                <div className="campo">
                  <label htmlFor={`categoria-bloqueo-${tarea.id}`}>Causa general</label>
                  <select
                    id={`categoria-bloqueo-${tarea.id}`}
                    aria-describedby={`ayuda-bloqueo-${tarea.id}`}
                    required
                    value={categoriaBloqueo}
                    onChange={(evento) => {
                      setCategoriaBloqueo(evento.target.value as CategoriaBloqueoTarea);
                    }}
                  >
                    <option value="">Elegí una opción</option>
                    {Object.entries(CATEGORIA_BLOQUEO_EN_PALABRAS).map(([valor, texto]) => (
                      <option key={valor} value={valor}>
                        {texto}
                      </option>
                    ))}
                  </select>
                  <span className="ayuda" id={`ayuda-bloqueo-${tarea.id}`}>
                    Sólo queda pública esta categoría general.
                  </span>
                </div>
                {/*
                 * Deshabilitado mientras falte la causa. Antes el botón estaba disponible y el
                 * manejador hacía `return` sin decir nada: se pulsaba, no pasaba nada, y no había
                 * forma de saber si el fallo era del botón, de la red o de una misma.
                 */}
                <button className="boton secundario" disabled={categoriaBloqueo === ''}>
                  Declarar bloqueo
                </button>
              </fieldset>
            </form>
          </div>
        )}

        {tarea.esMia && (tarea.estado === 'en-curso' || tarea.estado === 'bloqueada') && (
          <form
            className="acciones-tarea"
            onSubmit={(evento) => {
              evento.preventDefault();
              if (categoriaAyuda === '') return;
              void mutar(
                'ayuda',
                'ayuda',
                { ...cas, categoria: categoriaAyuda },
                'El pedido de ayuda quedó registrado y la tarea quedó en apoyo.',
              ).then((ok) => {
                if (ok) setCategoriaAyuda('');
              });
            }}
          >
            <fieldset disabled={accionEnCurso !== undefined}>
              <legend>Pedir ayuda</legend>
              <div className="campo">
                <label htmlFor={`categoria-ayuda-${tarea.id}`}>Ayuda general</label>
                <select
                  id={`categoria-ayuda-${tarea.id}`}
                  aria-describedby={`ayuda-solicitud-${tarea.id}`}
                  required
                  value={categoriaAyuda}
                  onChange={(evento) => {
                    setCategoriaAyuda(evento.target.value as CategoriaAyudaTarea);
                  }}
                >
                  <option value="">Elegí una opción</option>
                  {Object.entries(CATEGORIA_AYUDA_EN_PALABRAS).map(([valor, texto]) => (
                    <option key={valor} value={valor}>
                      {texto}
                    </option>
                  ))}
                </select>
                <span className="ayuda" id={`ayuda-solicitud-${tarea.id}`}>
                  Pedir ayuda detiene el trabajo; no es una sanción.
                </span>
              </div>
              <button className="boton secundario" disabled={categoriaAyuda === ''}>
                Pedir ayuda
              </button>
            </fieldset>
          </form>
        )}

        {tarea.esMia &&
          (tarea.estado === 'bloqueada' || tarea.estado === 'en-apoyo') &&
          tarea.pausaActual !== undefined && (
            <button
              className="boton"
              type="button"
              disabled={accionEnCurso !== undefined}
              onClick={() =>
                void mutar(
                  'reanudar',
                  'reanudar',
                  { ...cas, pauseId: tarea.pausaActual?.id },
                  'La tarea volvió a estar en curso.',
                )
              }
            >
              {accionEnCurso === `reanudar-${tarea.id}` ? 'Reanudando…' : 'Reanudar la tarea'}
            </button>
          )}

        {tarea.esMia &&
          (tarea.estado === 'en-curso' ||
            tarea.estado === 'bloqueada' ||
            tarea.estado === 'en-apoyo') && (
            <form
              className="acciones-tarea"
              onSubmit={(evento) => {
                evento.preventDefault();
                void mutar(
                  'evidencia',
                  'evidencias',
                  { ...cas, contenido: notaEvidencia, visibilidad: 'restricted' },
                  'La nota quedó guardada como evidencia restringida.',
                ).then((ok) => {
                  if (ok) setNotaEvidencia('');
                });
              }}
            >
              <fieldset disabled={accionEnCurso !== undefined}>
                <legend>Agregar evidencia</legend>
                <div className="campo">
                  <label htmlFor={`evidencia-${tarea.id}`}>Nota restringida</label>
                  <textarea
                    id={`evidencia-${tarea.id}`}
                    aria-describedby={`ayuda-evidencia-${tarea.id}`}
                    required
                    minLength={10}
                    maxLength={16_384}
                    value={notaEvidencia}
                    onChange={(evento) => {
                      setNotaEvidencia(evento.target.value);
                    }}
                  />
                  <span className="ayuda" id={`ayuda-evidencia-${tarea.id}`}>
                    El historial público sólo muestra clase, tamaño aproximado y fecha. El contenido
                    se abre únicamente por una acción autorizada.
                  </span>
                </div>
                {/* El campo pide 10 caracteres como mínimo; el botón espera a que los haya. */}
                <button className="boton secundario" disabled={notaEvidencia.trim().length < 10}>
                  Guardar evidencia restringida
                </button>
              </fieldset>
            </form>
          )}

        {tarea.esMia && tarea.estado === 'en-curso' && tarea.evidencias.length > 0 && (
          <form
            className="acciones-tarea"
            onSubmit={(evento) => {
              evento.preventDefault();
              void mutar(
                'entregar',
                'entregas',
                { ...cas, evidenciaIds: evidenciasEntrega, resumen: resumenEntrega },
                'La entrega quedó esperando revisión.',
              ).then((ok) => {
                if (ok) {
                  setEvidenciasEntrega([]);
                  setResumenEntrega('');
                }
              });
            }}
          >
            <fieldset disabled={accionEnCurso !== undefined}>
              <legend>Entregar para revisión</legend>
              <fieldset className="seleccion-evidencias">
                <legend>Evidencias de esta entrega</legend>
                {tarea.evidencias.map((evidencia) => (
                  <label key={evidencia.id}>
                    <input
                      type="checkbox"
                      checked={evidenciasEntrega.includes(evidencia.id)}
                      onChange={(evento) => {
                        setEvidenciasEntrega((actual) =>
                          evento.target.checked
                            ? [...actual, evidencia.id]
                            : actual.filter((idEvidencia) => idEvidencia !== evidencia.id),
                        );
                      }}
                    />{' '}
                    Evidencia {evidencia.tipo} del {cuando(evidencia.agregadaEn)}
                  </label>
                ))}
              </fieldset>
              <div className="campo">
                <label htmlFor={`resumen-entrega-${tarea.id}`}>Resumen restringido</label>
                <textarea
                  id={`resumen-entrega-${tarea.id}`}
                  aria-describedby={`ayuda-resumen-${tarea.id}`}
                  required
                  minLength={20}
                  maxLength={4000}
                  value={resumenEntrega}
                  onChange={(evento) => {
                    setResumenEntrega(evento.target.value);
                  }}
                />
                <span className="ayuda" id={`ayuda-resumen-${tarea.id}`}>
                  Esto lo leen sólo vos y quien revise la entrega. No sale en el historial que
                  cualquiera puede consultar ni en lo que se descarga para comprobarlo.
                </span>
              </div>
              <button
                className="boton"
                disabled={evidenciasEntrega.length === 0 || resumenEntrega.length < 20}
              >
                Entregar para revisión
              </button>
            </fieldset>
          </form>
        )}

        {esResponsableInicial &&
          tarea.estado === 'entregada' &&
          tarea.entregaActualId !== undefined && (
            <div className="acciones-tarea dos-columnas">
              <form
                onSubmit={(evento) => {
                  evento.preventDefault();
                  if (motivoCambios === '') return;
                  void mutar(
                    'cambios',
                    'revisiones/cambios',
                    {
                      deliveryId: tarea.entregaActualId,
                      revision: tarea.revision,
                      motivo: motivoCambios,
                    },
                    'Los cambios quedaron pedidos y la tarea volvió a estar en curso.',
                  ).then((ok) => {
                    if (ok) setMotivoCambios('');
                  });
                }}
              >
                <fieldset disabled={accionEnCurso !== undefined}>
                  <legend>Pedir cambios</legend>
                  <div className="campo">
                    <label htmlFor={`motivo-cambios-${tarea.id}`}>Motivo general</label>
                    <select
                      id={`motivo-cambios-${tarea.id}`}
                      aria-describedby={`ayuda-cambios-${tarea.id}`}
                      required
                      value={motivoCambios}
                      onChange={(evento) => {
                        setMotivoCambios(evento.target.value as MotivoCambiosTarea);
                      }}
                    >
                      <option value="">Elegí una opción</option>
                      {Object.entries(MOTIVO_CAMBIOS_EN_PALABRAS).map(([valor, texto]) => (
                        <option key={valor} value={valor}>
                          {texto}
                        </option>
                      ))}
                    </select>
                    <span className="ayuda" id={`ayuda-cambios-${tarea.id}`}>
                      Sólo esta categoría queda en el historial.
                    </span>
                  </div>
                  <button className="boton secundario" disabled={motivoCambios === ''}>
                    Pedir cambios
                  </button>
                </fieldset>
              </form>
              <form
                onSubmit={(evento) => {
                  evento.preventDefault();
                  if (evidenciaCriterio === '') return;
                  void mutar(
                    'aceptar-revision',
                    'revisiones/aceptar',
                    {
                      deliveryId: tarea.entregaActualId,
                      revision: tarea.revision,
                      evidenciaCriterio,
                    },
                    'La revisión quedó aceptada y la tarea está completada.',
                  ).then((ok) => {
                    if (ok) setEvidenciaCriterio('');
                  });
                }}
              >
                <fieldset disabled={accionEnCurso !== undefined}>
                  <legend>Aceptar la revisión</legend>
                  <div className="campo">
                    <label htmlFor={`evidencia-criterio-${tarea.id}`}>Estado de la evidencia</label>
                    <select
                      id={`evidencia-criterio-${tarea.id}`}
                      required
                      value={evidenciaCriterio}
                      onChange={(evento) => {
                        setEvidenciaCriterio(evento.target.value as EvidenciaCriterioResultado);
                      }}
                    >
                      <option value="">Elegí una opción</option>
                      {Object.entries(EVIDENCIA_CRITERIO_EN_PALABRAS).map(([valor, texto]) => (
                        <option key={valor} value={valor}>
                          {texto}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button className="boton" disabled={evidenciaCriterio === ''}>
                    Aceptar y completar
                  </button>
                </fieldset>
              </form>
            </div>
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
                  aria-describedby={`ayuda-motivo-${tarea.id}`}
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
                <span className="ayuda" id={`ayuda-motivo-${tarea.id}`}>
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
                : tarea.estado !== 'ofrecida'
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
                  <span className="ayuda" id={`ayuda-reoferta-${tarea.id}`}>
                    La oferta anterior fue para{' '}
                    {miembros.find((miembro) => miembro.id === tarea.destinatarioId)?.alias}. Elegí
                    otra persona.
                  </span>
                )}
                <select
                  id={`reoferta-${tarea.id}`}
                  aria-describedby={
                    miembros?.some((miembro) => miembro.id === tarea.destinatarioId) === true
                      ? `ayuda-reoferta-${tarea.id}`
                      : undefined
                  }
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
