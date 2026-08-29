'use client';

/**
 * Corregí tus datos (Ley 1581, art. 8 lit. a): la hermana de la pantalla de supresión que todavía
 * no existe, sobre el mismo autoservicio que ya expone `POST /mi/rectificacion`.
 *
 * ═══ Por qué el correo no está en la lista ═══
 *
 * Sólo se ofrecen los tres datos que el servidor acepta corregir por autoservicio: cómo te
 * saludamos, tu semestre y tu jornada. El correo institucional queda fuera **a propósito**, y se lo
 * dice más abajo en la propia pantalla en vez de fingir que no hace falta: es también la forma en
 * que entrás a tu cuenta, así que corregirlo con la misma liviandad que un alias podría dejar que
 * otra persona se quedara con la tuya, o que vos te quedaras afuera por una errata. Falta construir,
 * con cuidado, la confirmación de que la dirección nueva es tuya antes de ofrecerlo acá — ver
 * `pii-rectification.ts` en el servidor para el detalle completo de qué falta y por qué.
 *
 * ═══ Por qué un solo campo dinámico, y no tres campos siempre visibles ═══
 *
 * El servidor sólo acepta corregir UNO a la vez (`solicitarRectificacion` en `@koinonia/contracts`
 * es una unión discriminada por `campo`, no un formulario de casilleros sueltos), y la pantalla
 * respeta esa forma en vez de disimularla con varios campos que en el fondo mandan peticiones
 * distintas. Elegir primero qué corregir y completar después evita además el error más fácil de
 * cometer acá: mandar una jornada en el casillero del semestre porque los dos estaban a la vista a
 * la vez.
 *
 * ═══ Por qué semestre y jornada son una lista, no un campo de texto ═══
 *
 * El servidor sólo acepta uno de un conjunto cerrado de valores para los dos —son la forma en que
 * la comunidad se agrupa en la pantalla pública de salud del grupo, y un valor inventado ahí no es
 * un dato mal escrito, es un agujero—. La pantalla ofrece exactamente esa lista, para que nunca
 * haga falta adivinar qué forma tiene que tener el dato correcto.
 *
 * ═══ Por qué no se muestra el semestre ni la jornada actuales ═══
 *
 * No hay ninguna ruta que los devuelva. `/auth/estado` sólo expone el alias —porque es lo único que
 * hace falta para saludar en toda la aplicación—. Construir una ruta de lectura completa es el
 * derecho de ACCESO del mismo artículo 8 —lit. f, «conocer»—, y es un trabajo distinto del que pide
 * esta pantalla, que es sólo «corregir». El alias sí se muestra, porque ya viaja en la sesión.
 *
 * ═══ Por qué el valor se borra al cambiar de campo, pero no al terminar ═══
 *
 * Si alguien empieza a corregir el semestre y cambia de idea hacia la jornada, un valor que
 * sobrevive al cambio de campo es un envío del semestre como jornada esperando a que nadie se dé
 * cuenta: se vacía. La confirmación, en cambio, SÍ conserva el valor que se acaba de guardar —en el
 * propio estado de este componente, nunca en la respuesta del servidor, que deliberadamente no lo
 * repite (ver `rectificacionAplicada` en `@koinonia/contracts`)— para que quien corrigió pueda leer
 * exactamente qué quedó escrito, en vez de un «listo» sin ningún dato con el que comprobarlo.
 */

import Link from 'next/link';
import { useRef, useState, type ReactNode, type SyntheticEvent } from 'react';

import type { CampoRectificable, RectificacionAplicada } from '@koinonia/contracts';
import { JORNADAS, SEMESTRES } from '@koinonia/contracts';

import { Aviso, Cargando, ErrorVisible, useSesion } from '../../components/marco';
import { useAccionUnica } from '../../lib/acciones';
import { cuando, enviar, ErrorDeApi } from '../../lib/api';
import { enfocarTrasPintar } from '../../lib/foco';

/**
 * «s8» → «8.º semestre». El único lugar del cliente que conoce esta forma.
 *
 * Con clave `string` y no `(typeof SEMESTRES)[number]` a propósito: lo que llega en tiempo de
 * ejecución es lo que el servidor mandó de vuelta o lo que ya estaba en el estado del componente,
 * nunca algo que el compilador pueda garantizar que sigue siendo una de las diez etiquetas. Con la
 * clave estrecha, TypeScript «demuestra» que la búsqueda nunca falla y el `??` de abajo se vuelve
 * código muerto a sus ojos —exactamente lo que rompería, en silencio, el día en que este mapa y
 * `SEMESTRES` se desincronicen—.
 */
const ETIQUETA_DE_SEMESTRE: Readonly<Record<string, string>> = {
  s1: '1.º semestre',
  s2: '2.º semestre',
  s3: '3.º semestre',
  s4: '4.º semestre',
  s5: '5.º semestre',
  s6: '6.º semestre',
  s7: '7.º semestre',
  s8: '8.º semestre',
  s9: '9.º semestre',
  s10: '10.º semestre',
};

const ETIQUETA_DE_JORNADA: Readonly<Record<string, string>> = {
  diurna: 'Diurna',
  nocturna: 'Nocturna',
};

interface OpcionDeCampo {
  readonly id: CampoRectificable;
  /** Cómo se nombra la opción en el listado de radios. */
  readonly etiqueta: string;
  /** Cómo se nombra el mismo campo dentro de «Guardamos ___»: sin mayúscula inicial. */
  readonly enFrase: string;
  /** La ayuda que acompaña el control cuando esta opción está elegida. */
  readonly ayuda: string;
}

const CAMPOS: readonly OpcionDeCampo[] = [
  {
    id: 'alias',
    etiqueta: 'Cómo te saludamos',
    enFrase: 'cómo te saludamos',
    ayuda:
      'El nombre con el que aparecés en pantalla. No hace falta que sea tu nombre legal. Hasta 120 caracteres.',
  },
  {
    id: 'semestre',
    etiqueta: 'Tu semestre',
    enFrase: 'tu semestre',
    ayuda: 'Elegí el que corresponda de la lista.',
  },
  {
    id: 'jornada',
    etiqueta: 'Tu jornada',
    enFrase: 'tu jornada',
    ayuda: 'Elegí la que corresponda de la lista.',
  },
];

function opcionDe(campo: CampoRectificable): OpcionDeCampo {
  // `CAMPOS` cubre exactamente los tres valores de `CampoRectificable`: si el `find` fallara acá
  // sería una prueba de que las dos listas se desincronizaron, no un caso de uso real.
  const opcion = CAMPOS.find((candidata) => candidata.id === campo);
  if (opcion === undefined) throw new Error(`campo rectificable sin opción de pantalla: ${campo}`);
  return opcion;
}

/** El valor guardado, en palabras: el alias tal cual, semestre y jornada por su etiqueta fija. */
function enPalabras(campo: CampoRectificable, valorMaquina: string): string {
  if (campo === 'semestre') {
    return ETIQUETA_DE_SEMESTRE[valorMaquina] ?? valorMaquina;
  }
  if (campo === 'jornada') {
    return ETIQUETA_DE_JORNADA[valorMaquina] ?? valorMaquina;
  }
  return valorMaquina;
}

export default function MisDatos(): ReactNode {
  const { sesion, cargando } = useSesion();
  const [campo, setCampo] = useState<CampoRectificable>('alias');
  const [valorNuevo, setValorNuevo] = useState('');
  const [error, setError] = useState<unknown>(undefined);
  const [aplicada, setAplicada] = useState<RectificacionAplicada | undefined>(undefined);
  // A diferencia de `valorNuevo` (que se vacía al cambiar de campo, ver la cabecera del fichero),
  // esto sobrevive HASTA que se pide corregir otro dato: es lo único que deja mostrar, en la
  // confirmación, qué quedó escrito de verdad.
  const [valorConfirmado, setValorConfirmado] = useState('');
  const { enCurso, ejecutar } = useAccionUnica();
  const campoDeValor = useRef<HTMLInputElement | HTMLSelectElement | null>(null);

  // El servidor manda `campo: 'valorNuevo'` para los dos rechazos que puede dar esta ruta —el valor
  // no cambió nada, y el alias ya lo usa otra persona—: los dos apuntan al mismo y único control de
  // esta pantalla, así que basta una bandera para describirlo.
  const valorInvalido = error instanceof ErrorDeApi && error.campo === 'valorNuevo';
  const describenAlValor = error === undefined ? 'ayuda-valor' : 'ayuda-valor error-valor';

  async function corregir(evento: SyntheticEvent): Promise<void> {
    evento.preventDefault();
    setError(undefined);
    const resultado = await ejecutar('rectificacion', { campo, valorNuevo }, (requestId) =>
      enviar<RectificacionAplicada>('/mi/rectificacion', { requestId, campo, valorNuevo }),
    );
    if (resultado.estado === 'hecho') {
      setValorConfirmado(valorNuevo);
      setAplicada(resultado.valor);
    } else if (resultado.estado === 'fallo') {
      setError(resultado.error);
      enfocarTrasPintar(() => campoDeValor.current?.focus());
    }
  }

  function corregirOtro(): void {
    setAplicada(undefined);
    setError(undefined);
    setValorNuevo('');
    setValorConfirmado('');
    enfocarTrasPintar(() => campoDeValor.current?.focus());
  }

  if (cargando) {
    return (
      <div className="pagina-prosa">
        <h1>Corregí tus datos</h1>
        <Cargando que="tu sesión" completa />
      </div>
    );
  }

  if (sesion === undefined) {
    return (
      <div className="pagina-prosa">
        <h1>Corregí tus datos</h1>
        <Aviso tipo="atencion" titulo="Primero entrá">
          Sólo vos podés corregir tus propios datos, y hace falta saber quién sos para eso.{' '}
          <Link href="/entrar">Entrá con el correo institucional</Link> y volvé a esta pantalla.
        </Aviso>
      </div>
    );
  }

  const elegido = opcionDe(campo);

  return (
    <div className="pagina-prosa">
      <h1>Corregí tus datos</h1>
      <p>
        Tenés derecho a corregir lo que declaraste de vos mismo: cómo te saludamos, tu semestre y tu
        jornada. Esto no toca nada de lo que ya escribiste o decidiste con esa cuenta: el historial
        de lo que hiciste queda exactamente igual, y sólo cambia cómo aparecés de acá en adelante.
      </p>
      <p className="suave">
        Tu correo institucional no está en esta lista todavía: es también la forma en que entrás a
        tu cuenta, y corregirlo con la misma liviandad que un alias podría dejar que otra persona se
        quedara con la tuya. Falta construir, con cuidado, la confirmación de que la dirección nueva
        es tuya antes de ofrecerlo acá. Si te equivocaste al escribirlo o cambiaste de dirección,
        contalo en el grupo mientras tanto.
      </p>

      {aplicada !== undefined ? (
        <Aviso tipo="bien" titulo="Corregido">
          <p>
            Guardamos {opcionDe(aplicada.campo).enFrase}: «
            {enPalabras(aplicada.campo, valorConfirmado)}
            », el {cuando(aplicada.aplicadaEn)}.
          </p>
          <p className="suave">
            Radicado {aplicada.radicado}: guardalo si en algún momento necesitás decir cuándo lo
            pediste.
          </p>
          <p>
            <button className="boton" type="button" onClick={corregirOtro}>
              Corregir otro dato
            </button>
          </p>
        </Aviso>
      ) : (
        <form onSubmit={(e) => void corregir(e)} noValidate>
          <ErrorVisible error={error} id="error-valor" />

          <fieldset className="opciones">
            <legend>Qué querés corregir</legend>
            {CAMPOS.map((opcion) => (
              <div className="opcion" key={opcion.id}>
                <input
                  type="radio"
                  id={`campo-${opcion.id}`}
                  name="campo"
                  value={opcion.id}
                  checked={campo === opcion.id}
                  onChange={() => {
                    setCampo(opcion.id);
                    // Ver la cabecera del fichero: un valor escrito para un campo no sirve para
                    // otro, y dejarlo puesto es la forma más fácil de mandar el dato equivocado.
                    setValorNuevo('');
                    setError(undefined);
                  }}
                />
                <label htmlFor={`campo-${opcion.id}`}>{opcion.etiqueta}</label>
              </div>
            ))}
          </fieldset>

          {campo === 'alias' && <p className="suave">Hoy decimos «{sesion.alias}».</p>}

          <div className="campo">
            <label htmlFor="valor-nuevo">El valor correcto</label>
            <span className="ayuda" id="ayuda-valor">
              {elegido.ayuda}
            </span>
            {campo === 'alias' ? (
              <input
                id="valor-nuevo"
                name="valorNuevo"
                // Un `ref` de objeto único no tipa contra `HTMLInputElement | HTMLSelectElement` a
                // la vez —React exige el elemento exacto—; un `ref` de función sí acepta cualquiera
                // de los dos, porque sólo ASIGNA, nunca declara el tipo del campo que guarda.
                ref={(el) => {
                  campoDeValor.current = el;
                }}
                type="text"
                autoComplete="off"
                required
                aria-describedby={describenAlValor}
                aria-invalid={valorInvalido}
                value={valorNuevo}
                onChange={(e) => {
                  setValorNuevo(e.target.value);
                }}
              />
            ) : (
              <select
                id="valor-nuevo"
                name="valorNuevo"
                ref={(el) => {
                  campoDeValor.current = el;
                }}
                required
                aria-describedby={describenAlValor}
                aria-invalid={valorInvalido}
                value={valorNuevo}
                onChange={(e) => {
                  setValorNuevo(e.target.value);
                }}
              >
                <option value="">Elegí una opción</option>
                {(campo === 'semestre' ? SEMESTRES : JORNADAS).map((valorMaquina) => (
                  <option key={valorMaquina} value={valorMaquina}>
                    {enPalabras(campo, valorMaquina)}
                  </option>
                ))}
              </select>
            )}
          </div>

          <button
            className="boton"
            type="submit"
            disabled={enCurso !== undefined || valorNuevo.trim() === ''}
          >
            {enCurso === 'rectificacion' ? 'Corrigiendo…' : 'Corregir'}
          </button>
        </form>
      )}
    </div>
  );
}
