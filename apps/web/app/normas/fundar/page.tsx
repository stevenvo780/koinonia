'use client';

/**
 * Fundar las reglas: el acto que faltaba.
 *
 * ═══ Por qué esta pantalla no cuenta votos ═══
 *
 * `GOVERNANCE.md` §6 lo llama «el problema del arranque»: la regla fundacional no puede derivar
 * su legitimidad de las reglas que ella misma establece. La votación que aprueba la versión 1
 * ocurre **fuera** de una plataforma que todavía no tiene reglas propias —en una asamblea, con
 * papeletas de papel o con una votación común ya cerrada—, y lo único que un servidor puede hacer
 * honestamente es **registrar** ese acto: quién lo registró, cuándo, y con qué números, para que
 * cualquiera los contraste después con el acta. Esta pantalla no decide si la asamblea aprobó
 * nada: lo pregunta, lo manda tal cual, y el dominio rechaza los números que no alcanzan el
 * respaldo que el §6 exige (dos de cada tres papeletas a favor, con al menos un tercio del censo
 * votando en persona; con un censo de 300, ese tercio son las 100 personas del documento).
 *
 * ═══ Por qué el núcleo viene prellenado y no en blanco ═══
 *
 * Las seis reglas intangibles no las inventa quien funda: son las seis del §6.b, siempre en el
 * mismo orden, y `GET /normas` ya las devuelve en castellano llano incluso antes de que exista
 * ninguna versión (`verNormas()` en el servidor). Prellenarlas con ese texto y dejarlas editables
 * evita dos errores: uno, que alguien tenga que redactar de memoria una garantía que ya está
 * escrita en un solo lugar; dos, que la pantalla sugiera que el núcleo es un campo más y no lo que
 * es, seis reglas que nunca se pueden borrar de la lista.
 *
 * ═══ Lo que esta pantalla NO intenta resolver ═══
 *
 * El resto del documento —quién decide qué, los límites de cada encargo, los dominios que nunca se
 * someten a votación— no vive en el núcleo ni en un campo fijo: son reglas ordinarias más, y quien
 * funda las escribe acá mismo, en «Otras reglas». Esta pantalla no las redacta por nadie: eso es
 * trabajo de la asamblea, hecho fuera de aquí y traído en forma de texto.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode, type SyntheticEvent } from 'react';

import { datetimeLocalColombia, instanteColombia, type Normas } from '@koinonia/contracts';

import { Aviso, Cargando, ErrorVisible, useSesion } from '../../../components/marco';
import { useAccionUnica } from '../../../lib/acciones';
import { enviar, traer } from '../../../lib/api';

/** Un identificador del mismo formato que usa todo el sistema: 128 bits en hexadecimal minúscula. */
function nuevoIdOpaco(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface ReglaForm {
  /** Sólo para React: no se manda al servidor. */
  readonly clave: string;
  readonly id: string;
  readonly titulo: string;
  readonly texto: string;
}

const ID_REGLA_RE = /^[a-z][a-z0-9_]{0,31}$/u;

function reglaValida(regla: ReglaForm): boolean {
  return (
    ID_REGLA_RE.test(regla.id) &&
    regla.titulo.trim().length >= 4 &&
    regla.titulo.trim().length <= 160 &&
    !/[\n\r]/u.test(regla.titulo) &&
    regla.texto.trim().length >= 20 &&
    regla.texto.trim().length <= 8000
  );
}

function EditorDeRegla({
  regla,
  onChange,
  onQuitar,
  idFijo,
  numero,
}: {
  readonly regla: ReglaForm;
  readonly onChange: (siguiente: ReglaForm) => void;
  readonly onQuitar?: () => void;
  /** El núcleo no deja elegir el identificador: es el mismo del §6.b, siempre. */
  readonly idFijo: boolean;
  readonly numero: number;
}): ReactNode {
  return (
    <fieldset className="opciones">
      <legend>Regla {numero}</legend>
      {idFijo ? (
        <p className="suave">
          Identificador fijo: <code>{regla.id}</code>. Es uno de los seis puntos del núcleo y no se
          puede cambiar ni quitar de esta lista.
        </p>
      ) : (
        <div className="campo">
          <label htmlFor={`id-${regla.clave}`}>Identificador</label>
          <span className="ayuda" id={`ayuda-id-${regla.clave}`}>
            Minúsculas, números y guion bajo, empezando por una letra. Sirve para nombrar esta regla
            igual en el historial y en la conversación, por ejemplo <code>domino_verde</code>.
          </span>
          <input
            id={`id-${regla.clave}`}
            required
            pattern="[a-z][a-z0-9_]{0,31}"
            maxLength={32}
            aria-describedby={`ayuda-id-${regla.clave}`}
            value={regla.id}
            onChange={(e) => {
              onChange({ ...regla, id: e.target.value });
            }}
          />
        </div>
      )}
      <div className="campo">
        <label htmlFor={`titulo-${regla.clave}`}>Título</label>
        <input
          id={`titulo-${regla.clave}`}
          required
          minLength={4}
          maxLength={160}
          value={regla.titulo}
          onChange={(e) => {
            onChange({ ...regla, titulo: e.target.value });
          }}
        />
      </div>
      <div className="campo">
        <label htmlFor={`texto-${regla.clave}`}>Texto</label>
        <span className="ayuda" id={`ayuda-texto-${regla.clave}`}>
          Mínimo 20 caracteres: tiene que decir qué obliga.
        </span>
        <textarea
          id={`texto-${regla.clave}`}
          required
          minLength={20}
          maxLength={8000}
          aria-describedby={`ayuda-texto-${regla.clave}`}
          value={regla.texto}
          onChange={(e) => {
            onChange({ ...regla, texto: e.target.value });
          }}
        />
      </div>
      {onQuitar !== undefined && (
        <button type="button" className="boton secundario" onClick={onQuitar}>
          Quitar esta regla
        </button>
      )}
    </fieldset>
  );
}

function Formulario(): ReactNode {
  const router = useRouter();
  const { sesion, cargando } = useSesion();
  const puedeFundar =
    sesion?.roles.includes('facilitator') === true || sesion?.roles.includes('guarantees') === true;

  const [normas, setNormas] = useState<Normas | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const [errorFundar, setErrorFundar] = useState<unknown>(undefined);
  const { enCurso, ejecutar } = useAccionUnica();

  const [nucleo, setNucleo] = useState<ReglaForm[]>([]);
  const [extra, setExtra] = useState<ReglaForm[]>([]);
  const [decisionFundacional, setDecisionFundacional] = useState('');
  const [censo, setCenso] = useState('');
  const [papeletas, setPapeletas] = useState('');
  const [aFavor, setAFavor] = useState('');
  const [votoDirecto, setVotoDirecto] = useState('');
  const [rigeDesde, setRigeDesde] = useState(() => datetimeLocalColombia(Date.now()));

  useEffect(() => {
    traer<Normas>('/normas').then(setNormas).catch(setError);
  }, []);

  // Prellena el núcleo la primera vez que llegan los datos. No se vuelve a pisar después: si
  // alguien ya empezó a corregir el texto, un segundo `then` tardío no le borra el trabajo.
  useEffect(() => {
    if (normas === undefined || nucleo.length > 0) return;
    setNucleo(
      normas.nucleo.reglas.map((regla) => ({
        clave: regla.id,
        id: regla.id,
        titulo: regla.titulo,
        texto: regla.texto,
      })),
    );
  }, [normas, nucleo.length]);

  function agregarExtra(): void {
    setExtra((actual) => [...actual, { clave: nuevoIdOpaco(), id: '', titulo: '', texto: '' }]);
  }

  async function fundar(evento: SyntheticEvent): Promise<void> {
    evento.preventDefault();
    setErrorFundar(undefined);
    const reglas = [...nucleo, ...extra].map((r) => ({
      id: r.id,
      titulo: r.titulo.trim(),
      texto: r.texto.trim(),
    }));
    let rigeDesdeMs: number;
    try {
      rigeDesdeMs = instanteColombia(rigeDesde);
    } catch (motivo) {
      setErrorFundar(motivo);
      return;
    }
    const cuerpo = {
      decisionFundacional,
      censo: Number(censo),
      papeletas: Number(papeletas),
      aFavor: Number(aFavor),
      votoDirecto: Number(votoDirecto),
      rigeDesde: rigeDesdeMs,
      reglas,
    };
    const resultado = await ejecutar('fundar', cuerpo, (requestId) =>
      enviar<Normas>('/normas/fundacion', { requestId, ...cuerpo }),
    );
    if (resultado.estado === 'hecho') router.push('/normas');
    else if (resultado.estado === 'fallo') setErrorFundar(resultado.error);
  }

  if (error !== undefined) {
    return (
      <div className="pagina-prosa">
        <h1>No pudimos preparar esta pantalla</h1>
        <ErrorVisible error={error} />
        <p>
          <Link className="boton secundario" href="/normas">
            Volver a las reglas
          </Link>
        </p>
      </div>
    );
  }

  if (cargando || normas === undefined) {
    return (
      <div className="pagina-prosa">
        <Cargando que="las reglas" completa />
      </div>
    );
  }

  // La sesión no decide si esto se puede hacer —eso lo vuelve a decidir el servidor— sino qué
  // mostrar. El mismo criterio que `/decisiones/abrir`.
  if (!puedeFundar) {
    return (
      <div className="pagina-prosa">
        <h1>Fundar las reglas</h1>
        <Aviso tipo="atencion" titulo="Esto lo hace quien cuida el procedimiento o las garantías">
          Fundar registra un acto de la asamblea entera, con el censo y los votos como datos
          públicos que cualquiera puede contrastar. Por eso lo hace quien tiene ese encargo, nunca
          quien administra la plataforma.
          {sesion === undefined && (
            <>
              {' '}
              <Link href="/entrar">Entrar con el correo institucional</Link>.
            </>
          )}
        </Aviso>
        <p>
          <Link className="boton secundario" href="/normas">
            Ver las reglas
          </Link>
        </p>
      </div>
    );
  }

  if (normas.versionVigente !== 0) {
    return (
      <div className="pagina-prosa">
        <h1>Fundar las reglas</h1>
        <Aviso tipo="bien" titulo="Ya hay reglas vigentes">
          Fundar otra encima no es fundar, es un golpe. Para cambiar algo se reforma por el
          procedimiento de siempre; esta pantalla sólo sirve para la primera vez, o después de que
          las reglas caduquen sin que nadie las haya vuelto a aprobar.
        </Aviso>
        <p>
          <Link className="boton secundario" href="/normas">
            Ver las reglas vigentes
          </Link>
        </p>
      </div>
    );
  }

  const nucleoCompleto = nucleo.length === 6 && nucleo.every(reglaValida);
  const extraCompleta = extra.every(reglaValida);
  const idsRepetidos =
    new Set([...nucleo, ...extra].map((r) => r.id)).size !== nucleo.length + extra.length;
  const numeros = {
    censo: Number(censo),
    papeletas: Number(papeletas),
    aFavor: Number(aFavor),
    votoDirecto: Number(votoDirecto),
  };
  const numerosCompletos =
    censo !== '' &&
    papeletas !== '' &&
    aFavor !== '' &&
    votoDirecto !== '' &&
    Number.isInteger(numeros.censo) &&
    numeros.censo >= 1 &&
    Number.isInteger(numeros.papeletas) &&
    numeros.papeletas >= 1 &&
    numeros.papeletas <= numeros.censo &&
    Number.isInteger(numeros.aFavor) &&
    numeros.aFavor >= 0 &&
    numeros.aFavor <= numeros.papeletas &&
    Number.isInteger(numeros.votoDirecto) &&
    numeros.votoDirecto >= 0 &&
    numeros.votoDirecto <= numeros.papeletas;
  const decisionValida = /^[0-9a-f]{32}$/u.test(decisionFundacional);
  const puedeEnviar =
    nucleoCompleto &&
    extraCompleta &&
    !idsRepetidos &&
    numerosCompletos &&
    decisionValida &&
    rigeDesde !== '' &&
    enCurso === undefined;

  return (
    <div className="pagina-prosa">
      <h1>Fundar las reglas</h1>
      <p className="lede">
        Registrá acá el acto de la asamblea que aprobó estas reglas por primera vez —o que las
        volvió a aprobar después de que caducaran—. Lo que escribas queda público y con tu nombre;
        nadie, ni quien administra el servidor, puede tocarlo después.
      </p>

      <ErrorVisible error={errorFundar} />

      <form onSubmit={(evento) => void fundar(evento)}>
        <section aria-labelledby="nucleo-titulo">
          <h2 id="nucleo-titulo">Las seis reglas que nunca se pueden cambiar</h2>
          <p className="suave">
            Vienen con el texto que ya se explica en «Las reglas del juego». Podés ajustar la
            redacción, pero las seis tienen que quedar: sin alguna de ellas, el historial no acepta
            la fundación.
          </p>
          {nucleo.map((regla, indice) => (
            <EditorDeRegla
              key={regla.clave}
              regla={regla}
              idFijo
              numero={indice + 1}
              onChange={(siguiente) => {
                setNucleo((actual) => actual.map((r, i) => (i === indice ? siguiente : r)));
              }}
            />
          ))}
        </section>

        <section aria-labelledby="extra-titulo">
          <h2 id="extra-titulo">Otras reglas</h2>
          <p className="suave">
            Todo lo demás que la asamblea acordó: quién decide qué, los límites de cada encargo, qué
            nunca se somete a votación. No hace falta ponerlas todas hoy mismo: lo que falte se
            agrega después por el procedimiento de reforma, no acá.
          </p>
          {extra.map((regla, indice) => (
            <EditorDeRegla
              key={regla.clave}
              regla={regla}
              idFijo={false}
              numero={nucleo.length + indice + 1}
              onChange={(siguiente) => {
                setExtra((actual) => actual.map((r, i) => (i === indice ? siguiente : r)));
              }}
              onQuitar={() => {
                setExtra((actual) => actual.filter((_r, i) => i !== indice));
              }}
            />
          ))}
          <button type="button" className="boton secundario" onClick={agregarExtra}>
            Agregar otra regla
          </button>
          {idsRepetidos && (
            <Aviso tipo="error" titulo="Hay un identificador repetido">
              Cada regla necesita su propio identificador, núcleo incluido.
            </Aviso>
          )}
        </section>

        <section aria-labelledby="asamblea-titulo">
          <h2 id="asamblea-titulo">Los números de esa asamblea</h2>
          <p className="suave">
            Entran tal como pasaron, para que cualquiera los contraste con el acta. El respaldo que
            hace falta lo comprueba el servidor: hoy son dos de cada tres papeletas a favor, con al
            menos un tercio del censo votando en persona.
          </p>

          <div className="campo">
            <label htmlFor="decision-fundacional">Identificador de esta fundación</label>
            <span className="ayuda" id="ayuda-decision">
              32 caracteres entre <code>a</code>–<code>f</code> y <code>0</code>–<code>9</code>, en
              minúscula. Anotalo junto con estos números en el acta de la asamblea, para poder
              contrastarlos después. Si la votación se hizo con una votación común de la plataforma,
              es el identificador de esa votación.
            </span>
            <input
              id="decision-fundacional"
              required
              pattern="[0-9a-f]{32}"
              maxLength={32}
              aria-describedby="ayuda-decision"
              value={decisionFundacional}
              onChange={(e) => {
                setDecisionFundacional(e.target.value.trim().toLowerCase());
              }}
            />
            <button
              type="button"
              className="boton secundario"
              onClick={() => {
                setDecisionFundacional(nuevoIdOpaco());
              }}
            >
              Generar uno nuevo
            </button>
          </div>

          <div className="campo">
            <label htmlFor="censo">Censo: cuántas personas podían votar</label>
            <input
              id="censo"
              type="number"
              required
              min={1}
              inputMode="numeric"
              value={censo}
              onChange={(e) => {
                setCenso(e.target.value);
              }}
            />
          </div>

          <div className="campo">
            <label htmlFor="papeletas">Papeletas que se pudieron contar</label>
            <input
              id="papeletas"
              type="number"
              required
              min={1}
              max={censo === '' ? undefined : Number(censo)}
              inputMode="numeric"
              value={papeletas}
              onChange={(e) => {
                setPapeletas(e.target.value);
              }}
            />
          </div>

          <div className="campo">
            <label htmlFor="a-favor">Papeletas a favor</label>
            <input
              id="a-favor"
              type="number"
              required
              min={0}
              max={papeletas === '' ? undefined : Number(papeletas)}
              inputMode="numeric"
              value={aFavor}
              onChange={(e) => {
                setAFavor(e.target.value);
              }}
            />
          </div>

          <div className="campo">
            <label htmlFor="voto-directo">Personas que votaron en persona</label>
            <span className="ayuda" id="ayuda-voto-directo">
              Un voto prestado no cuenta para este número.
            </span>
            <input
              id="voto-directo"
              type="number"
              required
              min={0}
              max={papeletas === '' ? undefined : Number(papeletas)}
              inputMode="numeric"
              aria-describedby="ayuda-voto-directo"
              value={votoDirecto}
              onChange={(e) => {
                setVotoDirecto(e.target.value);
              }}
            />
          </div>

          <div className="campo">
            <label htmlFor="rige-desde">Rige desde, en hora de Colombia</label>
            <input
              id="rige-desde"
              type="datetime-local"
              required
              value={rigeDesde}
              onChange={(e) => {
                setRigeDesde(e.target.value);
              }}
            />
          </div>
        </section>

        <Aviso tipo="atencion" titulo="Antes de mandar">
          Esto queda escrito para siempre y con tu nombre. Fundar otra vez encima de una fundación
          vigente no es una corrección: el servidor lo va a rechazar.
        </Aviso>

        <button className="boton" type="submit" disabled={!puedeEnviar}>
          {enCurso === 'fundar' ? 'Fundando…' : 'Fundar las reglas'}
        </button>
      </form>
    </div>
  );
}

export default function FundarNormas(): ReactNode {
  return <Formulario />;
}
