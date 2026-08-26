'use client';

/**
 * Emitir la respuesta.
 *
 * ═══ «¿Alguien objeta?», no «vote sí o no» ═══
 *
 * Cuando el método es el de acuerdo interno, la pregunta que ve la persona es literalmente
 * **«¿Alguien objeta?»** y las tres respuestas son *sin objeción*, *tengo una reserva* y *objeto*.
 * No es una etiqueta bonita para un sí/no: son cosas distintas. «Tengo una reserva» se registra y no
 * bloquea; «objeto» bloquea y por eso exige un argumento y decir qué objetivo del grupo se daña.
 * El criterio se enuncia con esas palabras: *no hace falta que a todos les guste; hace falta que
 * nadie muestre un daño*.
 *
 * Y en las dos papeletas va, siempre, **qué hace falta para que esto pase**. La disputa de una
 * asamblea es casi siempre sobre el denominador; decirlo antes de votar la elimina.
 */

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type SyntheticEvent, type ReactNode } from 'react';

import type { DecisionDetalle } from '@koinonia/contracts';

import { Aviso, Cargando, ErrorVisible, useSesion } from '../../../components/marco';
import { Ficha, Medidor, Meta, Plazo } from '../../../components/piezas';
import { PlanEjecucionVisible } from '../../../components/plan-ejecucion';
import { useAccionUnica } from '../../../lib/acciones';
import { cuando, enviar, traer } from '../../../lib/api';
import { enPalabras, nombreDelMetodo, porQueTodaviaNo } from '../metodos-en-palabras';

type Postura = 'consent' | 'concern' | 'object';
type Binario = 'si' | 'no' | 'abstengo';

/**
 * Lo que bloquea la decisión, y —para quien facilita— cómo se desatasca.
 *
 * ═══ Por qué existe esta pieza ═══
 *
 * El motor sabía desestimar una objeción desde hacía tiempo: panel sorteado, dos tercios,
 * motivación escrita, y todo eso validado de verdad. Levantar una objeción se podía. Desestimarla
 * no se podía **desde ninguna pantalla**, así que una decisión con una objeción en pie se quedaba
 * ahí para siempre. La reauditoría lo llamó por su nombre: construido e inalcanzable, que es peor
 * que faltante — lo faltante se echa de menos.
 *
 * ═══ Tres decisiones sobre qué se enseña ═══
 *
 *  1. **La objeción se ve aunque no puedas hacer nada con ella.** Es lo que explica por qué la
 *     decisión no avanza, y esconderlo a quien no facilita convertiría el bloqueo en un misterio.
 *  2. **No dice quién objetó, y no se puede.** El texto viene sin firma desde la API: objetar es el
 *     sentido de un voto, y decir de quién es sería publicar ese voto (ADR-0010).
 *  3. **Desestimar cuesta escribir.** El formulario pide cuántas personas del panel votaron a favor
 *     y una motivación de verdad — la misma que el motor exige y que queda publicada—. No hay botón
 *     de «desestimar» a secas: la comunidad tiene derecho a leer por qué se pasó por encima de una
 *     objeción, y por eso el precio de hacerlo es explicarse.
 */
function ObjecionesEnPie({
  decisionId,
  objeciones,
  puedeDesestimar,
  alDesestimar,
}: {
  readonly decisionId: string;
  readonly objeciones: DecisionDetalle['objeciones'];
  readonly puedeDesestimar: boolean;
  readonly alDesestimar: () => void;
}): ReactNode {
  const [abierta, setAbierta] = useState<string | undefined>(undefined);
  const [votos, setVotos] = useState('');
  const [motivacion, setMotivacion] = useState('');
  const [error, setError] = useState<unknown>(undefined);
  const { ejecutar, enCurso } = useAccionUnica();

  if (objeciones.length === 0) return null;

  async function desestimar(evento: SyntheticEvent, objecionId: string): Promise<void> {
    evento.preventDefault();
    setError(undefined);
    const cuantos = Number(votos);
    if (!Number.isInteger(cuantos) || cuantos < 0) {
      setError(
        new Error('Escribí cuántas personas del panel votaron desestimar, en número entero.'),
      );
      return;
    }
    const resultado = await ejecutar(
      `desestimar-${objecionId}`,
      { objecionId, cuantos, motivacion },
      () =>
        enviar(`/decisiones/${decisionId}/objeciones/${objecionId}/desestimar`, {
          requestId: crypto.randomUUID(),
          votos: cuantos,
          motivacion,
        }),
    );
    if (resultado.estado === 'hecho') {
      setAbierta(undefined);
      setVotos('');
      setMotivacion('');
      alDesestimar();
    } else if (resultado.estado === 'fallo') {
      setError(resultado.error);
    }
  }

  return (
    <section aria-labelledby="objeciones-titulo">
      <h2 id="objeciones-titulo">Lo que la está frenando</h2>
      <p className="suave">
        Una objeción no es que a alguien no le guste: es que alguien mostró un daño concreto a lo
        que el grupo se propuso. Mientras siga en pie, esta decisión no pasa.
      </p>
      <ul className="tarjetas">
        {objeciones.map((objecion) => (
          <li key={objecion.id}>
            <article className="tarjeta">
              <h3>Qué se daña: {objecion.objetivoDanado}</h3>
              <p>{objecion.argumento}</p>
              {objecion.enmiendaPropuesta !== undefined && (
                <p>
                  <strong>Salida que propone:</strong> {objecion.enmiendaPropuesta}
                </p>
              )}
              <Meta>Se levantó en la ronda {objecion.ronda}</Meta>
              {puedeDesestimar &&
                (abierta === objecion.id ? (
                  <form onSubmit={(e) => void desestimar(e, objecion.id)} noValidate>
                    <p>
                      <label htmlFor={`votos-${objecion.id}`}>
                        Cuántas personas del grupo sorteado votaron desestimarla
                      </label>
                      <input
                        id={`votos-${objecion.id}`}
                        name="votos"
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={votos}
                        onChange={(e) => {
                          setVotos(e.target.value);
                        }}
                        required
                      />
                    </p>
                    <p>
                      <label htmlFor={`motivacion-${objecion.id}`}>
                        Por qué se desestima, para que cualquiera pueda leerlo
                      </label>
                      <textarea
                        id={`motivacion-${objecion.id}`}
                        name="motivacion"
                        rows={4}
                        value={motivacion}
                        onChange={(e) => {
                          setMotivacion(e.target.value);
                        }}
                        required
                      />
                      <span className="suave">
                        Queda publicado junto a la decisión. Pasar por encima de una objeción sin
                        explicarse es lo único que este procedimiento no permite.
                      </span>
                    </p>
                    <ErrorVisible error={error} />
                    <p className="acciones">
                      {/* `enCurso` es la CLAVE de la acción en vuelo, no un booleano: se compara
                          con la de esta objeción para no apagar el botón de otra tarjeta. */}
                      <button
                        className="boton"
                        type="submit"
                        disabled={enCurso === `desestimar-${objecion.id}`}
                      >
                        {enCurso === `desestimar-${objecion.id}`
                          ? 'Publicando…'
                          : 'Publicar la desestimación'}
                      </button>{' '}
                      <button
                        className="boton secundario"
                        type="button"
                        onClick={() => {
                          setAbierta(undefined);
                          setError(undefined);
                        }}
                      >
                        Dejarlo así
                      </button>
                    </p>
                  </form>
                ) : (
                  <p>
                    <button
                      className="boton secundario"
                      type="button"
                      onClick={() => {
                        setAbierta(objecion.id);
                        setError(undefined);
                      }}
                    >
                      Publicar la desestimación de esta objeción
                    </button>
                  </p>
                ))}
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function Decision(): ReactNode {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { sesion } = useSesion();

  const [decision, setDecision] = useState<DecisionDetalle | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const [errorEnvio, setErrorEnvio] = useState<unknown>(undefined);
  const [enviado, setEnviado] = useState(false);
  const [errorCierre, setErrorCierre] = useState<unknown>(undefined);
  // Las dos acciones más caras de la pantalla comparten guarda: mientras una está en vuelo, ni ella
  // ni la otra pueden volver a salir. Y las dos conservan su clave de idempotencia entre reintentos,
  // que es lo que impide que una respuesta perdida se convierta en dos papeletas o en dos cierres.
  const { enCurso, ejecutar } = useAccionUnica();

  const [postura, setPostura] = useState<Postura>('consent');
  const [binario, setBinario] = useState<Binario>('si');
  const [argumento, setArgumento] = useState('');
  const [objetivo, setObjetivo] = useState('');

  const recargar = useCallback(() => {
    setError(undefined);
    traer<DecisionDetalle>(`/decisiones/${id}`).then(setDecision).catch(setError);
  }, [id]);

  useEffect(recargar, [recargar]);

  async function responder(evento: SyntheticEvent): Promise<void> {
    evento.preventDefault();
    setErrorEnvio(undefined);
    setEnviado(false);
    if (decision === undefined) return;
    const respuesta =
      enPalabras(decision.metodo).formulario === 'consentimiento'
        ? {
            tipo: 'consent' as const,
            postura,
            ...(postura === 'object' ? { objecion: { argumento, objetivoDanado: objetivo } } : {}),
          }
        : binario === 'abstengo'
          ? { tipo: 'abstain' as const }
          : { tipo: 'binary' as const, aprueba: binario === 'si' };

    const resultado = await ejecutar(
      'papeleta',
      { huellaVersion: decision.huellaVersion, respuesta },
      (requestId) =>
        enviar<DecisionDetalle>(`/decisiones/${id}/papeletas`, {
          requestId,
          huellaVersion: decision.huellaVersion,
          respuesta,
        }),
    );
    if (resultado.estado === 'hecho') {
      setDecision(resultado.valor);
      setEnviado(true);
    } else if (resultado.estado === 'fallo') setErrorEnvio(resultado.error);
  }

  async function cerrar(): Promise<void> {
    setErrorCierre(undefined);
    const resultado = await ejecutar('cerrar', {}, (requestId) =>
      enviar(`/decisiones/${id}/cerrar`, { requestId }),
    );
    if (resultado.estado === 'hecho') router.push(`/decisiones/${id}/resultado`);
    else if (resultado.estado === 'fallo') setErrorCierre(resultado.error);
  }

  // Mismo callejón que había en el detalle de un problema: el aviso solo, sin reintento ni vuelta.
  if (error !== undefined) {
    return (
      <div className="pagina-prosa">
        <h1>No pudimos abrir esta decisión</h1>
        <ErrorVisible error={error} />
        <p>
          <button className="boton" type="button" onClick={recargar}>
            Volver a intentar
          </button>{' '}
          <Link className="boton secundario" href="/decisiones">
            Ver todas las decisiones
          </Link>
        </p>
      </div>
    );
  }
  if (decision === undefined) {
    return (
      <div className="pagina-prosa">
        <Cargando que="la decisión" />
      </div>
    );
  }

  /**
   * Qué papeleta le toca a este método.
   *
   * Antes esto era `decision.metodo === 'sociocratic-consent'`, y todo lo que no fuera eso recibía
   * el sí/no. Con dos métodos en el sistema la simplificación era exacta; con nueve dejó de serlo y
   * pasó a ser un error que sólo se ve al enviar: una votación de deliberación aleatoria —donde
   * **nadie llena una papeleta**— mostraba «¿Estás de acuerdo con este texto?», y cualquier
   * respuesta se estrellaba contra el motor, que para ese método no admite ninguna clase de
   * papeleta. Ahora la papeleta la decide el método, en un solo sitio y con las cuatro salidas
   * posibles dichas. Ver `../metodos-en-palabras.ts`.
   */
  const formulario = enPalabras(decision.metodo).formulario;
  const consentimiento = formulario === 'consentimiento';
  const cerrada = decision.estado !== 'Open';

  return (
    <div className="pagina-detalle">
      <h1>{decision.titulo}</h1>

      {/*
       * El carril de estado: lo que hace falta saber antes de leer el texto —si sigue abierta,
       * cuánto falta, quiénes ya se manifestaron y qué hace falta para que esto pase— y el botón
       * de la acción que le toca a quien mira: ir al resultado si ya cerró, o cerrarla si es quien
       * cuida el procedimiento. La respuesta en sí (la papeleta) es demasiado trabajo para un
       * carril angosto y se queda en el cuerpo, junto al texto que responde.
       */}
      <aside className="carril-estado" aria-label="Estado de la votación">
        <Ficha variante={cerrada ? 'neutra' : 'en-curso'}>
          {cerrada ? 'Cerrada' : 'En votación'}
        </Ficha>
        {!cerrada && <Plazo ms={decision.cierraEn} />}
        <Meta>
          {cerrada
            ? `Cerró el ${cuando(decision.cierraEn)}`
            : `Cierra el ${cuando(decision.cierraEn)}`}
        </Meta>

        {/*
         * Este `<h2>` se perdió al mover «qué hace falta para que esto pase» al carril de estado
         * durante el rediseño (dc6095d): quedó un párrafo suelto sin nada que diga de qué habla.
         * Es la regla que decide la votación —PRODUCT.md §4 exige que vaya SIEMPRE en la
         * papeleta— y sin título es un párrafo cualquiera en un carril lleno de párrafos cortos.
         * `problemas/[id]` ya usa el mismo patrón —`<section aria-labelledby><h2>`— dentro del
         * mismo `.carril-estado`, así que no es una pieza nueva.
         */}
        <section aria-labelledby="regla-titulo">
          <h2 id="regla-titulo">Qué hace falta para que esto pase</h2>
          {/*
           * El nombre de la regla, antes de la regla. Faltaba: la pantalla explicaba con qué se
           * cuenta pero no decía cómo se llama eso, y sin el nombre nadie puede ir a leer en qué
           * casos conviene ni discutir en asamblea si era el que correspondía.
           */}
          <p className="suave">
            Se decide con <strong>{nombreDelMetodo(decision.metodo)}</strong>.
          </p>
          <p>{decision.queHaceFaltaParaQuePase}</p>
        </section>
        <Medidor
          etiqueta="Se manifestaron"
          valor={decision.seManifestaron}
          total={decision.podianDecidir}
          descripcion="la lista se cerró al abrir la votación y no cambia"
        />

        {cerrada && (
          <p>
            <Link className="boton secundario" href={`/decisiones/${id}/resultado`}>
              Ver el resultado y por qué salió eso
            </Link>
          </p>
        )}

        {sesion?.roles.includes('facilitator') && !cerrada && (
          <div>
            <p className="suave">
              Sólo hacelo cuando haya terminado el plazo. Si todavía no se puede cerrar, te vamos a
              decir por qué sin perder ninguna respuesta escrita.
            </p>
            <ErrorVisible error={errorCierre} />
            <button
              className="boton secundario"
              type="button"
              onClick={() => void cerrar()}
              disabled={enCurso !== undefined}
            >
              {enCurso === 'cerrar' ? 'Cerrando…' : 'Cerrar y publicar el resultado'}
            </button>
          </div>
        )}
      </aside>

      <div className="cuerpo-detalle">
        <section aria-labelledby="texto-titulo">
          <h2 id="texto-titulo">El texto que se está decidiendo</h2>
          <div className="version vigente">
            <p className="texto" style={{ whiteSpace: 'pre-wrap' }}>
              {decision.cuerpoVersion}
            </p>
          </div>
          <p className="suave">
            <Link href={`/propuestas/${decision.propuestaId}`}>
              Ver la propuesta completa y sus versiones anteriores
            </Link>
          </p>
        </section>

        <PlanEjecucionVisible plan={decision.plan} />

        <ErrorVisible error={errorEnvio} />
        {enviado && (
          <Aviso tipo="bien" titulo="Quedó registrado">
            Tu respuesta quedó registrada; por tu propio secreto de voto, esta pantalla no repite
            cuál elegiste, ni ahora ni si volvés más tarde. Podés cambiarla hasta que cierre:
            cambiar de opinión después de leer a los demás es una virtud, no una trampa. Vale la
            última.
          </Aviso>
        )}

        {!cerrada && !decision.puedoDecidir && (
          <Aviso tipo="atencion" titulo="No podés responder acá">
            {decision.motivoNoPuedo ?? 'No estabas en la lista de quienes podían decidir aquí.'}
            {sesion === undefined && (
              <>
                {' '}
                <Link href="/entrar">Entrar con el correo institucional</Link>.
              </>
            )}
          </Aviso>
        )}

        {!cerrada && decision.puedoDecidir && formulario === 'sin-papeleta' && (
          <Aviso tipo="atencion" titulo="Acá no hay nada que responder">
            {enPalabras(decision.metodo).queLlenaLaGente} Estás en la lista de quienes podían
            decidir, así que podés salir sorteada o sorteado: si sale tu nombre, te va a llegar el
            aviso y a partir de ahí la conversación sigue con ese grupo.
          </Aviso>
        )}

        {/*
         * El caso que antes terminaba en un rechazo del motor sin explicación: el método existe, el
         * motor lo cuenta, y la respuesta que pide no tiene todavía por dónde entrar. Se dice, con
         * la misma frase que usa la pantalla de abrir, en vez de ofrecer un sí/no que iba a fallar.
         */}
        {!cerrada && decision.puedoDecidir && formulario === 'todavia-no' && (
          <Aviso tipo="atencion" titulo="Esta votación todavía no se puede responder">
            {porQueTodaviaNo(decision.metodo)} Mientras tanto no se pierde nada: el texto y el plan
            siguen acá, y quien cuida el procedimiento puede cerrarla y volver a abrirla con una
            regla que sí se pueda responder.
          </Aviso>
        )}

        {!cerrada && (
          <ObjecionesEnPie
            decisionId={decision.id}
            objeciones={decision.objeciones}
            /*
             * La misma regla que aplica la ruta: facilita el procedimiento o garantías. Se comprueba
             * también acá, y no porque la interfaz decida nada —el servidor rechaza igual a quien no
             * corresponda— sino porque ofrecer un botón que va a fallar es peor que no ofrecerlo.
             */
            puedeDesestimar={
              sesion?.roles.some((rol) => rol === 'facilitator' || rol === 'guarantees') ?? false
            }
            alDesestimar={recargar}
          />
        )}

        {!cerrada && decision.puedoDecidir && (consentimiento || formulario === 'binaria') && (
          <form onSubmit={(e) => void responder(e)} noValidate>
            {consentimiento ? (
              <>
                <fieldset className="opciones">
                  <legend>¿Alguien objeta?</legend>
                  <p className="suave" id="ayuda-consentimiento">
                    No hace falta que a todos les guste; hace falta que nadie muestre un daño.
                  </p>
                  <div className="opcion">
                    <input
                      type="radio"
                      id="p-consent"
                      name="postura"
                      checked={postura === 'consent'}
                      onChange={() => {
                        setPostura('consent');
                      }}
                      aria-describedby="ayuda-consentimiento"
                    />
                    <label htmlFor="p-consent">
                      Sin objeción
                      <span className="explica">
                        No veo un daño al propósito común. No quiere decir que me encante.
                      </span>
                    </label>
                  </div>
                  <div className="opcion">
                    <input
                      type="radio"
                      id="p-concern"
                      name="postura"
                      checked={postura === 'concern'}
                      onChange={() => {
                        setPostura('concern');
                      }}
                      aria-describedby="ayuda-consentimiento"
                    />
                    <label htmlFor="p-concern">
                      Tengo una reserva
                      <span className="explica">
                        Queda escrita para que se tenga en cuenta, y no bloquea.
                      </span>
                    </label>
                  </div>
                  <div className="opcion">
                    <input
                      type="radio"
                      id="p-object"
                      name="postura"
                      checked={postura === 'object'}
                      onChange={() => {
                        setPostura('object');
                      }}
                      aria-describedby="ayuda-consentimiento"
                    />
                    <label htmlFor="p-object">
                      Objeto
                      <span className="explica">
                        Esto bloquea, y por eso hay que decir qué se daña y por qué.
                      </span>
                    </label>
                  </div>
                </fieldset>

                {postura === 'object' && (
                  <div id="detalle-objecion">
                    <div className="campo">
                      <label htmlFor="objetivo">¿Qué objetivo del grupo se daña?</label>
                      <span className="ayuda" id="ayuda-objetivo">
                        Una objeción señala un daño a lo que el grupo se propuso. Sin eso es una
                        preferencia, que se registra como reserva.
                      </span>
                      <input
                        id="objetivo"
                        type="text"
                        required
                        minLength={5}
                        aria-describedby="ayuda-objetivo"
                        value={objetivo}
                        onChange={(e) => {
                          setObjetivo(e.target.value);
                        }}
                      />
                    </div>
                    <div className="campo">
                      <label htmlFor="argumento">¿Por qué? Contá el daño concreto.</label>
                      <span className="ayuda" id="ayuda-argumento">
                        Mínimo 40 caracteres. Bloquear a la comunidad tiene que costar, como mínimo,
                        explicarse.
                      </span>
                      <textarea
                        id="argumento"
                        required
                        minLength={40}
                        aria-describedby="ayuda-argumento"
                        value={argumento}
                        onChange={(e) => {
                          setArgumento(e.target.value);
                        }}
                      />
                    </div>
                  </div>
                )}
              </>
            ) : (
              <fieldset className="opciones">
                <legend>¿Estás de acuerdo con este texto?</legend>
                <div className="opcion">
                  <input
                    type="radio"
                    id="b-si"
                    name="binario"
                    checked={binario === 'si'}
                    onChange={() => {
                      setBinario('si');
                    }}
                  />
                  <label htmlFor="b-si">Sí</label>
                </div>
                <div className="opcion">
                  <input
                    type="radio"
                    id="b-no"
                    name="binario"
                    checked={binario === 'no'}
                    onChange={() => {
                      setBinario('no');
                    }}
                  />
                  <label htmlFor="b-no">No</label>
                </div>
                <div className="opcion">
                  <input
                    type="radio"
                    id="b-abstengo"
                    name="binario"
                    checked={binario === 'abstengo'}
                    onChange={() => {
                      setBinario('abstengo');
                    }}
                  />
                  <label htmlFor="b-abstengo">
                    Me abstengo
                    <span className="explica">
                      Cuenta para la participación mínima, pero no para el «más síes que noes».
                    </span>
                  </label>
                </div>
              </fieldset>
            )}

            {decision.yaVotaste && !enviado && (
              <p className="suave">
                Ya respondiste esta votación. Por tu propio secreto de voto no repetimos acá cuál
                elegiste; si mandás otra, vale la última.
              </p>
            )}

            <button className="boton" type="submit" disabled={enCurso !== undefined}>
              {enCurso === 'papeleta'
                ? 'Enviando…'
                : decision.yaVotaste
                  ? 'Cambiar mi respuesta'
                  : 'Enviar mi respuesta'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
