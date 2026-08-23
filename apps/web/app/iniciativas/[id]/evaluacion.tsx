'use client';

/**
 * El cierre del ciclo (ADR-0053): contrastar los criterios que se congelaron antes de decidir
 * contra lo que pasó de verdad, y dejar constancia de lo aprendido. Es lo que convierte «se votó»
 * en «funcionó o no funcionó, y esto aprendimos».
 *
 * ═══ Por qué vive acá y no en el resultado de la decisión ═══
 *
 * Las dos pantallas de este incremento comparten el ciclo, pero contestan preguntas distintas.
 * `/decisiones/[id]/resultado` demuestra **cómo se decidió** —es lectura, inmutable, pensada para
 * quien no cree que la votación fue limpia—. Esta sección demuestra **qué pasó con lo decidido**:
 * es acción —convocar, valorar, escalar, aprender, publicar, cerrar— y sus criterios ya viven acá,
 * en «Cómo sabremos si funcionó». Repartir el trabajo así evita dos cosas peores: mezclar una
 * pantalla de sólo lectura con formularios de escritura, y duplicar los criterios en dos sitios que
 * podrían desincronizarse. `resultado/page.tsx` sí muestra un resumen —de sólo lectura— del
 * desenlace y los aprendizajes cuando ya hay algo que contar, con un enlace hacia acá para el resto.
 *
 * ═══ Un hallazgo sobre ADR-0041 que no pude arreglar en la fuente ═══
 *
 * Varios mensajes de `packages/domain/src/evaluation/types.ts` (p. ej. `CRITERION_MET_NEEDS_EVIDENCE`,
 * `CRITERION_MISSING_EVIDENCE_MISMATCH`) usan la palabra «evento» —prohibida por la regla de oro,
 * `packages/contracts/src/glossary.ts`— y `services/api/src/http/app.ts` (que no puedo tocar) no
 * tiene todavía una entrada en `MENSAJES_DELIBERACION` que los traduzca: caen al `error.message`
 * crudo. Este fichero evita disparar esos casos por construcción (ver `FormularioValorarCriterio`:
 * el veredicto elegido determina la evidencia y si el campo «hecho» aplica, así que la combinación
 * inválida nunca sale del formulario) y, además, `mensajeSeguro` es una red de más abajo: si de
 * todos modos llegara un mensaje con una palabra prohibida, se reemplaza por uno propio antes de
 * mostrarlo. La reparación de fondo —una entrada en el traductor central— le toca a quien sí puede
 * tocar `app.ts`.
 *
 * ═══ El campo «el hecho que lo sostiene» es un selector real, no texto libre ═══
 *
 * El motor exige, para declarar un criterio `cumplido`, el identificador de un hecho de la propia
 * iniciativa que lo sostenga (`hechoQueLoSostieneId`). Nada en la interfaz muestra hoy esos
 * identificadores como algo que una persona pueda copiar y pegar —son UUID opacos—, así que pedirlo
 * como texto libre sería inutilizable. Pero `IniciativaDetalle.tareas[].evidencias[].id` y
 * `.entregas[].id` son, en el propio dominio, exactamente esos identificadores (ver el comentario
 * «Es exactamente el eventId de TaskEvidenceAdded/TaskDelivered» en
 * `packages/domain/src/workspace/initiative.ts`). Por eso `hechosCandidatosDe` arma un selector con
 * frases legibles («Entrega de “X” — 12 de agosto») sobre datos que la propia pantalla ya recibe:
 * ninguna ruta nueva, ningún dato inventado.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from 'react';

import {
  forbiddenTermsIn,
  instanteColombia,
  datetimeLocalColombia,
  type CriterioDeEvaluacion,
  type DesenlaceEvaluacion,
  type DisposicionAcuerdo,
  type EscalonEvaluacion,
  type EstadoDeEvaluacion,
  type EvidenciaCriterio,
  type InformeDeEvaluacion,
  type ObjetoDeEscalada,
  type Tarea,
  type TipoDeAprendizaje,
  type VeredictoCriterio,
} from '@koinonia/contracts';

import { Aviso, Cargando, ErrorVisible, useSesion } from '../../../components/marco';
import { Ficha, Medidor, type VarianteFicha } from '../../../components/piezas';
import { useAccionUnica } from '../../../lib/acciones';
import {
  cerrarFrase,
  cuando,
  enviar,
  ErrorDeApi,
  fechaCorta,
  respuestaEsperada,
  traer,
} from '../../../lib/api';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Vocabulario en palabras. Ninguno de estos vive en `@koinonia/contracts`: son cuatro vocabularios
// cerrados de cuatro letras cada uno, y escribirlos acá evita imponerle a otra pantalla una tabla
// que sólo esta sección usa.
// ═════════════════════════════════════════════════════════════════════════════════════════════

type TonoVeredicto = 'bien' | 'mal' | 'atencion' | 'pendiente';

const VEREDICTO_EN_PALABRAS: Readonly<Record<VeredictoCriterio, string>> = {
  cumplido: 'Se cumplió',
  incumplido: 'No se cumplió',
  'sin-evidencia': 'Sin evidencia',
  'no-aplica': 'No aplica',
};

const VEREDICTO_FICHA: Readonly<Record<VeredictoCriterio, VarianteFicha>> = {
  cumplido: 'bien',
  incumplido: 'mal',
  'sin-evidencia': 'atencion',
  'no-aplica': 'neutra',
};

const EVIDENCIA_EN_PALABRAS: Readonly<Record<EvidenciaCriterio, string>> = {
  verificada: 'Verificada',
  'sin-verificar': 'Sin verificar',
  'no-aplica': 'No aplica',
};

const DESENLACE_EN_PALABRAS: Readonly<Record<DesenlaceEvaluacion, string>> = {
  logrado: 'Logrado',
  parcial: 'Parcial',
  fallido: 'Fallido',
  inconcluso: 'Inconcluso',
};

const DESENLACE_TONO: Readonly<Record<DesenlaceEvaluacion, TonoVeredicto>> = {
  logrado: 'bien',
  parcial: 'atencion',
  fallido: 'mal',
  inconcluso: 'pendiente',
};

const ESTADO_EN_PALABRAS: Readonly<Record<EstadoDeEvaluacion, string>> = {
  'en-curso': 'En curso',
  publicada: 'Publicada',
  cerrada: 'Cerrada',
  'anulada-por-inconsistencia': 'Anulada por inconsistencia',
};

const ESTADO_FICHA: Readonly<Record<EstadoDeEvaluacion, VarianteFicha>> = {
  'en-curso': 'en-curso',
  publicada: 'atencion',
  cerrada: 'bien',
  'anulada-por-inconsistencia': 'mal',
};

const DISPOSICION_EN_PALABRAS: Readonly<Record<DisposicionAcuerdo, string>> = {
  mantener: 'Mantener el acuerdo tal cual',
  enmendar: 'Enmendarlo',
  derogar: 'Derogarlo',
  escalar: 'Escalarlo al colectivo',
};

const ESCALON_EN_PALABRAS: Readonly<Record<EscalonEvaluacion, string>> = {
  consultada: 'Preguntar primero',
  'en-revision-colectiva': 'Llevarlo al colectivo',
};

const OBJETO_EN_PALABRAS: Readonly<Record<ObjetoDeEscalada, string>> = {
  tarea: 'Una tarea concreta',
  acuerdo: 'El acuerdo en general',
  carga: 'La carga del círculo',
};

const APRENDIZAJE_EN_PALABRAS: Readonly<Record<TipoDeAprendizaje, string>> = {
  'lo-que-funciono': 'Lo que funcionó',
  'lo-que-no-funciono': 'Lo que no funcionó',
  'lo-que-faltaba-saber': 'Lo que faltaba saber',
  'lo-que-no-hay-que-repetir': 'Lo que no hay que repetir',
};

/** Si el mensaje trae una palabra prohibida por la regla de oro, se cambia por uno propio. Ver el
 * comentario de cabecera: es la red de más abajo, no la reparación de fondo. */
function mensajeSeguro(error: unknown): unknown {
  if (error instanceof ErrorDeApi && forbiddenTermsIn(error.message).length > 0) {
    return new ErrorDeApi(error.estado, {
      codigo: error.codigo,
      mensaje:
        'No se pudo registrar eso con los datos que mandaste. Repasá el veredicto, la evidencia y ' +
        'el hecho citado, y probá de nuevo.',
      ...(error.queHacer === undefined ? {} : { queHacer: error.queHacer }),
    });
  }
  return error;
}

interface HechoCandidato {
  readonly id: string;
  readonly etiqueta: string;
}

/** Ver «El campo “el hecho que lo sostiene” es un selector real» en la cabecera del fichero. */
function hechosCandidatosDe(tareas: readonly Tarea[]): readonly HechoCandidato[] {
  const hechos: HechoCandidato[] = [];
  for (const tarea of tareas) {
    for (const evidencia of tarea.evidencias) {
      hechos.push({
        id: evidencia.id,
        etiqueta: `Evidencia (${evidencia.tipo}) de "${tarea.titulo}" — ${fechaCorta(evidencia.agregadaEn)}`,
      });
    }
    for (const entrega of tarea.entregas) {
      hechos.push({
        id: entrega.id,
        etiqueta: `Entrega de "${tarea.titulo}" — ${fechaCorta(entrega.entregadaEn)}`,
      });
    }
  }
  return hechos;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// La sección
// ═════════════════════════════════════════════════════════════════════════════════════════════

export function SeccionEvaluacion({
  iniciativaId,
  circuloId,
  activa,
  revisarEn,
  tareas,
}: {
  readonly iniciativaId: string;
  readonly circuloId: string;
  readonly activa: boolean;
  readonly revisarEn: number;
  readonly tareas: readonly Tarea[];
}): ReactNode {
  const { sesion } = useSesion();
  const [informe, setInforme] = useState<InformeDeEvaluacion | undefined>(undefined);
  const [noAbierta, setNoAbierta] = useState(false);
  const [errorCarga, setErrorCarga] = useState<unknown>(undefined);
  const [errorAccion, setErrorAccion] = useState<unknown>(undefined);
  const [mensaje, setMensaje] = useState<string | undefined>(undefined);
  const { enCurso: accionEnCurso, ejecutar: ejecutarUnica } = useAccionUnica();
  const resultadoRef = useRef<HTMLDivElement | null>(null);

  const recargar = useCallback(async (): Promise<void> => {
    setErrorCarga(undefined);
    try {
      const actual = await traer<InformeDeEvaluacion>(`/iniciativas/${iniciativaId}/evaluacion`);
      setInforme(actual);
      setNoAbierta(false);
    } catch (fallo: unknown) {
      // Todavía no se convocó: no es un error, es el estado inicial de toda evaluación.
      if (respuestaEsperada(fallo, 404)) {
        setInforme(undefined);
        setNoAbierta(true);
        return;
      }
      setErrorCarga(fallo);
    }
  }, [iniciativaId]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  const esDelCirculo = sesion !== undefined && sesion.circulos.includes(circuloId);
  const puedeCerrar =
    sesion !== undefined &&
    sesion.circulos.includes(circuloId) &&
    (sesion.roles.includes('facilitator') || sesion.roles.includes('guarantees'));
  const hechos = hechosCandidatosDe(tareas);

  async function ejecutar(
    clave: string,
    ruta: string,
    cuerpo: Readonly<Record<string, unknown>>,
    confirmacion: string,
  ): Promise<boolean> {
    const resultado = await ejecutarUnica<InformeDeEvaluacion>(
      clave,
      [ruta, cuerpo],
      (requestId) => {
        setErrorAccion(undefined);
        setMensaje(undefined);
        return enviar<InformeDeEvaluacion>(ruta, { ...cuerpo, requestId });
      },
    );
    if (resultado.estado === 'ignorado') return false;
    if (resultado.estado === 'hecho') {
      setInforme(resultado.valor);
      setNoAbierta(false);
      setMensaje(confirmacion);
      requestAnimationFrame(() => resultadoRef.current?.focus());
      return true;
    }
    setErrorAccion(mensajeSeguro(resultado.error));
    requestAnimationFrame(() => resultadoRef.current?.focus());
    return false;
  }

  async function abrir(): Promise<void> {
    await ejecutar(
      'abrir-evaluacion',
      `/iniciativas/${iniciativaId}/evaluacion`,
      {},
      'La evaluación quedó convocada. Ya se puede valorar cada criterio contra su evidencia.',
    );
  }

  async function publicar(): Promise<void> {
    await ejecutar(
      'publicar-resultado',
      `/iniciativas/${iniciativaId}/evaluacion/publicacion`,
      {},
      'El resultado quedó anclado en el historial.',
    );
  }

  if (errorCarga !== undefined) {
    return (
      <section aria-labelledby="evaluacion-titulo">
        <h2 id="evaluacion-titulo">Qué pasó con lo que prometimos</h2>
        <ErrorVisible error={errorCarga} />
        <p>
          <button
            className="boton secundario"
            type="button"
            onClick={() => {
              void recargar();
            }}
          >
            Volver a intentar
          </button>
        </p>
      </section>
    );
  }

  if (informe === undefined && !noAbierta) {
    return (
      <section aria-labelledby="evaluacion-titulo">
        <h2 id="evaluacion-titulo">Qué pasó con lo que prometimos</h2>
        <Cargando que="la evaluación" />
      </section>
    );
  }

  return (
    <section aria-labelledby="evaluacion-titulo">
      <h2 id="evaluacion-titulo">Qué pasó con lo que prometimos</h2>
      <p className="suave">
        Acá se contrastan los criterios que se congelaron antes de decidir contra lo que pasó de
        verdad. Afirmar que algo se logró cuesta un hecho que lo sostenga; decir que no se logró no
        cuesta nada.
      </p>

      <div ref={resultadoRef} tabIndex={-1}>
        <ErrorVisible error={errorAccion} />
        {mensaje !== undefined && (
          <Aviso tipo="bien" titulo="Quedó registrado">
            {mensaje}
          </Aviso>
        )}
      </div>

      {noAbierta && (
        <SeccionAbrir
          activa={activa}
          revisarEn={revisarEn}
          esDelCirculo={esDelCirculo}
          accionEnCurso={accionEnCurso}
          onAbrir={() => void abrir()}
        />
      )}

      {informe !== undefined && (
        <>
          <p>
            <Ficha variante={ESTADO_FICHA[informe.estado]}>
              {ESTADO_EN_PALABRAS[informe.estado]}
            </Ficha>
          </p>

          {informe.discrepancia !== undefined && (
            <div className="veredicto mal" role="alert">
              <strong className="marca-estado">
                <span aria-hidden="true">✕ </span>
                Esto es un incidente, no un dato más
              </strong>
              <p>{informe.discrepancia.explicacion}</p>
            </div>
          )}

          {informe.estado === 'en-curso' && (
            <Medidor
              etiqueta="Criterios valorados"
              valor={informe.criterios.filter((c) => c.veredicto !== undefined).length}
              total={informe.criterios.length}
            />
          )}

          {(informe.estado === 'publicada' ||
            informe.estado === 'cerrada' ||
            informe.estado === 'anulada-por-inconsistencia') && (
            <div className={`veredicto ${DESENLACE_TONO[informe.desenlace]}`} role="status">
              <strong className="marca-estado">{DESENLACE_EN_PALABRAS[informe.desenlace]}</strong>
              <p>{informe.narrativa}</p>
              {informe.proporcionCumplida !== undefined && (
                <Medidor
                  etiqueta="Criterios cumplidos"
                  valor={informe.proporcionCumplida.numerador}
                  total={informe.proporcionCumplida.denominador}
                />
              )}
            </div>
          )}

          <ol className="hitos" aria-label="Criterios de éxito, con lo que pasó realmente">
            {informe.criterios.map((criterio) => (
              <CriterioVisible
                key={criterio.indice}
                criterio={criterio}
                escaladas={informe.escaladas.filter((e) => e.indiceDeCriterio === criterio.indice)}
                estado={informe.estado}
                esDelCirculo={esDelCirculo}
                hechos={hechos}
                tareas={tareas}
                accionEnCurso={accionEnCurso}
                onValorar={(veredicto, evidencia, hechoId) =>
                  ejecutar(
                    `valorar-${String(criterio.indice)}`,
                    `/iniciativas/${iniciativaId}/evaluacion/criterios/${String(criterio.indice)}/valoracion`,
                    {
                      veredicto,
                      evidencia,
                      ...(hechoId === undefined ? {} : { hechoQueLoSostieneId: hechoId }),
                    },
                    'La valoración quedó registrada.',
                  )
                }
                onEscalar={(escalon, objeto, tareaId) =>
                  ejecutar(
                    `escalar-${String(criterio.indice)}`,
                    `/iniciativas/${iniciativaId}/evaluacion/criterios/${String(criterio.indice)}/escaladas`,
                    { escalon, objeto, ...(tareaId === undefined ? {} : { tareaId }) },
                    'La escalada quedó registrada.',
                  )
                }
              />
            ))}
          </ol>

          <SeccionAprendizajes
            aprendizajes={informe.aprendizajes}
            puedeAnotar={
              esDelCirculo && (informe.estado === 'en-curso' || informe.estado === 'publicada')
            }
            accionEnCurso={accionEnCurso}
            onAnotar={(tipo, enunciado, etiquetas) =>
              ejecutar(
                'anotar-aprendizaje',
                `/iniciativas/${iniciativaId}/evaluacion/aprendizajes`,
                { tipo, enunciado, etiquetas },
                'El aprendizaje quedó anotado. Sobrevive aunque quien lo escribió deje el círculo.',
              )
            }
          />

          {informe.estado === 'en-curso' && esDelCirculo && (
            <div className="accion-procedimiento">
              <p className="suave" id="ayuda-publicar">
                {informe.criterios.every((c) => c.veredicto !== undefined)
                  ? 'Con esto se ancla en el historial el resultado que ya se puede ver arriba.'
                  : 'Faltan criterios por valorar. Los que falten no se redondean a favor ni en ' +
                    'contra: mientras falten, el resultado publicado saldría inconcluso.'}
              </p>
              <button
                className="boton"
                type="button"
                aria-describedby="ayuda-publicar"
                disabled={accionEnCurso !== undefined}
                onClick={() => void publicar()}
              >
                {accionEnCurso === 'publicar-resultado' ? 'Publicando…' : 'Publicar el resultado'}
              </button>
            </div>
          )}

          {informe.estado === 'publicada' && informe.discrepancia === undefined && (
            <SeccionCerrar
              desenlace={informe.desenlace}
              hayAprendizajes={informe.aprendizajes.length > 0}
              puedeCerrar={puedeCerrar}
              accionEnCurso={accionEnCurso}
              onCerrar={(disposicion, proximaRevisionEn) =>
                ejecutar(
                  'cerrar-evaluacion',
                  `/iniciativas/${iniciativaId}/evaluacion/cierre`,
                  {
                    disposicion,
                    ...(proximaRevisionEn === undefined ? {} : { proximaRevisionEn }),
                  },
                  'El acuerdo quedó cerrado.',
                )
              }
            />
          )}

          {informe.estado === 'cerrada' && informe.disposicion !== undefined && (
            <p>
              Se cerró con la disposición:{' '}
              <strong>{DISPOSICION_EN_PALABRAS[informe.disposicion]}</strong>.
            </p>
          )}

          <details className="de-donde-sale">
            <summary>Ver el comprobante del plan evaluado</summary>
            <p className="suave">
              Esta huella identifica exactamente los criterios que se congelaron al acordar. Si el
              plan hubiera cambiado después, la huella no coincidiría.
            </p>
            <code className="comprobante">{informe.huellaDelPlan}</code>
          </details>
        </>
      )}
    </section>
  );
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Convocar
// ═════════════════════════════════════════════════════════════════════════════════════════════

function SeccionAbrir({
  activa,
  revisarEn,
  esDelCirculo,
  accionEnCurso,
  onAbrir,
}: {
  readonly activa: boolean;
  readonly revisarEn: number;
  readonly esDelCirculo: boolean;
  readonly accionEnCurso: string | undefined;
  readonly onAbrir: () => void;
}): ReactNode {
  if (!activa) {
    return (
      <p className="suave">
        Esto se habilita después de la ratificación: hasta entonces no hubo mandato que cumplir.
      </p>
    );
  }
  const yaSePuede = Date.now() >= revisarEn;
  if (!yaSePuede) {
    return (
      <p className="suave">
        Todavía no se puede convocar. La fecha comprometida es el {cerrarFrase(cuando(revisarEn))}
      </p>
    );
  }
  if (!esDelCirculo) {
    return (
      <p className="suave">
        Ya se puede convocar la evaluación. Cualquier persona del círculo que decidió esto puede
        hacerlo.
      </p>
    );
  }
  return (
    <div className="accion-procedimiento">
      <p className="suave" id="ayuda-abrir">
        Convocarla no afirma nada todavía: sólo abre la posibilidad de valorar cada criterio.
      </p>
      <button
        className="boton"
        type="button"
        aria-describedby="ayuda-abrir"
        disabled={accionEnCurso !== undefined}
        onClick={onAbrir}
      >
        {accionEnCurso === 'abrir-evaluacion' ? 'Convocando…' : 'Convocar la evaluación'}
      </button>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Un criterio
// ═════════════════════════════════════════════════════════════════════════════════════════════

function CriterioVisible({
  criterio,
  escaladas,
  estado,
  esDelCirculo,
  hechos,
  tareas,
  accionEnCurso,
  onValorar,
  onEscalar,
}: {
  readonly criterio: CriterioDeEvaluacion;
  readonly escaladas: InformeDeEvaluacion['escaladas'];
  readonly estado: EstadoDeEvaluacion;
  readonly esDelCirculo: boolean;
  readonly hechos: readonly HechoCandidato[];
  readonly tareas: readonly Tarea[];
  readonly accionEnCurso: string | undefined;
  readonly onValorar: (
    veredicto: VeredictoCriterio,
    evidencia: EvidenciaCriterio,
    hechoId?: string,
  ) => Promise<boolean>;
  readonly onEscalar: (
    escalon: EscalonEvaluacion,
    objeto: ObjetoDeEscalada,
    tareaId?: string,
  ) => Promise<boolean>;
}): ReactNode {
  const puedeValorar = esDelCirculo && estado === 'en-curso';
  const esIncumplimiento =
    criterio.veredicto === 'incumplido' || criterio.veredicto === 'sin-evidencia';
  const puedeEscalar =
    esDelCirculo && esIncumplimiento && (estado === 'en-curso' || estado === 'publicada');

  return (
    <li>
      <article className="tarjeta-trabajo" aria-labelledby={`criterio-${String(criterio.indice)}`}>
        <h3 id={`criterio-${String(criterio.indice)}`}>{criterio.descripcion}</h3>
        <p className="suave">Lo comprobamos en: {cerrarFrase(criterio.fuenteDeVerificacion)}</p>

        {criterio.veredicto === undefined ? (
          <Ficha variante="neutra">Todavía no se valoró</Ficha>
        ) : (
          <Ficha variante={VEREDICTO_FICHA[criterio.veredicto]}>
            {VEREDICTO_EN_PALABRAS[criterio.veredicto]}
          </Ficha>
        )}

        {escaladas.length > 0 && (
          <ul className="lista-pausas">
            {escaladas.map((escalada) => (
              <li key={escalada.id}>
                {ESCALON_EN_PALABRAS[escalada.escalon]} sobre{' '}
                {OBJETO_EN_PALABRAS[escalada.objeto].toLowerCase()}, el {cuando(escalada.en)}
                {!escalada.vigente && ' (ya prescribió y dejó de contar)'}
              </li>
            ))}
          </ul>
        )}

        {puedeValorar && (
          <FormularioValorarCriterio
            indice={criterio.indice}
            hechos={hechos}
            accionEnCurso={accionEnCurso}
            onEnviar={onValorar}
          />
        )}

        {puedeEscalar && (
          <details>
            <summary>Escalar este criterio</summary>
            <FormularioEscalarCriterio
              indice={criterio.indice}
              tareas={tareas}
              accionEnCurso={accionEnCurso}
              onEnviar={onEscalar}
            />
          </details>
        )}
      </article>
    </li>
  );
}

function FormularioValorarCriterio({
  indice,
  hechos,
  accionEnCurso,
  onEnviar,
}: {
  readonly indice: number;
  readonly hechos: readonly HechoCandidato[];
  readonly accionEnCurso: string | undefined;
  readonly onEnviar: (
    veredicto: VeredictoCriterio,
    evidencia: EvidenciaCriterio,
    hechoId?: string,
  ) => Promise<boolean>;
}): ReactNode {
  const [veredicto, setVeredicto] = useState<VeredictoCriterio | ''>('');
  const [evidenciaIncumplido, setEvidenciaIncumplido] = useState<
    'verificada' | 'sin-verificar' | ''
  >('');
  const [hechoId, setHechoId] = useState('');
  const clave = `valorar-${String(indice)}`;

  const puedeEnviar =
    veredicto === 'cumplido'
      ? hechoId !== ''
      : veredicto === 'incumplido'
        ? evidenciaIncumplido !== ''
        : veredicto !== '';

  async function enviarForm(evento: SyntheticEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    if (veredicto === '') return;
    const evidencia: EvidenciaCriterio =
      veredicto === 'cumplido'
        ? 'verificada'
        : veredicto === 'incumplido'
          ? evidenciaIncumplido === ''
            ? 'sin-verificar'
            : evidenciaIncumplido
          : veredicto === 'sin-evidencia'
            ? 'sin-verificar'
            : 'no-aplica';
    const hechoQueAplica =
      veredicto === 'cumplido'
        ? hechoId
        : veredicto === 'incumplido' && hechoId !== ''
          ? hechoId
          : undefined;
    const guardado = await onEnviar(veredicto, evidencia, hechoQueAplica);
    if (guardado) {
      setVeredicto('');
      setEvidenciaIncumplido('');
      setHechoId('');
    }
  }

  return (
    <form className="formulario-acotado" onSubmit={(e) => void enviarForm(e)}>
      <fieldset className="opciones" disabled={accionEnCurso !== undefined}>
        <legend>Valorar este criterio</legend>
        {(Object.keys(VEREDICTO_EN_PALABRAS) as VeredictoCriterio[]).map((valor) => (
          <div className="opcion" key={valor}>
            <input
              id={`veredicto-${String(indice)}-${valor}`}
              type="radio"
              name={`veredicto-${String(indice)}`}
              required
              checked={veredicto === valor}
              onChange={() => {
                setVeredicto(valor);
                setEvidenciaIncumplido('');
                setHechoId('');
              }}
            />
            <label htmlFor={`veredicto-${String(indice)}-${valor}`}>
              {VEREDICTO_EN_PALABRAS[valor]}
            </label>
          </div>
        ))}

        {veredicto === 'cumplido' && (
          <div className="campo">
            <label htmlFor={`hecho-${String(indice)}`}>El hecho que lo sostiene</label>
            {hechos.length === 0 ? (
              <p className="ayuda">
                Todavía no hay ninguna entrega ni evidencia registrada en esta iniciativa para citar
                como respaldo. Sin un hecho concreto no se puede declarar cumplido.
              </p>
            ) : (
              <>
                <select
                  id={`hecho-${String(indice)}`}
                  required
                  aria-describedby={`ayuda-hecho-${String(indice)}`}
                  value={hechoId}
                  onChange={(e) => {
                    setHechoId(e.target.value);
                  }}
                >
                  <option value="">Elegí qué lo demuestra</option>
                  {hechos.map((hecho) => (
                    <option key={hecho.id} value={hecho.id}>
                      {hecho.etiqueta}
                    </option>
                  ))}
                </select>
                <span className="ayuda" id={`ayuda-hecho-${String(indice)}`}>
                  Afirmar que algo se logró cuesta un hecho concreto de esta iniciativa; decir que
                  no se logró no lo exige.
                </span>
              </>
            )}
          </div>
        )}

        {veredicto === 'incumplido' && (
          <>
            <fieldset className="opciones">
              <legend>¿La evidencia de que no se cumplió está verificada?</legend>
              {(['verificada', 'sin-verificar'] as const).map((valor) => (
                <div className="opcion" key={valor}>
                  <input
                    id={`evidencia-${String(indice)}-${valor}`}
                    type="radio"
                    name={`evidencia-${String(indice)}`}
                    required
                    checked={evidenciaIncumplido === valor}
                    onChange={() => {
                      setEvidenciaIncumplido(valor);
                    }}
                  />
                  <label htmlFor={`evidencia-${String(indice)}-${valor}`}>
                    {EVIDENCIA_EN_PALABRAS[valor]}
                  </label>
                </div>
              ))}
            </fieldset>
            {hechos.length > 0 && (
              <div className="campo">
                <label htmlFor={`hecho-${String(indice)}`}>
                  El hecho que lo muestra <span className="suave">(opcional)</span>
                </label>
                <select
                  id={`hecho-${String(indice)}`}
                  value={hechoId}
                  onChange={(e) => {
                    setHechoId(e.target.value);
                  }}
                >
                  <option value="">Sin citar ninguno</option>
                  {hechos.map((hecho) => (
                    <option key={hecho.id} value={hecho.id}>
                      {hecho.etiqueta}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </>
        )}

        <button className="boton secundario" disabled={!puedeEnviar}>
          {accionEnCurso === clave ? 'Guardando…' : 'Registrar la valoración'}
        </button>
      </fieldset>
    </form>
  );
}

function FormularioEscalarCriterio({
  indice,
  tareas,
  accionEnCurso,
  onEnviar,
}: {
  readonly indice: number;
  readonly tareas: readonly Tarea[];
  readonly accionEnCurso: string | undefined;
  readonly onEnviar: (
    escalon: EscalonEvaluacion,
    objeto: ObjetoDeEscalada,
    tareaId?: string,
  ) => Promise<boolean>;
}): ReactNode {
  const [escalon, setEscalon] = useState<EscalonEvaluacion | ''>('');
  const [objeto, setObjeto] = useState<ObjetoDeEscalada | ''>('');
  const [tareaId, setTareaId] = useState('');
  const clave = `escalar-${String(indice)}`;
  const puedeEnviar = escalon !== '' && objeto !== '' && (objeto !== 'tarea' || tareaId !== '');

  async function enviarForm(evento: SyntheticEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    if (escalon === '' || objeto === '') return;
    const guardado = await onEnviar(escalon, objeto, objeto === 'tarea' ? tareaId : undefined);
    if (guardado) {
      setEscalon('');
      setObjeto('');
      setTareaId('');
    }
  }

  return (
    <form className="formulario-acotado" onSubmit={(e) => void enviarForm(e)}>
      <fieldset className="opciones" disabled={accionEnCurso !== undefined}>
        <legend>Escalón</legend>
        <p className="suave">
          Los dos únicos que una evaluación puede pulsar: primero se pregunta, y sólo si eso no
          alcanza se lleva al colectivo.
        </p>
        {(Object.keys(ESCALON_EN_PALABRAS) as EscalonEvaluacion[]).map((valor) => (
          <div className="opcion" key={valor}>
            <input
              id={`escalon-${String(indice)}-${valor}`}
              type="radio"
              name={`escalon-${String(indice)}`}
              required
              checked={escalon === valor}
              onChange={() => {
                setEscalon(valor);
              }}
            />
            <label htmlFor={`escalon-${String(indice)}-${valor}`}>
              {ESCALON_EN_PALABRAS[valor]}
            </label>
          </div>
        ))}
      </fieldset>
      <fieldset className="opciones" disabled={accionEnCurso !== undefined}>
        <legend>Sobre qué</legend>
        {(Object.keys(OBJETO_EN_PALABRAS) as ObjetoDeEscalada[]).map((valor) => (
          <div className="opcion" key={valor}>
            <input
              id={`objeto-${String(indice)}-${valor}`}
              type="radio"
              name={`objeto-${String(indice)}`}
              required
              checked={objeto === valor}
              onChange={() => {
                setObjeto(valor);
                setTareaId('');
              }}
            />
            <label htmlFor={`objeto-${String(indice)}-${valor}`}>{OBJETO_EN_PALABRAS[valor]}</label>
          </div>
        ))}
        {objeto === 'tarea' && (
          <div className="campo">
            <label htmlFor={`tarea-escalada-${String(indice)}`}>Cuál tarea</label>
            <select
              id={`tarea-escalada-${String(indice)}`}
              required
              value={tareaId}
              onChange={(e) => {
                setTareaId(e.target.value);
              }}
            >
              <option value="">Elegí una tarea</option>
              {tareas.map((tarea) => (
                <option key={tarea.id} value={tarea.id}>
                  {tarea.titulo}
                </option>
              ))}
            </select>
          </div>
        )}
      </fieldset>
      <button className="boton secundario" disabled={!puedeEnviar}>
        {accionEnCurso === clave ? 'Guardando…' : 'Registrar la escalada'}
      </button>
    </form>
  );
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Aprendizajes
// ═════════════════════════════════════════════════════════════════════════════════════════════

function SeccionAprendizajes({
  aprendizajes,
  puedeAnotar,
  accionEnCurso,
  onAnotar,
}: {
  readonly aprendizajes: InformeDeEvaluacion['aprendizajes'];
  readonly puedeAnotar: boolean;
  readonly accionEnCurso: string | undefined;
  readonly onAnotar: (
    tipo: TipoDeAprendizaje,
    enunciado: string,
    etiquetas: readonly string[],
  ) => Promise<boolean>;
}): ReactNode {
  const [tipo, setTipo] = useState<TipoDeAprendizaje | ''>('');
  const [enunciado, setEnunciado] = useState('');
  const [etiquetasTexto, setEtiquetasTexto] = useState('');

  async function enviarForm(evento: SyntheticEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    if (tipo === '') return;
    const etiquetas = etiquetasTexto
      .split(',')
      .map((e) => e.trim())
      .filter((e) => e !== '');
    const guardado = await onAnotar(tipo, enunciado, etiquetas);
    if (guardado) {
      setTipo('');
      setEnunciado('');
      setEtiquetasTexto('');
    }
  }

  return (
    <section aria-labelledby="aprendizajes-titulo" id="aprendizajes-de-la-evaluacion">
      <h3 id="aprendizajes-titulo">Qué aprendimos</h3>
      {aprendizajes.length === 0 ? (
        <p className="suave">Todavía no se anotó ningún aprendizaje.</p>
      ) : (
        <ul>
          {aprendizajes.map((aprendizaje) => (
            <li key={aprendizaje.id}>
              <p>
                <strong>{APRENDIZAJE_EN_PALABRAS[aprendizaje.tipo]}:</strong>{' '}
                {aprendizaje.enunciado}
              </p>
              {aprendizaje.etiquetas.length > 0 && (
                <p className="suave">Etiquetas: {aprendizaje.etiquetas.join(', ')}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {puedeAnotar && (
        <form className="formulario-acotado" onSubmit={(e) => void enviarForm(e)}>
          <fieldset className="opciones" disabled={accionEnCurso !== undefined}>
            <legend>Anotar un aprendizaje</legend>
            <p className="suave">
              Sin autoría: esto tiene que sobrevivir a que quien lo escribió rote fuera del círculo.
            </p>
            {(Object.keys(APRENDIZAJE_EN_PALABRAS) as TipoDeAprendizaje[]).map((valor) => (
              <div className="opcion" key={valor}>
                <input
                  id={`tipo-aprendizaje-${valor}`}
                  type="radio"
                  name="tipo-aprendizaje"
                  required
                  checked={tipo === valor}
                  onChange={() => {
                    setTipo(valor);
                  }}
                />
                <label htmlFor={`tipo-aprendizaje-${valor}`}>
                  {APRENDIZAJE_EN_PALABRAS[valor]}
                </label>
              </div>
            ))}
            <div className="campo">
              <label htmlFor="enunciado-aprendizaje">Contalo</label>
              <textarea
                id="enunciado-aprendizaje"
                required
                minLength={40}
                maxLength={1000}
                value={enunciado}
                onChange={(e) => {
                  setEnunciado(e.target.value);
                }}
              />
              <span className="ayuda">
                Al menos 40 caracteres: lo suficiente para que sirva de algo.
              </span>
            </div>
            <div className="campo">
              <label htmlFor="etiquetas-aprendizaje">
                Etiquetas para encontrarlo después{' '}
                <span className="suave">(opcional, separadas por coma)</span>
              </label>
              <input
                id="etiquetas-aprendizaje"
                aria-describedby="ayuda-etiquetas-aprendizaje"
                value={etiquetasTexto}
                onChange={(e) => {
                  setEtiquetasTexto(e.target.value);
                }}
              />
              <span className="ayuda" id="ayuda-etiquetas-aprendizaje">
                En minúscula, sin espacios ni tildes: por ejemplo «convocatoria, plazos».
              </span>
            </div>
            <button
              className="boton secundario"
              disabled={tipo === '' || enunciado.trim().length < 40}
            >
              {accionEnCurso === 'anotar-aprendizaje' ? 'Guardando…' : 'Anotar el aprendizaje'}
            </button>
          </fieldset>
        </form>
      )}
    </section>
  );
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Cerrar
// ═════════════════════════════════════════════════════════════════════════════════════════════

function SeccionCerrar({
  desenlace,
  hayAprendizajes,
  puedeCerrar,
  accionEnCurso,
  onCerrar,
}: {
  readonly desenlace: DesenlaceEvaluacion;
  readonly hayAprendizajes: boolean;
  readonly puedeCerrar: boolean;
  readonly accionEnCurso: string | undefined;
  readonly onCerrar: (
    disposicion: DisposicionAcuerdo,
    proximaRevisionEn?: number,
  ) => Promise<boolean>;
}): ReactNode {
  const [disposicion, setDisposicion] = useState<DisposicionAcuerdo | ''>('');
  const [proximaRevision, setProximaRevision] = useState('');

  if (!puedeCerrar) {
    return (
      <p className="suave">
        Cerrar decide qué pasa con el acuerdo, y por eso le corresponde a quien cuida el
        procedimiento en el círculo.
      </p>
    );
  }

  const exigeAprendizaje = desenlace !== 'logrado' && !hayAprendizajes;
  const exigeProximaRevision = disposicion === 'mantener';
  const puedeEnviar =
    disposicion !== '' &&
    !exigeAprendizaje &&
    (!exigeProximaRevision || proximaRevision !== '') &&
    !(disposicion === 'mantener' && desenlace === 'fallido');

  async function enviarForm(evento: SyntheticEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    if (disposicion === '') return;
    let proximaRevisionEn: number | undefined;
    if (disposicion === 'mantener') {
      try {
        proximaRevisionEn = instanteColombia(proximaRevision);
      } catch {
        return;
      }
    }
    await onCerrar(disposicion, proximaRevisionEn);
  }

  return (
    <form className="formulario-acotado" onSubmit={(e) => void enviarForm(e)}>
      <fieldset className="opciones" disabled={accionEnCurso !== undefined}>
        <legend>Cerrar: qué se hace con el acuerdo</legend>
        {exigeAprendizaje && (
          <Aviso tipo="atencion" titulo="Falta un aprendizaje">
            Cerrar sin haberlo logrado exige anotar al menos un aprendizaje: lo que sobrevive del
            intento es lo que enseña. Anotalo más arriba antes de cerrar.
          </Aviso>
        )}
        {(Object.keys(DISPOSICION_EN_PALABRAS) as DisposicionAcuerdo[]).map((valor) => {
          const deshabilitada = valor === 'mantener' && desenlace === 'fallido';
          return (
            <div className="opcion" key={valor}>
              <input
                id={`disposicion-${valor}`}
                type="radio"
                name="disposicion"
                required
                disabled={deshabilitada}
                checked={disposicion === valor}
                onChange={() => {
                  setDisposicion(valor);
                }}
              />
              <label htmlFor={`disposicion-${valor}`}>
                {DISPOSICION_EN_PALABRAS[valor]}
                {deshabilitada && (
                  <span className="explica">
                    {' '}
                    — no se mantiene tal cual un acuerdo que no cumplió ninguno de sus criterios
                  </span>
                )}
              </label>
            </div>
          );
        })}
        {disposicion === 'mantener' && (
          <div className="campo">
            <label htmlFor="proxima-revision">Próxima fecha de revisión, en hora de Colombia</label>
            <input
              id="proxima-revision"
              type="datetime-local"
              required
              aria-describedby="ayuda-proxima-revision"
              min={datetimeLocalColombia(Date.now() + 60_000)}
              value={proximaRevision}
              onChange={(e) => {
                setProximaRevision(e.target.value);
              }}
            />
            <span className="ayuda" id="ayuda-proxima-revision">
              Mantener sin comprometer cuándo se vuelve a mirar deja que la inercia trabaje sola.
            </span>
          </div>
        )}
        <button className="boton" disabled={!puedeEnviar}>
          {accionEnCurso === 'cerrar-evaluacion' ? 'Cerrando…' : 'Cerrar'}
        </button>
      </fieldset>
    </form>
  );
}
