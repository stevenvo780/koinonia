'use client';

/**
 * La forma del reparto del voto prestado. **Nunca quién lo concentra.**
 *
 * ═══ La única decisión de diseño que importa acá ═══
 *
 * El contrato (`packages/contracts/src/concentracion.ts`) ya resolvió la tensión con ADR-0040: se
 * publica la FORMA de la distribución y jamás el nombre de nadie, y el servidor lo garantiza en
 * tiempo de ejecución —si un identificador sobreviviera al cálculo, revienta antes de que exista la
 * respuesta—. Esta pantalla puede deshacer esa garantía sin tocar el servidor, y por eso hay tres
 * cosas que no hace y que no son negociables:
 *
 *  1. **No hay ninguna lista.** Nada ordena personas de mayor a menor. Los diez tramos son grupos de
 *     tamaño fijo del padrón entero, no los diez que más sostienen: en un tramo hay treinta personas
 *     y la cifra que se publica es la suma de las treinta.
 *  2. **La cifra de «quien más sostiene» va sin sujeto y no se puede cruzar con nada.** Dice a qué
 *     parte del colectivo representa esa posición de la distribución, no quién la ocupa. En la
 *     pantalla no hay ningún otro dato con el que emparejarla —ni conteos por grupo, ni por círculo,
 *     ni por fecha— porque dos agregados cruzados son un nombre con pasos de más.
 *  3. **Cuando el servidor retiene, la pantalla no rellena el hueco.** Si el detalle no viene, se
 *     dice por qué no viene y se acabó; no se muestra «al menos» el número más grande.
 *
 * ═══ Por qué ningún índice se llama por su nombre ═══
 *
 * ADR-0041 prohíbe la jerga en pantalla, y el nombre técnico de estas tres cifras es jerga aunque se
 * escriba en español. Pero el problema es anterior al ADR: un nombre propio de índice no le dice
 * nada a nadie que no lo conozca ya, y quien lo conoce no lo necesita. Así que cada cifra se
 * presenta por **lo que se lee en sus dos extremos** —qué significa que dé casi cero y qué significa
 * que dé casi el máximo—, que es lo único que hace falta para interpretarla y lo único que se puede
 * comprobar mirando la pantalla.
 *
 * ═══ La acción ═══
 *
 * Es una pantalla de lectura, y aun así PRODUCT.md §4 exige una acción principal. Sólo hay una cosa
 * que una persona puede hacer con lo que ve acá, y es revisar a quién le prestó su propio voto: eso
 * es lo que cambia la forma de este reparto. Cualquier otra acción sería vigilancia.
 */

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

import type {
  BaldeDeRepartoDto,
  ConcentracionDelegacion,
  RepartoDeDelegacionDto,
} from '@koinonia/contracts';

import { Aviso, Cargando, ErrorVisible } from '../../components/marco';
import { Vacio } from '../../components/piezas';
import { cuando, traer } from '../../lib/api';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// La pantalla
// ═════════════════════════════════════════════════════════════════════════════════════════════

export default function Concentracion(): ReactNode {
  const [informe, setInforme] = useState<ConcentracionDelegacion | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);

  useEffect(() => {
    let vivo = true;
    traer<ConcentracionDelegacion>('/concentracion/delegaciones')
      .then((datos) => {
        if (vivo) setInforme(datos);
      })
      .catch((fallo: unknown) => {
        if (vivo) setError(fallo);
      });
    return () => {
      vivo = false;
    };
  }, []);

  return (
    <div className="pagina-prosa">
      <h1>Cómo está repartido el voto prestado</h1>
      <p className="lede">
        Quien no puede estar en una decisión puede prestarle su voto a otra persona. Esta pantalla
        mide <strong>qué forma tiene ese reparto en el colectivo entero</strong>: si está esparcido
        entre mucha gente o amontonado en pocas manos.{' '}
        <strong>No dice quién sostiene qué, y no es un olvido: es la regla.</strong> Un tablero con
        nombres y cuentas al lado sería exactamente la vigilancia que este proyecto se prohibió.
      </p>

      <p>
        <Link className="boton" href="/delegaciones">
          Revisar a quién le prestaste tu voto
        </Link>
      </p>

      <ErrorVisible error={error} />

      {informe === undefined && error === undefined && (
        <Cargando que="el reparto del voto prestado" completa />
      )}

      {informe !== undefined && <Informe informe={informe} />}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// El informe
// ═════════════════════════════════════════════════════════════════════════════════════════════

function Informe({ informe }: { readonly informe: ConcentracionDelegacion }): ReactNode {
  // Los dos huecos van dentro de una `<section>` con su propio `h2` y no sueltos bajo el `h1`: el
  // título de `<Vacio>` es un `h3` —lo impone el componente— y colgarlo directo del `h1` saltaría
  // un nivel, que es la clase de detalle que sólo se nota cuando alguien recorre la página por sus
  // encabezados y se pierde un escalón.
  if (informe.censo === 0) {
    return (
      <section aria-labelledby="reparto-de-hoy">
        <h2 id="reparto-de-hoy">El reparto de hoy</h2>
        <Vacio
          titulo="Todavía no hay a quién contar"
          salida={{ href: '/circulos', texto: 'Ver quién decide qué' }}
        >
          <p>
            No hay nadie registrado, así que no hay reparto que medir. Esto se llena solo en cuanto
            haya gente que pueda decidir.
          </p>
        </Vacio>
      </section>
    );
  }

  if (informe.personasQueDelegan === 0) {
    return (
      <section aria-labelledby="reparto-de-hoy">
        <h2 id="reparto-de-hoy">El reparto de hoy</h2>
        <Vacio
          titulo="Nadie le prestó su voto a nadie"
          salida={{ href: '/delegaciones', texto: 'Prestar tu voto' }}
        >
          <p>
            Las {informe.censo} personas que pueden decidir llevan hoy su propia voz. No hay nada
            amontonado porque no hay nada prestado: es la forma más repartida posible, y es la de
            hoy.
          </p>
        </Vacio>
        <Medido en={informe.medidoEn} />
      </section>
    );
  }

  return (
    <>
      <section aria-labelledby="cuanta-gente">
        <h2 id="cuanta-gente">De cuánta gente estamos hablando</h2>
        <dl className="datos-trabajo">
          <div>
            <dt>Pueden decidir</dt>
            <dd>{informe.censo} personas</dd>
          </div>
          <div>
            <dt>Prestaron su voto</dt>
            <dd>{informe.personasQueDelegan} personas</dd>
          </div>
          <div>
            <dt>Llevan su propia voz</dt>
            <dd>{informe.censo - informe.personasQueDelegan} personas</dd>
          </div>
        </dl>
        <p className="suave">
          Los tres números son cuentas del colectivo entero. Ninguno se puede abrir para ver quiénes
          son, ni acá ni pidiéndoselo al servidor.
        </p>
      </section>

      {informe.reparto.publicado ? (
        <Detalle reparto={informe.reparto.valor} pocasPersonas={informe.reparto.grupoPequeno} />
      ) : (
        <section aria-labelledby="retenido">
          <h2 id="retenido">La forma del reparto todavía no se publica</h2>
          <Aviso tipo="atencion" titulo="No se puede decir sin señalar a alguien">
            Hoy hay muy poca gente sosteniendo votos ajenos. Con tan pocas manos, hasta la forma del
            reparto —sin un solo nombre— alcanza para que cualquiera adivine de quién se está
            hablando. Se publica cuando al menos diez personas distintas sostengan algún voto
            prestado.
          </Aviso>
          <p>
            No es una falla ni un dato que falte: es la misma regla que impide publicar cualquier
            cifra de un grupo demasiado chico para esconder a nadie dentro.
          </p>
        </section>
      )}

      <section aria-labelledby="lo-que-no-cuenta">
        <h2 id="lo-que-no-cuenta">Qué no está contado acá</h2>
        <p>
          Cada préstamo de voto vale para UNA votación concreta, y deja de contar en cuanto esa
          votación se cierra. Esta foto junta los préstamos de todas las votaciones abiertas ahora
          mismo como si fueran permanentes, para poder mostrar un solo número del colectivo en vez
          de uno distinto por cada votación. Así que el reparto real dentro de una votación concreta
          puede ser algo distinto de lo que se ve acá, y en cuanto una votación se cierra su
          préstamo deja de sumar acá también.
        </p>
        <p>
          Lo que no aparece en esta foto, hoy, es el préstamo hecho para un tema puntual: todavía no
          hay ninguna votación de este producto que se pueda etiquetar por tema, así que ese tipo de
          préstamo no existe todavía en ningún lado.
        </p>
      </section>

      <Medido en={informe.medidoEn} />
    </>
  );
}

/**
 * El detalle publicable. Las tres cifras van con su lectura de extremos pegada, no en una leyenda
 * aparte: una cifra que hay que ir a buscar a otro sitio para entender se lee mal o no se lee.
 */
function Detalle({
  reparto,
  pocasPersonas,
}: {
  readonly reparto: RepartoDeDelegacionDto;
  readonly pocasPersonas: boolean;
}): ReactNode {
  return (
    <>
      <section aria-labelledby="que-tan-amontonado">
        <h2 id="que-tan-amontonado">Qué tan amontonado está</h2>

        {reparto.alarma && (
          <Aviso tipo="atencion" titulo="Vale la pena mirarlo">
            El voto prestado está más amontonado de lo que el colectivo se puso como raya para
            revisarlo. <strong>Esto no invalida nada de lo que se decidió</strong>: es una marca
            para conversarlo, no un veredicto.
          </Aviso>
        )}

        {pocasPersonas && (
          <p className="suave">
            Son pocas personas sosteniendo voto ajeno, así que estas cifras se mueven mucho con muy
            poco: que una sola cambie a quién le presta el voto puede correrlas bastante.
          </p>
        )}

        <dl>
          <dt>
            <strong>Si está esparcido o en pocas manos: {reparto.reparto.texto}</strong>
          </dt>
          <dd>
            Cerca de cero significa que todo el mundo pesa más o menos lo mismo. Cerca del cien por
            ciento significa que una sola persona lo sostendría todo.
          </dd>

          <dt>
            <strong>Qué tan desparejo es: {reparto.desigualdad.texto}</strong>
          </dt>
          <dd>
            Mide lo mismo con otra sensibilidad: cero es que todas sostienen igual, y cuanto más
            sube, más diferencia hay entre quienes sostienen mucho y quienes sostienen poco.
          </dd>

          <dt>
            <strong>
              A qué parte del colectivo representa quien más sostiene:{' '}
              {reparto.mayorReceptor.publicado
                ? reparto.mayorReceptor.valor.texto
                : 'todavía no se dice'}
            </strong>
          </dt>
          <dd>
            {reparto.mayorReceptor.publicado ? (
              <>
                Es una fracción del padrón, sin sujeto: dice cuánta gente queda representada por la
                posición más alta del reparto, nunca quién la ocupa.
              </>
            ) : (
              <>
                Esta cifra sola es la que más se acerca a señalar a una persona, así que pide más
                gente que las otras dos: hacen falta al menos treinta personas sosteniendo voto
                prestado para que decirla no equivalga a nombrar a alguien.
              </>
            )}
          </dd>
        </dl>

        <dl className="datos-trabajo">
          <div>
            <dt>Sostienen algún voto</dt>
            <dd>{reparto.receptoresConPeso} personas</dd>
          </div>
          <div>
            <dt>Préstamos que no llegaron</dt>
            <dd>{reparto.personasSinAsignar}</dd>
          </div>
        </dl>
        {reparto.personasSinAsignar > 0 && (
          <p className="suave">
            Esos préstamos hoy no los sostiene nadie: se prestaron en círculo, la cadena se hizo
            demasiado larga, o quien iba a recibirlos ya no está entre quienes pueden decidir. Quien
            los prestó sigue pudiendo cambiarlos cuando quiera.
          </p>
        )}
      </section>

      <Tramos tramos={reparto.deciles} />
    </>
  );
}

/**
 * Los diez tramos.
 *
 * Cada barra es sólo un dibujo: la cifra va escrita al lado, siempre, y la barra lleva
 * `aria-hidden` porque repetir el mismo dato como una segunda cosa que anunciar no ayuda a nadie.
 * El ancho se compara **contra el tramo más grande** y no contra el total: con diez tramos, los de
 * abajo suelen quedar por debajo del uno por ciento y una barra de un píxel no dibuja ninguna
 * forma. Eso distorsiona la escala a propósito, así que se dice arriba, en palabras, antes del
 * dibujo —y la cifra exacta de cada tramo queda siempre al lado para quien la necesite exacta.
 */
function Tramos({ tramos }: { readonly tramos: readonly BaldeDeRepartoDto[] }): ReactNode {
  if (tramos.length === 0) return null;

  const filas = tramos.map((tramo, indice) => ({
    indice,
    tramo,
    parte: tramo.participacionDelPeso.numerador / tramo.participacionDelPeso.denominador,
  }));
  const mayor = Math.max(...filas.map((f) => f.parte));

  return (
    <section aria-labelledby="la-forma">
      <h2 id="la-forma">La forma del reparto</h2>
      <p>
        El padrón entero, partido en diez tramos <strong>del mismo tamaño</strong>, del que más voto
        sostiene al que menos. Cada tramo son decenas de personas y lo que se publica es la suma del
        tramo: aunque dentro de uno hubiera una sola persona con casi todo, el número no la separa
        del resto.
      </p>
      <p className="suave">
        Las barras se comparan entre sí, no contra el total: la más larga es el tramo que más
        sostiene, y las demás se dibujan a esa escala para que la forma se vea. La cifra de al lado
        sí es la de verdad.
      </p>
      {/*
       * `.pasos` y no `.tarjetas`: lo que hace falta acá es una caja con diez renglones separados
       * por un filete —una escala se lee de arriba abajo de un vistazo—, y eso es exactamente lo
       * que esa clase dibuja. Diez tarjetas sueltas, con su borde y su sombra cada una, romperían
       * en diez piezas lo que es una sola figura. La clase es presentación, no significado: nada
       * acá pretende ser un recorrido por etapas, y por eso no lleva `aria-current` ninguno.
       */}
      <ol className="pasos" role="list">
        {filas.map(({ indice, tramo, parte }) => (
          // El índice como clave: son diez posiciones fijas de una escala, no cosas con identidad
          // propia que puedan reordenarse.
          <li key={indice}>
            <strong>
              Tramo {indice + 1}
              {indice === 0 ? ' (el que más sostiene)' : ''}
              {indice === filas.length - 1 ? ' (el que menos sostiene)' : ''}
            </strong>{' '}
            — {tramo.personas} {tramo.personas === 1 ? 'persona' : 'personas'} sostienen el{' '}
            {tramo.participacionDelPeso.texto} del voto prestado.
            <div className="medidor-barra" aria-hidden="true" style={{ marginTop: 'var(--e2)' }}>
              <div
                className="medidor-relleno"
                style={{
                  width: `${String(Math.round(mayor > 0 ? (parte * 100) / mayor : 0))}%`,
                }}
              />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** De cuándo es la foto. Sin esto, una cifra vieja se lee como la de hoy. */
function Medido({ en }: { readonly en: number }): ReactNode {
  return (
    <p className="suave">Medido el {cuando(en)}, en el momento en que abriste esta pantalla.</p>
  );
}
