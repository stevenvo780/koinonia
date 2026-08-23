'use client';

/**
 * Piezas compartidas del asistente de acción sistémica (ADR-0052, PRODUCT.md §5).
 *
 * ═══ El principio que gobierna todo este fichero ═══
 *
 * «La IA asesora, nunca gobierna ni vota» (principio 6). Acá eso se ve en tres decisiones
 * concretas:
 *
 *  1. Nada de lo que devuelve el ayudante automático se guarda solo. Todo pasa por
 *     `<PanelAyudaIA>`, que lo muestra en un bloque aparte —borde punteado, fondo distinto,
 *     encabezado «Esto lo escribió el asistente, no una persona» (PRODUCT.md §5)— con tres salidas
 *     posibles: usarlo tal cual, editarlo antes de guardar, o descartarlo. Ninguna sucede sin que
 *     la persona pulse un botón.
 *  2. `<ConsentimientoIA>` es la única forma en que el texto de alguien puede salir hacia un
 *     proveedor externo, y la decisión se pide en palabras, no se asume de que exista un proveedor
 *     configurado.
 *  3. Ninguna pieza de aquí ordena preguntas, puntúa respuestas ni oculta nada: `<MapaDePreguntas>`
 *     lista las 27 en el orden fijo de §3.1 y punto.
 *
 * ═══ Un hueco de la API, documentado y no inventado ═══
 *
 * PRODUCT.md §5 y el propio `DestinoIA` del dominio piden mostrar «a dónde va, qué se manda, qué no
 * se manda» ANTES de que la persona decida si consiente. Pero `BorradorDetalleDto.consentimiento`
 * sólo trae un `destino` una vez que la decisión YA se tomó (`ConsentimientoVigenteDto`), y no hay
 * ninguna ruta que exponga el `DestinoIA` del despliegue por adelantado. `<ConsentimientoIA>` pide
 * la decisión con el texto genérico que sí hay (`porQueNoHaySugerencias`, vía `TEXTO_DEL_MOTIVO` del
 * dominio) y muestra el destino recién después, como confirmación de a qué se acaba de decir que sí
 * o que no. Es una limitación real, no una que este fichero pueda cerrar por su cuenta: para
 * mostrarlo antes hace falta un campo nuevo en `BorradorDetalleDto` (algo como
 * `destinoDisponible?: DestinoIA`, presente siempre que `hayProveedor` sea cierto, decidido o no) y
 * eso es un cambio de contrato que no me corresponde a mí.
 *
 * ═══ Por qué «usar tal cual» reconstruye la respuesta con una regla y no la copia literal ═══
 *
 * El dominio exige que el texto aplicado esté, palabra por palabra, entre los `textos` que la
 * sugerencia registró (`TEXT_NOT_IN_SUGGESTION` si no). Pero una sugerencia trae **una** cadena por
 * candidato y una pregunta puede pedir «una por línea»: `respuestaDesdeTexto` reparte esa cadena en
 * líneas cuando la pregunta de destino lo pide, y dependen del mismo `textos` que ya viajaron: no
 * inventa contenido, sólo elige la forma. Si el texto tenía una sola línea, la «lista» resultante
 * tiene un elemento, que sigue siendo válido para el dominio (mínimo 1).
 */

import Link from 'next/link';
import { useState, type ReactNode, type SyntheticEvent } from 'react';

import type {
  BorradorDetalleDto,
  ConsentimientoVigenteDto,
  DestinoIADto,
  EstadoBorradorDto,
  FormaDeRespuestaDto,
  FraseDeCierreDto,
  ModoAsistenteDto,
  MotivoEstructuralDto,
  NumeroPreguntaDto,
  OperacionIADto,
  PreguntaAsistenteDto,
  RespuestaPreguntaDto,
  SugerenciaRecibidaDto,
} from '@koinonia/contracts';
import { TITULO_DE_OPERACION } from '@koinonia/contracts';

import { Ficha, type VarianteFicha } from './piezas';
import { enviar } from '../lib/api';
import { Aviso, ErrorVisible } from './marco';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Estado del borrador, dicho como palabra y como ficha
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** `'inexistente'` no llega nunca hasta acá: las rutas ya devuelven 404 antes. Cubierto igual. */
export const ETIQUETA_ESTADO_BORRADOR: Readonly<Record<EstadoBorradorDto, string>> = {
  inexistente: 'No existe',
  redactando: 'En marcha',
  cerrado: 'Cerrado',
};

const VARIANTE_ESTADO_BORRADOR: Readonly<Record<EstadoBorradorDto, VarianteFicha>> = {
  inexistente: 'mal',
  redactando: 'en-curso',
  cerrado: 'bien',
};

export function FichaEstadoBorrador({ estado }: { readonly estado: EstadoBorradorDto }): ReactNode {
  return (
    <Ficha variante={VARIANTE_ESTADO_BORRADOR[estado]}>{ETIQUETA_ESTADO_BORRADOR[estado]}</Ficha>
  );
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// La frase de cierre
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * La frase armada de §3.1, con sus huecos señalados y un camino directo a llenarlos.
 *
 * No es un resumen adornado: es literalmente lo que el borrador va a decir cuando alguien lo lea
 * después. Mostrarla temprano y seguido es lo que reemplaza a una barra de progreso — se ve qué
 * falta porque se lee la frase a medio hacer, no porque un número suba.
 */
export function FraseCierre({
  frase,
  borradorId,
}: {
  readonly frase: FraseDeCierreDto;
  readonly borradorId: string;
}): ReactNode {
  return (
    <div className="version vigente">
      <p className="texto">{frase.texto}</p>
      {!frase.completa && (
        <p className="suave">
          Faltan{' '}
          {frase.huecos.map((numero, indice) => (
            <span key={numero}>
              {indice > 0 && ', '}
              <Link href={`/asistente/${borradorId}/preguntas/${String(numero)}`}>la {numero}</Link>
            </span>
          ))}{' '}
          para que la frase quede completa.
        </p>
      )}
      <p className="suave">{frase.pregunta}</p>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Mapa de las 27 preguntas, agrupadas — la vista de conjunto, no un examen
// ═════════════════════════════════════════════════════════════════════════════════════════════

export type MarcaPregunta = 'respondida' | 'no_se' | 'pendiente';

const ETIQUETA_MARCA: Readonly<Record<MarcaPregunta, string>> = {
  respondida: 'Respondida',
  no_se: 'Dijiste que todavía no sabés',
  pendiente: 'Sin contestar',
};

const SIMBOLO_MARCA: Readonly<Record<MarcaPregunta, string>> = {
  respondida: '✓',
  no_se: '?',
  pendiente: '·',
};

/** Construye la marca de cada pregunta a partir de lo que ya cuenta el propio borrador. */
export function marcasDePreguntas(detalle: BorradorDetalleDto): ReadonlyMap<number, MarcaPregunta> {
  const marcas = new Map<number, MarcaPregunta>();
  for (const hueco of detalle.huecos) {
    marcas.set(hueco.pregunta, hueco.motivo === 'todavia_no_se' ? 'no_se' : 'pendiente');
  }
  for (const version of detalle.procedencia) {
    if (!marcas.has(version.pregunta)) marcas.set(version.pregunta, 'respondida');
  }
  return marcas;
}

/**
 * Las 27 preguntas agrupadas en los ocho tramos de §3.1, cada una con su marca y un enlace directo.
 *
 * Es la pieza que reemplaza a la barra de progreso: en vez de un porcentaje, ocho tramos con nombre
 * y, dentro de cada uno, qué está listo, qué quedó en «todavía no sé» y qué no se tocó — se lee de
 * un vistazo cuánto falta sin que se parezca a la cuenta de un examen.
 */
export function MapaDePreguntas({
  preguntas,
  marcas,
  borradorId,
  actual,
}: {
  readonly preguntas: readonly PreguntaAsistenteDto[];
  readonly marcas: ReadonlyMap<number, MarcaPregunta>;
  readonly borradorId: string;
  /** El número de la pregunta que se está mirando ahora, si esto se pinta desde esa pantalla. */
  readonly actual?: number;
}): ReactNode {
  const grupos: {
    readonly grupo: string;
    readonly rotulo: string;
    readonly preguntas: PreguntaAsistenteDto[];
  }[] = [];
  for (const pregunta of preguntas) {
    let tramo = grupos.find((g) => g.grupo === pregunta.grupo);
    if (tramo === undefined) {
      tramo = { grupo: pregunta.grupo, rotulo: pregunta.rotuloGrupo, preguntas: [] };
      grupos.push(tramo);
    }
    tramo.preguntas.push(pregunta);
  }
  return (
    <ol className="pasos" role="list" aria-label="Las 27 preguntas, agrupadas">
      {grupos.map((tramo) => (
        <li key={tramo.grupo}>
          <p style={{ fontWeight: 700, marginBottom: 'var(--e2)' }}>{tramo.rotulo}</p>
          <ul
            style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--e2)' }}
          >
            {tramo.preguntas.map((pregunta) => {
              const marca = marcas.get(pregunta.numero) ?? 'pendiente';
              const esActual = pregunta.numero === actual;
              return (
                <li key={pregunta.numero}>
                  <Link
                    href={`/asistente/${borradorId}/preguntas/${String(pregunta.numero)}`}
                    style={{ display: 'flex', gap: 'var(--e2)', alignItems: 'baseline' }}
                    {...(esActual ? { 'aria-current': 'page' as const } : {})}
                  >
                    <span aria-hidden="true">{SIMBOLO_MARCA[marca]}</span>
                    <span>
                      {pregunta.numero}. {pregunta.texto}
                      {pregunta.obligatoria && <span className="suave"> (obligatoria)</span>}
                    </span>
                    <span className="solo-lectores"> — {ETIQUETA_MARCA[marca]}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ol>
  );
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Consentimiento antes de que algo salga hacia un proveedor externo
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ¿Vale la pena mostrar el control de consentimiento acá?
 *
 * Sólo cuando hay algo que decidir o que recordar: si el despliegue no tiene ningún proveedor
 * configurado (`motivoEstructural === 'sin_proveedor'`) y nunca se decidió nada, no hay ni pregunta
 * ni historia que mostrar — mostrarlo igual sería pedirle a alguien que autorice un envío que nunca
 * va a pasar.
 */
export function necesitaMostrarConsentimiento(detalle: BorradorDetalleDto): boolean {
  return (
    detalle.modo === 'generativo' ||
    detalle.motivoEstructural === 'sin_consentimiento' ||
    detalle.motivoEstructural === 'consentimiento_negado' ||
    detalle.consentimiento !== undefined
  );
}

export function ConsentimientoIA({
  borradorId,
  consentimiento,
  onDecidido,
}: {
  readonly borradorId: string;
  readonly consentimiento: ConsentimientoVigenteDto | undefined;
  /** Se llama con el borrador ya actualizado, para que quien pinte esto recargue lo que necesite. */
  readonly onDecidido: (detalle: BorradorDetalleDto) => void;
}): ReactNode {
  const [enCurso, setEnCurso] = useState(false);
  const [error, setError] = useState<unknown>(undefined);

  async function decidir(concedido: boolean): Promise<void> {
    setEnCurso(true);
    setError(undefined);
    try {
      const detalle = await enviar<BorradorDetalleDto>(
        `/asistente/borradores/${borradorId}/consentimiento`,
        { concedido },
      );
      onDecidido(detalle);
    } catch (fallo: unknown) {
      setError(fallo);
    } finally {
      setEnCurso(false);
    }
  }

  if (consentimiento !== undefined) {
    // Ya se decidió. Se muestra el destino recién ahora, como confirmación de a qué se dijo que sí
    // o que no — ver la cabecera de este fichero sobre por qué no se puede mostrar antes.
    return (
      <div className="version">
        <p>
          {consentimiento.concedido
            ? 'Dijiste que sí: tu texto puede salir de acá cuando pidas ayuda.'
            : 'Dijiste que no: tu texto se queda acá.'}
        </p>
        <DestinoDetalle destino={consentimiento.destino} />
        {!consentimiento.concedido && (
          <p>
            <button
              className="boton texto"
              type="button"
              disabled={enCurso}
              onClick={() => void decidir(true)}
            >
              Cambiar de idea y permitirlo
            </button>
          </p>
        )}
        <ErrorVisible error={error} />
      </div>
    );
  }

  return (
    <Aviso tipo="atencion" titulo="¿Podemos mandar tu texto afuera?">
      Todavía no dijiste si tu texto puede salir de acá para pedir ayuda a un ayudante automático.
      Podés seguir con las 27 preguntas sin decidirlo; sólo hace falta para pedir ayuda.
      <p style={{ display: 'flex', gap: 'var(--e3)', flexWrap: 'wrap' }}>
        <button
          className="boton secundario"
          type="button"
          disabled={enCurso}
          onClick={() => void decidir(true)}
        >
          Sí, dejá que se use
        </button>
        <button
          className="boton secundario"
          type="button"
          disabled={enCurso}
          onClick={() => void decidir(false)}
        >
          No, prefiero que no
        </button>
      </p>
      <ErrorVisible error={error} />
    </Aviso>
  );
}

function DestinoDetalle({ destino }: { readonly destino: DestinoIADto }): ReactNode {
  return (
    <dl>
      <dt className="suave">A dónde va</dt>
      <dd>{destino.aDondeVa}</dd>
      <dt className="suave">Qué se manda</dt>
      <dd>{destino.queSeManda}</dd>
      <dt className="suave">Qué no se manda</dt>
      <dd>{destino.queNoSeManda}</dd>
    </dl>
  );
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Pedir ayuda al ayudante automático — siempre en su propio bloque, nunca mezclado con lo escrito
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** Un texto propuesto, ya asociado a la pregunta a la que se aplicaría. */
interface Candidato {
  readonly texto: string;
  readonly detalle?: string;
  readonly pregunta: number;
}

function candidatosDe(
  sugerencia: SugerenciaRecibidaDto,
  preguntaPorDefecto: number,
): {
  readonly candidatos: readonly Candidato[];
  readonly soloInformativo: boolean;
} {
  switch (sugerencia.operacion) {
    case 'estructurar':
      return {
        candidatos: sugerencia.contenido.tramos.map((tramo) => ({
          texto: tramo.texto,
          pregunta: tramo.pregunta,
        })),
        soloInformativo: false,
      };
    case 'resumir':
      return {
        candidatos: [{ texto: sugerencia.contenido.resumen, pregunta: preguntaPorDefecto }],
        soloInformativo: false,
      };
    case 'buscar_parecidos':
      return {
        candidatos: sugerencia.contenido.parecidos.map((p) => ({
          texto: p.texto,
          detalle: p.porQue,
          pregunta: preguntaPorDefecto,
        })),
        soloInformativo: false,
      };
    case 'proponer_alternativas':
      return {
        candidatos: sugerencia.contenido.alternativas.map((texto) => ({
          texto,
          pregunta: preguntaPorDefecto,
        })),
        soloInformativo: false,
      };
    case 'partir_en_tareas':
      return {
        candidatos: sugerencia.contenido.tareas.map((texto) => ({
          texto,
          pregunta: preguntaPorDefecto,
        })),
        soloInformativo: false,
      };
    case 'senalar_contradicciones':
      return {
        candidatos: sugerencia.contenido.tensiones.map((t) => ({
          texto: `${t.unaParte} — ${t.otraParte}`,
          detalle: t.porQue,
          pregunta: preguntaPorDefecto,
        })),
        soloInformativo: true,
      };
    case 'explicar_una_regla':
      return {
        candidatos: [{ texto: sugerencia.contenido.explicacion, pregunta: preguntaPorDefecto }],
        soloInformativo: true,
      };
  }
}

/** Reparte un texto propuesto en líneas cuando la pregunta de destino las pide. Ver cabecera. */
export function respuestaDesdeTexto(
  forma: FormaDeRespuestaDto,
  texto: string,
): RespuestaPreguntaDto {
  if (forma === 'frase') return { forma: 'frase', texto };
  const lineas = texto
    .split('\n')
    .map((linea) => linea.trim())
    .filter((linea) => linea !== '');
  const listaFinal = lineas.length > 0 ? lineas : [texto];
  return forma === 'lineas'
    ? { forma: 'lineas', lineas: listaFinal }
    : { forma: 'por_linea', porLinea: listaFinal };
}

const OPERACIONES_DISPONIBLES = Object.keys(TITULO_DE_OPERACION) as readonly OperacionIADto[];

export function PanelAyudaIA({
  borradorId,
  numero,
  modo,
  porQueNoHaySugerencias,
  motivoEstructural,
  fragmentoInicial,
  formaDePregunta,
  muestraMemoria,
  onAplicada,
  onEditar,
}: {
  readonly borradorId: string;
  readonly numero: NumeroPreguntaDto;
  readonly modo: ModoAsistenteDto;
  readonly porQueNoHaySugerencias: string | undefined;
  readonly motivoEstructural: MotivoEstructuralDto | undefined;
  readonly fragmentoInicial: string;
  /** Cómo resolver la forma de la pregunta de destino de cada candidato (puede ser otra pregunta). */
  readonly formaDePregunta: (numero: number) => FormaDeRespuestaDto | undefined;
  readonly muestraMemoria: boolean;
  /** Se llama tras aplicar con éxito, con la pregunta afectada y la vista ya actualizada del servidor. */
  readonly onAplicada: (preguntaAfectada: number) => void;
  /** «Editarlo»: precarga el formulario de respuesta con este texto, sin guardar nada todavía. */
  readonly onEditar: (texto: string) => void;
}): ReactNode {
  const [operacion, setOperacion] = useState<OperacionIADto>('proponer_alternativas');
  const [fragmento, setFragmento] = useState(fragmentoInicial);
  const [pidiendo, setPidiendo] = useState(false);
  const [errorPedido, setErrorPedido] = useState<unknown>(undefined);
  const [sugerencia, setSugerencia] = useState<SugerenciaRecibidaDto | undefined>(undefined);
  const [aplicando, setAplicando] = useState<string | undefined>(undefined);
  const [errorAplicar, setErrorAplicar] = useState<unknown>(undefined);

  if (modo === 'estructural') {
    return (
      <Aviso tipo="atencion" titulo="Sin ayuda automática por ahora">
        {porQueNoHaySugerencias ?? 'El ayudante automático no está disponible ahora mismo.'}
        {motivoEstructural === 'consentimiento_negado' && (
          <p className="suave">No insistimos: podés seguir con las 27 preguntas igual.</p>
        )}
      </Aviso>
    );
  }

  async function pedir(evento: SyntheticEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    setPidiendo(true);
    setErrorPedido(undefined);
    setSugerencia(undefined);
    try {
      const respuesta = await enviar<SugerenciaRecibidaDto>(
        `/asistente/borradores/${borradorId}/sugerencias`,
        { operacion, pregunta: numero, fragmento },
      );
      setSugerencia(respuesta);
    } catch (fallo: unknown) {
      setErrorPedido(fallo);
    } finally {
      setPidiendo(false);
    }
  }

  async function aplicar(candidato: Candidato): Promise<void> {
    if (sugerencia === undefined) return;
    const forma = formaDePregunta(candidato.pregunta);
    if (forma === undefined) return;
    const clave = `${String(candidato.pregunta)}:${candidato.texto}`;
    setAplicando(clave);
    setErrorAplicar(undefined);
    try {
      await enviar(
        `/asistente/borradores/${borradorId}/sugerencias/${sugerencia.sugerenciaId}/aplicar`,
        { pregunta: candidato.pregunta, respuesta: respuestaDesdeTexto(forma, candidato.texto) },
      );
      onAplicada(candidato.pregunta);
    } catch (fallo: unknown) {
      setErrorAplicar(fallo);
    } finally {
      setAplicando(undefined);
    }
  }

  const resultado = sugerencia === undefined ? undefined : candidatosDe(sugerencia, numero);

  return (
    <div>
      <form onSubmit={(e) => void pedir(e)} className="campo">
        <label htmlFor={`operacion-ia-${String(numero)}`}>¿Qué tipo de ayuda querés?</label>
        <select
          id={`operacion-ia-${String(numero)}`}
          value={operacion}
          onChange={(e) => {
            setOperacion(e.target.value as OperacionIADto);
          }}
        >
          {OPERACIONES_DISPONIBLES.filter((op) => op !== 'buscar_parecidos' || muestraMemoria).map(
            (op) => (
              <option key={op} value={op}>
                {TITULO_DE_OPERACION[op]}
              </option>
            ),
          )}
        </select>
        <label htmlFor={`fragmento-ia-${String(numero)}`} style={{ marginTop: 'var(--e3)' }}>
          Sobre qué texto
        </label>
        <textarea
          id={`fragmento-ia-${String(numero)}`}
          required
          minLength={1}
          maxLength={4000}
          value={fragmento}
          onChange={(e) => {
            setFragmento(e.target.value);
          }}
        />
        <button className="boton secundario" type="submit" disabled={pidiendo}>
          {pidiendo ? 'Pidiendo ayuda…' : 'Pedir ayuda'}
        </button>
      </form>

      <ErrorVisible error={errorPedido} />

      {resultado !== undefined && (
        <div
          role="region"
          aria-label="Lo que propuso el ayudante automático"
          style={{
            border: '2px dashed var(--linea-fuerte)',
            borderRadius: 'var(--radio-2)',
            background: 'var(--papel-hondo)',
            padding: 'var(--e4)',
            marginTop: 'var(--e4)',
          }}
        >
          <p style={{ fontWeight: 700 }}>Esto lo escribió el asistente, no una persona</p>
          <ErrorVisible error={errorAplicar} />
          <ul
            style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--e4)' }}
          >
            {resultado.candidatos.map((candidato, indice) => {
              const clave = `${String(candidato.pregunta)}:${candidato.texto}`;
              const puedeAplicar =
                !resultado.soloInformativo && formaDePregunta(candidato.pregunta) !== undefined;
              return (
                // El índice es clave estable: `candidatos` es fijo para esta respuesta y no se
                // reordena ni se filtra tras montarse.
                <li key={indice}>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{candidato.texto}</p>
                  {candidato.detalle !== undefined && <p className="suave">{candidato.detalle}</p>}
                  {puedeAplicar && (
                    <p style={{ display: 'flex', gap: 'var(--e2)', flexWrap: 'wrap' }}>
                      <button
                        className="boton secundario"
                        type="button"
                        disabled={aplicando !== undefined}
                        onClick={() => void aplicar(candidato)}
                      >
                        {aplicando === clave
                          ? 'Guardando…'
                          : candidato.pregunta === numero
                            ? 'Usarlo tal cual'
                            : `Usarlo tal cual en la pregunta ${String(candidato.pregunta)}`}
                      </button>
                      {candidato.pregunta === numero && (
                        <button
                          className="boton texto"
                          type="button"
                          onClick={() => {
                            onEditar(candidato.texto);
                          }}
                        >
                          Editarlo antes de guardar
                        </button>
                      )}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          <p>
            <button
              className="boton texto"
              type="button"
              onClick={() => {
                setSugerencia(undefined);
              }}
            >
              Descartarlo
            </button>
          </p>
        </div>
      )}
    </div>
  );
}
