'use client';

/**
 * Una conversación por etapas, en un teléfono.
 *
 * ═══ Tres decisiones que no son de estilo ═══
 *
 * 1. **El formulario lo dibuja el servidor, no esta pantalla.** Qué se puede escribir en cada etapa
 *    llega en `tiposQueSeAdmitenAhora`, `modosQueSeAdmitenAhora` y `relacionesQueSeAdmitenAhora`. Si
 *    la pantalla lo dedujera por su cuenta acabaría habiendo dos tablas, y el día que discreparan
 *    ofrecería un control que la orden rechaza. Lo que no está en esa lista no se pinta.
 *
 * 2. **El grafo se enseña sin dibujarlo.** Cada aporte dice a qué responde con la palabra que le
 *    corresponde —«Sostiene», «Respalda», «Riesgo de»— y con un enlace que salta al aporte
 *    referido. Un diagrama sería más bonito y sería inservible con un lector de pantalla, con datos
 *    móviles contados y en una pantalla de cinco pulgadas.
 *
 * 3. **Lo de la autoría se dice como es.** Mientras la etapa la oculte, la pantalla no dice
 *    «anónimo»: dice de quién protege —de las demás personas que participan— y de quién no —de quien
 *    administra el servidor—. Prometer más de lo que el sistema da es peor que no prometer nada.
 *
 * 4. **El doble toque no lo para esta pantalla: lo para `useAccionUnica`.** Tenía un `enviando` de
 *    estado, que se ve en el repintado siguiente y no antes del `await`, y llamaba a
 *    `nuevoRequestId()` dentro del manejador, de modo que las dos llamadas de un doble toque eran
 *    dos comandos distintos para el servidor. En un historial que no se puede corregir eso es un
 *    aporte duplicado en la conversación, escrito por alguien que sólo quiso escribir uno.
 */

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode, type SyntheticEvent } from 'react';

import {
  APORTE_EN_PALABRAS,
  clavesDeAporte,
  ETAPA_EN_PALABRAS,
  GRAVEDAD_EN_PALABRAS,
  type AporteDeliberacion,
  type ClaveAporte,
  type DeliberacionDetalle,
  type GravedadRiesgo,
  type MiembroCirculo,
  type ModoPosicion,
  type TipoAporte,
} from '@koinonia/contracts';

import { Aviso, Cargando, ErrorVisible, Pasos, useSesion } from '../../../components/marco';
import { useAccionUnica } from '../../../lib/acciones';
import { cuando, enviar, plazo, traer } from '../../../lib/api';

const ETAPAS: readonly { readonly id: string; readonly nombre: string }[] = Object.entries(
  ETAPA_EN_PALABRAS,
).map(([id, nombre]) => ({ id, nombre }));

const GRAVEDADES: readonly GravedadRiesgo[] = [1, 2, 3, 4, 5];

/**
 * La arista que exige cada clase de aporte, con la pregunta que se le hace a la persona.
 *
 * El nombre y la ayuda **no están acá**: vienen de `APORTE_EN_PALABRAS`, que es lo mismo que usa el
 * servidor para explicar un rechazo. Si estuvieran en los dos sitios, el día que cambiara uno la
 * pantalla ofrecería una cosa y el rechazo nombraría otra.
 */
const ARISTA_DE: Readonly<
  Record<
    ClaveAporte,
    {
      readonly destinoDeTipo?: TipoAporte;
      /**
       * Y de qué modo. **El motor no lo comprueba**: valida que el destino sea una `posicion` y no
       * mira si preguntó o si afirmó, así que aceptaría una razón que «sostiene» una pregunta. Acá
       * no se ofrece, que es todo lo que esta capa puede hacer al respecto.
       */
      readonly destinoDeModo?: ModoPosicion;
      readonly variosDestinos?: boolean;
      readonly etiquetaDestino?: string;
    }
  >
> = {
  pregunta: {},
  postura: {},
  responde: {
    destinoDeTipo: 'posicion',
    destinoDeModo: 'pregunta_aclaratoria',
    etiquetaDestino: '¿A qué pregunta respondés?',
  },
  sostiene: {
    destinoDeTipo: 'posicion',
    destinoDeModo: 'afirmacion',
    etiquetaDestino: '¿Qué postura sostenés?',
  },
  razon: {
    destinoDeTipo: 'posicion',
    etiquetaDestino: '¿A qué postura o pregunta se refiere?',
  },
  evidencia: {
    destinoDeTipo: 'razon',
    etiquetaDestino: '¿Qué razón respalda?',
  },
  supuesto: {
    variosDestinos: true,
    etiquetaDestino: '¿A qué aportes se les aplica?',
  },
  riesgo: {
    destinoDeTipo: 'alternativa',
    etiquetaDestino: '¿De qué salida es el riesgo?',
  },
  alternativa: {
    destinoDeTipo: 'posicion',
    variosDestinos: true,
    etiquetaDestino: '¿De qué posturas sale?',
  },
};

interface OpcionDeAporte {
  readonly clave: ClaveAporte;
  readonly tipo: TipoAporte;
  readonly nombre: string;
  readonly ayuda: string;
  readonly destinoDeTipo?: TipoAporte;
  readonly destinoDeModo?: ModoPosicion;
  readonly variosDestinos?: boolean;
  readonly etiquetaDestino?: string;
}

function opcionesDe(deliberacion: DeliberacionDetalle): readonly OpcionDeAporte[] {
  return clavesDeAporte(deliberacion).map((clave) => ({
    clave,
    tipo: APORTE_EN_PALABRAS[clave].tipo,
    nombre: APORTE_EN_PALABRAS[clave].nombre,
    ayuda: APORTE_EN_PALABRAS[clave].ayuda,
    ...ARISTA_DE[clave],
  }));
}

function resumen(aporte: AporteDeliberacion): string {
  const texto = aporte.texto.length > 70 ? `${aporte.texto.slice(0, 70)}…` : aporte.texto;
  return `${aporte.comoSeLlama}: ${texto}`;
}

/**
 * Un aporte corregido puede no estar en la lista que ve esta persona —el orden es una permutación,
 * pero un historial roto o un aporte de otra etapa podrían faltar—. Se dice, no se rompe la página.
 */
function textoDelCorregido(porId: ReadonlyMap<string, AporteDeliberacion>, id: string): string {
  const aporte = porId.get(id);
  return aporte === undefined ? 'un aporte anterior' : resumen(aporte);
}

export default function DetalleDeliberacion(): ReactNode {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { sesion } = useSesion();

  const [deliberacion, setDeliberacion] = useState<DeliberacionDetalle | undefined>(undefined);
  const [nombres, setNombres] = useState<Readonly<Record<string, string>>>({});
  const [error, setError] = useState<unknown>(undefined);
  const [errorAporte, setErrorAporte] = useState<unknown>(undefined);
  const { enCurso, ejecutar } = useAccionUnica();

  const [clave, setClave] = useState<ClaveAporte | ''>('');
  const [texto, setTexto] = useState('');
  const [fuente, setFuente] = useState('');
  const [mitigacion, setMitigacion] = useState('');
  const [gravedad, setGravedad] = useState<GravedadRiesgo>(3);
  const [destino, setDestino] = useState('');
  const [destinos, setDestinos] = useState<readonly string[]>([]);
  const [corrigeA, setCorrigeA] = useState('');

  const recargar = useCallback(() => {
    traer<DeliberacionDetalle>(`/deliberaciones/${id}`).then(setDeliberacion).catch(setError);
  }, [id]);

  useEffect(recargar, [recargar]);

  // Los nombres sólo se piden cuando ya se pueden mostrar. Pedirlos antes sería traer a la pantalla
  // justo lo que la etapa está protegiendo, aunque no se pintara.
  const circuloId = deliberacion?.circuloId;
  const autoriaVisible = deliberacion?.autoriaVisible ?? false;
  useEffect(() => {
    if (!autoriaVisible || circuloId === undefined || sesion === undefined) return;
    traer<MiembroCirculo[]>(`/circulos/${circuloId}/miembros`)
      .then((miembros) => {
        setNombres(Object.fromEntries(miembros.map((m) => [m.id, m.alias])));
      })
      .catch(() => undefined);
  }, [autoriaVisible, circuloId, sesion]);

  function limpiar(): void {
    setTexto('');
    setFuente('');
    setMitigacion('');
    setDestino('');
    setDestinos([]);
    setCorrigeA('');
  }

  async function aportar(evento: SyntheticEvent, opcion: OpcionDeAporte): Promise<void> {
    evento.preventDefault();
    // El `requestId` **no** entra acá: entra en `llamar`, ya elegido por `useAccionUnica`. Lo que
    // se arma en este bloque es exactamente lo que define que el aporte es *el mismo* aporte, y es
    // lo que decide si un reintento reusa la clave o estrena una.
    const comun = corrigeA === '' ? {} : { corrigeA };
    const cuerpo =
      opcion.clave === 'pregunta'
        ? { ...comun, tipo: 'posicion', modo: 'pregunta_aclaratoria', texto }
        : opcion.clave === 'postura'
          ? { ...comun, tipo: 'posicion', modo: 'afirmacion', texto }
          : opcion.clave === 'responde' || opcion.clave === 'sostiene'
            ? { ...comun, tipo: 'razon', relacion: opcion.clave, posicionId: destino, texto }
            : opcion.clave === 'evidencia'
              ? {
                  ...comun,
                  tipo: 'evidencia',
                  sostieneRazonId: destino,
                  texto,
                  ...(fuente.trim() === '' ? {} : { fuente: fuente.trim() }),
                }
              : opcion.clave === 'supuesto'
                ? { ...comun, tipo: 'supuesto', aplicaA: destinos, texto }
                : opcion.clave === 'riesgo'
                  ? {
                      ...comun,
                      tipo: 'riesgo',
                      salidaId: destino,
                      gravedad,
                      impacto: texto,
                      mitigacion,
                    }
                  : {
                      ...comun,
                      tipo: 'alternativa',
                      problemaId: deliberacion?.problemaId ?? '',
                      saleDe: destinos,
                      texto,
                    };
    const resultado = await ejecutar('aportar', cuerpo, (requestId) => {
      setErrorAporte(undefined);
      return enviar<DeliberacionDetalle>(`/deliberaciones/${id}/aportes`, { ...cuerpo, requestId });
    });
    if (resultado.estado === 'hecho') {
      setDeliberacion(resultado.valor);
      limpiar();
    } else if (resultado.estado === 'fallo') {
      setErrorAporte(resultado.error);
    }
  }

  async function avanzar(): Promise<void> {
    // La intención es «cerrar *esta* etapa», y por eso la etapa entra como dato: si la
    // conversación ya avanzó, cerrar la siguiente es otra intención y merece otra clave. Si la
    // respuesta se perdió, en cambio, el reintento lleva la misma y el cierre no se escribe dos
    // veces —que en este historial significaría dos etapas cerradas de un solo acto—.
    const resultado = await ejecutar('avanzar', deliberacion?.etapa, (requestId) => {
      setErrorAporte(undefined);
      return enviar<DeliberacionDetalle>(`/deliberaciones/${id}/etapa`, { requestId });
    });
    if (resultado.estado === 'hecho') setDeliberacion(resultado.valor);
    else if (resultado.estado === 'fallo') setErrorAporte(resultado.error);
  }

  if (error !== undefined) return <ErrorVisible error={error} />;
  if (deliberacion === undefined) return <Cargando que="la conversación" />;

  const opciones = opcionesDe(deliberacion);
  const opcion = opciones.find((o) => o.clave === clave);
  const porId = new Map(deliberacion.aportes.map((a) => [a.id, a]));
  const candidatos = (
    tipo: TipoAporte | undefined,
    modo?: ModoPosicion,
  ): readonly AporteDeliberacion[] =>
    deliberacion.aportes.filter(
      (a) => (tipo === undefined || a.tipo === tipo) && (modo === undefined || a.modo === modo),
    );

  function quienLoEscribio(aporte: AporteDeliberacion): string {
    if (aporte.esMio === true) return 'Lo escribiste vos';
    if (aporte.autorId === undefined) return 'Todavía no se ve quién lo escribió';
    const alias = nombres[aporte.autorId];
    return alias === undefined
      ? 'Lo escribió alguien que ya no está en el grupo'
      : `Lo escribió ${alias}`;
  }

  return (
    <>
      <p className="suave">
        Conversación sobre{' '}
        <Link href={`/problemas/${deliberacion.problemaId}`}>{deliberacion.problemaTitulo}</Link>
      </p>
      <h1>{deliberacion.problemaTitulo}</h1>

      <Pasos titulo="Etapas de la conversación" pasos={ETAPAS} actual={deliberacion.etapa} />

      <p>
        <span className="etiqueta">{deliberacion.etapaEnPalabras}</span>{' '}
        {plazo(deliberacion.cierraEn)}{' '}
        <span className="suave">(hasta el {cuando(deliberacion.cierraEn)})</span>
      </p>
      <p>{deliberacion.queSeHaceEnEstaEtapa}</p>

      <Aviso
        tipo={deliberacion.autoriaVisible ? 'bien' : 'atencion'}
        titulo={deliberacion.autoriaVisible ? 'Cada aporte tiene nombre' : 'Todavía sin nombres'}
      >
        {deliberacion.avisoDeAutoria}
      </Aviso>

      <ErrorVisible error={errorAporte} />

      <section aria-labelledby="aportes-titulo">
        <h2 id="aportes-titulo">Lo que se dijo</h2>
        {deliberacion.aportes.length === 0 ? (
          <div className="vacio">
            <p>Todavía no escribió nadie. {deliberacion.queSePuedeEscribirAhora}</p>
          </div>
        ) : (
          <ol className="tarjetas">
            {deliberacion.aportes.map((aporte) => (
              <li key={aporte.id} id={`aporte-${aporte.id}`}>
                <h3>
                  <span className="etiqueta">{aporte.comoSeLlama}</span>{' '}
                  {!aporte.vigente && (
                    <span className="suave">
                      <span aria-hidden="true">↺ </span>alguien lo corrigió después
                    </span>
                  )}
                </h3>
                <p style={{ whiteSpace: 'pre-wrap' }}>{aporte.texto}</p>

                {aporte.gravedad !== undefined && (
                  <p>
                    Qué tan grave sería:{' '}
                    <strong>
                      {aporte.gravedadEnPalabras ?? GRAVEDAD_EN_PALABRAS[aporte.gravedad]}
                    </strong>
                  </p>
                )}
                {aporte.mitigacion !== undefined && (
                  <p style={{ whiteSpace: 'pre-wrap' }}>Cómo se reduciría: {aporte.mitigacion}</p>
                )}
                {aporte.fuente !== undefined && (
                  <p className="suave">De dónde sale: {aporte.fuente}</p>
                )}

                {aporte.responde.map((vinculo) => {
                  const destinoAporte = porId.get(vinculo.aporteId);
                  return (
                    <p key={`${aporte.id}-${vinculo.aporteId}`} className="suave">
                      {vinculo.comoSeRelaciona}:{' '}
                      {destinoAporte === undefined ? (
                        'un aporte de esta misma conversación'
                      ) : (
                        <a href={`#aporte-${vinculo.aporteId}`}>{resumen(destinoAporte)}</a>
                      )}
                    </p>
                  );
                })}
                {aporte.corrigeA !== undefined && (
                  <p className="suave">
                    Corrige a:{' '}
                    <a href={`#aporte-${aporte.corrigeA}`}>
                      {textoDelCorregido(porId, aporte.corrigeA)}
                    </a>
                  </p>
                )}

                <p className="suave">
                  {quienLoEscribio(aporte)} ·{' '}
                  {aporte.cuando === undefined
                    ? `escrito en «${aporte.etapaEnPalabras}»`
                    : cuando(aporte.cuando)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      {deliberacion.puedoAportar ? (
        <section aria-labelledby="aportar-titulo">
          <h2 id="aportar-titulo">Aportar</h2>
          <p>{deliberacion.queSePuedeEscribirAhora}</p>

          <fieldset className="opciones">
            <legend>¿Qué querés escribir?</legend>
            {opciones.map((item) => (
              <div className="opcion" key={item.clave}>
                <input
                  type="radio"
                  id={`opcion-${item.clave}`}
                  name="opcion"
                  value={item.clave}
                  checked={clave === item.clave}
                  onChange={() => {
                    setClave(item.clave);
                    limpiar();
                  }}
                />
                <label htmlFor={`opcion-${item.clave}`}>{item.nombre}</label>
                <span className="explica">{item.ayuda}</span>
              </div>
            ))}
          </fieldset>

          {opcion !== undefined && (
            <form
              className="formulario-acotado"
              onSubmit={(e) => void aportar(e, opcion)}
              noValidate
            >
              {opcion.etiquetaDestino !== undefined &&
                (opcion.variosDestinos === true ? (
                  <fieldset className="opciones">
                    <legend>{opcion.etiquetaDestino}</legend>
                    {candidatos(opcion.destinoDeTipo, opcion.destinoDeModo).length === 0 ? (
                      <p className="suave">
                        Todavía no hay ningún aporte al que referirse. Escribí primero lo que va
                        antes.
                      </p>
                    ) : (
                      candidatos(opcion.destinoDeTipo, opcion.destinoDeModo).map((candidato) => (
                        <div className="opcion" key={candidato.id}>
                          <input
                            type="checkbox"
                            id={`destino-${candidato.id}`}
                            checked={destinos.includes(candidato.id)}
                            onChange={(e) => {
                              setDestinos((antes) =>
                                e.target.checked
                                  ? [...antes, candidato.id]
                                  : antes.filter((x) => x !== candidato.id),
                              );
                            }}
                          />
                          <label htmlFor={`destino-${candidato.id}`}>{resumen(candidato)}</label>
                        </div>
                      ))
                    )}
                  </fieldset>
                ) : (
                  <div className="campo">
                    <label htmlFor="destino">{opcion.etiquetaDestino}</label>
                    <select
                      id="destino"
                      required
                      value={destino}
                      onChange={(e) => {
                        setDestino(e.target.value);
                      }}
                    >
                      <option value="">Elegí uno</option>
                      {candidatos(opcion.destinoDeTipo, opcion.destinoDeModo).map((candidato) => (
                        <option key={candidato.id} value={candidato.id}>
                          {resumen(candidato)}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}

              <div className="campo">
                <label htmlFor="texto">
                  {opcion.clave === 'riesgo' ? '¿Qué puede salir mal?' : 'Escribilo'}
                </label>
                <span className="ayuda" id="ayuda-texto">
                  Mínimo 20 caracteres. {opcion.ayuda}
                </span>
                <textarea
                  id="texto"
                  required
                  minLength={20}
                  maxLength={4000}
                  aria-describedby="ayuda-texto"
                  value={texto}
                  onChange={(e) => {
                    setTexto(e.target.value);
                  }}
                />
              </div>

              {opcion.clave === 'evidencia' && (
                <div className="campo">
                  <label htmlFor="fuente">¿De dónde sale? (opcional)</label>
                  <input
                    id="fuente"
                    type="text"
                    maxLength={140}
                    value={fuente}
                    onChange={(e) => {
                      setFuente(e.target.value);
                    }}
                  />
                </div>
              )}

              {opcion.clave === 'riesgo' && (
                <>
                  <fieldset className="opciones">
                    <legend>¿Qué tan grave sería?</legend>
                    {GRAVEDADES.map((valor) => (
                      <div className="opcion" key={valor}>
                        <input
                          type="radio"
                          id={`gravedad-${String(valor)}`}
                          name="gravedad"
                          checked={gravedad === valor}
                          onChange={() => {
                            setGravedad(valor);
                          }}
                        />
                        <label htmlFor={`gravedad-${String(valor)}`}>
                          {GRAVEDAD_EN_PALABRAS[valor]}
                        </label>
                      </div>
                    ))}
                  </fieldset>
                  <div className="campo">
                    <label htmlFor="mitigacion">¿Cómo se reduciría?</label>
                    <textarea
                      id="mitigacion"
                      required
                      minLength={20}
                      maxLength={4000}
                      value={mitigacion}
                      onChange={(e) => {
                        setMitigacion(e.target.value);
                      }}
                    />
                  </div>
                </>
              )}

              {(deliberacion.laSalidaDebeCorregirAOtra || opcion.tipo !== 'alternativa') && (
                <div className="campo">
                  <label htmlFor="corrige">
                    {deliberacion.laSalidaDebeCorregirAOtra && opcion.tipo === 'alternativa'
                      ? '¿Qué salida estás corrigiendo?'
                      : '¿Estás corrigiendo un aporte anterior? (opcional)'}
                  </label>
                  {/*
                    Antes esta ayuda decía «puede ser de otra persona», porque el motor no
                    comprobaba la autoría al corregir y prometer lo contrario habría sido mentir.
                    Ya la comprueba, así que la frase cambia con la regla.

                    El filtro es `esMio !== false` y no `esMio === true` a propósito: mientras la
                    etapa oculta la autoría el campo **no viaja** —lo retiene el presentador, porque
                    comparando dos respuestas se atribuiría cada aporte por diferencia— y filtrar
                    por `=== true` dejaría la lista vacía justo cuando alguien quiere corregir lo
                    suyo. Ahí se ofrecen todos y quien escribió reconoce el suyo; si se equivoca, el
                    motor lo rechaza con estas mismas palabras y no ha revelado nada de nadie.
                  */}
                  <span className="ayuda" id="ayuda-corrige">
                    Sólo podés corregir lo que escribiste vos: lo de otra persona no se corrige, se
                    le responde. Lo que corregís no se borra: queda con su fecha y se marca que hay
                    algo más nuevo.
                  </span>
                  <select
                    id="corrige"
                    aria-describedby="ayuda-corrige"
                    required={
                      deliberacion.laSalidaDebeCorregirAOtra && opcion.tipo === 'alternativa'
                    }
                    value={corrigeA}
                    onChange={(e) => {
                      setCorrigeA(e.target.value);
                    }}
                  >
                    <option value="">No corrijo nada</option>
                    {candidatos(opcion.tipo)
                      .filter((candidato) => candidato.esMio !== false)
                      .map((candidato) => (
                        <option key={candidato.id} value={candidato.id}>
                          {resumen(candidato)}
                        </option>
                      ))}
                  </select>
                </div>
              )}

              <button className="boton" type="submit" disabled={enCurso !== undefined}>
                {enCurso === 'aportar' ? 'Guardando…' : 'Guardar mi aporte'}
              </button>
            </form>
          )}
        </section>
      ) : (
        <Aviso tipo="atencion" titulo="No podés escribir acá">
          {deliberacion.motivoNoPuedoAportar ?? 'En esta etapa no se escribe.'}{' '}
          {sesion === undefined && <Link href="/entrar">Entrar</Link>}
        </Aviso>
      )}

      {deliberacion.puedoAvanzarEtapa && deliberacion.etapaSiguienteEnPalabras !== undefined && (
        <section aria-labelledby="etapa-titulo" className="accion-procedimiento">
          <h2 id="etapa-titulo">Pasar a la etapa siguiente</h2>
          <p>
            Cerrar «{deliberacion.etapaEnPalabras}» no se deshace: después de esto ya nadie puede
            escribir lo que iba en esta etapa.
            {!deliberacion.autoriaVisible &&
              ' Y al cerrarla aparecen los nombres de todos los aportes, incluido el tuyo.'}
          </p>
          <button
            className="boton"
            type="button"
            disabled={enCurso !== undefined}
            onClick={() => void avanzar()}
          >
            Cerrar «{deliberacion.etapaEnPalabras}» y pasar a «
            {deliberacion.etapaSiguienteEnPalabras}»
          </button>
        </section>
      )}
    </>
  );
}
