'use client';

/**
 * Un sondeo: sembrar afirmaciones, valorarlas y leer el resultado (ADR-0038).
 *
 * ═══ Qué es esto y qué NO es ═══
 *
 * Se repite acá, no sólo en el índice, porque es la pantalla donde de verdad se actúa: **un sondeo
 * filtra la agenda, nunca decide**. Nadie gana, nadie pierde, y nada de lo que se vota acá aprueba
 * ni rechaza nada por sí solo. Cada afirmación se responde sola —de acuerdo, en desacuerdo o
 * paso— y no hay forma de contestarle a la persona que la escribió.
 *
 * ═══ Las tres fases, y qué puede hacer cada quien ═══
 *
 *  - **Armando** (`sembrando`): sólo quien convocó puede sembrar, y tiene que declarar, afirmación
 *    por afirmación, si contradice su propia postura. En cuanto junta doce con al menos tres
 *    contrarias, el sondeo se abre solo —no hay un botón para «abrir»—.
 *  - **Abierto**: cualquier persona puede valorar, una afirmación a la vez (PRODUCT.md §4), y
 *    también puede sumar afirmaciones nuevas —es el mecanismo antitrol de ADR-0038: frente a algo
 *    que molesta, la única salida estructural es escribir una afirmación que gane acuerdo de gente
 *    que no piensa igual—.
 *  - **Cerrado**: sólo queda el resultado.
 *
 * El resultado (`GET /sondeos/:id/resultado`) se muestra siempre, en las tres fases, porque
 * PRODUCT.md §4 trata «menos de 7 votos» y «no hay grupos claros» como desenlaces normales de la
 * pantalla, no como huecos que haya que esconder.
 *
 * ═══ Una corrección de lectura, no de código ═══
 *
 * El texto que `GET /sondeos/:id/resultado` manda para el caso `todavia_no` con `motivo:
 * 'sembrando'` es, tal como lo arma `services/api/src/http/rutas-consenso.ts`, el mismo que usa
 * para «no hay grupos claros» (`sinGruposDescripcion` de `@koinonia/consensus`) —una frase sobre
 * bandos que no distinguen a nadie, que no tiene sentido mientras el sondeo ni siquiera está
 * abierto—. Ese fichero no es mío y no lo edito; acá se opta por no imprimir esa frase para ese
 * caso puntual y escribir la que sí corresponde («todavía se está armando»). Los otros tres motivos
 * (`poca_gente`, `sin_diferencias`, `no_se_estabilizo`) sí traen su descripción propia y se muestran
 * tal cual llegan.
 */

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode, type SyntheticEvent } from 'react';

import {
  RESPUESTA_SONDEO_EN_PALABRAS,
  SONDEO_MAXIMO_CARACTERES_AFIRMACION,
  SONDEO_MINIMO_VALORACIONES_PARA_UBICAR,
  type AfirmacionResultadoSondeo,
  type AfirmacionSondeo,
  type GrupoSondeo,
  type RespuestaSondeo,
  type SondeoDetalle,
  type SondeoResultado,
} from '@koinonia/contracts';

import { Aviso, Cargando, ErrorVisible, useSesion } from '../../../components/marco';
import { Ficha, Medidor, Meta, type VarianteFicha } from '../../../components/piezas';
import { useAccionUnica, type AccionUnica } from '../../../lib/acciones';
import { enviar, fechaCortaEnFrase, traer } from '../../../lib/api';

const VARIANTE_POR_ESTADO: Readonly<Record<SondeoDetalle['estado'], VarianteFicha>> = {
  sembrando: 'atencion',
  abierto: 'en-curso',
  cerrado: 'neutra',
};

const RESPUESTAS: readonly RespuestaSondeo[] = ['de_acuerdo', 'en_desacuerdo', 'paso'];

/** El aviso que va arriba de todo, en las tres fases: qué es esto y qué no es. */
function QueEsQueNoEs(): ReactNode {
  return (
    <Aviso tipo="atencion" titulo="Qué es esto y qué no es">
      Esto no es una votación: nadie gana ni pierde, y el resultado no aprueba ni rechaza nada por
      sí solo. Sirve para encontrar, antes de discutir, qué afirmaciones cortas reúnen acuerdo en
      todos los grupos y cuáles dividen. Cada afirmación se responde sola: acá no se le contesta a
      nadie.
    </Aviso>
  );
}

/** Sembrar una afirmación: la fundacional (declara si contradice) o una nueva, con el sondeo abierto. */
function FormularioSembrar({
  sondeoId,
  esFundacional,
  accion,
  onSembrado,
}: {
  readonly sondeoId: string;
  readonly esFundacional: boolean;
  readonly accion: AccionUnica;
  readonly onSembrado: () => void;
}): ReactNode {
  const [texto, setTexto] = useState('');
  const [contraria, setContraria] = useState<'si' | 'no' | ''>('');
  const [error, setError] = useState<unknown>(undefined);
  const { enCurso, ejecutar } = accion;

  async function enviarAfirmacion(evento: SyntheticEvent): Promise<void> {
    evento.preventDefault();
    setError(undefined);
    const datos = esFundacional ? { texto, contrariaAMiPosicion: contraria === 'si' } : { texto };
    const resultado = await ejecutar('sembrar', datos, (requestId) =>
      enviar<AfirmacionSondeo>(`/sondeos/${sondeoId}/afirmaciones`, { requestId, ...datos }),
    );
    if (resultado.estado === 'hecho') {
      setTexto('');
      setContraria('');
      onSembrado();
    } else if (resultado.estado === 'fallo') setError(resultado.error);
  }

  return (
    <form onSubmit={(e) => void enviarAfirmacion(e)} noValidate>
      <ErrorVisible error={error} />
      <div className="campo">
        <label htmlFor="texto-afirmacion">La afirmación</label>
        <span className="ayuda" id="ayuda-texto-afirmacion">
          Una frase corta y votable, sin argumento: el argumento tiene su lugar en la conversación
          de origen, no acá. Máximo {SONDEO_MAXIMO_CARACTERES_AFIRMACION} caracteres.
        </span>
        <textarea
          id="texto-afirmacion"
          required
          minLength={10}
          maxLength={SONDEO_MAXIMO_CARACTERES_AFIRMACION}
          aria-describedby="ayuda-texto-afirmacion"
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
          }}
        />
      </div>

      {esFundacional && (
        <fieldset className="opciones">
          <legend>¿Contradice tu propia postura?</legend>
          <p className="suave" id="ayuda-contraria">
            De las doce fundacionales, al menos tres tienen que serlo: es lo que evita que el sondeo
            sea sólo tu propio argumento repetido doce veces.
          </p>
          <div className="opcion">
            <input
              type="radio"
              id="contraria-si"
              name="contraria"
              required
              checked={contraria === 'si'}
              onChange={() => {
                setContraria('si');
              }}
              aria-describedby="ayuda-contraria"
            />
            <label htmlFor="contraria-si">Sí, contradice mi postura</label>
          </div>
          <div className="opcion">
            <input
              type="radio"
              id="contraria-no"
              name="contraria"
              required
              checked={contraria === 'no'}
              onChange={() => {
                setContraria('no');
              }}
              aria-describedby="ayuda-contraria"
            />
            <label htmlFor="contraria-no">No, coincide con mi postura</label>
          </div>
        </fieldset>
      )}

      <button
        className="boton"
        type="submit"
        disabled={enCurso !== undefined || (esFundacional && contraria === '')}
      >
        {enCurso === 'sembrar' ? 'Sembrando…' : 'Sembrar esta afirmación'}
      </button>
    </form>
  );
}

/** La afirmación de turno, con sus tres botones. PRODUCT.md §4: «una afirmación a la vez». */
function Valorar({
  sondeoId,
  afirmacion,
  accion,
  onValorado,
}: {
  readonly sondeoId: string;
  readonly afirmacion: AfirmacionSondeo;
  readonly accion: AccionUnica;
  readonly onValorado: () => void;
}): ReactNode {
  const [error, setError] = useState<unknown>(undefined);
  const { enCurso, ejecutar } = accion;
  const clave = `valorar-${afirmacion.id}`;

  async function votar(respuesta: RespuestaSondeo): Promise<void> {
    setError(undefined);
    const resultado = await ejecutar(clave, { respuesta }, (requestId) =>
      enviar<AfirmacionSondeo>(`/sondeos/${sondeoId}/afirmaciones/${afirmacion.id}/valoraciones`, {
        requestId,
        respuesta,
      }),
    );
    if (resultado.estado === 'hecho') onValorado();
    else if (resultado.estado === 'fallo') setError(resultado.error);
  }

  return (
    <div>
      <p className="destacado">{afirmacion.texto}</p>
      {afirmacion.contrariaALaPosicionDeQuienConvoca && (
        <p className="suave">Es una de las que quien convocó marcó como contraria a su postura.</p>
      )}
      <ErrorVisible error={error} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--e3)', marginTop: 'var(--e4)' }}>
        {RESPUESTAS.map((respuesta) => (
          <button
            key={respuesta}
            type="button"
            className="boton secundario"
            style={{ flex: '1 1 9rem' }}
            disabled={enCurso !== undefined}
            onClick={() => void votar(respuesta)}
          >
            {enCurso === clave ? 'Enviando…' : RESPUESTA_SONDEO_EN_PALABRAS[respuesta]}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Una tabla accesible por afirmación: el grupo es el encabezado de fila, no un color (WCAG 1.4.1). */
function TablaDeGrupos({
  afirmaciones,
  grupos,
}: {
  readonly afirmaciones: readonly AfirmacionResultadoSondeo[];
  readonly grupos: readonly GrupoSondeo[];
}): ReactNode {
  return (
    <ul className="tarjetas">
      {afirmaciones.map((afirmacion) => (
        <li key={afirmacion.texto}>
          <h4>{afirmacion.texto}</h4>
          <p className="suave">
            {afirmacion.observaciones}{' '}
            {afirmacion.observaciones === 1 ? 'persona la valoró' : 'personas la valoraron'}.
          </p>
          <table className="datos">
            <caption className="suave">Cuánto acuerdo reunió en cada grupo</caption>
            <thead>
              <tr>
                <th scope="col">Grupo</th>
                <th scope="col">De acuerdo</th>
              </tr>
            </thead>
            <tbody>
              {grupos.map((grupo, indice) => (
                <tr key={grupo.nombre}>
                  <th scope="row">{grupo.nombre}</th>
                  <td>{afirmacion.porcentajeAcuerdoPorGrupo[indice] ?? 0} %</td>
                </tr>
              ))}
            </tbody>
          </table>
        </li>
      ))}
    </ul>
  );
}

/**
 * Lista de afirmaciones cuando no hay grupos que distinguir: sin facciones, toda la población es
 * un único conjunto, y llamarlo «grupo» sería fabricar una distinción que ADR-0038 no permite. Por
 * eso acá no hay tabla por grupo, sólo el porcentaje de acuerdo sobre el conjunto entero.
 */
function ListaDeAcuerdoGeneral({
  afirmaciones,
}: {
  readonly afirmaciones: readonly AfirmacionResultadoSondeo[];
}): ReactNode {
  return (
    <ul className="tarjetas">
      {afirmaciones.map((afirmacion) => (
        <li key={afirmacion.texto}>
          <h4>{afirmacion.texto}</h4>
          <p>
            <strong>{afirmacion.porcentajeAcuerdoPorGrupo[0] ?? 0} %</strong> de acuerdo, sobre{' '}
            {afirmacion.observaciones}{' '}
            {afirmacion.observaciones === 1 ? 'valoración' : 'valoraciones'}.
          </p>
        </li>
      ))}
    </ul>
  );
}

function Resultado({ resultado }: { readonly resultado: SondeoResultado }): ReactNode {
  if (resultado.tipo === 'todavia_no') {
    // Ver la nota de cabecera: el `descripcion` que manda el servidor para `sembrando` es el de
    // «no hay grupos claros», que no corresponde acá. Se escribe la frase correcta a mano.
    const descripcion =
      resultado.motivo === 'sembrando'
        ? 'Todavía se está armando: hacen falta las doce afirmaciones fundacionales, con sus tres ' +
          'contrarias, antes de que haya algo que mostrar.'
        : resultado.descripcion;
    return (
      <div className="vacio" role="status">
        <h3>Todavía no hay un mapa que mostrar</h3>
        <p>{descripcion}</p>
      </div>
    );
  }

  return (
    <>
      <p className="suave">{resultado.avisoProvisional}</p>
      <p className="suave">
        Se consideraron {resultado.participantesConsiderados}{' '}
        {resultado.participantesConsiderados === 1 ? 'persona' : 'personas'} ya ubicadas en el mapa
        {resultado.participantesSinUbicar > 0 && (
          <>
            {' '}
            y {resultado.participantesSinUbicar}{' '}
            {resultado.participantesSinUbicar === 1
              ? 'que todavía no valoró'
              : 'que todavía no valoraron'}{' '}
            las {SONDEO_MINIMO_VALORACIONES_PARA_UBICAR} afirmaciones que hacen falta, como mínimo,
            para poder ubicarlas en el mapa
          </>
        )}
        .
      </p>

      {resultado.tipo === 'sin_grupos_claros' && (
        <>
          <h3>{resultado.titulo}</h3>
          <p>{resultado.descripcion}</p>
          {resultado.acuerdoGeneral.length > 0 ? (
            <>
              <h4>{resultado.acuerdoGeneralTitulo}</h4>
              <p className="suave">{resultado.acuerdoGeneralDescripcion}</p>
              <ListaDeAcuerdoGeneral afirmaciones={resultado.acuerdoGeneral} />
            </>
          ) : (
            resultado.aviso !== '' && <p>{resultado.aviso}</p>
          )}
        </>
      )}

      {resultado.tipo === 'grupos_detectados' && (
        <>
          <h3>{resultado.titulo}</h3>
          <p>{resultado.descripcion}</p>

          <h4>Grupos</h4>
          <ul>
            {resultado.grupos.map((grupo) => (
              <li key={grupo.nombre}>
                <strong>{grupo.nombre}</strong> —{' '}
                {grupo.tamano === 1 ? '1 persona' : `${String(grupo.tamano)} personas`}
                {resultado.miGrupo === grupo.nombre && (
                  <>
                    {' '}
                    <span className="etiqueta">Acá quedaste vos</span>
                  </>
                )}
              </li>
            ))}
          </ul>
          {resultado.miGrupo === undefined && (
            <p className="suave">
              Vos no aparecés en ningún grupo porque todavía no valoraste las{' '}
              {SONDEO_MINIMO_VALORACIONES_PARA_UBICAR} afirmaciones mínimas para entrar al mapa.
            </p>
          )}

          {/* Lo que une va primero: es una decisión de contenido, no de maquetación (ver
              `apps/web/app/consenso/page.tsx` para el mismo criterio en el índice). */}
          <h4>{resultado.afirmacionesPuenteTitulo}</h4>
          <p className="suave">{resultado.afirmacionesPuenteDescripcion}</p>
          <TablaDeGrupos afirmaciones={resultado.afirmacionesPuente} grupos={resultado.grupos} />

          <h4>{resultado.afirmacionesDivisivasTitulo}</h4>
          <p className="suave">{resultado.afirmacionesDivisivasDescripcion}</p>
          <TablaDeGrupos afirmaciones={resultado.afirmacionesDivisivas} grupos={resultado.grupos} />

          <h4>Cómo NO leer esto</h4>
          <p>
            Esto describe respuestas, no personas. Nadie «es» de un grupo: cada quien respondió lo
            que respondió en estas afirmaciones concretas, y en otro sondeo puede quedar en otro
            lado. Los grupos no son bandos, no tienen representantes y no deciden nada.
          </p>
        </>
      )}
    </>
  );
}

export default function SondeoDetallePagina(): ReactNode {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { sesion } = useSesion();

  const [sondeo, setSondeo] = useState<SondeoDetalle | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const [resultado, setResultado] = useState<SondeoResultado | undefined>(undefined);
  const [errorResultado, setErrorResultado] = useState<unknown>(undefined);
  const accionSiembra = useAccionUnica();
  const accionValorar = useAccionUnica();

  const recargar = useCallback(() => {
    setError(undefined);
    traer<SondeoDetalle>(`/sondeos/${id}`).then(setSondeo).catch(setError);
    setErrorResultado(undefined);
    traer<SondeoResultado>(`/sondeos/${id}/resultado`).then(setResultado).catch(setErrorResultado);
  }, [id]);

  useEffect(recargar, [recargar]);

  if (error !== undefined) {
    return (
      <div className="pagina-prosa">
        <h1>No pudimos abrir este sondeo</h1>
        <ErrorVisible error={error} />
        <p>
          <button className="boton" type="button" onClick={recargar}>
            Volver a intentar
          </button>{' '}
          <Link className="boton secundario" href="/consenso">
            Ver todos los sondeos
          </Link>
        </p>
      </div>
    );
  }
  if (sondeo === undefined) {
    return (
      <div className="pagina-prosa">
        <Cargando que="el sondeo" completa />
      </div>
    );
  }

  const puedeSembrarFundacional = sondeo.estado === 'sembrando' && sondeo.convocaEsMi;
  const puedeSembrarNueva = sondeo.estado === 'abierto';

  return (
    <div className="pagina-detalle">
      <h1>{sondeo.asuntoTitulo}</h1>

      <aside className="carril-estado" aria-label="Estado del sondeo">
        <Ficha variante={VARIANTE_POR_ESTADO[sondeo.estado]}>{sondeo.estadoEnPalabras}</Ficha>
        <Meta>
          {sondeo.asuntoTipo === 'problema' ? 'Sobre un problema' : 'Sobre una propuesta'}
          {`Abierto ${fechaCortaEnFrase(sondeo.desde)}`}
        </Meta>
        <p>{sondeo.motivo}</p>
        <p>
          <Link
            href={
              sondeo.asuntoTipo === 'problema'
                ? `/problemas/${sondeo.asuntoId}`
                : `/propuestas/${sondeo.asuntoId}`
            }
          >
            Ver {sondeo.asuntoTipo === 'problema' ? 'el problema' : 'la propuesta'} completo
          </Link>
        </p>

        {sondeo.estado === 'sembrando' && sondeo.progresoSiembra !== undefined && (
          <>
            <Medidor
              etiqueta="Afirmaciones sembradas"
              valor={sondeo.progresoSiembra.sembradas}
              total={sondeo.progresoSiembra.sembradas + sondeo.progresoSiembra.faltan}
            />
            <Medidor
              etiqueta="De ellas, contrarias a quien convoca"
              valor={sondeo.progresoSiembra.contrariasSembradas}
              total={
                sondeo.progresoSiembra.contrariasSembradas + sondeo.progresoSiembra.contrariasFaltan
              }
            />
          </>
        )}
        {sondeo.estado !== 'sembrando' && (
          <Medidor
            etiqueta="Valoraste"
            valor={sondeo.miProgreso.valoradas}
            total={sondeo.miProgreso.total}
          />
        )}
      </aside>

      <div className="cuerpo-detalle">
        <QueEsQueNoEs />

        {sondeo.estado === 'sembrando' &&
          (puedeSembrarFundacional ? (
            <section aria-labelledby="sembrar-titulo">
              <h2 id="sembrar-titulo">Sembrar la afirmación siguiente</h2>
              <FormularioSembrar
                sondeoId={id}
                esFundacional
                accion={accionSiembra}
                onSembrado={recargar}
              />
            </section>
          ) : (
            <Aviso tipo="atencion" titulo="Todavía se está armando">
              Mientras se arma, sólo quien convocó este sondeo puede sembrar afirmaciones. En cuanto
              reúna las doce —tres de ellas contrarias a su propia postura— se abre solo para que
              cualquiera lo valore.
              {sesion === undefined && (
                <>
                  {' '}
                  <Link href="/entrar">Entrá</Link> si querés que te avisemos cuando abra.
                </>
              )}
            </Aviso>
          ))}

        {sondeo.estado === 'abierto' && (
          <section aria-labelledby="valorar-titulo">
            <h2 id="valorar-titulo">Valorar</h2>
            {sesion === undefined ? (
              <Aviso tipo="atencion" titulo="Antes de valorar">
                Para que tu respuesta cuente hay que entrar con el correo institucional.{' '}
                <Link href="/entrar">Entrar ahora</Link>.
              </Aviso>
            ) : sondeo.siguienteAfirmacion === undefined ? (
              <div className="vacio" role="status">
                <h3>Ya valoraste todo lo que había</h3>
                <p>
                  Volvé más tarde por si alguien sumó una afirmación nueva. Mientras tanto podés
                  sumar vos una abajo.
                </p>
              </div>
            ) : (
              <Valorar
                sondeoId={id}
                afirmacion={sondeo.siguienteAfirmacion}
                accion={accionValorar}
                onValorado={recargar}
              />
            )}
          </section>
        )}

        {puedeSembrarNueva && (
          <details>
            <summary>Sumar una afirmación nueva</summary>
            <p className="suave">
              Cualquiera puede sumar afirmaciones mientras el sondeo está abierto. Es la salida
              estructural frente a algo que molesta: en vez de responderle a nadie, se escribe una
              afirmación que tiene que ganar acuerdo de gente que no piensa igual.
            </p>
            {sesion === undefined ? (
              <Aviso tipo="atencion" titulo="Antes de sembrar">
                Para que quede a tu nombre hay que entrar con el correo institucional.{' '}
                <Link href="/entrar">Entrar ahora</Link>.
              </Aviso>
            ) : (
              <FormularioSembrar
                sondeoId={id}
                esFundacional={false}
                accion={accionSiembra}
                onSembrado={recargar}
              />
            )}
          </details>
        )}

        {sondeo.estado === 'cerrado' && (
          <Aviso tipo="atencion" titulo="Este sondeo ya cerró">
            No se puede sembrar ni valorar nada más. Lo que queda es el resultado, abajo.
          </Aviso>
        )}

        <section aria-labelledby="resultado-titulo">
          <h2 id="resultado-titulo">Qué dice el sondeo hasta ahora</h2>
          <ErrorVisible error={errorResultado} />
          {resultado === undefined && errorResultado === undefined && (
            <p className="suave" role="status">
              Calculando…
            </p>
          )}
          {resultado !== undefined && <Resultado resultado={resultado} />}
        </section>
      </div>
    </div>
  );
}
