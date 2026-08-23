'use client';

/**
 * Una pregunta por pantalla (PRODUCT.md §5) — el corazón del asistente de acción sistémica.
 *
 * Cada pantalla trae **una** de las 27 preguntas de §3.1, literal, con su propio formulario según
 * la forma que pide (`frase` / `lineas` / `por_linea`) y con «todavía no sé» siempre disponible como
 * respuesta de primera clase, nunca como un casillero escondido. Guardar no obliga a seguir: el
 * botón dice «Guardar y continuar» porque eso es lo que hace, pero irse sin guardar no pierde nada
 * más que esta respuesta puntual — el resto del plan queda como estaba.
 *
 * ═══ Por qué la pregunta 7 necesita una llamada extra ═══
 *
 * La 7 responde «por cada causa» de la 6: tiene tantas casillas como líneas tenga la 6 en ESE
 * momento. `AyudaPreguntaDto` no trae ese número por su cuenta —sólo lo hace cuando ya hay un
 * desajuste registrado—, así que para dibujar las casillas correctas antes de que exista cualquier
 * desajuste hay que leer la 6 aparte. Es una llamada más, sólo cuando `porCadaLineaDe` está
 * presente (hoy, sólo en la 7).
 */

import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from 'react';

import type {
  AyudaPreguntaDto,
  BorradorDetalleDto,
  FormaDeRespuestaDto,
  PreguntaAsistenteDto,
  RespuestaPreguntaDto,
} from '@koinonia/contracts';

import {
  ConsentimientoIA,
  PanelAyudaIA,
  necesitaMostrarConsentimiento,
} from '../../../../../components/asistente';
import { Aviso, Cargando, ErrorVisible } from '../../../../../components/marco';
import { Ficha } from '../../../../../components/piezas';
import { useAccionUnica } from '../../../../../lib/acciones';
import { cerrarFrase, cuando, enviar, respuestaEsperada, traer } from '../../../../../lib/api';

// Iguales a `MAX_TEXTO_SUGERIDO` (=`MAX_BODY_LENGTH`) y `MAX_LINEAS` de `@koinonia/domain`. No se
// pueden importar del dominio: `apps/web` sólo depende de `@koinonia/contracts` (ver su
// `package.json`), así que quedan como literales, igual que hace `propuestas/nueva/page.tsx` con
// `maxLength={4000}` para el cuerpo de una propuesta.
const MAX_TEXTO = 4000;
const MAX_LINEAS = 30;
/** Igual a `CUANTAS_PREGUNTAS` del dominio: el formulario tiene 27 preguntas, fijo (ver §3.1). */
const CUANTAS_PREGUNTAS = 27;

type ModoRespuesta = 'contestar' | 'no_se';

export default function Pregunta(): ReactNode {
  const params = useParams<{ id: string; numero: string }>();
  const id = params.id;
  const numero = Number(params.numero);

  const [ayuda, setAyuda] = useState<AyudaPreguntaDto | undefined>(undefined);
  const [detalle, setDetalle] = useState<BorradorDetalleDto | undefined>(undefined);
  const [preguntas, setPreguntas] = useState<readonly PreguntaAsistenteDto[] | undefined>(
    undefined,
  );
  const [origenLineas, setOrigenLineas] = useState<readonly string[] | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const [sinPermiso, setSinPermiso] = useState<string | undefined>(undefined);
  const [errorAccion, setErrorAccion] = useState<unknown>(undefined);
  const [guardado, setGuardado] = useState(false);

  const [modoRespuesta, setModoRespuesta] = useState<ModoRespuesta>('contestar');
  const [texto, setTexto] = useState('');
  const [lineas, setLineas] = useState<string[]>(['']);

  const { enCurso, ejecutar } = useAccionUnica();

  const numeroValido = Number.isInteger(numero) && numero >= 1 && numero <= CUANTAS_PREGUNTAS;

  const cargar = useCallback(async (): Promise<void> => {
    if (!numeroValido) return;
    try {
      const [a, d] = await Promise.all([
        traer<AyudaPreguntaDto>(`/asistente/borradores/${id}/preguntas/${String(numero)}`),
        traer<BorradorDetalleDto>(`/asistente/borradores/${id}`),
      ]);
      setAyuda(a);
      setDetalle(d);
      setError(undefined);
      setSinPermiso(undefined);
    } catch (fallo: unknown) {
      if (respuestaEsperada(fallo, 401)) {
        setSinPermiso('Para responder hay que entrar con el correo institucional.');
        return;
      }
      if (respuestaEsperada(fallo, 403)) {
        setSinPermiso('Este plan es de otra persona: cada quien ve y escribe sólo el suyo.');
        return;
      }
      setError(fallo);
    }
  }, [id, numero, numeroValido]);

  useEffect(() => {
    setGuardado(false);
    void cargar();
  }, [cargar]);

  useEffect(() => {
    traer<PreguntaAsistenteDto[]>('/asistente/preguntas')
      .then(setPreguntas)
      .catch(() => undefined);
  }, []);

  // La 7 (y cualquier futura pregunta «por cada línea de») necesita el contenido actual de su
  // pregunta de origen para saber cuántas casillas dibujar.
  const origen = ayuda?.pregunta.porCadaLineaDe;
  useEffect(() => {
    if (origen === undefined) {
      setOrigenLineas(undefined);
      return;
    }
    let vivo = true;
    traer<AyudaPreguntaDto>(`/asistente/borradores/${id}/preguntas/${String(origen)}`)
      .then((respuesta) => {
        if (!vivo) return;
        const previa = respuesta.loQueYaEscribiste?.respuesta;
        setOrigenLineas(previa?.forma === 'lineas' ? previa.lineas : []);
      })
      .catch(() => {
        if (vivo) setOrigenLineas([]);
      });
    return () => {
      vivo = false;
    };
  }, [id, origen]);

  // Precarga el formulario con lo que ya había, cada vez que cambia la pregunta que se está viendo.
  useEffect(() => {
    if (ayuda === undefined) return;
    const existente = ayuda.loQueYaEscribiste?.respuesta;
    setModoRespuesta(existente?.forma === 'todavia_no_se' ? 'no_se' : 'contestar');
    if (ayuda.pregunta.forma === 'frase') {
      setTexto(existente?.forma === 'frase' ? existente.texto : '');
      return;
    }
    if (ayuda.pregunta.forma === 'lineas') {
      const previas = existente?.forma === 'lineas' ? existente.lineas : undefined;
      setLineas(previas !== undefined && previas.length > 0 ? [...previas] : ['']);
      return;
    }
    // 'por_linea': hace falta saber cuántas casillas hay antes de poder llenarlas.
    if (origenLineas === undefined) return;
    const previas = existente?.forma === 'por_linea' ? existente.porLinea : undefined;
    setLineas(
      previas !== undefined && previas.length === origenLineas.length
        ? [...previas]
        : origenLineas.map(() => ''),
    );
  }, [ayuda, origenLineas]);

  const preguntaPorNumero = useMemo(() => {
    const mapa = new Map<number, PreguntaAsistenteDto>();
    for (const p of preguntas ?? []) mapa.set(p.numero, p);
    return mapa;
  }, [preguntas]);

  function formaDePregunta(n: number): FormaDeRespuestaDto | undefined {
    return preguntaPorNumero.get(n)?.forma;
  }

  function cambiarLinea(indice: number, valor: string): void {
    setLineas((actual) => actual.map((l, i) => (i === indice ? valor : l)));
  }

  function agregarLinea(): void {
    setLineas((actual) => (actual.length >= MAX_LINEAS ? actual : [...actual, '']));
  }

  function quitarLinea(indice: number): void {
    setLineas((actual) => (actual.length <= 1 ? actual : actual.filter((_l, i) => i !== indice)));
  }

  async function guardar(evento: SyntheticEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    if (ayuda === undefined) return;
    setErrorAccion(undefined);
    setGuardado(false);

    let respuesta: RespuestaPreguntaDto;
    if (modoRespuesta === 'no_se') {
      respuesta = { forma: 'todavia_no_se' };
    } else if (ayuda.pregunta.forma === 'frase') {
      if (texto.trim() === '') {
        setErrorAccion(new Error('Escribí una respuesta, o marcá que todavía no sabés.'));
        return;
      }
      respuesta = { forma: 'frase', texto: texto.trim() };
    } else if (ayuda.pregunta.forma === 'lineas') {
      const limpias = lineas.map((l) => l.trim()).filter((l) => l !== '');
      if (limpias.length === 0) {
        setErrorAccion(new Error('Escribí al menos una línea, o marcá que todavía no sabés.'));
        return;
      }
      respuesta = { forma: 'lineas', lineas: limpias };
    } else {
      if (origenLineas === undefined || origenLineas.length === 0) {
        setErrorAccion(new Error('Todavía no hay causas en la pregunta 6 para responder acá.'));
        return;
      }
      if (lineas.some((l) => l.trim() === '')) {
        setErrorAccion(
          new Error('Completá una respuesta para cada causa, o marcá arriba que todavía no sabés.'),
        );
        return;
      }
      respuesta = { forma: 'por_linea', porLinea: lineas.map((l) => l.trim()) };
    }

    const resultado = await ejecutar(`respuesta-${String(numero)}`, respuesta, () =>
      enviar<AyudaPreguntaDto>(`/asistente/borradores/${id}/respuestas`, {
        pregunta: numero,
        respuesta,
      }),
    );
    if (resultado.estado === 'hecho') {
      setAyuda(resultado.valor);
      setGuardado(true);
      traer<BorradorDetalleDto>(`/asistente/borradores/${id}`)
        .then(setDetalle)
        .catch(() => undefined);
    } else if (resultado.estado === 'fallo') {
      setErrorAccion(resultado.error);
    }
  }

  if (!numeroValido) {
    return (
      <div className="pagina-prosa">
        <h1>Esa pregunta no existe</h1>
        <p>El formulario tiene 27 preguntas, numeradas de la 1 a la 27.</p>
        <p>
          <Link className="boton secundario" href={`/asistente/${id}`}>
            Ver el plan
          </Link>
        </p>
      </div>
    );
  }

  if (sinPermiso !== undefined) {
    return (
      <div className="pagina-prosa">
        <h1>No podés responder esto</h1>
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
        <h1>No pudimos abrir esta pregunta</h1>
        <ErrorVisible error={error} />
        <p>
          <button className="boton" type="button" onClick={() => void cargar()}>
            Volver a intentar
          </button>{' '}
          <Link className="boton secundario" href={`/asistente/${id}`}>
            Ver el plan
          </Link>
        </p>
      </div>
    );
  }

  if (ayuda === undefined || detalle === undefined) return <Cargando que="la pregunta" completa />;

  const cerrado = detalle.estado === 'cerrado';
  const siguienteNumero = numero < CUANTAS_PREGUNTAS ? numero + 1 : undefined;
  const anteriorNumero = numero > 1 ? numero - 1 : undefined;

  return (
    <div className="pagina-detalle">
      <p className="suave">
        <Link href={`/asistente/${id}`}>Tu plan</Link> · Pregunta {numero} de {CUANTAS_PREGUNTAS} ·{' '}
        {ayuda.rotulo}
      </p>
      <h1>{ayuda.pregunta.texto}</h1>
      {ayuda.pregunta.obligatoria && (
        <Ficha variante="atencion">Obligatoria para cerrar el plan</Ficha>
      )}

      <aside className="carril-estado" aria-label="Sobre esta pregunta">
        {ayuda.loQueYaEscribiste !== undefined && (
          <section aria-labelledby="ultima-vez-titulo">
            <h2 id="ultima-vez-titulo">La última vez</h2>
            <p className="suave">
              {ayuda.loQueYaEscribiste.origen === 'sugerencia'
                ? 'La guardaste a partir de una sugerencia del ayudante automático, '
                : 'La escribiste a mano, '}
              el {cerrarFrase(cuando(ayuda.loQueYaEscribiste.escritaEn))}
            </p>
          </section>
        )}

        {cerrado && (
          <Aviso tipo="atencion" titulo="Este plan ya está cerrado">
            Se puede seguir leyendo, pero ya no se puede cambiar. Si querés corregir algo, empezá
            otro plan.
          </Aviso>
        )}

        <section aria-labelledby="frase-parcial-titulo">
          <h2 id="frase-parcial-titulo">Cómo va quedando</h2>
          <p className="suave">{ayuda.frase.pregunta}</p>
          <p>{ayuda.frase.texto}</p>
        </section>
      </aside>

      <div className="cuerpo-detalle">
        <ErrorVisible error={errorAccion} />
        {guardado && (
          <Aviso tipo="bien" titulo="Guardado">
            Esta respuesta ya quedó guardada.
          </Aviso>
        )}

        <form className="formulario-acotado" onSubmit={(e) => void guardar(e)}>
          <fieldset disabled={cerrado}>
            <legend className="solo-lectores">Tu respuesta</legend>

            <div className="opcion">
              <input
                type="radio"
                id="modo-contestar"
                name="modo-respuesta"
                checked={modoRespuesta === 'contestar'}
                onChange={() => {
                  setModoRespuesta('contestar');
                }}
              />
              <label htmlFor="modo-contestar">Responder</label>
            </div>
            <div className="opcion">
              <input
                type="radio"
                id="modo-no-se"
                name="modo-respuesta"
                checked={modoRespuesta === 'no_se'}
                onChange={() => {
                  setModoRespuesta('no_se');
                }}
              />
              <label htmlFor="modo-no-se">
                Todavía no sé
                <span className="explica">
                  Vale como respuesta de verdad: queda anotado para volver más tarde, no es un
                  casillero vacío.
                </span>
              </label>
            </div>

            {modoRespuesta === 'contestar' && ayuda.pregunta.forma === 'frase' && (
              <div className="campo">
                <label htmlFor="respuesta-frase">Tu respuesta</label>
                <textarea
                  id="respuesta-frase"
                  maxLength={MAX_TEXTO}
                  value={texto}
                  onChange={(e) => {
                    setTexto(e.target.value);
                  }}
                />
              </div>
            )}

            {modoRespuesta === 'contestar' && ayuda.pregunta.forma === 'lineas' && (
              <div className="campo">
                <span id="etiqueta-lineas">Una por línea</span>
                <ul
                  aria-labelledby="etiqueta-lineas"
                  style={{
                    listStyle: 'none',
                    margin: 0,
                    padding: 0,
                    display: 'grid',
                    gap: 'var(--e2)',
                  }}
                >
                  {lineas.map((linea, indice) => (
                    // Sin identidad propia: son renglones de un formulario, se agregan y quitan por
                    // posición, no por el texto que llevan (que puede repetirse o estar vacío).
                    <li key={indice} style={{ display: 'flex', gap: 'var(--e2)' }}>
                      <input
                        aria-label={`Línea ${String(indice + 1)}`}
                        maxLength={MAX_TEXTO}
                        value={linea}
                        onChange={(e) => {
                          cambiarLinea(indice, e.target.value);
                        }}
                      />
                      <button
                        className="boton texto"
                        type="button"
                        disabled={lineas.length <= 1}
                        onClick={() => {
                          quitarLinea(indice);
                        }}
                      >
                        Quitar
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  className="boton secundario"
                  type="button"
                  disabled={lineas.length >= MAX_LINEAS}
                  style={{ marginTop: 'var(--e2)' }}
                  onClick={agregarLinea}
                >
                  Agregar línea
                </button>
              </div>
            )}

            {modoRespuesta === 'contestar' &&
              ayuda.pregunta.forma === 'por_linea' &&
              (origenLineas === undefined ? (
                <Cargando que={`la pregunta ${String(origen ?? '')}`} />
              ) : origenLineas.length === 0 ? (
                <Aviso tipo="atencion" titulo="Falta la pregunta anterior">
                  Todavía no escribiste ninguna causa en la pregunta {origen}.{' '}
                  <Link href={`/asistente/${id}/preguntas/${String(origen)}`}>
                    Ir a la pregunta {origen}
                  </Link>
                  .
                </Aviso>
              ) : (
                <div className="campo">
                  <p id="etiqueta-por-linea">Una respuesta por cada una</p>
                  <ul
                    aria-labelledby="etiqueta-por-linea"
                    style={{
                      listStyle: 'none',
                      margin: 0,
                      padding: 0,
                      display: 'grid',
                      gap: 'var(--e3)',
                    }}
                  >
                    {origenLineas.map((causa, indice) => (
                      // La posición es la identidad acá: la casilla N siempre responde a la causa N
                      // de la pregunta 6, aunque dos causas tengan el mismo texto.
                      <li key={indice}>
                        <label htmlFor={`por-linea-${String(indice)}`}>{causa}</label>
                        <input
                          id={`por-linea-${String(indice)}`}
                          maxLength={MAX_TEXTO}
                          value={lineas[indice] ?? ''}
                          onChange={(e) => {
                            cambiarLinea(indice, e.target.value);
                          }}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

            <button
              className="boton"
              type="submit"
              disabled={
                cerrado ||
                enCurso !== undefined ||
                (ayuda.pregunta.forma === 'por_linea' &&
                  (origenLineas === undefined || origenLineas.length === 0))
              }
            >
              {enCurso === `respuesta-${String(numero)}` ? 'Guardando…' : 'Guardar y continuar'}
            </button>
          </fieldset>
        </form>

        <p style={{ display: 'flex', gap: 'var(--e3)', flexWrap: 'wrap', marginTop: 'var(--e4)' }}>
          {anteriorNumero !== undefined && (
            <Link
              className="boton secundario"
              href={`/asistente/${id}/preguntas/${String(anteriorNumero)}`}
            >
              ← Pregunta {anteriorNumero}
            </Link>
          )}
          {ayuda.siguiente !== undefined && (
            <Link className="boton" href={`/asistente/${id}/preguntas/${String(ayuda.siguiente)}`}>
              Siguiente sin responder: la {ayuda.siguiente}
            </Link>
          )}
          {/* Si la siguiente sin responder es igual a la siguiente en orden, un solo botón alcanza:
              el de arriba ya lleva ahí. Éste sólo aparece cuando divergen (se venía saltando). */}
          {siguienteNumero !== undefined && siguienteNumero !== ayuda.siguiente && (
            <Link
              className="boton secundario"
              href={`/asistente/${id}/preguntas/${String(siguienteNumero)}`}
            >
              Pregunta {siguienteNumero} →
            </Link>
          )}
          <Link className="boton secundario" href={`/asistente/${id}`}>
            Ver el plan completo
          </Link>
        </p>

        {!cerrado && (
          <section aria-labelledby="ayuda-ia-titulo" style={{ marginTop: 'var(--e6)' }}>
            <h2 id="ayuda-ia-titulo">Pedir ayuda</h2>
            {necesitaMostrarConsentimiento(detalle) && (
              <ConsentimientoIA
                borradorId={id}
                consentimiento={detalle.consentimiento}
                onDecidido={setDetalle}
              />
            )}
            <PanelAyudaIA
              // Fuerza una instancia nueva por pregunta: sin esto, React reutiliza la misma y el
              // panel arrastraría el fragmento y la sugerencia de la pregunta anterior al navegar.
              key={numero}
              borradorId={id}
              numero={numero}
              modo={ayuda.modo}
              porQueNoHaySugerencias={ayuda.porQueNoHaySugerencias}
              motivoEstructural={detalle.motivoEstructural}
              fragmentoInicial={ayuda.pregunta.forma === 'frase' ? texto : lineas.join('\n')}
              formaDePregunta={formaDePregunta}
              muestraMemoria={ayuda.muestraMemoria}
              onAplicada={(preguntaAfectada) => {
                if (preguntaAfectada === numero) {
                  void cargar();
                }
              }}
              onEditar={(textoPropuesto) => {
                if (ayuda.pregunta.forma === 'frase') {
                  setTexto(textoPropuesto);
                } else {
                  setLineas(textoPropuesto.split('\n').filter((l) => l.trim() !== ''));
                }
                setModoRespuesta('contestar');
              }}
            />
          </section>
        )}
      </div>
    </div>
  );
}
