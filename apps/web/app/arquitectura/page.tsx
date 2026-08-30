/**
 * «Quién es dueño de esto» — la pantalla que explica por qué no hace falta confiar en quien
 * administra el servidor.
 *
 * ═══ Por qué existe y por qué es una pantalla y no un documento ═══
 *
 * El proyecto entero se apoya en una afirmación incómoda: *este servidor es de una persona*. Si esa
 * frase no se dice y no se responde, todo lo demás —el historial que no se puede alterar, el
 * recuento que se recalcula, la constancia comprobable— se lee como marketing. Un documento en
 * `docs/` no la responde ante quien va a votar: la responde ante quien ya está programando.
 *
 * ═══ La regla de oro, aplicada al pie de la letra ═══
 *
 * `packages/contracts/src/glossary.ts` prohíbe en pantalla las palabras que exigen un curso:
 * «blockchain», «huella» en su forma técnica, «cripto», «participación mínima» en su forma latina,
 * y una docena más. Esta pantalla es justamente la que más tentación tiene de usarlas —habla de
 * anclaje, de firmas y de clases de independencia— y por eso es la que más las evita. Cada garantía
 * se dice por lo que hace, no por cómo se llama. Si acá se colara una sola, la prueba de jerga de
 * `tests/e2e` la encuentra.
 *
 * ═══ Lo que esta pantalla NO promete ═══
 *
 * No dice que hoy la ejecución esté repartida entre varios servidores, porque no lo está: eso no
 * está construido. Dice lo que sí es cierto —que la AUTORIDAD ya está repartida por diseño, que la
 * regla que lo sostiene es código con pruebas detrás, y que hoy falta gente, no software— y dice en
 * voz alta lo que falta. Una página que vendiera federación inexistente sería exactamente el tipo
 * de confianza falsa que este proyecto se pasa doce documentos evitando.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';

/*
 * El título de la pestaña NO va acá: va en `layout.tsx`, con `tituloDe(...)`, que es la convención
 * de las otras 33 pantallas. Declararlo dentro de `page.tsx` funciona en el navegador —se comprobó—
 * pero deja la ruta fuera de `tests/unit/titulos-de-pantalla.test.ts`, que lee las capas por fichero
 * (no puede importarlas: `apps/web` resuelve módulos de otra manera y el import rompería el
 * typecheck del repositorio entero). Una pantalla sin su capa hereda «Koinonía» a ojos de esa
 * prueba, que es justo la regresión que existe para impedir — dieciséis pestañas iguales.
 */

/**
 * El dibujo. Va en SVG dentro del marcado —no como imagen— por la misma razón que el resto del
 * proyecto no sirve ni un mapa de bits: pesa cero bytes de red y escala a cualquier pantalla.
 * `role="img"` con su título y su descripción para que quien no lo ve reciba lo mismo que dice el
 * dibujo, y no un hueco.
 */
function Dibujo(): ReactNode {
  return (
    <figure className="dibujo-testigos">
      <svg
        viewBox="0 0 720 320"
        role="img"
        aria-labelledby="dib-t dib-d"
        xmlns="http://www.w3.org/2000/svg"
      >
        <title id="dib-t">Cómo se reparte el testimonio</title>
        <desc id="dib-d">
          En el centro, este servidor, que cada cierto tiempo publica un resumen de todo lo que
          pasó. El diseño manda ese resumen a cuatro tipos de testigo independientes entre sí: un
          registro público mundial, dos copias del proyecto en sitios distintos, personas con buzón
          propio, y registros de terceros. Hoy sólo funciona el primero; los otros tres esperan a
          que haya gente que ponga su llave. Para que una constancia se dé por firme hacen falta dos
          testigos de tipos distintos, así que hoy ninguna lo está. Aparte, y sin hablar con el
          servidor, cualquiera puede descargar la historia entera y volver a calcularla en su propia
          máquina.
        </desc>

        {/*
         * La punta de flecha. El sentido del dibujo importa: el resumen sale DEL servidor HACIA los
         * testigos, no al revés. La primera versión dibujaba las líneas convergiendo hacia el
         * servidor y se leía como «los testigos le mandan algo», que es justo lo contrario de lo
         * que pasa y de lo que la página argumenta.
         */}
        <defs>
          <marker
            id="punta"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" className="d-punta" />
          </marker>
        </defs>

        <rect x="276" y="16" width="168" height="60" rx="10" className="d-servidor" />
        <text x="360" y="40" className="d-tt">
          Este servidor
        </text>
        <text x="360" y="60" className="d-tp">
          publica un resumen de todo
        </text>

        {[
          { x: 8, t: 'Registro público', s: 'mundial, no es de nadie' },
          { x: 186, t: 'Dos copias', s: 'del proyecto, aparte' },
          { x: 364, t: 'Personas', s: 'con su propio buzón' },
          { x: 542, t: 'Registros', s: 'de terceros' },
        ].map((c) => (
          <g key={c.t}>
            {/*
             * `String(...)` explícito y no interpolación directa: la configuración de lint de este
             * repositorio prohíbe meter un número en una plantilla de texto sin decirlo
             * (`restrict-template-expressions`).
             */}
            <path
              d={`M 360 76 L ${String(c.x + 85)} 132`}
              className="d-linea"
              markerEnd="url(#punta)"
            />
            <rect x={c.x} y={138} width="170" height="60" rx="10" className="d-testigo" />
            <text x={c.x + 85} y={162} className="d-tt">
              {c.t}
            </text>
            <text x={c.x + 85} y={180} className="d-tp">
              {c.s}
            </text>
          </g>
        ))}

        <text x="360" y="228" className="d-regla">
          para dar algo por firme: DOS de tipos distintos
        </text>

        {/*
         * El verificador va SUELTO, sin una sola línea que lo una al servidor. Ese hueco es el
         * argumento entero de la página dibujado: no hay flecha porque no hay conversación.
         */}
        <rect x="196" y="252" width="328" height="56" rx="10" className="d-verificador" />
        <text x="360" y="276" className="d-tt">
          Vos, en tu máquina
        </text>
        <text x="360" y="294" className="d-tp">
          recalculás la historia entera — sin hablar con el servidor
        </text>
      </svg>
      <figcaption>
        Para dar una constancia por firme no basta con que este servidor lo diga: hacen falta dos
        testigos de <strong>tipos distintos</strong>. Dos del mismo tipo no son dos testigos; son
        uno con dos nombres.
      </figcaption>
    </figure>
  );
}

export default function ArquitecturaPantalla(): ReactNode {
  return (
    <div className="pagina-prosa">
      <h1>Quién es dueño de esto</h1>

      <p className="lede">
        El servidor donde corre Koinonía hoy lo paga y lo administra una sola persona. Eso, dicho
        tal cual, es un problema — y es el problema que el sistema está construido para resolver.
      </p>

      <p>
        Una plataforma donde se vota tiene un punto débil que no arregla ninguna contraseña: quien
        administra la máquina puede cambiar un número. Puede borrar una objeción incómoda, mover una
        fecha, ajustar un resultado. La respuesta habitual es pedir confianza —«nosotros no haríamos
        eso»— y esa respuesta no vale nada, porque la daría igual quien sí lo haría.
      </p>

      <p>
        Acá la respuesta es otra: <strong>no hace falta creerme</strong>. No porque yo sea de fiar,
        sino porque el sistema está armado para que mi palabra no sea la que decide.
      </p>

      <h2>El testimonio se reparte, no se pide</h2>

      <p>
        Cada cierto tiempo, este servidor publica un resumen corto de <em>todo</em> lo que pasó
        hasta ese momento. Un resumen tan sensible que si alguien cambiara una sola letra de una
        sola propuesta escrita hace meses, el resumen saldría distinto.
      </p>

      <p>
        Ese resumen se manda afuera, a testigos que no dependen de mí. El diseño tiene cuatro tipos,
        elegidos justamente porque fallan de maneras distintas. Abajo, junto a cada uno, dice si hoy
        está funcionando: <strong>hoy funciona uno solo</strong>, y más abajo está el porqué.
      </p>

      <Dibujo />

      <dl className="tipos-testigo">
        <dt>
          Un registro público mundial <em className="anda">— funcionando</em>
        </dt>
        <dd>
          El resumen queda sellado en un registro que no es de nadie y que no se puede reescribir.
          Para desmentirlo habría que rehacer ese registro entero. Es el único que anda hoy, y por
          sí solo no alcanza: hace falta un segundo tipo.
        </dd>

        <dt>
          Dos copias del proyecto en sitios distintos <em className="no-anda">— apagado</em>
        </dt>
        <dd>
          El resumen se publica firmado en dos alojamientos independientes. Para desmentirlo habría
          que entrar en los dos y cuadrar la mentira en ambos. Está apagado porque no hay todavía un
          listado de quién puede firmar por la veeduría, y un listado vacío admitiría cualquier
          firma — incluida la mía, que es justo lo que esto tiene que impedir.
        </dd>

        <dt>
          Personas con su propio buzón <em className="no-anda">— apagado</em>
        </dt>
        <dd>
          El resumen llega por correo a varias personas de dominios distintos, que responden
          firmando con <strong>su</strong> propia llave. Para desmentirlo habría que conseguir que
          todas pierdan o entreguen su buzón. Está apagado porque nadie ha puesto su llave todavía.
        </dd>

        <dt>
          Registros de terceros <em className="no-anda">— apagado</em>
        </dt>
        <dd>
          Servicios ajenos que anotan, con fecha, que recibieron ese resumen. Todavía no hay ninguno
          dado de alta.
        </dd>
      </dl>

      <h2>La regla que lo sostiene, y que es código</h2>

      <div className="aviso atencion" role="status">
        <strong className="marca-aviso">
          <span aria-hidden="true">! </span>Lo importante:{' '}
        </strong>
        una firma hecha con una llave que vive <em>en este mismo servidor</em> nunca cuenta como
        testigo.
      </div>

      <p>
        Es la regla central y no es una promesa escrita en un documento: está en el programa, con
        pruebas que la comprueban. Y el motivo es sencillo. Si yo pudiera reescribir la historia y
        además firmar la versión falsa con una llave que tengo acá, mi firma no probaría nada:
        parecería una garantía sin serlo, que es peor que no tener ninguna.
      </p>

      <p>
        Por eso <strong>hacen falta dos testigos de tipos distintos</strong>. Dos confirmaciones del
        mismo tipo son un solo testigo con dos nombres. Y mientras no haya dos de tipos distintos,
        el estado público no es «bien, con una nota al pie»: es <strong>sin confirmar</strong>, con
        la fecha desde la que lo está. El sistema lo dice en voz alta en vez de fingir un visto
        bueno que no se ganó.
      </p>

      <h2>Cómo participás sin pedirme permiso</h2>

      <p>
        Esto es lo que hace que la propiedad no sea mía. No hay que pedirle acceso a nadie ni
        esperar a que yo lo autorice — de hecho, yo no puedo impedirlo:
      </p>

      <ol className="formas-participar">
        <li>
          <strong>Comprobalo por tu cuenta.</strong> Descargás la historia entera y la volvés a
          calcular en tu máquina, con un programa que <em>no habla con este servidor</em>. Si lo que
          te dio no coincide con lo que la pantalla dice, la que miente es la pantalla. Se hace
          desde{' '}
          <Link href="/verificar" prefetch={false}>
            la pantalla de comprobación
          </Link>
          .
        </li>
        <li>
          <strong>Sé testigo.</strong> Hace falta un buzón de correo y una llave propia, de las que
          ya usa cualquiera que suba código. No hay que instalar nada nuestro ni tener servidor: te
          llega el resumen, lo firmás con tu llave, y desde ese momento tu firma es una de las que
          hacen falta para que una constancia sea firme. <strong>La llave se queda con vos</strong>;
          si viviera acá, no contaría. Son diez minutos para empezar y{' '}
          <strong>un correo al día</strong> después; si un día no respondés, no se rompe nada.{' '}
          <a
            href="https://github.com/stevenvo780/koinonia/blob/main/docs/SER-TESTIGO.md"
            rel="noreferrer"
          >
            Acá está el procedimiento entero
          </a>
          , escrito para quien lo va a hacer y no para quien administra.
        </li>
        <li>
          <strong>Levantá tu propia copia.</strong> Todo el programa es libre, con una licencia que
          obliga a que cualquier mejora vuelva a la comunidad que la usa. Si mañana el Instituto
          quiere correr esto en sus propias máquinas, o alguien quiere montarlo para otra asamblea,
          no hay permiso que pedir ni empresa a la que llamar.
        </li>
      </ol>

      <h2>Lo que hoy falta, dicho sin adornos</h2>

      <p>
        La autoridad está repartida <em>por diseño</em>, y el programa que lo impone está escrito y
        probado. Pero hay dos cosas que todavía no son ciertas, y conviene decirlas acá y no
        descubrirlas después:
      </p>

      <ul>
        <li>
          <strong>Falta gente, no programa.</strong> Tres de los cuatro tipos de testigo están
          construidos y apagados, y por el mismo motivo: no hay listado de quién puede firmar. El de
          las personas espera llaves; el de las copias del proyecto espera el listado de la
          veeduría; el de registros de terceros, que se dé alguno de alta. Un listado vacío no se
          rellena solo y tampoco se puede dar por bueno: admitiría cualquier firma, incluida la mía,
          que es exactamente lo que esto existe para impedir.
          <br />
          Consecuencia, dicha sin rodeos: como hacen falta <strong>dos</strong> tipos distintos y
          hoy anda uno, <strong>ninguna constancia está firme todavía</strong>. La herramienta
          independiente lo dice en ámbar, y eso no es un fallo: es la única respuesta honesta hasta
          que alguien más ponga su llave.
        </li>
        <li>
          <strong>La ejecución todavía no está repartida.</strong> Hoy el programa corre en una sola
          máquina. Que varias facultades presten su cómputo y se repartan también la ejecución es a
          donde esto va, y para lo que está preparado el diseño, pero <em>no está hecho</em>. Lo que
          ya está repartido es lo que decide si se puede confiar en el resultado, que es la parte
          que importa primero.
        </li>
      </ul>

      <p>
        Prometer lo segundo como si ya existiera sería el tipo exacto de confianza falsa que todo
        esto existe para no pedir.
      </p>

      <p className="cierre-arquitectura">
        <Link className="boton" href="/verificar" prefetch={false}>
          Comprobalo vos mismo
        </Link>
      </p>
    </div>
  );
}
