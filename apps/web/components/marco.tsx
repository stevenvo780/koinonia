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

import { ErrorDeApi, traer } from '../lib/api';
import type { Sesion } from '@koinonia/contracts';

export function Cargando({ que }: { readonly que: string }): ReactNode {
  return (
    <p className="cargando" role="status">
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
    traer<Sesion>('/auth/yo')
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
      <ol className="tarjetas">
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
  if (sesion === undefined) {
    return (
      <p className="tira-sesion">
        Estás mirando sin cuenta. <Link href="/entrar">Entrar con el correo institucional</Link>.
      </p>
    );
  }
  return (
    <p className="tira-sesion">
      Entraste como <strong>{sesion.alias}</strong>.{' '}
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
 * `prefetch={false}` en todos: la precarga por omisión de trece destinos costaba 73 KiB, un tercio
 * de la portada, sin que nadie hubiera pulsado nada. Daniela paga esos datos.
 */

type Destino = {
  readonly href: string;
  /**
   * El texto del enlace es el `h1` del destino: quien salta por la lista de enlaces reconoce dónde
   * cayó.
   *
   * Con **una** excepción, `/verificar`, cuyo `h1` es «Comprobar que nada se cambió». Ese `h1` no
   * es mío y no se toca; y como rótulo de navegación ocupa dos líneas en un teléfono de 360 px y
   * baja los cinco destinos que tiene al lado. Así que ahí el enlace dice «Verificar» —que es el
   * verbo que la gente busca— y la pista dice el resto. Es la única de las doce que no coincide.
   */
  readonly texto: string;
  /** Sólo en el grupo de consulta, donde tres nombres se parecían entre sí y había que separarlos. */
  readonly pista?: string;
};

const RECORRIDO: readonly Destino[] = [
  { href: '/problemas', texto: 'Problemas' },
  { href: '/deliberaciones', texto: 'Deliberaciones' },
  { href: '/decisiones', texto: 'Decisiones' },
  { href: '/iniciativas', texto: 'Iniciativas' },
  { href: '/mis-tareas', texto: 'Mis tareas' },
];

const CONSULTA: readonly Destino[] = [
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
    href: '/historial',
    texto: 'Todo lo que quedó escrito',
    pista: 'todo lo que pasó, en orden y sin filtrar',
  },
  {
    href: '/verificar',
    texto: 'Verificar',
    pista: 'comprobalo por tu cuenta, sin creerle a nadie',
  },
];

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

export function Cabecera(): ReactNode {
  const camino = usePathname();
  const dondeEstas = CONSULTA.find((destino) => esDestinoActual(camino, destino.href));
  const [abierto, setAbierto] = useState(false);

  /*
   * El grupo llega plegado a todas partes, también a las seis pantallas de consulta.
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
        {enPortada ? null : (
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
            <ul
              id="lista-consulta"
              className="lista consulta"
              role="list"
              aria-label="Consultar"
              data-abierto={abierto ? 'si' : 'no'}
            >
              {CONSULTA.map((destino) => (
                <li key={destino.href}>
                  <EnlaceDestino destino={destino} actual={esDestinoActual(camino, destino.href)} />
                  {destino.pista !== undefined && <span className="pista">{destino.pista}</span>}
                </li>
              ))}
            </ul>
          </div>
        </nav>
      </div>
    </header>
  );
}
