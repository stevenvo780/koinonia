'use client';

/**
 * El tablero de iniciativas — PRODUCT.md §4 lo llama Kanban, y en un teléfono de 390 px un Kanban de
 * columnas lado a lado es ilegible: cuatro columnas de 88 px cada una no caben ni una tarjeta.
 *
 * La forma que se eligió, con las piezas que ya existen (`.pagina-indice`, `<Tarjeta>`, `<Ficha>`):
 * **agrupar por estado en secciones apiladas**, exactamente el patrón que ya usa `/decisiones`
 * (`Abiertas` / `Cerradas`, cada una su propio `<section aria-labelledby>` con su `<h2>` y su
 * `<ul className="tarjetas">`). En el teléfono se leen una debajo de la otra: cada sección es la
 * columna del Kanban vuelta franja. En pantalla ancha, `.pagina-indice .tarjetas` ya sabe pasar a 2
 * y 3 columnas dentro de cada sección — así que las cuatro franjas se despliegan en bloques, sin
 * inventar una rejilla nueva ni tocar `globals.css`. No es un Kanban de columnas fijas, es su
 * equivalente responsivo con las herramientas que hay.
 *
 * ═══ Por qué el estado sale de `/iniciativas/tablero` y no de `/iniciativas` ═══
 *
 * `GET /iniciativas` (la ruta vieja) sirve hoy `estado: 'por-empezar'` fijo para toda iniciativa,
 * en cualquier fase — es un literal de un solo valor en `presenters.ts`, sin actualizar todavía.
 * `GET /iniciativas/tablero` es la ruta nueva (informe INICIATIVAS + integrador) que deriva el
 * estado real del agregado con `derivarEstadoTableroIniciativa`. Sin ella este encargo — pintar el
 * estado real — no se puede hacer, así que la pantalla usa esa ruta y no la vieja.
 *
 * ═══ Sólo cuatro columnas, no cinco ═══
 *
 * PRODUCT.md §4 promete `por empezar / en curso / bloqueada / en revisión / cerrada`. El dominio no
 * sostiene la quinta: no existe ningún evento que declare que una iniciativa CERRÓ (ver la cabecera
 * de `packages/contracts/src/iniciativas.ts`, que es la fuente de este hallazgo). Pintar una columna
 * «Cerrada» acá sería inventar un hecho de gobierno que nadie declaró. Se pintan los cuatro estados
 * que el dominio sí puede demostrar, y esta nota es la constancia de la ausencia — no un olvido.
 *
 * ═══ Un tipo local, no de `@koinonia/contracts` ═══
 *
 * `TarjetaTableroIniciativa`/`TableroIniciativas` se definen en
 * `services/api/src/http/rutas-iniciativas.ts` (servidor, fuera de mi propiedad) y el paquete de
 * contratos sólo exporta las piezas puras que sí comparte con el dominio: `EstadoTableroIniciativa`,
 * `ESTADO_TABLERO_INICIATIVA_EN_PALABRAS`, `AvanceIniciativa`. `RespuestaTablero`, abajo, es la forma
 * exacta de la respuesta HTTP, verificada campo a campo contra ese fichero — no un tipo inventado.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  ESTADO_TABLERO_INICIATIVA_EN_PALABRAS,
  type AvanceIniciativa,
  type Circulo,
  type EstadoTableroIniciativa,
} from '@koinonia/contracts';

import { ErrorVisible } from '../../components/marco';
import {
  Esqueleto,
  Ficha,
  Medidor,
  Meta,
  Tarjeta,
  Vacio,
  type VarianteFicha,
} from '../../components/piezas';
import { cuando, fechaCortaEnFrase, traer } from '../../lib/api';

interface TarjetaTableroIniciativa {
  readonly id: string;
  readonly circuloId: string;
  readonly decisionId: string;
  readonly objetivo: string;
  readonly estado: EstadoTableroIniciativa;
  readonly estadoEnPalabras: string;
  readonly activa: boolean;
  readonly revisarEn: number;
  readonly avance: AvanceIniciativa;
}

interface RespuestaTablero {
  readonly tarjetas: readonly TarjetaTableroIniciativa[];
  readonly totalesPorEstado: Readonly<Record<EstadoTableroIniciativa, number>>;
}

/** El orden en que PRODUCT.md §4 nombra las columnas: el recorrido natural de una iniciativa. */
const ORDEN_ESTADOS: readonly EstadoTableroIniciativa[] = [
  'por-empezar',
  'en-curso',
  'bloqueada',
  'en-revision',
];

/**
 * El mismo criterio que ya usa `iniciativas/[id]/page.tsx` para las tareas: un resultado no tiene
 * variante propia porque el dominio no distingue aquí ningún resultado firme (`bien`/`mal`), sólo
 * dónde está el trabajo en su recorrido. `bloqueada` y `en-revision` comparten `atencion` — la
 * palabra de la ficha ya las distingue, el color no tiene por qué hacerlo también (ver `<Ficha>`).
 */
const VARIANTE_ESTADO_FICHA: Readonly<Record<EstadoTableroIniciativa, VarianteFicha>> = {
  'por-empezar': 'neutra',
  'en-curso': 'en-curso',
  bloqueada: 'atencion',
  'en-revision': 'atencion',
};

/** Una frase corta por sección, para que agrupar no sea sólo un rótulo sin explicar el porqué. */
const EXPLICACION_ESTADO: Readonly<Record<EstadoTableroIniciativa, string>> = {
  'por-empezar': 'Todavía en la ventana de impugnación: el plan puede objetarse antes de arrancar.',
  'en-curso': 'Avanzando, sin ninguna tarea detenida ni entregada pendiente de revisión.',
  bloqueada: 'Alguna tarea está detenida y pidió ayuda o se frenó: nadie la está moviendo.',
  'en-revision': 'Alguien entregó una tarea y falta que la persona responsable inicial la revise.',
};

export default function Iniciativas(): ReactNode {
  const [tablero, setTablero] = useState<RespuestaTablero | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  // Los nombres de los grupos son un realce del «quién responde» que pide PRODUCT.md §4 — a nivel
  // de CÍRCULO, nunca de persona (ADR-0039/0040) — así que si esta segunda llamada falla, la
  // pantalla sigue sirviendo el tablero completo sin ese dato, no se rompe por él.
  const [circulos, setCirculos] = useState<Circulo[] | undefined>(undefined);

  useEffect(() => {
    traer<RespuestaTablero>('/iniciativas/tablero').then(setTablero).catch(setError);
  }, []);

  useEffect(() => {
    traer<Circulo[]>('/circulos')
      .then(setCirculos)
      .catch(() => undefined);
  }, []);

  const nombreDelCirculo = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const circulo of circulos ?? []) mapa.set(circulo.id, circulo.nombre);
    return mapa;
  }, [circulos]);

  return (
    <div className="pagina-indice">
      <h1>Iniciativas</h1>
      <p>
        Acá seguimos los cambios que una decisión aprobada dejó listos para hacer, agrupados por
        dónde va cada uno. No es un tablero de personas: mirá el estado del trabajo, no quién lo
        lleva.
      </p>

      <ErrorVisible error={error} />
      {tablero === undefined && error === undefined && <Esqueleto que="las iniciativas" />}

      {tablero !== undefined && tablero.tarjetas.length === 0 && (
        <Vacio
          titulo="Todavía no hay iniciativas"
          salida={{ href: '/decisiones', texto: 'Ver las decisiones' }}
        >
          <p>
            No hay ninguna porque no hay decisiones aprobadas todavía: una decisión no puede
            cerrarse sin dejar creada la suya. En cuanto se apruebe la primera, va a aparecer acá
            sola.
          </p>
        </Vacio>
      )}

      {tablero !== undefined &&
        tablero.tarjetas.length > 0 &&
        ORDEN_ESTADOS.map((estado) => {
          const tarjetas = tablero.tarjetas.filter((tarjeta) => tarjeta.estado === estado);
          if (tarjetas.length === 0) return null;
          const tituloId = `grupo-${estado}-titulo`;
          return (
            <section key={estado} aria-labelledby={tituloId}>
              <h2 id={tituloId}>
                {ESTADO_TABLERO_INICIATIVA_EN_PALABRAS[estado]}{' '}
                <span className="suave">({tarjetas.length})</span>
              </h2>
              <p className="suave">{EXPLICACION_ESTADO[estado]}</p>
              <ul className="tarjetas">
                {tarjetas.map((tarjeta) => (
                  <Tarjeta
                    key={tarjeta.id}
                    titulo={tarjeta.objetivo}
                    enlace={`/iniciativas/${tarjeta.id}`}
                  >
                    <Ficha variante={VARIANTE_ESTADO_FICHA[estado]}>
                      {tarjeta.estadoEnPalabras}
                    </Ficha>
                    <Meta>
                      {nombreDelCirculo.get(tarjeta.circuloId) !== undefined ? (
                        <>Responde el círculo {nombreDelCirculo.get(tarjeta.circuloId)}</>
                      ) : null}
                      <>
                        Volvemos a mirar{' '}
                        <time
                          dateTime={new Date(tarjeta.revisarEn).toISOString()}
                          title={cuando(tarjeta.revisarEn)}
                        >
                          {fechaCortaEnFrase(tarjeta.revisarEn)}
                        </time>
                      </>
                    </Meta>
                    {tarjeta.avance.tareasTotales > 0 && (
                      <Medidor
                        etiqueta="Tareas completas"
                        valor={tarjeta.avance.tareasCompletas}
                        total={tarjeta.avance.tareasTotales}
                        descripcion={`${String(tarjeta.avance.hitos)} ${
                          tarjeta.avance.hitos === 1 ? 'hito' : 'hitos'
                        }`}
                      />
                    )}
                    <p>
                      <Link href={`/decisiones/${tarjeta.decisionId}/resultado`}>
                        Ver la decisión de origen
                      </Link>
                    </p>
                  </Tarjeta>
                ))}
              </ul>
            </section>
          );
        })}
    </div>
  );
}
