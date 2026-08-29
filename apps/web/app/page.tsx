'use client';

/**
 * Inicio.
 *
 * ═══ El estado vacío ═══
 *
 * Es la pantalla más importante del producto y la que todos olvidan: es lo único que ve la comunidad
 * el primer día. Por eso aquí **no hay un tablero de ceros**. «0 problemas · 0 propuestas · 0
 * decisiones» comunica fracaso el día uno, y la gente que se va el día uno no vuelve el día dos.
 * En su lugar: el botón, una frase que dice que ser el primero es el punto, y tres ejemplos escritos
 * a mano para que nadie tenga que inventarse el formato de un problema desde cero.
 */

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

import type { Portada, SerieDeAcuerdos } from '@koinonia/contracts';

import { Aviso, BarraSesion, Cargando, ErrorVisible, useSesion } from '../components/marco';
import { Medidor, Meta, Tarjeta, Vacio } from '../components/piezas';
import { cerrarFrase, cuando, fechaCorta, fechaCortaEnFrase, plazo, traer } from '../lib/api';

const EJEMPLOS: readonly string[] = [
  'La sala de estudio cierra a las 6 y los de la nocturna no tenemos dónde leer.',
  'Los de primer semestre no sabemos qué leer ni en qué orden, y los PDF circulan por WhatsApp sin criterio.',
  'Se decidió hacer una carta hace cuatro meses y nadie sabe si se escribió.',
];

/**
 * Cuántas ventanas de treinta días pedimos para la serie de la portada.
 *
 * `GET /metricas/acuerdos/serie` acepta hasta 52; acá se piden seis (medio año) porque es lo que
 * entra legible en una fila de barras angosta de teléfono sin que cada barra quede más fina que el
 * dedo que la mira. No es el límite del contrato, es una elección de esta pantalla.
 */
const PUNTOS_DE_SERIE = 6;

/** El recorrido, para quien llega por primera vez y todavía no sabe qué se hace acá. */
const RECORRIDO_PUBLICO: readonly { readonly paso: string; readonly que: string }[] = [
  { paso: 'Escribís lo que está mal', que: 'sin votar nada todavía, y sin traer la solución' },
  {
    paso: 'Se discute con plazo',
    que: 'por etapas, y las objeciones quedan escritas, no borradas',
  },
  {
    paso: 'Se decide',
    que: 'con una regla dicha ANTES de abrir, no elegida después del resultado',
  },
  { paso: 'Alguien se hace cargo', que: 'lo aprobado se vuelve compromisos con nombre y fecha' },
  { paso: 'Y se ve si se hizo', que: 'que es la única medida que importa de verdad' },
];

/**
 * La presentación para quien llega sin cuenta.
 *
 * ═══ Por qué sólo para quien no entró ═══
 *
 * La portada tiene dos públicos incompatibles. Quien ya es miembro entra a ver qué le toca hoy: para
 * esa persona, media pantalla explicando qué es Koinonía es un estorbo que se lee una vez y molesta
 * doscientas. Quien llega por primera vez —el enlace que le pasaron por WhatsApp— no tiene ni idea
 * de qué es esto, y un tablero de decisiones ajenas no se lo dice.
 *
 * Así que se muestra a quien no tiene sesión y desaparece cuando la hay. No es una portada distinta
 * ni una ruta aparte: es la misma pantalla contestando la pregunta que cada quien trae.
 *
 * ═══ Lo que NO puede hacer ═══
 *
 * No puede repetir el enlace «Tengo un problema o una idea»: ya está arriba, y `01-gobernanza` lo
 * busca por su nombre para pulsarlo. Dos enlaces con el mismo nombre accesible dejarían esa prueba
 * sin saber cuál pulsar — y, antes que eso, dejarían a quien navega por voz con la misma duda.
 */
function Presentacion(): ReactNode {
  return (
    <>
      <section className="presenta-recorrido" aria-labelledby="pres-recorrido">
        <h2 id="pres-recorrido">Cómo funciona</h2>
        <ol className="pasos-publicos">
          {RECORRIDO_PUBLICO.map((etapa, indice) => (
            <li key={etapa.paso}>
              <span className="paso-numero" aria-hidden="true">
                {indice + 1}
              </span>
              <span className="paso-cuerpo">
                <strong>{etapa.paso}</strong>
                <span className="paso-detalle">{etapa.que}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="suave">
          Abrir una votación es el acto más caro del sistema, no el más barato: exige que antes haya
          habido discusión y evidencia.
        </p>
      </section>

      <section className="presenta-pilares" aria-labelledby="pres-pilares">
        <h2 id="pres-pilares">Por qué no es un formulario más</h2>
        <ul className="pilares">
          <li>
            <strong>Lo que pasó no se puede cambiar después.</strong> Cada cosa que se escribe queda
            encadenada a la anterior. Si alguien editara una sola palabra de algo de hace meses, la
            comprobación se pondría en rojo — incluida la de quien tiene la máquina.
          </li>
          <li>
            <strong>El resultado no se guarda: se vuelve a calcular.</strong> Cada vez que alguien
            pide el resultado de una votación, se cuenta otra vez desde las respuestas. Un número
            guardado es un número que se puede editar.
          </li>
          <li>
            <strong>Y no hace falta creernos.</strong> Cualquiera puede descargar la historia entera
            y recalcularla en su propia máquina, con un programa que no habla con este servidor.
          </li>
        </ul>
        <p>
          <Link href="/arquitectura" prefetch={false}>
            Quién es dueño de esto
          </Link>{' '}
          — por qué esa última frase se sostiene, y cómo participar sin pedirle permiso a nadie.
        </p>
      </section>
    </>
  );
}

/** Un punto ya traducido a lo que necesita dibujarse: su etiqueta, su valor (o nada) y su frase. */
type PuntoDeGrafico = {
  readonly etiqueta: string;
  readonly valor: number | undefined;
  readonly texto: string;
};

/**
 * Una serie temporal dibujada con `<div>` y CSS — cero dependencias, cero imágenes. ADR-0040/§6:
 * el nivel importa menos que la dirección, así que lo que hay que poder leer de un vistazo es
 * hacia dónde va la fila de barras, no el valor exacto de una sola.
 *
 * La barra es puramente decorativa (`aria-hidden`): la misma información, en palabras y completa,
 * vive al lado en una lista `.solo-lectores` — el mismo patrón de gemelo visual/leído que ya usa
 * `<Plazo>` en `piezas.tsx`. Un punto sin dato (ningún acuerdo vencía esa ventana) se dibuja como
 * una línea plana y atenuada, nunca como una barra en cero que se leería como «fracasó».
 *
 * La versión anterior traía las trece declaraciones de forma en `style={{…}}` y se disculpaba en
 * este mismo comentario: «ninguna clase nueva en globals.css (que no es mío para tocar)». Ya lo es,
 * y estaban de más: la forma vive en `.serie` (ver `globals.css`) y acá queda **sólo el alto de
 * cada barra**, que es lo único que depende del dato y por tanto lo único que no puede ser una
 * clase. Importa más de lo que parece: un color escrito a mano en un `style` no lo revisa el
 * fichero donde están medidos todos los contrastes, y en un fichero de 2.200 líneas de dirección
 * de arte, lo que se dibuja aparte se despinta aparte.
 */
function GraficoDeSerie({
  titulo,
  puntos,
  max,
}: {
  readonly titulo: string;
  readonly puntos: readonly PuntoDeGrafico[];
  readonly max: number;
}): ReactNode {
  const primero = puntos[0];
  const ultimo = puntos[puntos.length - 1];
  return (
    <div>
      <div className="serie" aria-hidden="true">
        {puntos.map((punto, indice) => (
          <div className="serie-hueco" key={indice}>
            <div
              className={punto.valor === undefined ? 'serie-barra sin-dato' : 'serie-barra'}
              style={
                punto.valor === undefined
                  ? undefined
                  : { height: `${String(Math.max(2, Math.round((punto.valor / max) * 100)))}%` }
              }
            />
          </div>
        ))}
      </div>
      {primero !== undefined && ultimo !== undefined && (
        <p className="suave serie-extremos" aria-hidden="true">
          <span>{primero.etiqueta}</span>
          <span>{ultimo.etiqueta}</span>
        </p>
      )}
      <ul className="solo-lectores">
        <li>{titulo}, de la ventana más antigua a la más reciente:</li>
        {puntos.map((punto, indice) => (
          <li key={indice}>
            {punto.etiqueta}: {punto.texto}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Inicio(): ReactNode {
  const [portada, setPortada] = useState<Portada | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  // Sólo decide si se muestra la presentación. Nunca decide si algo se PUEDE hacer: eso lo vuelve a
  // exigir el servidor en cada orden, y así está escrito en el propio `useSesion`.
  const { sesion, cargando } = useSesion();

  // Independiente de `/portada`: es una segunda llamada, a una ruta que ya tiene sus propias 92
  // pruebas contra `@koinonia/metrics`. Si esta falla, la portada entera no tiene por qué caerse
  // con ella —ver el aviso propio más abajo—, así que lleva su propio par de estados.
  const [serieAcuerdos, setSerieAcuerdos] = useState<SerieDeAcuerdos | undefined>(undefined);
  const [errorSerie, setErrorSerie] = useState<unknown>(undefined);

  useEffect(() => {
    traer<Portada>('/portada').then(setPortada).catch(setError);
  }, []);

  useEffect(() => {
    traer<SerieDeAcuerdos>(`/metricas/acuerdos/serie?puntos=${String(PUNTOS_DE_SERIE)}`)
      .then(setSerieAcuerdos)
      .catch(setErrorSerie);
  }, []);

  // El punto vigente es el último de la serie: misma ventana de treinta días que ya usa
  // `GET /metricas/salud`, sólo que acá viene como el punto final de la serie en vez de una
  // segunda llamada aparte.
  const ultimoAcuerdos = serieAcuerdos?.puntos[serieAcuerdos.puntos.length - 1];

  const puntosCumplimiento: readonly PuntoDeGrafico[] =
    serieAcuerdos?.puntos.map((punto) => {
      const c = punto.total.cumplimiento;
      return {
        etiqueta: fechaCorta(punto.ventana.hasta),
        valor: c.hay ? Math.round((c.numerador / c.denominador) * 100) : undefined,
        texto: c.hay
          ? `cumplimiento del ${c.texto} (${String(c.numerador)} de ${String(c.denominador)})`
          : 'no vencía ningún compromiso en esa ventana',
      };
    }) ?? [];

  const puntosDeuda: readonly PuntoDeGrafico[] =
    serieAcuerdos?.puntos.map((punto) => ({
      etiqueta: fechaCorta(punto.ventana.hasta),
      valor: punto.total.deuda,
      texto:
        punto.total.deuda === 0
          ? 'sin compromisos vencidos sin cerrar'
          : `${String(punto.total.deuda)} ${
              punto.total.deuda === 1
                ? 'compromiso vencido sin cerrar'
                : 'compromisos vencidos sin cerrar'
            }`,
    })) ?? [];
  // Sin tope natural en 100, a diferencia del cumplimiento: la escala de la fila de barras es
  // relativa a lo peor que muestra la propia serie, nunca a un máximo inventado.
  const maxDeuda = Math.max(1, ...puntosDeuda.map((punto) => punto.valor ?? 0));

  return (
    <div className="pagina-indice">
      <h1>Koinonía</h1>
      <BarraSesion />

      <p className="lede">
        Acá se escribe lo que está mal, se discute con plazo y se decide dejando constancia que
        cualquiera puede comprobar. No hay muro, no hay seguidores y no hay nadie decidiendo qué
        ves.
      </p>

      <p>
        <Link className="boton grande" href="/problemas/nuevo">
          Tengo un problema o una idea
        </Link>
      </p>

      {/*
       * La presentación va acá —después del botón y antes de los datos— y sólo para quien no entró.
       * `!cargando` y no sólo `sesion === undefined`: sin esa condición, un miembro con sesión vería
       * el folleto durante los ~100 ms que tarda `/auth/estado` y luego lo vería desaparecer, que es
       * peor que no mostrarlo. Quien llega sin cuenta —el caso que esto atiende— lo ve igual, un
       * parpadeo después, junto con el resto de la pantalla.
       */}
      {!cargando && sesion === undefined && <Presentacion />}

      <ErrorVisible error={error} />

      {/* Un esqueleto con la forma real —no una línea suelta— para que el pie de página no quede
          pegado al título mientras la petición está en vuelo, ni todo el contenido se abra de
          golpe cuando responda. */}
      {portada === undefined && error === undefined && (
        <>
          <div className="aviso atencion" aria-hidden="true">
            <div className="esqueleto-linea esqueleto-titulo" />
            <div className="esqueleto-linea" style={{ width: '80%' }} />
          </div>
          <section aria-hidden="true">
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
          </section>
          <div className="solo-lectores">
            <Cargando que="la portada" />
          </div>
        </>
      )}

      {portada?.primerDia === true && (
        <section className="vacio" aria-labelledby="vacio-titulo">
          <h2 id="vacio-titulo">Todavía no hay nada acá</h2>
          <p>
            Lo primero que se escriba va a ser el primer problema del Instituto. No hace falta que
            esté bien redactado ni que traigas la solución: para eso está el resto.
          </p>
          <p>Tres ejemplos, por si ayuda a arrancar:</p>
          <ul>
            {EJEMPLOS.map((ejemplo) => (
              <li key={ejemplo}>«{ejemplo}»</li>
            ))}
          </ul>
        </section>
      )}

      {portada !== undefined && !portada.primerDia && (
        <>
          {portada.loQueTeToca !== undefined && (
            <section aria-labelledby="toca-titulo">
              <h2 id="toca-titulo">Lo que te toca a vos</h2>
              <div className="aviso atencion" role="status">
                <p>
                  <strong>{portada.loQueTeToca.que}</strong>
                </p>
                {portada.loQueTeToca.cierraEn !== undefined && (
                  <p>
                    {plazo(portada.loQueTeToca.cierraEn)} —{' '}
                    {cerrarFrase(cuando(portada.loQueTeToca.cierraEn))}
                  </p>
                )}
                <p>
                  <Link className="boton accion" href={portada.loQueTeToca.enlace}>
                    Ir a responder
                  </Link>
                </p>
              </div>
              <p className="suave">
                Una sola cosa a la vez. Si hubiera más, te avisamos de la que cierra primero.
              </p>
            </section>
          )}

          {/*
           * Métrica 1 de `@koinonia/metrics` (ADR-0040/§6): «lo que se decide, ¿se hace?». Es
           * independiente de `/portada` a propósito —su propia carga, su propio error— para que
           * un fallo acá nunca tumbe el resto de la pantalla, que es la parte que de verdad
           * importa el primer minuto. Ningún número de este bloque es de una persona: son conteos
           * del colectivo (cuántos compromisos, no quién los cumplió), como exige ADR-0039/0040.
           */}
          <section aria-labelledby="acuerdos-titulo">
            <h2 id="acuerdos-titulo">Lo que se decide, ¿se hace?</h2>
            <p className="suave">
              De los compromisos que vencían en cada período de treinta días, cuántos se cumplieron.
              Es la medida principal: si decidir no cambia nada, todo lo demás es decorado.
            </p>

            {serieAcuerdos === undefined && errorSerie === undefined && (
              <>
                <div className="esqueleto-linea esqueleto-titulo" style={{ width: '35%' }} />
                <div
                  className="esqueleto-linea"
                  style={{ height: '5rem', marginTop: 'var(--e3)' }}
                />
                <div className="solo-lectores">
                  <Cargando que="el cumplimiento de acuerdos" />
                </div>
              </>
            )}

            {errorSerie !== undefined && (
              <Aviso tipo="atencion" titulo="No pudimos traer esta cifra">
                El resto de la portada sigue sirviendo igual. Volvé a cargar la página para
                intentarlo de nuevo.
              </Aviso>
            )}

            {ultimoAcuerdos !== undefined && (
              <>
                {ultimoAcuerdos.bajoLaMitad && (
                  <Aviso tipo="atencion" titulo="Menos de la mitad se cumplió">
                    En el último período, menos de la mitad de los compromisos vencidos llegaron a
                    cerrarse. Si esto se sostiene, decidir acá no está sirviendo para nada.
                  </Aviso>
                )}

                {ultimoAcuerdos.total.cumplimiento.hay ? (
                  <Medidor
                    etiqueta="Compromisos cumplidos"
                    valor={ultimoAcuerdos.total.cumplimiento.numerador}
                    total={ultimoAcuerdos.total.cumplimiento.denominador}
                    descripcion="de los que vencían en el último período de treinta días"
                  />
                ) : (
                  <p>Todavía no venció ningún compromiso en el último período.</p>
                )}

                <p>
                  {ultimoAcuerdos.total.deuda === 0
                    ? 'No hay compromisos vencidos que sigan abiertos.'
                    : `Hay ${String(ultimoAcuerdos.total.deuda)} ${
                        ultimoAcuerdos.total.deuda === 1
                          ? 'compromiso vencido que sigue abierto'
                          : 'compromisos vencidos que siguen abiertos'
                      }.`}
                  {ultimoAcuerdos.total.conRelojDetenido > 0 && (
                    <>
                      {' '}
                      {ultimoAcuerdos.total.conRelojDetenido === 1
                        ? 'Uno más avisó que estaba bloqueado o pidió ayuda'
                        : `${String(ultimoAcuerdos.total.conRelojDetenido)} más avisaron que estaban bloqueados o pidieron ayuda`}
                      , y no cuenta como incumplido: el plazo se detiene en cuanto se avisa.
                    </>
                  )}
                </p>

                <GraficoDeSerie
                  titulo="Cumplimiento por período"
                  puntos={puntosCumplimiento}
                  max={100}
                />

                <p className="suave" style={{ marginTop: 'var(--e5)' }}>
                  Y la deuda misma, período a período — acá importa menos el nivel que si sube o
                  baja:
                </p>
                <GraficoDeSerie
                  titulo="Compromisos vencidos sin cerrar, por período"
                  puntos={puntosDeuda}
                  max={maxDeuda}
                />
              </>
            )}
          </section>

          <section aria-labelledby="abiertas-titulo">
            <h2 id="abiertas-titulo">Decisiones abiertas</h2>
            {portada.decisionesAbiertas.length === 0 ? (
              <Vacio
                titulo="No hay ninguna decisión abierta"
                salida={{ href: '/problemas', texto: 'Ver los problemas' }}
              >
                <p>
                  <strong>Así debe ser la mayoría del tiempo:</strong> si hay más de tres por
                  semana, algo está mal en cómo estamos decidiendo.
                </p>
              </Vacio>
            ) : (
              <ul className="tarjetas">
                {portada.decisionesAbiertas.map((decision) => (
                  <Tarjeta
                    key={decision.id}
                    titulo={decision.titulo}
                    enlace={`/decisiones/${decision.id}`}
                  >
                    <Meta>{plazo(decision.cierraEn)}</Meta>
                    <Medidor
                      etiqueta="Se manifestaron"
                      valor={decision.seManifestaron}
                      total={decision.podianDecidir}
                    />
                  </Tarjeta>
                ))}
              </ul>
            )}
          </section>

          {portada.ultimasCerradas.length > 0 && (
            <section aria-labelledby="cerradas-titulo">
              <h2 id="cerradas-titulo">Últimas cerradas</h2>
              <ul className="tarjetas">
                {portada.ultimasCerradas.map((decision) => (
                  <Tarjeta
                    key={decision.id}
                    titulo={decision.titulo}
                    enlace={`/decisiones/${decision.id}/resultado`}
                  >
                    <Meta>
                      <time
                        dateTime={new Date(decision.cierraEn).toISOString()}
                        title={cuando(decision.cierraEn)}
                      >
                        Cerró {fechaCortaEnFrase(decision.cierraEn)}
                      </time>
                    </Meta>
                  </Tarjeta>
                ))}
              </ul>
            </section>
          )}

          {portada.iniciativasActivas > 0 && (
            <section aria-labelledby="iniciativas-titulo">
              <h2 id="iniciativas-titulo">Cambios por seguir</h2>
              <p>
                Hay {portada.iniciativasActivas}{' '}
                {portada.iniciativasActivas === 1
                  ? 'iniciativa por revisar'
                  : 'iniciativas por revisar'}
                . <Link href="/iniciativas">Ver los acuerdos y cómo se comprobarán</Link>.
              </p>
            </section>
          )}

          {/*
           * Los dos números llevan cada uno a su índice. Antes esta frase contaba las propuestas y
           * el único enlace era «Verlos todos» a `/problemas`: se nombraba una pantalla que existía
           * y no se ofrecía la puerta, que es la forma más silenciosa de tener una pantalla
           * inalcanzable —peor que no nombrarla, porque quien lee sabe que está y no encuentra
           * cómo llegar—.
           */}
          <p>
            Hay{' '}
            <Link href="/problemas">
              {portada.problemas}{' '}
              {portada.problemas === 1 ? 'problema escrito' : 'problemas escritos'}
            </Link>{' '}
            y{' '}
            <Link href="/propuestas">
              {portada.propuestas} {portada.propuestas === 1 ? 'propuesta' : 'propuestas'}
            </Link>
            .
          </p>
        </>
      )}
    </div>
  );
}
