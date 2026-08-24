'use client';

/**
 * Abrir una votación: elegir con qué regla se va a decidir.
 *
 * ═══ El problema real de esta pantalla ═══
 *
 * No es el desplegable. Un desplegable con nueve entradas se escribe en diez minutos y deja a quien
 * abre exactamente donde estaba: eligiendo entre nueve nombres que no significan nada si no leíste
 * teoría de la elección social. Hasta este incremento la interfaz resolvía eso por la vía de no
 * ofrecer nada: `/propuestas/{id}` tenía un `<select>` con **dos** opciones escritas a mano, y los
 * otros siete métodos —que el motor cuenta desde siempre— no se podían alcanzar desde ninguna
 * pantalla.
 *
 * Así que lo que esta pantalla ofrece de cada método no es su nombre: es **en qué asunto conviene**,
 * **cuándo sería un error elegirlo** y **qué va a tener que llenar la gente**. Esas tres frases
 * viven en `../metodos-en-palabras.ts`; el nombre, la descripción y si admite prestar el voto salen
 * del catálogo del contrato (`GET /metodos`), para que renombrar un método no exija tocar la
 * pantalla.
 *
 * ═══ Nueve visibles, cinco abribles, y por qué se dice ═══
 *
 * Cuatro métodos —puntuación, voto por rondas, valoración por menciones y comparación por pares—
 * exigen una papeleta que hoy no cruza la red: `emitirPapeleta` en `@koinonia/contracts` sólo tiene
 * ramas para sí/no, abstención y consentimiento. Abrir una votación con uno de ellos crearía una
 * votación **que nadie puede responder**, en un historial que no se corrige ni se borra.
 *
 * La salida fácil sería esconderlos. No se esconden: quien abre tiene derecho a saber que existen y
 * para qué sirven, y esconderlos convertiría un hueco medible en un hueco invisible. Se muestran, no
 * se dejan elegir, y se dice por qué con todas las letras. `tests/unit/metodos-en-pantalla.test.ts`
 * comprueba contra el dominio y contra el contrato que esos cuatro son exactamente los que no tienen
 * papeleta que cruce la red, así que el día que la rama que falta aparezca, la prueba cae y nombra
 * el fichero de esta pantalla que hay que revisar.
 *
 * ═══ La configuración: lo que se pregunta y lo que no ═══
 *
 * Cada método admite campos extra (`configuracionDeMetodoHttp`). Preguntarlos todos sería devolverle
 * a quien abre la carga que esta pantalla existe para quitarle. Se pregunta sólo lo que cambia el
 * resultado de forma que alguien pueda decidirlo sin jerga —qué pasa con quien se abstiene, qué
 * fracción hace falta, cuántas vueltas se admiten, cuánta gente se sortea— y lo demás se queda en el
 * valor por defecto institucional que `service.ts` documenta contra GOVERNANCE.md. Lo que se manda
 * se valida **con el mismo esquema que el servidor va a parsear**, no con uno parecido.
 */

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type ReactNode, type SyntheticEvent } from 'react';

import {
  configuracionDeMetodoHttp,
  type ConfiguracionDeMetodoHttp,
  type IdMetodo,
  type PropuestaResumen,
} from '@koinonia/contracts';

import { Aviso, Cargando, ErrorVisible, useSesion } from '../../../components/marco';
import { Vacio } from '../../../components/piezas';
import { useAccionUnica } from '../../../lib/acciones';
import { cuando, enviar, traer } from '../../../lib/api';
import {
  admiteDelegacion,
  descripcionDelMetodo,
  enPalabras,
  METODOS_EN_PALABRAS,
  nombreDelMetodo,
  porQueTodaviaNo,
  sePuedeAbrirHoy,
} from '../metodos-en-palabras';

/** Las fracciones que se ofrecen para la mayoría reforzada, dichas como se dicen en voz alta. */
const FRACCIONES: readonly {
  readonly clave: string;
  readonly numerador: number;
  readonly denominador: number;
  readonly comoSeDice: string;
}[] = [
  { clave: '3/5', numerador: 3, denominador: 5, comoSeDice: 'Tres de cada cinco (60 %)' },
  {
    clave: '2/3',
    numerador: 2,
    denominador: 3,
    comoSeDice: 'Dos de cada tres (67 %) — lo habitual para cambiar reglas',
  },
  { clave: '3/4', numerador: 3, denominador: 4, comoSeDice: 'Tres de cada cuatro (75 %)' },
];

const HORA_MS = 3_600_000;

function Formulario(): ReactNode {
  const router = useRouter();
  const params = useSearchParams();
  const { sesion, cargando } = useSesion();

  const [propuestas, setPropuestas] = useState<PropuestaResumen[] | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const [errorAbrir, setErrorAbrir] = useState<unknown>(undefined);
  const { enCurso, ejecutar } = useAccionUnica();

  const [propuestaId, setPropuestaId] = useState(params.get('propuesta') ?? '');
  const [metodo, setMetodo] = useState<IdMetodo>('simple-majority');
  const [duracionHoras, setDuracionHoras] = useState('72');
  const [delegacion, setDelegacion] = useState(false);

  // Configuración por método. Cada estado arranca en el valor por defecto institucional, así que
  // quien no toque nada abre exactamente lo que GOVERNANCE.md manda para ese método.
  const [abstenciones, setAbstenciones] = useState<'excluir' | 'incluir' | 'como-no'>('excluir');
  const [fraccion, setFraccion] = useState('2/3');
  const [abstencionesBloquean, setAbstencionesBloquean] = useState(true);
  const [rondasMaximas, setRondasMaximas] = useState('3');
  const [tamanoDeMuestra, setTamanoDeMuestra] = useState('5');

  useEffect(() => {
    traer<PropuestaResumen[]>('/propuestas').then(setPropuestas).catch(setError);
  }, []);

  /**
   * Lo que se manda en `configuracion`, o nada.
   *
   * `undefined` cuando la elección coincide con el valor por defecto: mandar un campo con su propio
   * valor por defecto no cambia nada y sí congela en las reglas de la votación una decisión que
   * nadie tomó. Lo que se manda se valida contra el esquema del servidor antes de salir.
   */
  function configuracionElegida(id: IdMetodo): ConfiguracionDeMetodoHttp | undefined {
    switch (id) {
      case 'simple-majority':
        return abstenciones === 'excluir' ? undefined : { metodo: id, abstenciones };
      case 'supermajority': {
        const elegida = FRACCIONES.find((f) => f.clave === fraccion);
        return elegida === undefined
          ? undefined
          : {
              metodo: id,
              fraccion: { numerador: elegida.numerador, denominador: elegida.denominador },
            };
      }
      case 'unanimity':
        return abstencionesBloquean ? undefined : { metodo: id, abstencionesBloquean: false };
      case 'sociocratic-consent':
        return { metodo: id, rondasMaximas: Number(rondasMaximas) };
      case 'deliberative-sortition':
        return { metodo: id, tamanoDeMuestra: Number(tamanoDeMuestra) };
      default:
        // Los cuatro que hoy no se pueden abrir no llegan hasta acá: el formulario no los deja
        // elegir. Si alguna vez llegaran, salen sin configuración y el servidor pone los defectos.
        return undefined;
    }
  }

  async function abrir(evento: SyntheticEvent): Promise<void> {
    evento.preventDefault();
    setErrorAbrir(undefined);
    if (propuestaId === '') return;

    const configuracion = configuracionElegida(metodo);
    if (configuracion !== undefined) {
      const revisada = configuracionDeMetodoHttp.safeParse(configuracion);
      if (!revisada.success) {
        setErrorAbrir(
          new Error(
            'Alguno de los ajustes de este método quedó fuera de lo que se admite. Revisá los ' +
              'números de arriba antes de abrir.',
          ),
        );
        return;
      }
    }

    const cuerpo = {
      propuestaId,
      metodo,
      duracionHoras: Number(duracionHoras),
      ...(configuracion === undefined ? {} : { configuracion }),
      ...(delegacion ? { delegacion: true } : {}),
    };

    const resultado = await ejecutar('abrir-votacion', cuerpo, (requestId) =>
      enviar<{ id: string }>('/decisiones', { requestId, ...cuerpo }),
    );
    if (resultado.estado === 'hecho') router.push(`/decisiones/${resultado.valor.id}`);
    else if (resultado.estado === 'fallo') setErrorAbrir(resultado.error);
  }

  if (error !== undefined) {
    return (
      <div className="pagina-prosa">
        <h1>No pudimos preparar esta pantalla</h1>
        <ErrorVisible error={error} />
        <p>
          <Link className="boton secundario" href="/decisiones">
            Ver las decisiones
          </Link>
        </p>
      </div>
    );
  }

  if (cargando || propuestas === undefined) {
    return (
      <div className="pagina-prosa">
        <Cargando que="las propuestas que se pueden votar" />
      </div>
    );
  }

  // La sesión no decide si esto se puede hacer —eso lo vuelve a decidir el servidor— sino qué
  // mostrar. A quien no cuida el procedimiento se le dice qué hace falta, no «no autorizado».
  if (!(sesion?.roles.includes('facilitator') ?? false)) {
    return (
      <div className="pagina-prosa">
        <h1>Abrir una votación</h1>
        <Aviso tipo="atencion" titulo="Esto lo abre quien cuida el procedimiento">
          Abrir una votación es el acto más caro del sistema: cierra la lista de quiénes pueden
          decidir y congela las reglas. Por eso lo hace quien tiene ese encargo en el círculo.
          {sesion === undefined && (
            <>
              {' '}
              <Link href="/entrar">Entrar con el correo institucional</Link>.
            </>
          )}
        </Aviso>
        <p>
          <Link className="boton secundario" href="/propuestas">
            Ver las propuestas escritas
          </Link>
        </p>
      </div>
    );
  }

  const disponibles = propuestas.filter((p) => p.decisiones.length === 0);
  const propuesta = disponibles.find((p) => p.id === propuestaId);
  const horas = Number(duracionHoras);
  const cierraEn = Number.isFinite(horas) && horas > 0 ? Date.now() + horas * HORA_MS : undefined;
  const dicho = enPalabras(metodo);

  if (disponibles.length === 0) {
    return (
      <div className="pagina-prosa">
        <h1>Abrir una votación</h1>
        <Vacio
          titulo="No hay ninguna propuesta lista para votarse"
          salida={{ href: '/propuestas', texto: 'Ver las propuestas' }}
        >
          <p>
            Una votación se abre sobre un texto que alguien escribió antes, y ese texto sale de un
            problema discutido. Ahora mismo todas las propuestas escritas ya tienen su votación, o
            todavía no hay ninguna.
          </p>
          <p>
            Si lo que falta es la discusión previa, empieza en{' '}
            <Link href="/problemas">los problemas abiertos</Link>.
          </p>
        </Vacio>
      </div>
    );
  }

  return (
    <div className="pagina-detalle">
      <h1>Abrir una votación</h1>

      {/*
       * El carril: lo que se va a abrir, resumido, y la única acción de la pantalla. Va acá y no al
       * final del formulario porque la decisión que importa —el método— se toma leyendo el cuerpo, y
       * quien va eligiendo necesita ver a cada paso qué queda armado.
       */}
      <aside className="carril-estado" aria-label="Lo que se va a abrir">
        <section aria-labelledby="resumen-titulo">
          <h2 id="resumen-titulo">Lo que se va a abrir</h2>
          <p>
            {propuesta === undefined
              ? 'Todavía no elegiste qué texto se somete.'
              : `«${propuesta.titulo}», en su versión ${String(propuesta.versionVigente)}.`}
          </p>
          <p>
            Se decide con <strong>{nombreDelMetodo(metodo)}</strong>. {descripcionDelMetodo(metodo)}
          </p>
          {cierraEn !== undefined && <p className="suave">Cerraría el {cuando(cierraEn)}</p>}
        </section>

        <p className="suave">
          Al abrirla, las reglas y la lista de quiénes pueden decidir se congelan y ya no se
          cambian. El texto tampoco: se somete la versión que esté vigente en este momento.
        </p>

        {!sePuedeAbrirHoy(metodo) && (
          <Aviso tipo="atencion" titulo="Con esta regla no se puede abrir">
            Elegí otra de la lista. Abrirla igual dejaría una votación que nadie puede responder, y
            lo escrito en el historial no se borra.
          </Aviso>
        )}

        <ErrorVisible error={errorAbrir} />
        {/*
         * Este `disabled` es la guarda de verdad, no un adorno: los métodos bloqueados sí se pueden
         * elegir (para poder leerlos), así que es acá donde se impide abrir. El servidor vuelve a
         * decidir por su cuenta, como siempre.
         */}
        <button
          className="boton"
          type="submit"
          form="abrir-votacion"
          disabled={enCurso !== undefined || propuestaId === '' || !sePuedeAbrirHoy(metodo)}
        >
          {enCurso === 'abrir-votacion' ? 'Abriendo…' : 'Abrir la votación'}
        </button>
      </aside>

      <div className="cuerpo-detalle">
        <form
          id="abrir-votacion"
          className="formulario-acotado"
          onSubmit={(evento) => void abrir(evento)}
          noValidate
        >
          <section aria-labelledby="texto-titulo">
            <h2 id="texto-titulo">¿Qué texto se somete?</h2>
            <div className="campo">
              <label htmlFor="propuesta">Propuesta</label>
              <span className="ayuda" id="ayuda-propuesta">
                Sólo aparecen las que todavía no tienen una votación abierta. Una propuesta no se
                vota dos veces: si hace falta volver sobre ella, se escribe una versión nueva.
              </span>
              <select
                id="propuesta"
                required
                aria-describedby="ayuda-propuesta"
                value={propuestaId}
                onChange={(evento) => {
                  setPropuestaId(evento.target.value);
                }}
              >
                <option value="">Elegí una propuesta</option>
                {disponibles.map((candidata) => (
                  <option key={candidata.id} value={candidata.id}>
                    {candidata.titulo}
                  </option>
                ))}
              </select>
            </div>
            {propuesta !== undefined && (
              <p className="suave">
                <Link href={`/propuestas/${propuesta.id}`}>
                  Leer el texto completo antes de abrir
                </Link>
              </p>
            )}
          </section>

          <section aria-labelledby="metodo-titulo">
            <h2 id="metodo-titulo">¿Con qué regla se decide?</h2>
            <p>
              No hay una regla mejor que las otras: hay una que le queda bien a este asunto. Debajo
              de cada nombre está en qué casos conviene; al elegir uno se abre lo demás.
            </p>

            <fieldset className="opciones">
              <legend>Métodos</legend>
              {METODOS_EN_PALABRAS.map((item) => {
                const abrible = sePuedeAbrirHoy(item.id);
                const elegido = metodo === item.id;
                return (
                  <div className="opcion" key={item.id}>
                    {/*
                      Los cuatro que todavía no se pueden abrir **no** llevan `disabled`. Un control
                      deshabilitado no recibe el foco, así que quien navega con teclado o con lector
                      de pantalla saltaría justo los métodos que hay que explicar y no oiría nunca
                      por qué no están. Acá se pueden elegir y leer enteros; lo que está apagado es
                      la apertura, con el motivo escrito al lado del botón.
                    */}
                    <input
                      type="radio"
                      id={`metodo-${item.id}`}
                      name="metodo"
                      value={item.id}
                      checked={elegido}
                      aria-describedby={`porque-${item.id}`}
                      onChange={() => {
                        setMetodo(item.id);
                      }}
                    />
                    <label htmlFor={`metodo-${item.id}`}>
                      {nombreDelMetodo(item.id)}
                      {!abrible && ' — todavía no se puede abrir'}
                    </label>
                    {/*
                      La misma frase para los nueve: en qué caso conviene. Es lo que hace elegible
                      la lista de un vistazo. El porqué largo de los que no se pueden abrir va una
                      sola vez, en la ficha de abajo, y no cuatro veces dentro de la lista.
                    */}
                    <span className="explica" id={`porque-${item.id}`}>
                      {item.cuandoConviene}
                    </span>
                  </div>
                );
              })}
            </fieldset>

            {/*
             * El detalle del método elegido, y sólo de ése. Nueve fichas completas a la vez son
             * cuatro pantallas de teléfono que nadie lee; una, junto a la elección que se acaba de
             * hacer, se lee entera.
             */}
            <div className="version vigente">
              <h3>{nombreDelMetodo(metodo)}</h3>
              <p>{descripcionDelMetodo(metodo)}</p>
              <p>
                <strong>Un caso así:</strong> {dicho.ejemplo}
              </p>
              <p>
                <strong>Cuándo sería un error:</strong> {dicho.cuandoNo}
              </p>
              <p>
                <strong>Qué va a llenar la gente:</strong> {dicho.queLlenaLaGente}
              </p>
              {!sePuedeAbrirHoy(metodo) && (
                <Aviso tipo="atencion" titulo="Todavía no se puede abrir con esta regla">
                  {porQueTodaviaNo(metodo)}
                </Aviso>
              )}
            </div>
          </section>

          {sePuedeAbrirHoy(metodo) && (
            <>
              <section aria-labelledby="ajustes-titulo">
                <h2 id="ajustes-titulo">Ajustes de esta regla</h2>
                <p className="suave">
                  Lo que no se toca acá queda en el valor que el acuerdo del grupo tiene por defecto
                  para este método.
                </p>

                {metodo === 'simple-majority' && (
                  <fieldset className="opciones">
                    <legend>¿Qué se hace con quien se abstiene?</legend>
                    <div className="opcion">
                      <input
                        type="radio"
                        id="abst-excluir"
                        name="abstenciones"
                        checked={abstenciones === 'excluir'}
                        onChange={() => {
                          setAbstenciones('excluir');
                        }}
                      />
                      <label htmlFor="abst-excluir">No cuenta para el «más síes que noes»</label>
                      <span className="explica">
                        Lo habitual. Abstenerse sigue contando para la participación mínima.
                      </span>
                    </div>
                    <div className="opcion">
                      <input
                        type="radio"
                        id="abst-incluir"
                        name="abstenciones"
                        checked={abstenciones === 'incluir'}
                        onChange={() => {
                          setAbstenciones('incluir');
                        }}
                      />
                      <label htmlFor="abst-incluir">Cuenta como respuesta emitida</label>
                      <span className="explica">
                        Sube el listón: hacen falta más síes para llegar a la mitad.
                      </span>
                    </div>
                    <div className="opcion">
                      <input
                        type="radio"
                        id="abst-como-no"
                        name="abstenciones"
                        checked={abstenciones === 'como-no'}
                        onChange={() => {
                          setAbstenciones('como-no');
                        }}
                      />
                      <label htmlFor="abst-como-no">Cuenta como un no</label>
                      <span className="explica">
                        Lo más exigente. Decilo en la propuesta: quien se abstiene tiene derecho a
                        saber que su silencio pesa en contra.
                      </span>
                    </div>
                  </fieldset>
                )}

                {metodo === 'supermajority' && (
                  <fieldset className="opciones">
                    <legend>¿Cuántos síes hacen falta?</legend>
                    {FRACCIONES.map((opcion) => (
                      <div className="opcion" key={opcion.clave}>
                        <input
                          type="radio"
                          id={`fraccion-${opcion.clave}`}
                          name="fraccion"
                          checked={fraccion === opcion.clave}
                          onChange={() => {
                            setFraccion(opcion.clave);
                          }}
                        />
                        <label htmlFor={`fraccion-${opcion.clave}`}>{opcion.comoSeDice}</label>
                      </div>
                    ))}
                  </fieldset>
                )}

                {metodo === 'unanimity' && (
                  <fieldset className="opciones">
                    <legend>¿Abstenerse rompe el acuerdo?</legend>
                    <div className="opcion">
                      <input
                        type="radio"
                        id="unan-si"
                        name="abstencionesBloquean"
                        checked={abstencionesBloquean}
                        onChange={() => {
                          setAbstencionesBloquean(true);
                        }}
                      />
                      <label htmlFor="unan-si">Sí: hace falta que todo el mundo diga que sí</label>
                      <span className="explica">
                        La regla más fuerte, y la que se aplica si nadie decide lo contrario.
                      </span>
                    </div>
                    <div className="opcion">
                      <input
                        type="radio"
                        id="unan-no"
                        name="abstencionesBloquean"
                        checked={!abstencionesBloquean}
                        onChange={() => {
                          setAbstencionesBloquean(false);
                        }}
                      />
                      <label htmlFor="unan-no">No: basta con que nadie diga que no</label>
                      <span className="explica">
                        Aflojarla exige que el círculo lo haya decidido antes. Si no lo decidió, el
                        servidor va a rechazar la apertura.
                      </span>
                    </div>
                  </fieldset>
                )}

                {metodo === 'sociocratic-consent' && (
                  <div className="campo">
                    <label htmlFor="rondas">
                      ¿Cuántas vueltas de enmienda se admiten antes de cerrar sin acuerdo?
                    </label>
                    <span className="ayuda" id="ayuda-rondas">
                      Entre 1 y 5. En cada vuelta se integra lo que se objetó y se vuelve a
                      preguntar. Tres es lo habitual: más vueltas cansan al grupo y menos no dan
                      tiempo a corregir nada.
                    </span>
                    <input
                      id="rondas"
                      type="number"
                      min={1}
                      max={5}
                      inputMode="numeric"
                      aria-describedby="ayuda-rondas"
                      value={rondasMaximas}
                      onChange={(evento) => {
                        setRondasMaximas(evento.target.value);
                      }}
                    />
                  </div>
                )}

                {metodo === 'deliberative-sortition' && (
                  <div className="campo">
                    <label htmlFor="muestra">¿A cuántas personas se sortea?</label>
                    <span className="ayuda" id="ayuda-muestra">
                      Entre 1 y 100. El sorteo reparte los puestos entre los mismos grupos en que
                      está repartida la gente que podía decidir, para que la muestra no salga toda
                      del mismo lado.
                    </span>
                    <input
                      id="muestra"
                      type="number"
                      min={1}
                      max={100}
                      inputMode="numeric"
                      aria-describedby="ayuda-muestra"
                      value={tamanoDeMuestra}
                      onChange={(evento) => {
                        setTamanoDeMuestra(evento.target.value);
                      }}
                    />
                  </div>
                )}

                {admiteDelegacion(metodo) ? (
                  <div className="opcion">
                    <input
                      type="checkbox"
                      id="delegacion"
                      checked={delegacion}
                      onChange={(evento) => {
                        setDelegacion(evento.target.checked);
                      }}
                    />
                    <label htmlFor="delegacion">
                      Se le puede prestar el voto a otra persona en esta votación
                    </label>
                    <span className="explica">
                      Apagado si no se dice nada. Se decide ahora y no se cambia después.
                    </span>
                  </div>
                ) : (
                  <p className="suave">
                    En este método no se le puede prestar el voto a nadie: lo que se pide es que
                    cada quien mire este asunto y diga lo suyo.
                  </p>
                )}
              </section>

              <section aria-labelledby="plazo-titulo">
                <h2 id="plazo-titulo">¿Cuánto tiempo hay para responder?</h2>
                <div className="campo">
                  <label htmlFor="duracion">Horas</label>
                  <span className="ayuda" id="ayuda-duracion">
                    Entre 1 hora y 30 días. Dale tiempo suficiente para leer y responder sin tener
                    que juntarse: 72 horas cubre un fin de semana.
                  </span>
                  <input
                    id="duracion"
                    type="number"
                    required
                    min={1}
                    max={720}
                    inputMode="numeric"
                    aria-describedby="ayuda-duracion"
                    value={duracionHoras}
                    onChange={(evento) => {
                      setDuracionHoras(evento.target.value);
                    }}
                  />
                </div>
              </section>
            </>
          )}
        </form>
      </div>
    </div>
  );
}

export default function AbrirVotacion(): ReactNode {
  return (
    // `role="status"` para que la espera se anuncie: sin él, quien usa un lector de pantalla se
    // queda ante una página muda mientras se resuelven los parámetros de la dirección.
    <Suspense
      fallback={
        <div className="pagina-prosa">
          <p className="cargando" role="status">
            Cargando el formulario…
          </p>
        </div>
      }
    >
      <Formulario />
    </Suspense>
  );
}
