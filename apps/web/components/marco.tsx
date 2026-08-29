'use client';

/**
 * Piezas comunes de la interfaz.
 *
 * Todas cumplen tres reglas que en la práctica se saltan siempre:
 *
 *  1. **Los mensajes que aparecen solos se anuncian.** Un error que se pinta y no lleva `role`
 *     adecuado no existe para quien usa un lector de pantalla: la página cambia y no se entera.
 *  2. **Nada depende sólo del color.** Verde y rojo llevan símbolo y palabra.
 *  3. **Cargando también se dice.** Un hueco en blanco durante dos segundos es una página rota para
 *     quien no ve el spinner.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useState } from 'react';

import { ErrorDeApi, sesionActual } from '../lib/api';
import type { Sesion } from '@koinonia/contracts';

/**
 * `completa`: la pantalla entera está esperando este dato y no hay ningún otro contenido montado
 * todavía —el caso de `/`, `/normas`, `/verificar` y de cada `return <Cargando .../>` temprano que
 * reemplaza el árbol entero de una pantalla de detalle—. Ahí reserva alto (ver `.cargando-completa`
 * en `globals.css`) para que el pie de página no quede pegado al título y no salte cientos de
 * píxeles cuando la respuesta llega. Sin `completa` (el valor por omisión) es la línea suelta de
 * siempre, pensada para cuando `<Cargando>` reemplaza sólo una pieza chica de una pantalla que ya
 * tiene el resto montado —el placeholder de un `<select>` mientras llega su lista, por ejemplo—,
 * donde reservar medio alto de pantalla sería un hueco absurdo.
 */
export function Cargando({
  que,
  completa = false,
}: {
  readonly que: string;
  readonly completa?: boolean;
}): ReactNode {
  return (
    <p className={completa ? 'cargando cargando-completa' : 'cargando'} role="status">
      Cargando {que}…
    </p>
  );
}

export function Aviso({
  tipo,
  titulo,
  id,
  children,
}: {
  readonly tipo: 'error' | 'bien' | 'atencion';
  readonly titulo?: string;
  readonly id?: string;
  readonly children: ReactNode;
}): ReactNode {
  const simbolo = tipo === 'error' ? '✕' : tipo === 'bien' ? '✓' : '!';
  const palabra = tipo === 'error' ? 'Problema' : tipo === 'bien' ? 'Todo bien' : 'Atención';
  return (
    <div
      className={`aviso ${tipo}`}
      role={tipo === 'error' ? 'alert' : 'status'}
      {...(id === undefined ? {} : { id })}
    >
      <strong className="marca-aviso">
        <span aria-hidden="true">{simbolo} </span>
        {titulo ?? palabra}:{' '}
      </strong>
      {children}
    </div>
  );
}

/**
 * El `id` es opcional pero no decorativo: cuando el error pertenece a un campo concreto, el campo
 * tiene que poder apuntarlo con `aria-describedby`. Sin eso, quien usa un lector de pantalla llega
 * al campo, oye la ayuda, y nunca se entera de por qué lo rechazaron.
 */
export function ErrorVisible({
  error,
  id,
}: {
  readonly error: unknown;
  readonly id?: string;
}): ReactNode {
  if (error === null || error === undefined) return null;
  const mensaje =
    error instanceof ErrorDeApi
      ? error.message
      : error instanceof Error
        ? error.message
        : 'Algo no salió bien.';
  const queHacer = error instanceof ErrorDeApi ? error.queHacer : undefined;
  return (
    <Aviso tipo="error" titulo="No se pudo" {...(id === undefined ? {} : { id })}>
      {mensaje}
      {queHacer !== undefined && (
        <>
          {' '}
          <span>{queHacer}</span>
        </>
      )}
    </Aviso>
  );
}

/** La sesión, para saber qué mostrar. **Nunca** para decidir si algo se puede hacer. */
export function useSesion(): {
  readonly sesion: Sesion | undefined;
  readonly cargando: boolean;
  readonly recargar: () => void;
} {
  const [sesion, setSesion] = useState<Sesion | undefined>(undefined);
  const [cargando, setCargando] = useState(true);
  const [tic, setTic] = useState(0);

  const recargar = useCallback(() => {
    // La identidad anterior deja de ser utilizable en el mismo turno en que pedimos revalidarla.
    // Conservarla hasta que responda `/auth/yo` puede mostrar datos privados de otra cuenta si la
    // cookie cambió en una pestaña distinta.
    setSesion(undefined);
    setCargando(true);
    setTic((n) => n + 1);
  }, []);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    // `sesionActual()` pregunta contra `/auth/estado`, que contesta 200 tanto si hay sesión como
    // si no: ver el comentario de esa función en `lib/api.ts`. `/auth/yo` sigue devolviendo 401 sin
    // credencial, y en cada carga de cada pantalla eso pintaba una línea roja en la consola del
    // navegador para lo que es la pregunta más común de toda la interfaz —«¿hay alguien mirando
    // con cuenta?»—, que no es un error, es la respuesta esperada la mitad del tiempo.
    sesionActual()
      .then((s) => {
        if (vivo) setSesion(s);
      })
      .catch(() => {
        if (vivo) setSesion(undefined);
      })
      .finally(() => {
        if (vivo) setCargando(false);
      });
    return () => {
      vivo = false;
    };
  }, [tic]);

  useEffect(() => {
    window.addEventListener('focus', recargar);
    return () => {
      window.removeEventListener('focus', recargar);
    };
  }, [recargar]);

  return {
    sesion,
    cargando,
    recargar,
  };
}

/**
 * Un recorrido por etapas, con la etapa actual marcada **en palabras**.
 *
 * Es la pieza que se hace mal siempre: un recorrido de pasos donde el actual sólo se distingue por
 * el color es invisible para quien no distingue esos colores y para quien usa un lector de pantalla.
 * Acá el estado va tres veces —`aria-current`, un símbolo con `aria-hidden` y una palabra—, y la
 * palabra es la que manda (WCAG 2.2 AA, criterio 1.4.1).
 */
export function Pasos({
  titulo,
  pasos,
  actual,
}: {
  readonly titulo: string;
  readonly pasos: readonly { readonly id: string; readonly nombre: string }[];
  readonly actual: string;
}): ReactNode {
  const indiceActual = pasos.findIndex((paso) => paso.id === actual);
  return (
    <nav aria-label={titulo}>
      {/*
       * `.pasos`, no `.tarjetas`: un paso del recorrido no es un ítem de índice, es un tramo de un
       * único recorrido, y compartir clase con las tarjetas le prestaba una caja —sombra, filete
       * que se tiñe al pasar el mouse— que no le correspondía. `role="list"` porque `.pasos` le
       * quita a este `<ol>` el `list-style` nativo, y sin marcador VoiceOver deja de anunciarlo
       * como lista si no se lo decimos explícitamente (el mismo motivo por el que el recorrido de
       * la cabecera, más abajo en este fichero, también lo lleva).
       */}
      <ol className="pasos" role="list">
        {pasos.map((paso, indice) => {
          const esActual = indice === indiceActual;
          const yaPaso = indiceActual >= 0 && indice < indiceActual;
          return (
            <li key={paso.id} {...(esActual ? { 'aria-current': 'step' as const } : {})}>
              <span aria-hidden="true">{yaPaso ? '✓ ' : esActual ? '▸ ' : '· '}</span>
              {esActual ? <strong>{paso.nombre}</strong> : paso.nombre}
              {esActual && <span className="suave"> — acá va la conversación ahora</span>}
              {yaPaso && <span className="suave"> — ya cerró</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function BarraSesion(): ReactNode {
  const { sesion, cargando } = useSesion();
  if (cargando) return null;
  // La frase va envuelta en un `<span>` y no suelta dentro del `<p>`. `.tira-sesion` es un
  // contenedor flexible para poder alinear la etiqueta del encargo con el texto, y en un contenedor
  // flexible **cada nodo de texto suelto es un ítem**: el punto final de la oración se convertía en
  // una caja propia y aparecía en pantalla separado por el hueco de 0,75 rem, como «institucional .».
  // Envolver la oración entera la vuelve un solo ítem y el punto vuelve a pegarse a la palabra.
  if (sesion === undefined) {
    return (
      <p className="tira-sesion">
        <span>
          Estás mirando sin cuenta. <Link href="/entrar">Entrar con el correo institucional</Link>.
        </span>
      </p>
    );
  }
  return (
    <p className="tira-sesion">
      <span>
        Entraste como <strong>{sesion.alias}</strong>.{' '}
        <Link className="enlace-corregir" href="/mis-datos">
          Corregir tus datos
        </Link>
        .
      </span>
      {sesion.roles.includes('facilitator') && (
        <span className="etiqueta">Cuidás el procedimiento</span>
      )}
    </p>
  );
}

/**
 * La navegación principal.
 *
 * ═══ Por qué dos grupos y no trece enlaces ═══
 *
 * Trece destinos al mismo nivel no son una navegación: son un índice. Ocupaban 284 px de una
 * pantalla de 800 y empujaban el `h1` a `y=373`, así que casi la mitad del teléfono era una lista
 * de enlaces azules antes de que la página dijera de qué trata.
 *
 * El corte no es estético. Hay **una** cosa que se hace acá, y tiene orden: se escribe un
 * problema, se conversa, se decide, alguien se hace cargo, y esa persona tiene tareas. Eso es el
 * grupo «El recorrido», numerado 1→5, y va siempre visible porque enseña el procedimiento a quien
 * llega por primera vez sin obligarla a leer las normas. Todo lo demás —quién decide qué, con qué
 * reglas, qué quedó escrito, cómo se comprueba, a quién le prestaste el voto— no es un paso: es
 * material de consulta al que se va con una pregunta ya formada. Eso se pliega en el teléfono y se
 * despliega en pantalla ancha, donde el espacio no es escaso.
 *
 * «Prestar tu voto» cae en consulta y no en el recorrido a propósito: no se hace cada vez que hay
 * una decisión, se deja puesto una vez y se revisa de tanto en tanto. Ponerlo entre los pasos
 * sugeriría que hay que pasar por ahí, y no hay que pasar por ahí.
 *
 * ═══ Y por qué ahora el segundo grupo va subdividido ═══
 *
 * Llegaron cuatro pantallas más —«Propuestas» y «El asistente», que existían y **no las enlazaba
 * nadie**, y «Lo que aprendimos» y «Qué tan repartida está la voz», nuevas—. Este proyecto ya tuvo
 * una pantalla viva a la que sólo se llegaba escribiendo la dirección a mano, así que dejarlas
 * fuera no era una opción; pero colgarlas del mismo grupo plano lo llevaba a **diez destinos
 * seguidos sin una sola junta**, que en un teléfono es una lista que se recorre entera cada vez
 * que se busca uno.
 *
 * La junta que faltaba no es un segundo botón —dos mandos que hay que probar por turnos son peores
 * que uno—, es **decir de qué trata cada tramo**. El grupo se sigue abriendo con un solo botón y
 * por dentro va partido en tres, con el rótulo de cada tramo escrito:
 *
 *   · **Escribir** — dónde están los textos y quién te ayuda a redactar uno.
 *   · **Cómo se decide acá** — las reglas, quién manda sobre qué, y cuánta voz junta cada quien.
 *   · **Lo que quedó** — lo que ya pasó, lo que se aprendió, y cómo comprobarlo sin creerle a nadie.
 *
 * «Propuestas» cae en «Escribir» y no entre los pasos numerados a propósito, y no por falta de
 * sitio: una propuesta **no se empieza desde su índice**. Se escribe desde el problema que la pide
 * (`/propuestas/nueva?problema=…` es la única puerta que existe), así que el índice es el sitio al
 * que se va a *ver qué se redactó*, que es consulta. Numerarlo como paso prometería una puerta que
 * la pantalla no tiene.
 *
 * `prefetch={false}` en todos: la precarga por omisión de trece destinos costaba 73 KiB, un tercio
 * de la portada, sin que nadie hubiera pulsado nada. Daniela paga esos datos.
 */

type Destino = {
  readonly href: string;
  /**
   * El texto del enlace es el `h1` del destino: quien salta por la lista de enlaces reconoce dónde
   * cayó.
   *
   * Con **una** excepción entre los quince, `/verificar`, cuyo `h1` es «Comprobar que nada se
   * cambió». Ese `h1` no es mío y no se toca; y como rótulo de navegación ocupa dos líneas en un
   * teléfono de 360 px y baja los cinco destinos que tiene al lado. Así que ahí el enlace dice
   * «Verificar» —que es el verbo que la gente busca— y la pista dice el resto.
   *
   * Las cuatro pantallas que se enlazaron después se comprobaron una por una contra el `h1` que
   * tienen HOY escrito, no contra el nombre que parecía razonable: «Propuestas», «El asistente»,
   * «Lo que ya aprendimos» y «Cómo está repartido el voto prestado». Los dos últimos no eran los
   * que este fichero había supuesto («Lo que aprendimos», «Qué tan repartida está la voz»), y la
   * diferencia es justo la que rompe el trato: el enlace habría prometido un título que la
   * pantalla no dice.
   */
  readonly texto: string;
  /** Sólo en el grupo de consulta, donde tres nombres se parecían entre sí y había que separarlos. */
  readonly pista?: string;
};

/** Un tramo del grupo de consulta: su rótulo y sus destinos. */
type Tramo = {
  /** Sufijo del `id` del rótulo, que es a quien apunta el `aria-labelledby` de la lista. */
  readonly id: string;
  readonly titulo: string;
  readonly destinos: readonly Destino[];
};

const RECORRIDO: readonly Destino[] = [
  { href: '/problemas', texto: 'Problemas' },
  { href: '/deliberaciones', texto: 'Deliberaciones' },
  { href: '/decisiones', texto: 'Decisiones' },
  { href: '/iniciativas', texto: 'Iniciativas' },
  { href: '/mis-tareas', texto: 'Mis tareas' },
];

const TRAMOS: readonly Tramo[] = [
  {
    id: 'escribir',
    titulo: 'Escribir',
    destinos: [
      {
        href: '/propuestas',
        texto: 'Propuestas',
        pista: 'los textos ya redactados para decidir sobre ellos',
      },
      {
        href: '/asistente',
        texto: 'El asistente',
        pista: 'te arma un plan, una pregunta por pantalla',
      },
    ],
  },
  {
    id: 'como-se-decide',
    titulo: 'Cómo se decide acá',
    destinos: [
      {
        href: '/consenso',
        texto: 'En qué coincidimos',
        pista: 'dónde ya hay acuerdo y no hace falta votar',
      },
      {
        href: '/circulos',
        texto: 'Quién decide qué',
        pista: 'los grupos y hasta dónde llega cada uno',
      },
      {
        // Entre «Círculos» y «Normas» a propósito: es donde PRODUCT.md §4 la ubica en la tabla de
        // las 14 pantallas, y el mismo orden separa lo que YA es estructura de gobierno (círculos,
        // reglas) de lo que es apenas insumo para ella. No va en «Escribir»: convocar y publicar un
        // acta no son textos que decidan nada por sí mismos, son la constancia de lo que pasó
        // presencialmente — el principio del proyecto es que esa constancia es una herramienta más,
        // no el sistema de gobierno, así que tampoco encabeza el recorrido numerado.
        href: '/reuniones',
        texto: 'Reuniones',
        pista: 'lo presencial, con orden del día y lo que quedó acordado',
      },
      {
        href: '/normas',
        texto: 'Las reglas del juego',
        pista: 'cómo se decide acá y con qué plazos',
      },
      {
        href: '/delegaciones',
        texto: 'Prestar tu voto',
        pista: 'quién lleva tu parte cuando no podés estar',
      },
      {
        // El texto es, letra por letra, el `h1` de esa pantalla —«Cómo está repartido el voto
        // prestado»— y no el rótulo más corto que pedía el renglón. Es largo, sí: entra en dos
        // líneas dentro de los 44 px que el enlace ya reserva por área táctil, así que no cuesta
        // alto, y a cambio quien salta por la lista de enlaces cae en un título que reconoce.
        href: '/concentracion',
        texto: 'Cómo está repartido el voto prestado',
        pista: 'si unas pocas personas juntan la decisión',
      },
    ],
  },
  {
    id: 'lo-que-quedo',
    titulo: 'Lo que quedó',
    destinos: [
      {
        href: '/aprendizajes',
        texto: 'Lo que ya aprendimos',
        pista: 'lo que dejaron los intentos que ya cerraron',
      },
      {
        href: '/historial',
        texto: 'Todo lo que quedó escrito',
        pista: 'todo lo que pasó, en orden y sin filtrar',
      },
      {
        href: '/verificar',
        texto: 'Verificar',
        pista: 'comprobalo por tu cuenta, sin creerle a nadie',
      },
    ],
  },
];

/**
 * Los diez destinos de consulta en una sola lista, para buscar en ellos el «estás acá».
 *
 * Se deriva de `TRAMOS` y no se escribe a mano: una segunda lista escrita aparte es la que se
 * olvida de actualizar el día que se agrega un destino, y el síntoma sería justo el que este
 * fichero vino a arreglar —un destino sin marca de «estás acá»—.
 */
const CONSULTA: readonly Destino[] = TRAMOS.flatMap((tramo) => tramo.destinos);

function esDestinoActual(camino: string, href: string): boolean {
  return camino === href || camino.startsWith(`${href}/`);
}

function EnlaceDestino({
  destino,
  actual,
}: {
  readonly destino: Destino;
  readonly actual: boolean;
}): ReactNode {
  return (
    <Link
      href={destino.href}
      prefetch={false}
      {...(actual ? { 'aria-current': 'page' as const } : {})}
    >
      {destino.texto}
    </Link>
  );
}

/**
 * ¿Estamos en el ancho donde existe la barra lateral?
 *
 * El corte es el mismo 64rem que usa `globals.css`, y está escrito en los dos sitios porque no hay
 * forma de leer una variable de CSS desde una consulta de medios de JavaScript. Si se cambia allá,
 * se cambia acá.
 *
 * Hace falta en JavaScript y no basta con esconder la pieza por CSS: esconderla la deja igualmente
 * montada, y montada significa **pedir `/auth/estado` en cada pantalla y en cada vuelta al foco de
 * la ventana** para pintar algo que en el teléfono no se ve. Este proyecto cuenta los kilobytes que
 * manda —es la razón por la que no hay ni una imagen rasterizada ni una tipografía web— así que
 * gastar una petición por pantalla en lo invisible sería incoherente con todo lo demás.
 *
 * Arranca en `false` a propósito: es lo que se pinta en el servidor, y coincidir con eso en el
 * primer render del cliente es lo que evita un desajuste de hidratación.
 */
function usePantallaAncha(): boolean {
  const [ancha, setAncha] = useState(false);

  useEffect(() => {
    const consulta = window.matchMedia('(min-width: 64rem)');
    const alCambiar = (): void => {
      setAncha(consulta.matches);
    };
    alCambiar();
    consulta.addEventListener('change', alCambiar);
    return () => {
      consulta.removeEventListener('change', alCambiar);
    };
  }, []);

  return ancha;
}

/**
 * Quién sos, dicho en la propia barra y en todas las pantallas.
 *
 * Hasta acá la sesión sólo se decía en la portada (`<BarraSesion/>` en `app/page.tsx`): en las
 * otras treinta y dos pantallas no había forma de saber si estabas dentro o mirando de visita sin
 * volver al principio. Eso importa especialmente acá, donde la mitad de las pantallas cambian de
 * contenido según si entraste —«Mis tareas», «Prestar tu voto», votar— y la explicación de por qué
 * no ves algo es justamente ésa.
 *
 * Va **fuera** de `<nav className="principal">` a propósito, y no es un detalle de maquetado: las
 * pruebas de navegación buscan enlaces *dentro* de esa región (`getByRole('navigation', { name:
 * 'Principal' })`) y cuentan los que hay. Un enlace de cuenta metido ahí adentro sería un destino
 * más para ellas, y además es mentira: la cuenta no es un lugar del recorrido.
 *
 * Y el texto es «Entrar» a secas, no la frase de `BarraSesion` («Estás mirando sin cuenta»): esa
 * frase ya la escriben, palabra por palabra, los `Vacio` de `/delegaciones`, `/deliberaciones` y
 * `/problemas/[id]` como título, y repetirla en la barra dejaba dos apariciones del mismo texto en
 * la misma pantalla —que es exactamente lo que una búsqueda por texto no puede desambiguar—.
 */
function SesionEnCabecera(): ReactNode {
  const { sesion, cargando } = useSesion();
  // Mientras no se sabe, no se dice: un «entrar» que parpadea y se convierte en tu nombre medio
  // segundo después es peor que un hueco, porque el primero invita a pulsarlo.
  if (cargando) return null;
  if (sesion === undefined) {
    return (
      <div className="sesion-barra">
        <Link className="entrar" href="/entrar" prefetch={false}>
          Entrar
        </Link>
      </div>
    );
  }
  return (
    <div className="sesion-barra">
      {/*
       * Antes era un `<span>` decorativo: quien mira su propio nombre en la cabecera no tenía
       * ningún camino, ni aquí ni en ningún otro sitio ancho, hacia la pantalla que le deja
       * corregirlo (`/mis-datos`). El texto visible no cambia —sigue siendo sólo el alias, para no
       * repetir la frase completa que ya dice `<BarraSesion>` en la portada— pero el enlace sí
       * dice, para quien usa lector de pantalla, adónde lleva: ver `.solo-lectores` más abajo.
       */}
      <Link className="quien" href="/mis-datos" prefetch={false}>
        <span className="inicial" aria-hidden="true">
          {sesion.alias.slice(0, 1).toUpperCase()}
        </span>
        <span className="alias">{sesion.alias}</span>
        <span className="solo-lectores"> — corregir tus datos</span>
      </Link>
      {sesion.roles.includes('facilitator') && (
        <span className="etiqueta">Cuidás el procedimiento</span>
      )}
    </div>
  );
}

export function Cabecera(): ReactNode {
  const camino = usePathname();
  const anchaParaBarra = usePantallaAncha();
  const dondeEstas = CONSULTA.find((destino) => esDestinoActual(camino, destino.href));
  const [abierto, setAbierto] = useState(false);

  /*
   * El grupo llega plegado a todas partes, también a las diez pantallas de consulta.
   *
   * Antes se abría solo al llegar a una de ellas. La intención era buena —que la marca de «estás
   * acá» no quedara escondida detrás de un botón, que es igual que no tenerla— pero el precio,
   * medido, era medio teléfono: la lista desplegada mide 406 px de 800, y el `h1` de `/normas`
   * nacía en `y=648`. El 81 % de la pantalla era barra, peor que la queja que esto vino a arreglar.
   *
   * La marca no necesita la lista abierta: necesita estar **escrita**. Así que se escribe junto al
   * botón, en palabras, y la lista se queda plegada. Cerrarla al cambiar de camino tampoco es
   * cosmética: la cabecera vive en el layout y no se vuelve a montar, de modo que el grupo que
   * abriste para elegir destino seguiría abierto **en** el destino, con sus 406 px encima del `h1`.
   */
  useEffect(() => {
    setAbierto(false);
  }, [camino]);

  // En la portada el nombre ya es el `h1` de la página. Repetirlo arriba lo decía dos veces con
  // 350 px de enlaces en medio, y ninguna de las dos servía para ir a ningún lado.
  const enPortada = camino === '/';

  return (
    <header className="cabecera">
      <div className="interior">
        {/*
         * En la portada el nombre se escribe pero **no enlaza**, y las dos mitades de esa frase
         * son deliberadas.
         *
         * No enlaza porque un enlace a la pantalla en la que ya estás no lleva a ningún lado, y
         * porque el nombre ya es el `h1` de esta pantalla: decirlo dos veces como enlace y como
         * título es repetir el mismo destino en el árbol de accesibilidad. Hay una prueba que lo
         * fija (`13-navegacion.spec.ts`: cero enlaces llamados «Koinonía» en `/`).
         *
         * Pero se escribe igual, y eso sí cambió: antes desaparecía entero. Con la barra lateral
         * de pantalla ancha, quitarlo dejaba la columna empezando por «El recorrido», sin membrete
         * —la única pantalla del sitio donde el marco se veía distinto, y justamente la primera que
         * ve quien llega—. Un `<p>` conserva la forma sin prometer un destino.
         */}
        {enPortada ? (
          <p className="marca marca-portada">Koinonía</p>
        ) : (
          <Link className="marca" href="/" prefetch={false}>
            Koinonía
          </Link>
        )}

        <nav className="principal" aria-label="Principal">
          <div className="grupo">
            <p className="titulo-grupo">El recorrido</p>
            <ol className="lista recorrido" role="list" aria-label="El recorrido">
              {RECORRIDO.map((destino, indice) => (
                <li key={destino.href}>
                  <span className="paso" aria-hidden="true">
                    {indice + 1}
                  </span>
                  <EnlaceDestino destino={destino} actual={esDestinoActual(camino, destino.href)} />
                </li>
              ))}
            </ol>
          </div>

          <div className="grupo">
            {/*
             * El botón y la marca de «estás acá» comparten renglón a propósito: el botón mide
             * 103 px de los 328 disponibles y el resto estaba vacío. Puesta debajo, la marca
             * costaba 19 px y dejaba el `h1` en `y=307`; al lado no cuesta ninguno. La marca va
             * fuera del botón porque dentro pasaría a ser parte de su nombre accesible, y el
             * botón tiene que seguir llamándose «Consultar» y nada más.
             */}
            <div className="fila-abridor">
              <button
                type="button"
                className="abridor"
                aria-expanded={abierto}
                aria-controls="lista-consulta"
                onClick={() => {
                  setAbierto((valor) => !valor);
                }}
              >
                Consultar
                <span className="signo" aria-hidden="true">
                  {abierto ? '▲' : '▼'}
                </span>
              </button>
              {dondeEstas !== undefined && !abierto && (
                <p className="aca-consulta">
                  <span aria-hidden="true">▸ </span>
                  estás acá: <strong>{dondeEstas.texto}</strong>
                </p>
              )}
            </div>
            <p className="titulo-grupo solo-ancho">Consultar</p>
            {/*
             * El contenedor pasó de `<ul>` a `<div>` porque ya no es una lista: es el envoltorio de
             * tres. Sigue siendo el mismo `id="lista-consulta"` al que apunta el `aria-controls`
             * del botón —el mando tiene que seguir señalando exactamente lo que abre— y el mismo
             * `data-abierto` que decide si se ve.
             */}
            <div id="lista-consulta" className="consulta" data-abierto={abierto ? 'si' : 'no'}>
              {TRAMOS.map((tramo) => {
                const idRotulo = `tramo-${tramo.id}`;
                return (
                  <div className="tramo" key={tramo.id}>
                    {/*
                     * El rótulo del tramo NO es un encabezado, por el mismo motivo que el rótulo
                     * del grupo: un `h2` en la cabecera se cuela en el índice de encabezados de
                     * todas las pantallas y aparece por delante del `h1`, que es lo que usa para
                     * orientarse quien navega con lector de pantalla. Como `<p>` no estorba ahí, y
                     * `aria-labelledby` le da igual el nombre a la lista que rotula.
                     */}
                    <p className="titulo-tramo" id={idRotulo}>
                      {tramo.titulo}
                    </p>
                    <ul className="lista sublista" role="list" aria-labelledby={idRotulo}>
                      {tramo.destinos.map((destino) => (
                        <li key={destino.href}>
                          <EnlaceDestino
                            destino={destino}
                            actual={esDestinoActual(camino, destino.href)}
                          />
                          {destino.pista !== undefined && (
                            <span className="pista">{destino.pista}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        </nav>

        {/*
         * Sólo donde existe la barra lateral. No es lo mismo que esconderla con CSS: montarla en
         * el teléfono costaría una petición de sesión por pantalla para pintar algo invisible (ver
         * `usePantallaAncha`).
         */}
        {anchaParaBarra && <SesionEnCabecera />}
      </div>
    </header>
  );
}
