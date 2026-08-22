'use client';

import Link from 'next/link';
import { type ReactNode, type SyntheticEvent, useEffect, useRef, useState } from 'react';

import {
  CATEGORIA_AYUDA_EN_PALABRAS,
  CATEGORIA_BLOQUEO_EN_PALABRAS,
  MOTIVO_RESPUESTA_TAREA_EN_PALABRAS,
  type CapacidadPropia,
  type CategoriaAyudaTarea,
  type CategoriaBloqueoTarea,
  type IniciativaDetalle,
  type MotivoRespuestaTarea,
  type Tarea,
} from '@koinonia/contracts';

import { Aviso, Cargando, ErrorVisible, useSesion } from '../../components/marco';
import { cuando, enviar, ErrorDeApi, nuevoRequestId, reemplazar, traer } from '../../lib/api';

const MAXIMO_SEMANAL = 10_080;

const ESTADO_EN_PALABRAS: Readonly<Record<Tarea['estado'], string>> = {
  ofrecida: 'Oferta pendiente',
  aceptada: 'Aceptada',
  rechazada: 'No aceptada',
  'reasignacion-solicitada': 'Reasignación solicitada',
  'en-curso': 'En curso',
  bloqueada: 'Bloqueada',
  'en-apoyo': 'En apoyo',
  entregada: 'Entregada para revisión',
  completada: 'Completada',
};

interface TareaConIniciativa {
  readonly iniciativaId: string;
  readonly objetivo: string;
  readonly tarea: Tarea;
  readonly dependenciasPendientes: readonly string[];
}

interface Intento {
  readonly huella: string;
  readonly requestId: string;
}

function dividirMinutos(total: number): { horas: string; minutos: string } {
  return { horas: String(Math.floor(total / 60)), minutos: String(total % 60) };
}

function describirCapacidad(capacidad: CapacidadPropia): string {
  if (!capacidad.declarada) return 'Todavía no declaraste una capacidad semanal.';
  const horas = Math.floor(capacidad.minutosPorSemana / 60);
  const minutos = capacidad.minutosPorSemana % 60;
  if (horas === 0 && minutos === 0) return 'Declaraste 0 horas por semana.';
  return `Declaraste ${String(horas)} ${horas === 1 ? 'hora' : 'horas'}${
    minutos === 0 ? '' : ` y ${String(minutos)} ${minutos === 1 ? 'minuto' : 'minutos'}`
  } por semana.`;
}

export default function MisTareas(): ReactNode {
  const { sesion, cargando: cargandoSesion } = useSesion();
  const miembroId = sesion?.miembroId;
  const miembroActualRef = useRef<string | undefined>(miembroId);
  miembroActualRef.current = miembroId;

  const [capacidad, setCapacidad] = useState<CapacidadPropia | undefined>(undefined);
  const [capacidadDe, setCapacidadDe] = useState<string | undefined>(undefined);
  const [iniciativas, setIniciativas] = useState<IniciativaDetalle[] | undefined>(undefined);
  const [iniciativasDe, setIniciativasDe] = useState<string | undefined>(undefined);
  const [horas, setHoras] = useState('');
  const [minutos, setMinutos] = useState('');
  const [errorCapacidad, setErrorCapacidad] = useState<unknown>(undefined);
  const [errorTareas, setErrorTareas] = useState<unknown>(undefined);
  const [errorAccion, setErrorAccion] = useState<unknown>(undefined);
  const [confirmacion, setConfirmacion] = useState<string | undefined>(undefined);
  const [guardando, setGuardando] = useState(false);
  const [accionEnCurso, setAccionEnCurso] = useState<string | undefined>(undefined);
  const guardandoRef = useRef(false);
  const accionRef = useRef<string | undefined>(undefined);
  const guardadoGeneracionRef = useRef(0);
  const accionGeneracionRef = useRef(0);
  const capacidadCargaGeneracionRef = useRef(0);
  const iniciativasCargaGeneracionRef = useRef(0);
  const ultimaIdentidadConfirmadaRef = useRef<string | undefined>(undefined);
  const borradorCapacidadDeRef = useRef<string | undefined>(undefined);
  const borradorCapacidadSucioRef = useRef(false);
  const intentos = useRef(new Map<string, Intento>());
  const resultadoRef = useRef<HTMLDivElement>(null);

  function adoptarCapacidad(owner: string, actual: CapacidadPropia): void {
    if (miembroActualRef.current !== owner) return;
    setCapacidad(actual);
    setCapacidadDe(owner);
    if (borradorCapacidadSucioRef.current && borradorCapacidadDeRef.current === owner) return;
    if (actual.declarada) {
      const partes = dividirMinutos(actual.minutosPorSemana);
      setHoras(partes.horas);
      setMinutos(partes.minutos);
    } else {
      setHoras('');
      setMinutos('');
    }
  }

  async function cargarCapacidad(owner: string): Promise<CapacidadPropia | undefined> {
    const generacion = ++capacidadCargaGeneracionRef.current;
    setErrorCapacidad(undefined);
    try {
      const actual = await traer<CapacidadPropia>('/mi/capacidad');
      if (miembroActualRef.current !== owner || capacidadCargaGeneracionRef.current !== generacion)
        return undefined;
      adoptarCapacidad(owner, actual);
      return actual;
    } catch (fallo: unknown) {
      if (miembroActualRef.current === owner && capacidadCargaGeneracionRef.current === generacion)
        setErrorCapacidad(fallo);
      return undefined;
    }
  }

  async function cargarIniciativas(owner: string): Promise<IniciativaDetalle[] | undefined> {
    const generacion = ++iniciativasCargaGeneracionRef.current;
    setErrorTareas(undefined);
    try {
      const actuales = await traer<IniciativaDetalle[]>('/iniciativas');
      if (
        miembroActualRef.current !== owner ||
        iniciativasCargaGeneracionRef.current !== generacion
      )
        return undefined;
      setIniciativas(actuales);
      setIniciativasDe(owner);
      return actuales;
    } catch (fallo: unknown) {
      if (
        miembroActualRef.current === owner &&
        iniciativasCargaGeneracionRef.current === generacion
      )
        setErrorTareas(fallo);
      return undefined;
    }
  }

  useEffect(() => {
    // Los datos privados se vuelven irrepresentables en cuanto cambia o desaparece el sujeto.
    capacidadCargaGeneracionRef.current += 1;
    iniciativasCargaGeneracionRef.current += 1;
    setCapacidad(undefined);
    setCapacidadDe(undefined);
    setIniciativas(undefined);
    setIniciativasDe(undefined);
    setErrorCapacidad(undefined);
    setErrorTareas(undefined);
    setErrorAccion(undefined);
    setConfirmacion(undefined);
    guardandoRef.current = false;
    accionRef.current = undefined;
    guardadoGeneracionRef.current += 1;
    accionGeneracionRef.current += 1;
    setGuardando(false);
    setAccionEnCurso(undefined);
    intentos.current.clear();
    if (cargandoSesion) return;
    if (miembroId === undefined) {
      ultimaIdentidadConfirmadaRef.current = undefined;
      borradorCapacidadDeRef.current = undefined;
      borradorCapacidadSucioRef.current = false;
      setHoras('');
      setMinutos('');
      return;
    }
    if (ultimaIdentidadConfirmadaRef.current !== miembroId) {
      borradorCapacidadDeRef.current = undefined;
      borradorCapacidadSucioRef.current = false;
      setHoras('');
      setMinutos('');
    }
    ultimaIdentidadConfirmadaRef.current = miembroId;
    void cargarCapacidad(miembroId);
    void cargarIniciativas(miembroId);
    // Las funciones verifican el owner capturado antes de adoptar cualquier promesa tardía.
  }, [cargandoSesion, miembroId]);

  async function guardar(evento: SyntheticEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    if (guardandoRef.current || miembroId === undefined || capacidadDe !== miembroId) return;
    guardandoRef.current = true;
    const generacion = ++guardadoGeneracionRef.current;
    setGuardando(true);
    setErrorAccion(undefined);
    setConfirmacion(undefined);

    const horasNumero = Number(horas);
    const minutosNumero = Number(minutos);
    if (
      horas === '' ||
      minutos === '' ||
      !Number.isInteger(horasNumero) ||
      !Number.isInteger(minutosNumero) ||
      horasNumero < 0 ||
      horasNumero > 168 ||
      minutosNumero < 0 ||
      minutosNumero > 59
    ) {
      setErrorAccion(
        new Error('Escribí horas entre 0 y 168 y minutos entre 0 y 59, sin decimales.'),
      );
      requestAnimationFrame(() => resultadoRef.current?.focus());
      if (guardadoGeneracionRef.current === generacion) {
        guardandoRef.current = false;
        setGuardando(false);
      }
      return;
    }
    const total = horasNumero * 60 + minutosNumero;
    if (total > MAXIMO_SEMANAL) {
      setErrorAccion(new Error('La capacidad no puede superar las 168 horas de una semana.'));
      requestAnimationFrame(() => resultadoRef.current?.focus());
      if (guardadoGeneracionRef.current === generacion) {
        guardandoRef.current = false;
        setGuardando(false);
      }
      return;
    }
    const revision = capacidad?.declarada === true ? capacidad.revision : 0;
    try {
      const actualizada = await reemplazar<CapacidadPropia>('/mi/capacidad', {
        revision,
        minutosPorSemana: total,
      });
      if (miembroActualRef.current !== miembroId || guardadoGeneracionRef.current !== generacion)
        return;
      borradorCapacidadSucioRef.current = false;
      borradorCapacidadDeRef.current = miembroId;
      adoptarCapacidad(miembroId, actualizada);
      setConfirmacion('Tu capacidad semanal quedó guardada de forma privada.');
      requestAnimationFrame(() => resultadoRef.current?.focus());
    } catch (fallo: unknown) {
      if (miembroActualRef.current !== miembroId || guardadoGeneracionRef.current !== generacion)
        return;
      // Un 409 puede ser una respuesta perdida o una edición concurrente. La lectura decide cuál.
      const vigente = await cargarCapacidad(miembroId);
      if (miembroActualRef.current !== miembroId || guardadoGeneracionRef.current !== generacion)
        return;
      if (vigente?.declarada === true && vigente.minutosPorSemana === total) {
        borradorCapacidadSucioRef.current = false;
        borradorCapacidadDeRef.current = miembroId;
        adoptarCapacidad(miembroId, vigente);
        setErrorAccion(undefined);
        setConfirmacion(
          'Tu capacidad ya había quedado guardada; recuperamos la respuesta vigente.',
        );
      } else {
        setErrorAccion(fallo);
      }
      requestAnimationFrame(() => resultadoRef.current?.focus());
    } finally {
      if (guardadoGeneracionRef.current === generacion) {
        guardandoRef.current = false;
        if (miembroActualRef.current === miembroId) setGuardando(false);
      }
    }
  }

  async function mutarTarea(input: {
    readonly clave: string;
    readonly iniciativaId: string;
    readonly tarea: Tarea;
    readonly sufijo: string;
    readonly cuerpo: Readonly<Record<string, unknown>>;
    readonly mensaje: string;
  }): Promise<void> {
    if (accionRef.current !== undefined || miembroId === undefined) return;
    const ruta = `/iniciativas/${input.iniciativaId}/tareas/${input.tarea.id}/${input.sufijo}`;
    const huella = JSON.stringify([ruta, input.cuerpo]);
    const anterior = intentos.current.get(input.clave);
    const requestId = anterior?.huella === huella ? anterior.requestId : nuevoRequestId();
    intentos.current.set(input.clave, { huella, requestId });
    const generacion = ++accionGeneracionRef.current;
    accionRef.current = input.clave;
    setAccionEnCurso(input.clave);
    setErrorAccion(undefined);
    setConfirmacion(undefined);
    const cuerpo = { ...input.cuerpo, requestId };
    const adoptar = (actualizada: IniciativaDetalle, mensaje: string): void => {
      setIniciativas((actuales) =>
        actuales?.map((iniciativa) =>
          iniciativa.id === actualizada.id ? actualizada : iniciativa,
        ),
      );
      intentos.current.delete(input.clave);
      setConfirmacion(mensaje);
    };
    try {
      const actualizada = await enviar<IniciativaDetalle>(ruta, cuerpo);
      if (miembroActualRef.current !== miembroId || accionGeneracionRef.current !== generacion)
        return;
      adoptar(actualizada, input.mensaje);
      requestAnimationFrame(() => document.getElementById(`mi-tarea-${input.tarea.id}`)?.focus());
    } catch (fallo: unknown) {
      if (miembroActualRef.current !== miembroId || accionGeneracionRef.current !== generacion)
        return;
      let falloDefinitivo = fallo;
      if (!(fallo instanceof ErrorDeApi)) {
        try {
          // La misma clave sólo puede recuperar exactamente esta intención. A diferencia de mirar
          // el nombre del estado, no confunde una operación ajena que llegó al mismo estado.
          const recuperada = await enviar<IniciativaDetalle>(ruta, cuerpo);
          if (miembroActualRef.current !== miembroId || accionGeneracionRef.current !== generacion)
            return;
          adoptar(recuperada, `${input.mensaje} Recuperamos la respuesta vigente.`);
          requestAnimationFrame(() =>
            document.getElementById(`mi-tarea-${input.tarea.id}`)?.focus(),
          );
          return;
        } catch (segundoFallo: unknown) {
          falloDefinitivo = segundoFallo;
        }
      }
      await cargarIniciativas(miembroId);
      if (miembroActualRef.current !== miembroId || accionGeneracionRef.current !== generacion)
        return;
      setErrorAccion(falloDefinitivo);
      requestAnimationFrame(() => document.getElementById(`mi-tarea-${input.tarea.id}`)?.focus());
    } finally {
      if (accionGeneracionRef.current === generacion) {
        accionRef.current = undefined;
        if (miembroActualRef.current === miembroId) setAccionEnCurso(undefined);
      }
    }
  }

  if (cargandoSesion) return <Cargando que="tu sesión" />;
  if (sesion === undefined) {
    return (
      <>
        <h1>Mis tareas</h1>
        <Aviso tipo="atencion" titulo="Primero entrá">
          Tu capacidad y tus compromisos son privados.{' '}
          <Link href="/entrar">Entrá con el correo institucional</Link> para verlos.
        </Aviso>
      </>
    );
  }

  const capacidadVisible = capacidadDe === miembroId ? capacidad : undefined;
  const iniciativasVisibles = iniciativasDe === miembroId ? iniciativas : undefined;
  const tareas =
    iniciativasVisibles?.flatMap((iniciativa) =>
      iniciativa.tareas
        .filter((tarea) => tarea.esMia)
        .map((tarea) => ({
          iniciativaId: iniciativa.id,
          objetivo: iniciativa.objetivo,
          tarea,
          dependenciasPendientes: tarea.dependeDe
            .map((dependenciaId) =>
              iniciativa.tareas.find((candidata) => candidata.id === dependenciaId),
            )
            .filter((dependencia) => dependencia?.estado !== 'completada')
            .map((dependencia) => dependencia?.titulo ?? 'Una tarea anterior'),
        })),
    ) ?? [];
  const pendientes = tareas.filter(({ tarea }) => tarea.estado === 'ofrecida');
  const compromisos = tareas.filter(
    ({ tarea }) =>
      tarea.estado !== 'ofrecida' &&
      tarea.estado !== 'rechazada' &&
      tarea.estado !== 'reasignacion-solicitada',
  );
  const noAsumidas = tareas.filter(
    ({ tarea }) => tarea.estado === 'rechazada' || tarea.estado === 'reasignacion-solicitada',
  );

  return (
    <>
      <h1>Mis tareas</h1>
      <p>
        Acá ves solamente las ofertas que te hicieron y el trabajo que decidiste asumir. Tu
        capacidad exacta no aparece en iniciativas, directorios ni perfiles de otras personas.
      </p>

      <div ref={resultadoRef} tabIndex={-1}>
        <ErrorVisible error={errorAccion} />
        {confirmacion !== undefined && (
          <Aviso tipo="bien" titulo="Quedó registrado">
            {confirmacion}
          </Aviso>
        )}
      </div>

      <section aria-labelledby="capacidad-titulo">
        <h2 id="capacidad-titulo">Mi capacidad semanal</h2>
        <ErrorVisible error={errorCapacidad} />
        {errorCapacidad !== undefined && (
          <button
            className="boton secundario"
            type="button"
            onClick={() => void cargarCapacidad(sesion.miembroId)}
          >
            Reintentar capacidad
          </button>
        )}
        {capacidadVisible === undefined && errorCapacidad === undefined && (
          <Cargando que="tu capacidad" />
        )}
        {capacidadVisible !== undefined && (
          <>
            <div className="capacidad-resumen" role="status">
              <p>
                <strong>{describirCapacidad(capacidadVisible)}</strong>
              </p>
              {!capacidadVisible.declarada && (
                <p>
                  La ausencia no significa cero: hasta que guardes un valor, no hay declaración.
                </p>
              )}
              {capacidadVisible.declarada && (
                <p className="suave">Última actualización: {cuando(capacidadVisible.updatedAt)}.</p>
              )}
            </div>
            <form className="formulario-acotado" onSubmit={(evento) => void guardar(evento)}>
              <fieldset disabled={guardando}>
                <legend>
                  {capacidadVisible.declarada ? 'Cambiar mi capacidad' : 'Declarar mi capacidad'}
                </legend>
                <p className="suave" id="ayuda-capacidad">
                  Es un límite que elegís para cuidarte. Podés declarar cero. Nadie que ofrece
                  tareas recibe este número.
                </p>
                <div className="campos-tiempo">
                  <div className="campo">
                    <label htmlFor="capacidad-horas">Horas por semana</label>
                    <input
                      id="capacidad-horas"
                      type="number"
                      inputMode="numeric"
                      min="0"
                      max="168"
                      step="1"
                      required
                      aria-describedby="ayuda-capacidad"
                      value={horas}
                      onChange={(evento) => {
                        borradorCapacidadDeRef.current = miembroId;
                        borradorCapacidadSucioRef.current = true;
                        setHoras(evento.target.value);
                      }}
                    />
                  </div>
                  <div className="campo">
                    <label htmlFor="capacidad-minutos">Minutos adicionales</label>
                    <input
                      id="capacidad-minutos"
                      type="number"
                      inputMode="numeric"
                      min="0"
                      max="59"
                      step="1"
                      required
                      aria-describedby="ayuda-capacidad"
                      value={minutos}
                      onChange={(evento) => {
                        borradorCapacidadDeRef.current = miembroId;
                        borradorCapacidadSucioRef.current = true;
                        setMinutos(evento.target.value);
                      }}
                    />
                  </div>
                </div>
                <button className="boton" type="submit">
                  {guardando ? 'Guardando…' : 'Guardar mi capacidad'}
                </button>
              </fieldset>
            </form>
          </>
        )}
      </section>

      <section aria-labelledby="tareas-titulo">
        <h2 id="tareas-titulo">Ofertas y compromisos</h2>
        <ErrorVisible error={errorTareas} />
        {errorTareas !== undefined && (
          <button
            className="boton secundario"
            type="button"
            onClick={() => void cargarIniciativas(sesion.miembroId)}
          >
            Reintentar tareas
          </button>
        )}
        {iniciativasVisibles === undefined && errorTareas === undefined && (
          <Cargando que="tus tareas" />
        )}
        {iniciativasVisibles !== undefined && tareas.length === 0 && (
          <div className="vacio">
            <p>
              <strong>No tenés tareas. Eso está bien:</strong> no todo el mundo tiene que estar
              haciendo algo todo el tiempo.
            </p>
            <p>
              Si querés conocer el trabajo abierto, podés{' '}
              <Link href="/iniciativas">recorrer las iniciativas</Link> sin asumir nada.
            </p>
          </div>
        )}
        {iniciativasVisibles !== undefined && tareas.length > 0 && (
          <>
            <GrupoTareas
              titulo="Ofertas pendientes"
              tareas={pendientes}
              accionEnCurso={accionEnCurso}
              onMutar={mutarTarea}
            />
            <GrupoTareas
              titulo="Mis compromisos"
              tareas={compromisos}
              accionEnCurso={accionEnCurso}
              onMutar={mutarTarea}
            />
            <GrupoTareas
              titulo="Ofertas que no asumí"
              tareas={noAsumidas}
              accionEnCurso={accionEnCurso}
              onMutar={mutarTarea}
            />
          </>
        )}
      </section>
    </>
  );
}

type Mutar = (input: {
  readonly clave: string;
  readonly iniciativaId: string;
  readonly tarea: Tarea;
  readonly sufijo: string;
  readonly cuerpo: Readonly<Record<string, unknown>>;
  readonly mensaje: string;
}) => Promise<void>;

function GrupoTareas({
  titulo,
  tareas,
  accionEnCurso,
  onMutar,
}: {
  readonly titulo: string;
  readonly tareas: readonly TareaConIniciativa[];
  readonly accionEnCurso: string | undefined;
  readonly onMutar: Mutar;
}): ReactNode {
  if (tareas.length === 0) return null;
  const id =
    titulo === 'Ofertas pendientes'
      ? 'ofertas-pendientes'
      : titulo === 'Mis compromisos'
        ? 'compromisos-propios'
        : 'ofertas-no-asumidas';
  return (
    <section aria-labelledby={id}>
      <h3 id={id}>{titulo}</h3>
      <ul className="tarjetas" aria-label={titulo}>
        {tareas.map((item) => (
          <TareaRapida
            key={`${item.iniciativaId}:${item.tarea.id}`}
            item={item}
            accionEnCurso={accionEnCurso}
            onMutar={onMutar}
          />
        ))}
      </ul>
    </section>
  );
}

function TareaRapida({
  item,
  accionEnCurso,
  onMutar,
}: {
  readonly item: TareaConIniciativa;
  readonly accionEnCurso: string | undefined;
  readonly onMutar: Mutar;
}): ReactNode {
  const { iniciativaId, objetivo, tarea, dependenciasPendientes } = item;
  const [motivo, setMotivo] = useState<MotivoRespuestaTarea | ''>('');
  const [bloqueo, setBloqueo] = useState<CategoriaBloqueoTarea | ''>('');
  const [ayuda, setAyuda] = useState<CategoriaAyudaTarea | ''>('');
  const cas = { offerId: tarea.ofertaId, revision: tarea.revision };
  const ocupado = accionEnCurso !== undefined;

  function mutar(
    accion: string,
    sufijo: string,
    cuerpo: Readonly<Record<string, unknown>>,
    mensaje: string,
  ): void {
    void onMutar({
      clave: `${accion}-${tarea.id}`,
      iniciativaId,
      tarea,
      sufijo,
      cuerpo,
      mensaje,
    });
  }

  const puedeReasignar =
    tarea.estado === 'aceptada' ||
    tarea.estado === 'en-curso' ||
    tarea.estado === 'bloqueada' ||
    tarea.estado === 'en-apoyo';

  return (
    <li
      className="tarea-propia"
      id={`mi-tarea-${tarea.id}`}
      tabIndex={-1}
      aria-labelledby={`mi-tarea-titulo-${tarea.id}`}
    >
      <span className="etiqueta">{ESTADO_EN_PALABRAS[tarea.estado]}</span>
      <h3 id={`mi-tarea-titulo-${tarea.id}`}>{tarea.titulo}</h3>
      <p>{tarea.descripcion}</p>
      <p className="suave">
        {tarea.esfuerzoMinutos} minutos estimados · vence el {cuando(tarea.venceEn)}
      </p>
      <p className="suave">Iniciativa: {objetivo}</p>

      {tarea.estado === 'ofrecida' && (
        <div className="respuesta-tarea">
          <p className="suave">Aceptar crea un compromiso; no inicia el trabajo todavía.</p>
          <button
            className="boton"
            type="button"
            disabled={ocupado}
            onClick={() => {
              mutar(
                'aceptar',
                'respuestas',
                { ...cas, tipo: 'aceptar' },
                'Aceptaste la tarea. Ahora podés comenzar cuando el trabajo empiece.',
              );
            }}
          >
            Aceptar oferta
          </button>
          <form
            onSubmit={(evento) => {
              evento.preventDefault();
              if (motivo === '') return;
              mutar(
                'rechazar',
                'respuestas',
                { ...cas, tipo: 'rechazar', motivo },
                'La oferta quedó rechazada sin atribuirte el trabajo.',
              );
            }}
          >
            <div className="campo">
              <label htmlFor={`rechazo-${tarea.id}`}>Motivo general para no asumirla</label>
              <select
                id={`rechazo-${tarea.id}`}
                aria-describedby={`ayuda-rechazo-${tarea.id}`}
                required
                disabled={ocupado}
                value={motivo}
                onChange={(evento) => {
                  setMotivo(evento.target.value as MotivoRespuestaTarea);
                }}
              >
                <option value="">Elegí una opción</option>
                {Object.entries(MOTIVO_RESPUESTA_TAREA_EN_PALABRAS).map(([valor, texto]) => (
                  <option key={valor} value={valor}>
                    {texto}
                  </option>
                ))}
              </select>
              <span className="ayuda" id={`ayuda-rechazo-${tarea.id}`}>
                Sólo se registra esta categoría cerrada.
              </span>
            </div>
            <button className="boton secundario" disabled={ocupado || motivo === ''}>
              Rechazar oferta
            </button>
            <button
              className="boton secundario"
              type="button"
              disabled={ocupado || motivo === ''}
              onClick={() => {
                if (motivo === '') return;
                mutar(
                  'reasignar-oferta',
                  'respuestas',
                  { ...cas, tipo: 'pedir-reasignacion', motivo },
                  'Pediste que la oferta se dirija a otra persona sin atribuirte el trabajo.',
                );
              }}
            >
              Pedir que se la ofrezcan a otra persona
            </button>
          </form>
        </div>
      )}

      {tarea.estado === 'aceptada' && (
        <div>
          <p className="suave" id={`ayuda-iniciar-rapido-${tarea.id}`}>
            {dependenciasPendientes.length === 0
              ? 'Comenzá cuando el trabajo realmente empiece.'
              : `Antes deben completarse: ${dependenciasPendientes.join(', ')}.`}
          </p>
          <button
            className="boton"
            type="button"
            aria-describedby={`ayuda-iniciar-rapido-${tarea.id}`}
            disabled={ocupado || dependenciasPendientes.length > 0}
            onClick={() => {
              mutar('iniciar', 'iniciar', cas, 'La tarea quedó en curso desde ahora.');
            }}
          >
            Comenzar la tarea
          </button>
        </div>
      )}

      {tarea.estado === 'en-curso' && (
        <form
          className="respuesta-tarea"
          onSubmit={(evento) => {
            evento.preventDefault();
            if (bloqueo === '') return;
            mutar(
              'bloquear',
              'bloquear',
              { ...cas, categoria: bloqueo },
              'El bloqueo quedó registrado y detuvo la tarea.',
            );
          }}
        >
          <div className="campo">
            <label htmlFor={`bloqueo-${tarea.id}`}>Causa general del bloqueo</label>
            <select
              id={`bloqueo-${tarea.id}`}
              aria-describedby={`ayuda-bloqueo-rapido-${tarea.id}`}
              required
              disabled={ocupado}
              value={bloqueo}
              onChange={(evento) => {
                setBloqueo(evento.target.value as CategoriaBloqueoTarea);
              }}
            >
              <option value="">Elegí una opción</option>
              {Object.entries(CATEGORIA_BLOQUEO_EN_PALABRAS).map(([valor, texto]) => (
                <option key={valor} value={valor}>
                  {texto}
                </option>
              ))}
            </select>
            <span className="ayuda" id={`ayuda-bloqueo-rapido-${tarea.id}`}>
              El detalle privado no se pide en esta pantalla.
            </span>
          </div>
          <button className="boton secundario" disabled={ocupado || bloqueo === ''}>
            Declarar bloqueo
          </button>
        </form>
      )}

      {(tarea.estado === 'en-curso' || tarea.estado === 'bloqueada') && (
        <form
          className="respuesta-tarea"
          onSubmit={(evento) => {
            evento.preventDefault();
            if (ayuda === '') return;
            mutar(
              'ayuda',
              'ayuda',
              { ...cas, categoria: ayuda },
              'El pedido de ayuda quedó registrado y detuvo la tarea.',
            );
          }}
        >
          <div className="campo">
            <label htmlFor={`ayuda-${tarea.id}`}>Tipo general de ayuda</label>
            <select
              id={`ayuda-${tarea.id}`}
              aria-describedby={`ayuda-ayuda-rapida-${tarea.id}`}
              required
              disabled={ocupado}
              value={ayuda}
              onChange={(evento) => {
                setAyuda(evento.target.value as CategoriaAyudaTarea);
              }}
            >
              <option value="">Elegí una opción</option>
              {Object.entries(CATEGORIA_AYUDA_EN_PALABRAS).map(([valor, texto]) => (
                <option key={valor} value={valor}>
                  {texto}
                </option>
              ))}
            </select>
            <span className="ayuda" id={`ayuda-ayuda-rapida-${tarea.id}`}>
              Pedir ayuda no es una sanción y detiene el trabajo.
            </span>
          </div>
          <button className="boton secundario" disabled={ocupado || ayuda === ''}>
            Pedir ayuda
          </button>
        </form>
      )}

      {puedeReasignar && (
        <form
          className="respuesta-tarea"
          onSubmit={(evento) => {
            evento.preventDefault();
            if (motivo === '') return;
            mutar(
              'reasignar',
              'respuestas',
              { ...cas, tipo: 'pedir-reasignacion', motivo },
              'Pediste otra persona y el compromiso dejó de figurar a tu cargo.',
            );
          }}
        >
          <div className="campo">
            <label htmlFor={`reasignacion-${tarea.id}`}>
              Motivo general para pedir otra persona
            </label>
            <select
              id={`reasignacion-${tarea.id}`}
              aria-describedby={`ayuda-reasignacion-${tarea.id}`}
              required
              disabled={ocupado}
              value={motivo}
              onChange={(evento) => {
                setMotivo(evento.target.value as MotivoRespuestaTarea);
              }}
            >
              <option value="">Elegí una opción</option>
              {Object.entries(MOTIVO_RESPUESTA_TAREA_EN_PALABRAS).map(([valor, texto]) => (
                <option key={valor} value={valor}>
                  {texto}
                </option>
              ))}
            </select>
            <span className="ayuda" id={`ayuda-reasignacion-${tarea.id}`}>
              No se guarda texto libre ni capacidad privada.
            </span>
          </div>
          <button className="boton secundario" disabled={ocupado || motivo === ''}>
            Pedir reasignación
          </button>
        </form>
      )}

      <p>
        <Link href={`/iniciativas/${iniciativaId}`}>
          Ver detalle, evidencia, entrega y revisión
        </Link>
      </p>
    </li>
  );
}
