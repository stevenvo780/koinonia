'use client';

/**
 * La memoria institucional: qué aprendió el colectivo, y de qué iniciativa salió cada cosa.
 *
 * ═══ Por qué la pantalla es una BÚSQUEDA y no un archivo ═══
 *
 * Un archivo ordenado por fecha se lee una vez, el día que se publica, y nunca más. La memoria de
 * un colectivo sólo sirve en un momento muy concreto: cuando alguien está a punto de escribir un
 * problema que ya se intentó resolver. Por eso la acción principal de esta pantalla no es «filtrar»
 * ni «ordenar», es **pegar el problema que traés y ver qué se aprendió de intentos parecidos** —que
 * es exactamente lo que `GET /aprendizajes/parecidos` hace y lo único que esa ruta añade sobre el
 * listado que ya existía—. El listado completo sigue estando, debajo, para quien llega sin pregunta.
 *
 * ═══ Por qué se enseñan las palabras que coincidieron ═══
 *
 * El parecido de esa ruta es léxico y no semántico: cuenta cuántas palabras del problema nuevo
 * aparecen tal cual en el aprendizaje. Enseñar un porcentaje a secas invitaría a leerlo como un
 * juicio de un sistema que entiende; enseñar **con qué palabras** se justificó cada fila deja que
 * quien lee descarte en dos segundos una coincidencia tonta. La cifra sin la prueba sería peor que
 * no dar cifra.
 *
 * ═══ Qué NO hace esta pantalla ═══
 *
 * No dice quién escribió cada aprendizaje ni cuántos escribió nadie: un aprendizaje es del
 * colectivo y del intento del que salió, nunca de una persona (ADR-0039/0040). El contrato
 * directamente no trae autoría, y aquí no se inventa.
 */

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

import type {
  CoincidenciaDeAprendizaje,
  DesenlaceEvaluacion,
  DisposicionAcuerdo,
  EntradaDeMemoria,
  TipoDeAprendizaje,
} from '@koinonia/contracts';

import { ErrorVisible } from '../../components/marco';
import {
  Esqueleto,
  Ficha,
  Meta,
  Tarjeta,
  Vacio,
  type VarianteFicha,
} from '../../components/piezas';
import { fechaCortaEnFrase, traer } from '../../lib/api';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// El vocabulario cerrado, dicho en español llano
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Los cuatro tipos y los cuatro desenlaces viajan por la API como identificadores con guiones
// (`lo-que-no-hay-que-repetir`, `inconcluso`). Nada de eso se dibuja crudo: un identificador en
// pantalla es jerga aunque esté en español, y ADR-0041 no distingue entre jerga en inglés y jerga
// en castellano.

const TIPO_EN_PALABRAS: Readonly<Record<TipoDeAprendizaje, string>> = {
  'lo-que-funciono': 'Lo que funcionó',
  'lo-que-no-funciono': 'Lo que no funcionó',
  'lo-que-faltaba-saber': 'Lo que faltaba saber antes',
  'lo-que-no-hay-que-repetir': 'Lo que no hay que repetir',
};

/** El símbolo y el tono los pone `<Ficha>`; acá sólo se elige cuál le toca a cada tipo. */
const VARIANTE_POR_TIPO: Readonly<Record<TipoDeAprendizaje, VarianteFicha>> = {
  'lo-que-funciono': 'bien',
  'lo-que-no-funciono': 'mal',
  'lo-que-faltaba-saber': 'neutra',
  'lo-que-no-hay-que-repetir': 'atencion',
};

const DESENLACE_EN_PALABRAS: Readonly<Record<DesenlaceEvaluacion, string>> = {
  logrado: 'la iniciativa logró lo que buscaba',
  parcial: 'la iniciativa lo logró a medias',
  fallido: 'la iniciativa no lo logró',
  inconcluso: 'la iniciativa quedó sin cerrar',
};

const DISPOSICION_EN_PALABRAS: Readonly<Record<DisposicionAcuerdo, string>> = {
  mantener: 'el acuerdo siguió igual',
  enmendar: 'el acuerdo se corrigió',
  derogar: 'el acuerdo se dio de baja',
  escalar: 'el asunto se llevó más arriba',
};

const TIPOS: readonly TipoDeAprendizaje[] = [
  'lo-que-funciono',
  'lo-que-no-funciono',
  'lo-que-faltaba-saber',
  'lo-que-no-hay-que-repetir',
];

const DESENLACES: readonly DesenlaceEvaluacion[] = ['logrado', 'parcial', 'fallido', 'inconcluso'];

/** El mínimo que exige el contrato de la ruta: menos de tres letras no da para comparar nada. */
const MINIMO_TITULO = 3;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// La consulta
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Arma la cola de la dirección a mano en vez de con `URLSearchParams`.
 *
 * No es purismo: los cuatro parámetros que se mandan son texto libre de quien escribe (el título y
 * el cuerpo del problema), y `encodeURIComponent` es la única pieza que hace falta para que un «&»
 * escrito por una persona no parta la consulta en dos. Un parámetro vacío no se manda: la ruta
 * valida con un esquema cerrado y una cadena vacía no es lo mismo que «sin filtro».
 */
function conParametros(base: string, parametros: readonly (readonly [string, string])[]): string {
  const puestos = parametros
    .filter(([, valor]) => valor !== '')
    .map(([clave, valor]) => `${clave}=${encodeURIComponent(valor)}`);
  return puestos.length === 0 ? base : `${base}?${puestos.join('&')}`;
}

/** Lo que se pidió al servidor: la memoria entera, o los parecidos a un problema concreto. */
type Consulta = { readonly titulo: string; readonly cuerpo: string } | undefined;

/**
 * Lo que hay en pantalla. Se separan las dos clases porque sólo una trae la razón por la que cada
 * fila apareció, y esa diferencia tiene que sobrevivir a los tipos en vez de resolverse con un
 * campo opcional que nadie sabe cuándo está.
 */
type Vista =
  | { readonly clase: 'memoria'; readonly filas: readonly EntradaDeMemoria[] }
  | { readonly clase: 'parecidos'; readonly filas: readonly CoincidenciaDeAprendizaje[] };

// ═════════════════════════════════════════════════════════════════════════════════════════════
// La pantalla
// ═════════════════════════════════════════════════════════════════════════════════════════════

export default function Aprendizajes(): ReactNode {
  const [titulo, setTitulo] = useState('');
  const [cuerpo, setCuerpo] = useState('');
  const [tipo, setTipo] = useState('');
  const [desenlace, setDesenlace] = useState('');
  const [consulta, setConsulta] = useState<Consulta>(undefined);
  const [vista, setVista] = useState<Vista | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const [reproche, setReproche] = useState<string | undefined>(undefined);

  // Un solo efecto para las dos rutas: `consulta` es lo que decide cuál se llama, y los dos filtros
  // valen igual para ambas. Con dos efectos, cambiar un filtro mientras hay una búsqueda hecha
  // dispararía las dos peticiones y ganaría la que contestara más tarde.
  useEffect(() => {
    let vivo = true;
    setVista(undefined);
    setError(undefined);

    const filtros: readonly (readonly [string, string])[] = [
      ['tipo', tipo],
      ['desenlace', desenlace],
    ];

    if (consulta === undefined) {
      traer<EntradaDeMemoria[]>(conParametros('/aprendizajes', filtros))
        .then((filas) => {
          if (vivo) setVista({ clase: 'memoria', filas });
        })
        .catch((fallo: unknown) => {
          if (vivo) setError(fallo);
        });
    } else {
      const ruta = conParametros('/aprendizajes/parecidos', [
        ['titulo', consulta.titulo],
        ['cuerpo', consulta.cuerpo],
        ...filtros,
      ]);
      traer<CoincidenciaDeAprendizaje[]>(ruta)
        .then((filas) => {
          if (vivo) setVista({ clase: 'parecidos', filas });
        })
        .catch((fallo: unknown) => {
          if (vivo) setError(fallo);
        });
    }

    return () => {
      vivo = false;
    };
  }, [consulta, tipo, desenlace]);

  const buscando = consulta !== undefined;

  return (
    <div className="pagina-indice">
      <h1>Lo que ya aprendimos</h1>
      <p className="lede">
        Cada vez que una iniciativa se revisa, lo que se aprendió de ella queda escrito acá, pegado
        a la decisión de la que salió. No es un archivo para leer de corrido:{' '}
        <strong>
          es para consultarlo antes de escribir un problema, y ver si esto ya se intentó y cómo fue.
        </strong>
      </p>

      <section aria-labelledby="buscar-titulo">
        <h2 id="buscar-titulo">Traé tu problema y mirá qué se aprendió de intentos parecidos</h2>

        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const limpio = titulo.trim();
            if (limpio.length < MINIMO_TITULO) {
              setReproche(
                'Escribí al menos tres letras del problema. Con menos no hay nada que comparar.',
              );
              return;
            }
            setReproche(undefined);
            setConsulta({ titulo: limpio, cuerpo: cuerpo.trim() });
          }}
        >
          <div className="campo">
            <label htmlFor="problema-titulo">En una frase, ¿qué está pasando?</label>
            <span className="ayuda" id="ayuda-problema-titulo">
              Con las mismas palabras que usarías para escribirlo como problema. Ejemplo: «la sala
              de estudio cierra a las 6 y la nocturna no tiene dónde leer».
            </span>
            <input
              id="problema-titulo"
              name="problema-titulo"
              type="text"
              maxLength={200}
              aria-describedby={
                reproche === undefined
                  ? 'ayuda-problema-titulo'
                  : 'ayuda-problema-titulo reproche-titulo'
              }
              {...(reproche === undefined ? {} : { 'aria-invalid': true as const })}
              value={titulo}
              onChange={(e) => {
                setTitulo(e.target.value);
              }}
            />
            {reproche !== undefined && (
              <p className="error-campo" id="reproche-titulo" role="alert">
                {reproche}
              </p>
            )}
          </div>

          <div className="campo">
            <label htmlFor="problema-cuerpo">Si querés, contá más (opcional)</label>
            <span className="ayuda" id="ayuda-problema-cuerpo">
              Cuantas más palabras concretas escribas, mejor se encuentran los intentos parecidos:
              se comparan palabra por palabra, no por significado.
            </span>
            <textarea
              id="problema-cuerpo"
              name="problema-cuerpo"
              maxLength={4000}
              aria-describedby="ayuda-problema-cuerpo"
              value={cuerpo}
              onChange={(e) => {
                setCuerpo(e.target.value);
              }}
            />
          </div>

          <div className="campo">
            <label htmlFor="filtro-tipo">Mostrar sólo</label>
            <select
              id="filtro-tipo"
              name="filtro-tipo"
              value={tipo}
              onChange={(e) => {
                setTipo(e.target.value);
              }}
            >
              <option value="">Todo lo que se aprendió</option>
              {TIPOS.map((valor) => (
                <option key={valor} value={valor}>
                  {TIPO_EN_PALABRAS[valor]}
                </option>
              ))}
            </select>
          </div>

          <div className="campo">
            <label htmlFor="filtro-desenlace">De iniciativas en las que</label>
            <select
              id="filtro-desenlace"
              name="filtro-desenlace"
              value={desenlace}
              onChange={(e) => {
                setDesenlace(e.target.value);
              }}
            >
              <option value="">Pasó cualquier cosa</option>
              {DESENLACES.map((valor) => (
                <option key={valor} value={valor}>
                  {DESENLACE_EN_PALABRAS[valor]}
                </option>
              ))}
            </select>
          </div>

          <button className="boton" type="submit">
            Buscar intentos parecidos
          </button>
          {buscando && (
            <>
              {' '}
              <button
                className="boton secundario"
                type="button"
                onClick={() => {
                  setConsulta(undefined);
                  setReproche(undefined);
                }}
              >
                Ver toda la memoria
              </button>
            </>
          )}
        </form>
      </section>

      <ErrorVisible error={error} />

      <section aria-labelledby="resultados-titulo">
        <h2 id="resultados-titulo">
          {buscando
            ? 'Lo que se parece a lo que escribiste'
            : 'Toda la memoria, de lo más reciente'}
        </h2>

        {/*
         * El orden se dice, no se deja adivinar. La ruta ordena por cuántas palabras del problema
         * aparecen en cada aprendizaje, y sin esa frase la primera fila se lee como «la más
         * importante» —que no es lo mismo y sería un juicio que nadie hizo.
         */}
        {buscando && (
          <p className="suave">
            Arriba va el que comparte más palabras con lo que escribiste. Se comparan las palabras
            tal cual, no lo que significan: una coincidencia puede ser casualidad, y por eso cada
            fila dice con qué palabras salió.
          </p>
        )}

        {vista === undefined && error === undefined && (
          <Esqueleto que={buscando ? 'los intentos parecidos' : 'la memoria'} />
        )}

        {vista !== undefined && vista.filas.length === 0 && (
          <SinNada
            buscando={buscando}
            filtrado={tipo !== '' || desenlace !== ''}
            quitarFiltros={() => {
              setTipo('');
              setDesenlace('');
            }}
          />
        )}

        {vista !== undefined && vista.filas.length > 0 && (
          <ul className="tarjetas">
            {vista.clase === 'memoria'
              ? vista.filas.map((fila) => (
                  <FilaDeMemoria key={fila.aprendizaje.id} fila={fila} porQue={undefined} />
                ))
              : vista.filas.map((fila) => (
                  <FilaDeMemoria
                    key={fila.aprendizaje.id}
                    fila={fila}
                    porQue={fila.palabrasCoincidentes}
                  />
                ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Las piezas de esta pantalla
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Una fila de la memoria.
 *
 * El enlace de la tarjeta va a la **iniciativa**, no a la evaluación: «de qué salió esto» es la
 * pregunta que se hace quien acaba de leer el aprendizaje, y la iniciativa es la que tiene el plan,
 * el desenlace y la decisión que la originó, todo junto.
 */
function FilaDeMemoria({
  fila,
  porQue,
}: {
  readonly fila: EntradaDeMemoria;
  readonly porQue: readonly string[] | undefined;
}): ReactNode {
  const { aprendizaje } = fila;
  return (
    <Tarjeta titulo={aprendizaje.enunciado} enlace={`/iniciativas/${fila.iniciativaId}`}>
      <Ficha variante={VARIANTE_POR_TIPO[aprendizaje.tipo]}>
        {TIPO_EN_PALABRAS[aprendizaje.tipo]}
      </Ficha>
      {porQue !== undefined && porQue.length > 0 && (
        <p className="suave">
          Aparece porque usás las mismas palabras: {porQue.map((p) => `«${p}»`).join(', ')}.
        </p>
      )}
      <Meta>
        {DESENLACE_EN_PALABRAS[fila.desenlace]}
        {fila.disposicion === undefined ? null : DISPOSICION_EN_PALABRAS[fila.disposicion]}
        {`escrito ${fechaCortaEnFrase(aprendizaje.en)}`}
      </Meta>
      {aprendizaje.etiquetas.length > 0 && (
        <p>
          {aprendizaje.etiquetas.map((etiqueta) => (
            <span className="etiqueta" key={etiqueta}>
              {etiqueta}
            </span>
          ))}
        </p>
      )}
      <p className="suave">
        <Link href={`/decisiones/${fila.decisionId}`}>Ver la decisión que lo originó</Link>
      </p>
    </Tarjeta>
  );
}

/**
 * Los tres huecos posibles, cada uno con su propia salida. Es el punto de PRODUCT.md §4 que más se
 * incumple: un estado vacío que dice «no hay resultados» y deja a quien lee sin nada que hacer.
 */
function SinNada({
  buscando,
  filtrado,
  quitarFiltros,
}: {
  readonly buscando: boolean;
  readonly filtrado: boolean;
  readonly quitarFiltros: () => void;
}): ReactNode {
  if (buscando) {
    return (
      <Vacio
        titulo="Nadie intentó todavía algo parecido a esto"
        salida={{ href: '/problemas/nuevo', texto: 'Escribir el problema' }}
      >
        <p>
          Ningún aprendizaje comparte palabras con lo que escribiste. Puede ser que el problema sea
          nuevo de verdad, o que se haya escrito con otras palabras: probá con las palabras más
          concretas del asunto —el lugar, la hora, el trámite— antes de darlo por nuevo.
          {filtrado && ' Y tené en cuenta que estás mostrando sólo una parte de la memoria.'}
        </p>
      </Vacio>
    );
  }
  if (filtrado) {
    /*
     * Éste es el único hueco de los tres cuya salida NO es otra pantalla, y por eso no usa
     * `<Vacio>`: la salida que corresponde acá es «quitá los filtros», y `<Vacio>` sólo sabe
     * dibujar un enlace. Un enlace a `/aprendizajes` desde `/aprendizajes` sería una salida
     * falsa —el segmento no se vuelve a montar, así que los dos desplegables se quedarían como
     * están y quien lo pulsara vería exactamente la misma pantalla vacía—. Se conserva la forma
     * que exige PRODUCT.md §4 (título, explicación y UNA salida) y la misma caja `.vacio`; lo
     * único que cambia es que la salida es un botón que de verdad hace algo.
     */
    return (
      <div className="vacio" role="status">
        <h3>Nada de la memoria encaja en lo que pediste</h3>
        <p>
          Hay cosas aprendidas, pero ninguna que sea de ese tipo y venga de una iniciativa que
          terminara así, las dos cosas a la vez.
        </p>
        <p>
          <button className="boton secundario" type="button" onClick={quitarFiltros}>
            Ver toda la memoria
          </button>
        </p>
      </div>
    );
  }
  return (
    <Vacio
      titulo="Todavía no hay nada aprendido"
      salida={{ href: '/iniciativas', texto: 'Ver las iniciativas en marcha' }}
    >
      <p>
        No es un hueco: acá sólo entra lo que sale de{' '}
        <strong>revisar una iniciativa ya andada</strong>. Mientras ninguna llegue a su revisión, la
        memoria está vacía y tiene que estarlo —escribir aprendizajes antes de haber intentado nada
        sería inventarlos.
      </p>
    </Vacio>
  );
}
