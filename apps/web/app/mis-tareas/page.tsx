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
  type MiTarea,
  type MotivoRespuestaTarea,
  type Tarea,
} from '@koinonia/contracts';

import { Aviso, Cargando, ErrorVisible, useSesion } from '../../components/marco';
import { Esqueleto, Ficha, Meta, Vacio, type VarianteFicha } from '../../components/piezas';
import { type EscalonTarea } from '../iniciativas/escalones';
import { PeldanoDeTarea, selloDeTareas, useEscalones } from '../iniciativas/piezas-ejecucion';
import { useAccionUnica } from '../../lib/acciones';
import {
  cerrarFrase,
  cuando,
  enviar,
  ErrorDeApi,
  fechaCortaEnFrase,
  reemplazar,
  traer,
} from '../../lib/api';
import { enfocarTrasPintar } from '../../lib/foco';

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

/**
 * Qué variante de `<Ficha>` le toca a cada estado. `bien` sólo para el desenlace real
 * (completada); `mal` sólo para lo que quedó fuera (rechazada); `en-curso` para todo lo que sigue
 * vivo y sin resultado todavía —incluida «aceptada», que ya es un compromiso pero no arrancó—; y
 * `atencion` para lo que le pide algo a la persona ahora mismo: responder una oferta, resolver un
 * bloqueo, conseguir ayuda o que le reasignen el trabajo.
 */
const ESTADO_A_VARIANTE: Readonly<Record<Tarea['estado'], VarianteFicha>> = {
  ofrecida: 'atencion',
  aceptada: 'en-curso',
  rechazada: 'mal',
  'reasignacion-solicitada': 'atencion',
  'en-curso': 'en-curso',
  bloqueada: 'atencion',
  'en-apoyo': 'atencion',
  entregada: 'en-curso',
  completada: 'bien',
};

/**
 * Reconstruye la fila propia a partir de la iniciativa que devuelve la mutación.
 *
 * La respuesta del POST trae la iniciativa entera, incluidas tareas de otras personas. Se usa lo
 * único que hace falta —la tarea propia y cuántas dependencias le faltan— y **el resto se descarta
 * en el acto**: no se guarda en el estado, así que no sobrevive al manejador.
 */
function filaPropia(iniciativa: IniciativaDetalle, tareaId: string): MiTarea | undefined {
  const tarea = iniciativa.tareas.find((candidata) => candidata.id === tareaId);
  if (tarea === undefined) return undefined;
  return {
    iniciativaId: iniciativa.id,
    objetivo: iniciativa.objetivo,
    tarea,
    dependenciasPendientes: tarea.dependeDe.filter((dependenciaId) => {
      const dependencia = iniciativa.tareas.find((otra) => otra.id === dependenciaId);
      return dependencia?.estado !== 'completada';
    }).length,
  };
}

function dividirMinutos(total: number): { horas: string; minutos: string } {
  return { horas: String(Math.floor(total / 60)), minutos: String(total % 60) };
}

/** «1 minuto estimado» / «45 minutos estimados». El número manda sobre el sustantivo. */
function esfuerzoEnPalabras(minutos: number): string {
  return minutos === 1 ? '1 minuto estimado' : `${String(minutos)} minutos estimados`;
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
  const [misTareas, setMisTareas] = useState<MiTarea[] | undefined>(undefined);
  const [misTareasDe, setMisTareasDe] = useState<string | undefined>(undefined);
  const [horas, setHoras] = useState('');
  const [minutos, setMinutos] = useState('');
  const [errorCapacidad, setErrorCapacidad] = useState<unknown>(undefined);
  const [errorTareas, setErrorTareas] = useState<unknown>(undefined);
  const [errorAccion, setErrorAccion] = useState<unknown>(undefined);
  const [confirmacion, setConfirmacion] = useState<string | undefined>(undefined);
  const [guardando, setGuardando] = useState(false);
  // Una acción a la vez y una clave de idempotencia por intención. Esta pantalla era la última que
  // llevaba el patrón copiado a mano —su propio cerrojo, su propia generación, su propio mapa de
  // claves y su propio `nuevoRequestId()`—; ahora usa el mismo módulo que las demás, que es lo que
  // hace cierta la premisa de `lib/acciones`: arreglarlo una vez las arregla a todas.
  // Las claves llevan el id de la tarea —`iniciar-${tarea.id}`— así que muchas filas conviven sin
  // mezclar idempotencias, y el cerrojo sigue siendo uno solo para toda la pantalla.
  const {
    enCurso: accionEnCurso,
    ejecutar: ejecutarUnica,
    olvidarTodo,
    reiniciar,
  } = useAccionUnica();
  const guardandoRef = useRef(false);
  const guardadoGeneracionRef = useRef(0);
  const capacidadCargaGeneracionRef = useRef(0);
  const tareasCargaGeneracionRef = useRef(0);
  const ultimaIdentidadConfirmadaRef = useRef<string | undefined>(undefined);
  const borradorCapacidadDeRef = useRef<string | undefined>(undefined);
  const borradorCapacidadSucioRef = useRef(false);
  const resultadoRef = useRef<HTMLDivElement>(null);

  // Los peldaños de incumplimiento (ADR-0040) de las tareas propias. Acá llegan los DOS privados
  // —«se acerca la fecha» y «toca preguntar cómo va»— que el servidor no le enseña a nadie más:
  // esta pantalla es, literalmente, el único sitio donde ese recordatorio existe, y por eso es el
  // sitio donde hay que decir que es privado. Se piden por iniciativa (no hay ruta por tarea), y un
  // fallo no rompe la pantalla: sin peldaños se sigue viendo el trabajo entero.
  const escalones = useEscalones(
    (misTareas ?? []).map((item) => item.iniciativaId),
    selloDeTareas((misTareas ?? []).map((item) => item.tarea)),
  );

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

  /**
   * Pide **sólo las tareas propias**.
   *
   * Antes pedía `/iniciativas`, que devuelve el detalle completo de todas: llegaban al teléfono el
   * título y la descripción del trabajo de todo el Instituto, y `esMia` sólo decidía qué se
   * pintaba. Lo que no se envía no se puede filtrar por error, y en una conexión que se paga por
   * megabyte tampoco se paga.
   */
  async function cargarTareas(owner: string): Promise<MiTarea[] | undefined> {
    const generacion = ++tareasCargaGeneracionRef.current;
    setErrorTareas(undefined);
    try {
      const actuales = await traer<MiTarea[]>('/mi/tareas');
      if (miembroActualRef.current !== owner || tareasCargaGeneracionRef.current !== generacion)
        return undefined;
      setMisTareas(actuales);
      setMisTareasDe(owner);
      return actuales;
    } catch (fallo: unknown) {
      if (miembroActualRef.current === owner && tareasCargaGeneracionRef.current === generacion)
        setErrorTareas(fallo);
      return undefined;
    }
  }

  useEffect(() => {
    // Los datos privados se vuelven irrepresentables en cuanto cambia o desaparece el sujeto.
    capacidadCargaGeneracionRef.current += 1;
    tareasCargaGeneracionRef.current += 1;
    setCapacidad(undefined);
    setCapacidadDe(undefined);
    setMisTareas(undefined);
    setMisTareasDe(undefined);
    setErrorCapacidad(undefined);
    setErrorTareas(undefined);
    setErrorAccion(undefined);
    setConfirmacion(undefined);
    guardandoRef.current = false;
    guardadoGeneracionRef.current += 1;
    setGuardando(false);
    // Suelta el cerrojo y jubila lo que esté en vuelo. Las claves de idempotencia **no** se
    // olvidan acá: revalidar la cookie de la misma persona pasa por este efecto en cada vuelta al
    // foco, y borrarlas ahí era justamente lo que impedía reintentar tras un 401 pasajero sin
    // escribir dos veces. Se olvidan más abajo, y sólo cuando el sujeto deja de ser el mismo.
    reiniciar();
    if (cargandoSesion) return;
    if (miembroId === undefined) {
      ultimaIdentidadConfirmadaRef.current = undefined;
      borradorCapacidadDeRef.current = undefined;
      borradorCapacidadSucioRef.current = false;
      olvidarTodo();
      setHoras('');
      setMinutos('');
      return;
    }
    if (ultimaIdentidadConfirmadaRef.current !== miembroId) {
      borradorCapacidadDeRef.current = undefined;
      borradorCapacidadSucioRef.current = false;
      // Una clave pendiente recuerda la intención de la cuenta anterior. Reusarla haría que el
      // servidor tomara el envío de esta persona por un duplicado del de aquella, y no escribiera.
      olvidarTodo();
      setHoras('');
      setMinutos('');
    }
    ultimaIdentidadConfirmadaRef.current = miembroId;
    void cargarCapacidad(miembroId);
    void cargarTareas(miembroId);
    // Las funciones verifican el owner capturado antes de adoptar cualquier promesa tardía.
  }, [cargandoSesion, miembroId, olvidarTodo, reiniciar]);

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
      enfocarTrasPintar(() => resultadoRef.current?.focus());
      if (guardadoGeneracionRef.current === generacion) {
        guardandoRef.current = false;
        setGuardando(false);
      }
      return;
    }
    const total = horasNumero * 60 + minutosNumero;
    if (total > MAXIMO_SEMANAL) {
      setErrorAccion(new Error('La capacidad no puede superar las 168 horas de una semana.'));
      enfocarTrasPintar(() => resultadoRef.current?.focus());
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
      enfocarTrasPintar(() => resultadoRef.current?.focus());
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
      enfocarTrasPintar(() => resultadoRef.current?.focus());
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
    if (miembroId === undefined) return;
    const ruta = `/iniciativas/${input.iniciativaId}/tareas/${input.tarea.id}/${input.sufijo}`;
    const enfocarTarea = (): void => {
      enfocarTrasPintar(() => document.getElementById(`mi-tarea-${input.tarea.id}`)?.focus());
    };

    // El cerrojo síncrono, la clave estable y jubilar lo que quedó en vuelo los pone
    // `useAccionUnica`. Lo que queda acá es lo único que sólo esta pantalla sabe: que la respuesta
    // trae la iniciativa entera y que de ella se conserva **una sola fila**, la propia.
    const resultado = await ejecutarUnica<{
      readonly iniciativa: IniciativaDetalle;
      readonly recuperada: boolean;
    }>(input.clave, [ruta, input.cuerpo], async (requestId) => {
      // Dentro de `llamar`, que sólo corre si el cerrojo se tomó: un segundo toque descartado no
      // puede borrar el aviso que la persona todavía no leyó.
      setErrorAccion(undefined);
      setConfirmacion(undefined);
      const cuerpo = { ...input.cuerpo, requestId };
      try {
        return { iniciativa: await enviar<IniciativaDetalle>(ruta, cuerpo), recuperada: false };
      } catch (fallo: unknown) {
        // Un fallo que no llegó a ser respuesta del servidor puede ser una escritura que sí ocurrió
        // y cuya respuesta se perdió. Se reenvía con **la misma** clave: si ya estaba escrito, el
        // servidor devuelve aquello en vez de escribirlo otra vez. A diferencia de mirar el nombre
        // del estado, la clave sólo puede recuperar exactamente esta intención y no una ajena que
        // llegó al mismo estado. Si el reintento también falla, el que sube es el segundo fallo.
        if (fallo instanceof ErrorDeApi) throw fallo;
        return { iniciativa: await enviar<IniciativaDetalle>(ruta, cuerpo), recuperada: true };
      }
    });

    // `ignorado` es el toque que no entró o la respuesta de una tanda ya jubilada: nada que pintar.
    if (resultado.estado === 'ignorado') return;
    // Y una proyección pertenece a una identidad concreta: si cambió mientras la llamada volaba,
    // describe permisos que ya no son los de quien mira.
    if (miembroActualRef.current !== miembroId) return;

    if (resultado.estado === 'hecho') {
      const { iniciativa: actualizada, recuperada } = resultado.valor;
      const fila = filaPropia(actualizada, input.tarea.id);
      setMisTareas((actuales) =>
        actuales?.map((item) =>
          item.iniciativaId === actualizada.id && item.tarea.id === input.tarea.id && fila
            ? fila
            : item,
        ),
      );
      setConfirmacion(
        recuperada ? `${input.mensaje} Recuperamos la respuesta vigente.` : input.mensaje,
      );
      enfocarTarea();
      return;
    }

    await cargarTareas(miembroId);
    if (miembroActualRef.current !== miembroId) return;
    setErrorAccion(resultado.error);
    enfocarTarea();
  }

  // El título y la introducción no dependen de ningún dato: se quedan fijos, igual que en
  // /iniciativas, y sólo el cuerpo —que sí depende de la sesión— muestra un esqueleto mientras se
  // resuelve. Antes este `return` reemplazaba la página entera, `<h1>` incluido, y el salto al
  // resolver la sesión era de cientos de píxeles.
  if (cargandoSesion) {
    return (
      <div className="pagina-indice">
        <h1>Mis tareas</h1>
        <p>
          Acá ves solamente las ofertas que te hicieron y el trabajo que decidiste asumir. Tu
          capacidad exacta no aparece en iniciativas, directorios ni perfiles de otras personas.
        </p>

        <div aria-hidden="true">
          <div className="esqueleto-linea esqueleto-titulo" style={{ width: '35%' }} />
          <div className="esqueleto-linea" style={{ width: '60%' }} />
          <div
            className="esqueleto-linea esqueleto-titulo"
            style={{ marginTop: 'var(--e6)', width: '40%' }}
          />
          <ul className="tarjetas esqueleto">
            {Array.from({ length: 3 }, (_valor, indice) => (
              <li key={indice}>
                <div className="esqueleto-linea esqueleto-titulo" />
                <div className="esqueleto-linea" />
              </li>
            ))}
          </ul>
        </div>
        <div className="solo-lectores">
          <Cargando que="tu sesión" />
        </div>
      </div>
    );
  }
  if (sesion === undefined) {
    return (
      <div className="pagina-indice">
        <h1>Mis tareas</h1>
        <Aviso tipo="atencion" titulo="Primero entrá">
          Tu capacidad y tus compromisos son privados.{' '}
          <Link href="/entrar">Entrá con el correo institucional</Link> para verlos.
        </Aviso>
      </div>
    );
  }

  const capacidadVisible = capacidadDe === miembroId ? capacidad : undefined;
  // Ya no hace falta filtrar: el servidor no manda nada que no sea de esta persona.
  const tareas = (misTareasDe === miembroId ? misTareas : undefined) ?? [];
  const tareasVisibles = misTareasDe === miembroId ? misTareas : undefined;
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
    <div className="pagina-indice">
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
                <p className="suave">
                  {cerrarFrase(`Última actualización: ${cuando(capacidadVisible.updatedAt)}`)}
                </p>
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
            onClick={() => void cargarTareas(sesion.miembroId)}
          >
            Reintentar tareas
          </button>
        )}
        {tareasVisibles === undefined && errorTareas === undefined && (
          <Esqueleto que="tus tareas" />
        )}
        {tareasVisibles !== undefined && tareas.length === 0 && (
          <Vacio
            titulo="No tenés tareas"
            salida={{ href: '/iniciativas', texto: 'Recorrer las iniciativas' }}
          >
            <p>Eso está bien: no todo el mundo tiene que estar haciendo algo todo el tiempo.</p>
          </Vacio>
        )}
        {tareasVisibles !== undefined && tareas.length > 0 && (
          <>
            <GrupoTareas
              titulo="Ofertas pendientes"
              tareas={pendientes}
              escalones={escalones}
              accionEnCurso={accionEnCurso}
              onMutar={mutarTarea}
            />
            <GrupoTareas
              titulo="Mis compromisos"
              tareas={compromisos}
              escalones={escalones}
              accionEnCurso={accionEnCurso}
              onMutar={mutarTarea}
            />
            <GrupoTareas
              titulo="Ofertas que no asumí"
              tareas={noAsumidas}
              escalones={escalones}
              accionEnCurso={accionEnCurso}
              onMutar={mutarTarea}
            />
          </>
        )}
      </section>
    </div>
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
  escalones,
  accionEnCurso,
  onMutar,
}: {
  readonly titulo: string;
  readonly tareas: readonly MiTarea[];
  /** Índice `tareaId → peldaño`, aplanado sobre todas las iniciativas: ver `useEscalones`. */
  readonly escalones: ReadonlyMap<string, EscalonTarea>;
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
            escalon={escalones.get(item.tarea.id)}
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
  escalon,
  accionEnCurso,
  onMutar,
}: {
  readonly item: MiTarea;
  /** El peldaño vigente de ESTA tarea, incluidos los dos que sólo ve quien la tiene. */
  readonly escalon: EscalonTarea | undefined;
  readonly accionEnCurso: string | undefined;
  readonly onMutar: Mutar;
}): ReactNode {
  const { iniciativaId, objetivo, tarea, dependenciasPendientes } = item;
  // Dos motivos y no uno. Rechazar una oferta y pedir que un compromiso ya asumido pase a otra
  // persona son actos distintos, y compartían estado: el motivo elegido para lo primero seguía
  // seleccionado cuando la tarea cambiaba de estado y aparecía el segundo formulario, así que se
  // podía enviar como motivo de reasignación algo que se eligió para otra pregunta.
  const [motivoOferta, setMotivoOferta] = useState<MotivoRespuestaTarea | ''>('');
  const [motivoReasignacion, setMotivoReasignacion] = useState<MotivoRespuestaTarea | ''>('');
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
      <Ficha variante={ESTADO_A_VARIANTE[tarea.estado]}>{ESTADO_EN_PALABRAS[tarea.estado]}</Ficha>
      <h3 id={`mi-tarea-titulo-${tarea.id}`}>{tarea.titulo}</h3>
      <p>{tarea.descripcion}</p>
      <Meta>
        {esfuerzoEnPalabras(tarea.esfuerzoMinutos)}
        <>
          vence{' '}
          <time dateTime={new Date(tarea.venceEn).toISOString()} title={cuando(tarea.venceEn)}>
            {fechaCortaEnFrase(tarea.venceEn)}
          </time>
        </>
        {`Iniciativa: ${objetivo}`}
      </Meta>

      {/*
       * El peldaño va antes que cualquier formulario: es lo que explica por qué la pantalla te está
       * pidiendo algo. Puesto después, la persona ya decidió qué hacer sin haber leído que atrasarse
       * no es una falta que se le anota a nadie.
       */}
      {escalon !== undefined && <PeldanoDeTarea escalon={escalon} />}

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
              if (motivoOferta === '') return;
              mutar(
                'rechazar',
                'respuestas',
                { ...cas, tipo: 'rechazar', motivo: motivoOferta },
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
                value={motivoOferta}
                onChange={(evento) => {
                  setMotivoOferta(evento.target.value as MotivoRespuestaTarea);
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
            <button className="boton secundario" disabled={ocupado || motivoOferta === ''}>
              Rechazar oferta
            </button>
            <button
              className="boton secundario"
              type="button"
              disabled={ocupado || motivoOferta === ''}
              onClick={() => {
                if (motivoOferta === '') return;
                mutar(
                  'reasignar-oferta',
                  'respuestas',
                  { ...cas, tipo: 'pedir-reasignacion', motivo: motivoOferta },
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
            {/*
             * Cuántas faltan, no cuáles: los títulos son de tareas de otras personas y esta
             * pantalla ya no los recibe. Quién las lleva y cómo van se lee en la iniciativa, que
             * es donde ese trabajo se rinde en público —y el enlace está al pie de esta tarjeta.
             */}
            {dependenciasPendientes === 0
              ? 'Comenzá cuando el trabajo realmente empiece.'
              : dependenciasPendientes === 1
                ? 'Antes tiene que completarse otra tarea de la que depende esta. Podés verla en la iniciativa.'
                : `Antes tienen que completarse ${String(dependenciasPendientes)} tareas de las que depende esta. Podés verlas en la iniciativa.`}
          </p>
          <button
            className="boton"
            type="button"
            aria-describedby={`ayuda-iniciar-rapido-${tarea.id}`}
            disabled={ocupado || dependenciasPendientes > 0}
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

      {/*
       * Reanudar, que estaba sólo en la iniciativa. Una tarea en pausa se ve acá, se declara acá y
       * se pide ayuda acá; obligar a irse a otra pantalla justo para volver al trabajo dejaba a
       * quien pidió ayuda sin la única acción que le quedaba pendiente.
       */}
      {(tarea.estado === 'bloqueada' || tarea.estado === 'en-apoyo') &&
        tarea.pausaActual !== undefined && (
          <p>
            <button
              className="boton"
              type="button"
              disabled={ocupado}
              onClick={() => {
                mutar(
                  'reanudar',
                  'reanudar',
                  { ...cas, pauseId: tarea.pausaActual?.id },
                  'La tarea volvió a estar en curso.',
                );
              }}
            >
              {accionEnCurso === `reanudar-${tarea.id}` ? 'Reanudando…' : 'Reanudar la tarea'}
            </button>
          </p>
        )}

      {puedeReasignar && (
        <form
          className="respuesta-tarea"
          onSubmit={(evento) => {
            evento.preventDefault();
            if (motivoReasignacion === '') return;
            mutar(
              'reasignar',
              'respuestas',
              { ...cas, tipo: 'pedir-reasignacion', motivo: motivoReasignacion },
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
              value={motivoReasignacion}
              onChange={(evento) => {
                setMotivoReasignacion(evento.target.value as MotivoRespuestaTarea);
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
          <button className="boton secundario" disabled={ocupado || motivoReasignacion === ''}>
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
