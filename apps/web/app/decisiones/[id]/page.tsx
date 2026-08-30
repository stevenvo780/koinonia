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
 *
 * ═══ Puntuar, ordenar y valorar por menciones ═══
 *
 * Los otros tres formularios que dibuja esta pantalla —puntuación, orden de preferencia y valoración
 * por menciones— cargan una honestidad propia: hoy toda decisión se abre sobre un único texto
 * (`abrirDecision` en `service.ts` construye `options: [optionId(propuestaId)]`), así que puntuar y
 * valorar por menciones puntúan y valoran ESE texto —tiene sentido por sí solo, y por eso se dibujan
 * sin aviso—, pero ordenar no puede ofrecer más que confirmar que se prefiere ese texto a no
 * responder nada, y la pantalla lo dice así en vez de simular una elección que todavía no existe.
 * `../abrir` no deja ABRIR una votación nueva con estos cuatro métodos —comparan varias salidas, y
 * con una sola el resultado ya se sabría de antemano—, pero una decisión así puede existir igual (una
 * ya abierta desde antes de esa regla, o abierta por fuera de esta pantalla), y por eso esta pantalla
 * sí sabe responderla: negarle la papeleta a un voto que el motor cuenta de verdad sería peor que el
 * caso raro que evita.
 *
 * Ninguna de las tres manda `null` para «sin opinión»: el historial lo prohíbe (`packages/crypto`,
 * A.1.1.2). La opción que no aparece en la lista es la que no tiene opinión — ver `responder` más
 * abajo y `payloadDePapeleta` en `services/api/src/http/service.ts`.
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
import { enPalabras, nombreDelMetodo } from '../metodos-en-palabras';

type Postura = 'consent' | 'concern' | 'object';
type Binario = 'si' | 'no' | 'abstengo';
/** «» significa «sin opinión»: una declaración válida de la papeleta de puntuación, no una casilla
 *  vacía — se manda como lista sin esa opción, nunca como un valor nulo. */
type PuntuacionElegida = '' | '0' | '1' | '2' | '3' | '4' | '5';

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
  // '' es «sin opinión» para puntuar: una declaración válida (queda fuera del cálculo), no una
  // casilla que alguien olvidó llenar.
  const [puntuacion, setPuntuacion] = useState<PuntuacionElegida>('');
  // '' sólo dura hasta que la decisión carga: el efecto de más abajo la fija en la primera mención
  // de la escala apenas hay una escala que mirar, así que siempre hay una elegida para enviar.
  const [mencion, setMencion] = useState('');
  /*
   * El consejo. Arranca sin postura elegida a propósito, por lo mismo que la mención: preseleccionar
   * «a favor» convertiría «no toqué nada» en «me pareció bien», y acá lo que se registra es lo que
   * alguien piensa, no lo que el formulario traía puesto.
   */
  const [posturaConsejo, setPosturaConsejo] = useState('');
  const [razonesConsejo, setRazonesConsejo] = useState('');

  const recargar = useCallback(() => {
    setError(undefined);
    traer<DecisionDetalle>(`/decisiones/${id}`).then(setDecision).catch(setError);
  }, [id]);

  useEffect(recargar, [recargar]);

  /*
   * NO se preselecciona ninguna mención, y el motivo merece quedar escrito porque antes SÍ se
   * preseleccionaba y se argumentaba bien.
   *
   * El argumento era: `missingGradePolicy` rechaza por defecto la papeleta entera si falta una
   * mención (B.7.b), y ese rechazo es cierto pero inútil para quien sólo se olvidó de tocar un
   * botón; así que dejar elegida la primera de la escala evita el problema en la raíz, igual que
   * «Sí» arranca elegido en la papeleta binaria.
   *
   * El paralelo con «Sí» es lo que no se sostiene. Una papeleta binaria ofrece dos respuestas
   * simétricas, y «Sí» es la postura que la propuesta ya defiende. Una escala de menciones está
   * ORDENADA: tiene una mejor y una peor, y `escalaDeMenciones[0]` es la mejor. Preseleccionarla
   * convierte «se me olvidó tocar un botón» en «le di la calificación más alta», en una votación,
   * en un historial que no se puede corregir. Un rechazo que la persona ve y arregla es mejor que
   * un voto máximo que nunca quiso emitir.
   *
   * Y el rechazo tampoco llega a pasar: el botón de enviar está bloqueado mientras no haya mención
   * elegida (ver más abajo), así que la papeleta incompleta ni sale. Eso cubre de paso el caso en
   * que la escala no cargue —sin escala no hay nada que elegir, luego `mencion` sigue vacía y el
   * botón sigue bloqueado—, que antes mandaba `menciones: []` y traía un 422 desconcertante.
   */

  async function responder(evento: SyntheticEvent): Promise<void> {
    evento.preventDefault();
    setErrorEnvio(undefined);
    setEnviado(false);
    if (decision === undefined) return;
    const formularioDeEsteMetodo = enPalabras(decision.metodo).formulario;
    const respuesta =
      formularioDeEsteMetodo === 'consentimiento'
        ? {
            tipo: 'consent' as const,
            postura,
            ...(postura === 'object' ? { objecion: { argumento, objetivoDanado: objetivo } } : {}),
          }
        : formularioDeEsteMetodo === 'puntuacion'
          ? {
              tipo: 'score' as const,
              // La única opción de hoy es la propuesta misma: `abrirDecision` la registra con ese
              // mismo identificador (`optionId(propuestaId)`). «Sin opinión» es la lista VACÍA, no
              // un valor nulo — el historial no admite `null` (A.1.1.2) y una opción ausente de la
              // lista ya significa exactamente eso.
              puntuaciones:
                puntuacion === ''
                  ? []
                  : [{ opcion: decision.propuestaId, valor: Number(puntuacion) }],
            }
          : formularioDeEsteMetodo === 'menciones'
            ? {
                tipo: 'grades' as const,
                menciones: mencion === '' ? [] : [{ opcion: decision.propuestaId, mencion }],
              }
            : formularioDeEsteMetodo === 'ordenamiento'
              ? {
                  tipo: 'ranking' as const,
                  // Hoy la decisión tiene una sola opción: el único orden posible es ésa.
                  orden: [decision.propuestaId],
                }
              : formularioDeEsteMetodo === 'consejo' && decision.procesoDeConsejo?.decidoYo !== true
                ? {
                    tipo: 'advice' as const,
                    postura: posturaConsejo as 'a-favor' | 'en-contra' | 'matiz',
                    razones: razonesConsejo,
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
   * el sí/no. Con dos métodos en el sistema la simplificación era exacta; con nueve dejó de serlo:
   * una votación de deliberación aleatoria —donde **nadie llena una papeleta**— mostraba «¿Estás de
   * acuerdo con este texto?», y cualquier respuesta se estrellaba contra el motor, que para ese
   * método no admite ninguna clase de papeleta. Ahora la papeleta la decide el método, en un solo
   * sitio y con las seis formas posibles dichas. Ver `../metodos-en-palabras.ts`.
   */
  const formulario = enPalabras(decision.metodo).formulario;
  const consentimiento = formulario === 'consentimiento';
  /**
   * Si esta papeleta es de menciones y todavía no hay ninguna elegida.
   *
   * Vale también cuando la escala no cargó: sin escala no hay botones que tocar, así que `mencion`
   * se queda vacía y el envío sigue bloqueado en vez de mandar `menciones: []` y volver con un 422
   * que no le dice nada a nadie. Ver el bloque largo junto a los `useState` de la papeleta.
   */
  const faltaLaMencion = formulario === 'menciones' && mencion === '';
  /**
   * Si esta papeleta es un consejo y todavía le falta algo.
   *
   * Bloquear acá no reemplaza al servidor —`validateBallot` exige lo mismo y quien llame por otra
   * puerta pasa por él igual—, pero ofrecer un botón que va a rebotar es peor que no ofrecerlo. El
   * mínimo de 40 caracteres es el del motor (`MIN_LARGO_DEL_CONSEJO`), no un número de esta pantalla.
   */
  const faltaElConsejo =
    formulario === 'consejo' &&
    decision.procesoDeConsejo?.decidoYo !== true &&
    (posturaConsejo === '' || razonesConsejo.trim().length < 40);
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
            Tu respuesta quedó registrada. Esta pantalla no la repite —ni ahora ni si volvés más
            tarde— para no dejarla a la vista de quien mire por encima de tu hombro; eso no la hace
            secreta, y arriba dice quién puede verla. Podés cambiarla hasta que cierre: cambiar de
            opinión después de leer a los demás es una virtud, no una trampa. Vale la última.
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

        {!cerrada && decision.puedoDecidir && formulario !== 'sin-papeleta' && (
          <Aviso tipo="atencion" titulo="Antes de responder: tu voto no es secreto">
            <p>
              Toda votación de esta plataforma es <strong>a mano alzada</strong>. Queda escrito qué
              respondiste y quién sos, y cualquiera que se descargue la copia de lo que pasó acá
              —que se descarga sin permiso de nadie, y así tiene que ser para poder comprobarla—
              puede leer las dos cosas juntas.
            </p>
            <p>
              No aparece tu nombre, sino el código que te identifica acá; pero es siempre el mismo
              en todo lo que hacés, así que en un instituto de este tamaño no cuesta atarlo a una
              persona. Damos por hecho que se puede.
            </p>
            <p>
              <strong>
                Si el tema es delicado, o creés que alguien podría presionarte por lo que votes,
                decilo antes de votar: hay cosas que todavía deben decidirse en papel.
              </strong>{' '}
              El motor se niega a abrir una votación prometiendo secreto justamente para no prometer
              lo que hoy no puede cumplir.
            </p>
          </Aviso>
        )}

        {!cerrada && decision.puedoDecidir && formulario !== 'sin-papeleta' && (
          <form onSubmit={(e) => void responder(e)} noValidate>
            {consentimiento && (
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
            )}

            {formulario === 'consejo' && decision.procesoDeConsejo !== undefined && (
              <>
                {decision.procesoDeConsejo.decidoYo ? (
                  <>
                    <p className="suave">
                      Acá decidís vos. Van {decision.procesoDeConsejo.consejosDados} consejos de las{' '}
                      {decision.procesoDeConsejo.consejosMinimos} personas que hacen falta escuchar.
                      {decision.procesoDeConsejo.consejosDados <
                      decision.procesoDeConsejo.consejosMinimos
                        ? ' Todavía no podés cerrar: falta que te aconsejen.'
                        : ' Ya podés decidir. El consejo no te ata: podés resolver en contra de lo' +
                          ' que te dijeron, y eso está permitido.'}
                    </p>
                    <fieldset className="opciones">
                      <legend>¿Qué resolvés?</legend>
                      {(
                        [
                          ['si', 'Sí, se hace'],
                          ['no', 'No se hace'],
                        ] as const
                      ).map(([valor, etiqueta]) => (
                        <div className="opcion" key={valor}>
                          <input
                            type="radio"
                            id={`resuelvo-${valor}`}
                            name="resuelvo"
                            checked={binario === valor}
                            onChange={() => {
                              setBinario(valor);
                            }}
                          />
                          <label htmlFor={`resuelvo-${valor}`}>{etiqueta}</label>
                        </div>
                      ))}
                    </fieldset>
                  </>
                ) : (
                  <>
                    <p className="suave">
                      Acá no se vota: decide una persona, y sólo después de escuchar. Lo que vos
                      dejás es un consejo — y lo que decida no te va a atar a vos ni vos a ella.
                      {decision.procesoDeConsejo.yaAconseje
                        ? ' Ya dejaste el tuyo; si lo mandás otra vez, vale el último.'
                        : ''}
                    </p>
                    <fieldset className="opciones">
                      <legend>¿Qué le decís?</legend>
                      {(
                        [
                          ['a-favor', 'Me parece bien'],
                          ['en-contra', 'Me parece mal'],
                          ['matiz', 'Bien, pero con matices'],
                        ] as const
                      ).map(([valor, etiqueta]) => (
                        <div className="opcion" key={valor}>
                          <input
                            type="radio"
                            id={`consejo-${valor}`}
                            name="consejo"
                            checked={posturaConsejo === valor}
                            onChange={() => {
                              setPosturaConsejo(valor);
                            }}
                          />
                          <label htmlFor={`consejo-${valor}`}>{etiqueta}</label>
                        </div>
                      ))}
                    </fieldset>
                    <div className="campo">
                      <label htmlFor="razones-consejo">¿Por qué? Contá tus razones.</label>
                      <span className="ayuda" id="ayuda-consejo">
                        Mínimo 40 caracteres. Sin razones no es un consejo, es un voto disfrazado —
                        y acá no se vota. Lo único que puede cambiarle la cabeza a quien decide es
                        tu porqué.
                      </span>
                      <textarea
                        id="razones-consejo"
                        required
                        minLength={40}
                        aria-describedby="ayuda-consejo"
                        value={razonesConsejo}
                        onChange={(e) => {
                          setRazonesConsejo(e.target.value);
                        }}
                      />
                    </div>
                  </>
                )}
              </>
            )}

            {formulario === 'binaria' && (
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

            {formulario === 'puntuacion' && (
              <fieldset className="opciones">
                <legend>¿Qué nota le ponés a este texto?</legend>
                <p className="suave" id="ayuda-puntuacion">
                  De 0 a 5. Dejarlo en «sin opinión» no cuenta como un cero: queda fuera del
                  cálculo.
                </p>
                {(['0', '1', '2', '3', '4', '5'] as const).map((nota) => (
                  <div className="opcion" key={nota}>
                    <input
                      type="radio"
                      id={`puntuacion-${nota}`}
                      name="puntuacion"
                      checked={puntuacion === nota}
                      onChange={() => {
                        setPuntuacion(nota);
                      }}
                      aria-describedby="ayuda-puntuacion"
                    />
                    <label htmlFor={`puntuacion-${nota}`}>{nota}</label>
                  </div>
                ))}
                <div className="opcion">
                  <input
                    type="radio"
                    id="puntuacion-sin-opinion"
                    name="puntuacion"
                    checked={puntuacion === ''}
                    onChange={() => {
                      setPuntuacion('');
                    }}
                    aria-describedby="ayuda-puntuacion"
                  />
                  <label htmlFor="puntuacion-sin-opinion">Sin opinión</label>
                </div>
              </fieldset>
            )}

            {formulario === 'menciones' && (
              <fieldset className="opciones">
                <legend>¿Qué mención le ponés a este texto?</legend>
                {decision.escalaDeMenciones === undefined ||
                decision.escalaDeMenciones.length === 0 ? (
                  // No debería pasar con una decisión abierta de verdad —la escala se congela al
                  // abrir—, pero fallar visible y no silencioso es mejor que dibujar botones vacíos.
                  <p className="suave">
                    Todavía no se pudo cargar la escala de menciones. Volvé a intentar en un rato.
                  </p>
                ) : (
                  decision.escalaDeMenciones.map((grado) => (
                    <div className="opcion" key={grado.id}>
                      <input
                        type="radio"
                        id={`mencion-${grado.id}`}
                        name="mencion"
                        checked={mencion === grado.id}
                        onChange={() => {
                          setMencion(grado.id);
                        }}
                      />
                      <label htmlFor={`mencion-${grado.id}`}>{grado.etiqueta}</label>
                    </div>
                  ))
                )}
              </fieldset>
            )}

            {formulario === 'ordenamiento' && (
              <p className="suave">
                Hoy esta votación tiene un solo texto sobre la mesa, así que tu papeleta sólo dice
                que lo preferís a no responder nada. El día que haya más de una salida entre las que
                elegir, acá vas a poder ordenarlas de la que más se prefiere a la que menos.
              </p>
            )}

            {decision.yaVotaste && !enviado && (
              <p className="suave">
                Ya respondiste esta votación. No repetimos acá cuál elegiste —para no dejarlo a la
                vista de quien pase—, que no es lo mismo que sea secreto: arriba dice quién puede
                verlo. Si mandás otra, vale la última.
              </p>
            )}

            {faltaLaMencion && (
              <p className="suave" id="falta-mencion">
                Elegí una mención para poder enviar tu respuesta.
              </p>
            )}
            {faltaElConsejo && (
              <p className="suave" id="falta-consejo">
                Elegí qué le decís y escribí tus razones (mínimo 40 caracteres) para poder enviarlo.
              </p>
            )}

            <button
              className="boton"
              type="submit"
              disabled={enCurso !== undefined || faltaLaMencion || faltaElConsejo}
              {...(faltaLaMencion ? { 'aria-describedby': 'falta-mencion' } : {})}
              {...(faltaElConsejo ? { 'aria-describedby': 'falta-consejo' } : {})}
            >
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
