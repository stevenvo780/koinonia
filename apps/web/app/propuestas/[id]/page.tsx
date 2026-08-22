'use client';

/**
 * Detalle de una propuesta, con **el historial de versiones visible**.
 *
 * La versión 1 se muestra entera, con su texto y su fecha, después de que exista la 2. No es un
 * adorno de transparencia: es lo que hace comprobable que enmendar **añade** y no edita, y por tanto
 * que una respuesta dada sobre la V1 tenía un referente que sigue existiendo.
 *
 * Arriba va el problema del que cuelga: una propuesta no se lee sin ver a qué responde (PRODUCT §4).
 */

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type SyntheticEvent, type ReactNode } from 'react';

import type { PropuestaDetalle } from '@koinonia/contracts';

import { Aviso, Cargando, ErrorVisible, useSesion } from '../../../components/marco';
import {
  PlanEjecucionFormulario,
  PlanEjecucionVisible,
  borradorDesdePlan,
  convertirPlan,
  type BorradorPlanEjecucion,
} from '../../../components/plan-ejecucion';
import { useAccionUnica } from '../../../lib/acciones';
import { cuando, enviar, traer } from '../../../lib/api';

export default function DetallePropuesta(): ReactNode {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { sesion } = useSesion();

  const [propuesta, setPropuesta] = useState<PropuestaDetalle | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const [errorEnmienda, setErrorEnmienda] = useState<unknown>(undefined);
  const [enmendando, setEnmendando] = useState(false);
  const [titulo, setTitulo] = useState('');
  const [cuerpo, setCuerpo] = useState('');
  const [motivo, setMotivo] = useState('');
  const [plan, setPlan] = useState<BorradorPlanEjecucion>(borradorDesdePlan(undefined));
  const [metodo, setMetodo] = useState<'simple-majority' | 'sociocratic-consent'>(
    'simple-majority',
  );
  const [duracionHoras, setDuracionHoras] = useState('72');
  const [errorAbrir, setErrorAbrir] = useState<unknown>(undefined);
  const { enCurso, ejecutar } = useAccionUnica();

  const recargar = useCallback(() => {
    traer<PropuestaDetalle>(`/propuestas/${id}`).then(setPropuesta).catch(setError);
  }, [id]);

  useEffect(recargar, [recargar]);

  function abrirEnmienda(): void {
    const vigente = propuesta?.versiones.at(-1);
    setTitulo(vigente?.titulo ?? '');
    setCuerpo(vigente?.cuerpo ?? '');
    setPlan(borradorDesdePlan(vigente?.plan));
    setMotivo('');
    setEnmendando(true);
  }

  async function guardarEnmienda(evento: SyntheticEvent): Promise<void> {
    evento.preventDefault();
    setErrorEnmienda(undefined);
    const planParaEnviar = convertirPlan(plan, sesion?.miembroId);
    if (planParaEnviar === undefined) {
      setErrorEnmienda(
        new Error('Entrá con tu correo institucional antes de guardar esta versión.'),
      );
      return;
    }
    const resultado = await ejecutar(
      'enmendar',
      { titulo, cuerpo, motivo, plan: planParaEnviar },
      (requestId) =>
        enviar<PropuestaDetalle>(`/propuestas/${id}/enmiendas`, {
          requestId,
          titulo,
          cuerpo,
          motivo,
          plan: planParaEnviar,
        }),
    );
    if (resultado.estado === 'hecho') {
      setPropuesta(resultado.valor);
      setEnmendando(false);
    } else if (resultado.estado === 'fallo') setErrorEnmienda(resultado.error);
  }

  async function abrirDecision(evento: SyntheticEvent): Promise<void> {
    evento.preventDefault();
    setErrorAbrir(undefined);
    const resultado = await ejecutar(
      'abrir-decision',
      { propuestaId: propuesta?.id, metodo, duracionHoras },
      (requestId) =>
        enviar<{ id: string }>('/decisiones', {
          requestId,
          propuestaId: propuesta?.id,
          metodo,
          duracionHoras: Number(duracionHoras),
        }),
    );
    if (resultado.estado === 'hecho') router.push(`/decisiones/${resultado.valor.id}`);
    else if (resultado.estado === 'fallo') setErrorAbrir(resultado.error);
  }

  if (error !== undefined) return <ErrorVisible error={error} />;
  if (propuesta === undefined) return <Cargando que="la propuesta" />;

  const versionesAlReves = [...propuesta.versiones].reverse();

  return (
    <>
      {/* El problema de origen, arriba: no se lee una propuesta sin ver a qué responde. */}
      <p className="suave">
        Responde a:{' '}
        <Link href={`/problemas/${propuesta.problemaId}`}>{propuesta.problemaTitulo}</Link>
      </p>

      <h1>{propuesta.titulo}</h1>
      <p className="suave">
        Va por la versión {propuesta.versionVigente}.{' '}
        {propuesta.versionVigente > 1 &&
          'Las versiones anteriores siguen abajo, tal como estaban: enmendar agrega, no borra.'}
      </p>

      <ErrorVisible error={errorEnmienda} />

      {propuesta.decisiones.length > 0 && (
        <Aviso tipo="atencion" titulo="Hay una votación sobre esta propuesta">
          {propuesta.decisiones.map((decision) => (
            <span key={decision.decisionId}>
              <Link href={`/decisiones/${decision.decisionId}`}>Ir a la votación</Link>{' '}
            </span>
          ))}
        </Aviso>
      )}

      {sesion?.roles.includes('facilitator') && propuesta.decisiones.length === 0 && (
        <section aria-labelledby="abrir-decision-titulo">
          <h2 id="abrir-decision-titulo">Abrir una decisión</h2>
          <p className="suave">
            Antes de abrirla, verificá que el texto y el plan de abajo son los que la comunidad va a
            considerar. Al abrirla no se cambian después.
          </p>
          <ErrorVisible error={errorAbrir} />
          <form onSubmit={(evento) => void abrirDecision(evento)}>
            <div className="campo">
              <label htmlFor="metodo-decision">¿Cómo se toma esta decisión?</label>
              <select
                id="metodo-decision"
                value={metodo}
                onChange={(evento) => {
                  setMetodo(evento.target.value as 'simple-majority' | 'sociocratic-consent');
                }}
              >
                <option value="simple-majority">Mayoría simple</option>
                <option value="sociocratic-consent">Sin objeciones que muestren un daño</option>
              </select>
            </div>
            <div className="campo">
              <label htmlFor="duracion-decision">¿Cuánto tiempo hay para responder?</label>
              <span className="ayuda" id="ayuda-duracion-decision">
                Entre 1 hora y 30 días. Elegí tiempo suficiente para leer y responder sin una
                reunión.
              </span>
              <input
                id="duracion-decision"
                type="number"
                required
                min={1}
                max={720}
                inputMode="numeric"
                aria-describedby="ayuda-duracion-decision"
                value={duracionHoras}
                onChange={(evento) => {
                  setDuracionHoras(evento.target.value);
                }}
              />
            </div>
            <button className="boton" type="submit" disabled={enCurso !== undefined}>
              {enCurso === 'abrir-decision' ? 'Abriendo…' : 'Abrir la decisión'}
            </button>
          </form>
        </section>
      )}

      <section aria-labelledby="versiones-titulo">
        <h2 id="versiones-titulo">Historial de versiones</h2>

        {versionesAlReves.map((version) => {
          const esVigente = version.version === propuesta.versionVigente;
          return (
            <article
              className={`version${esVigente ? ' vigente' : ''}`}
              key={version.version}
              aria-labelledby={`v-${String(version.version)}`}
            >
              <h3 id={`v-${String(version.version)}`}>
                Versión {version.version}
                {esVigente ? ' · la que está sobre la mesa' : ' · anterior, y sigue acá entera'}
              </h3>
              <p className="suave">Escrita el {cuando(version.cuando)}</p>
              {version.motivo !== undefined && (
                <p>
                  <strong>Qué cambió y por qué:</strong> {version.motivo}
                </p>
              )}
              <p className="texto">{version.cuerpo}</p>
              <PlanEjecucionVisible
                plan={version.plan}
                titulo="Qué pasa si se aprueba esta versión"
                nivel="h4"
              />
              <details>
                <summary>Ver el comprobante de esta versión</summary>
                <p className="suave">
                  Este número identifica <em>exactamente</em> este texto y el plan que lo acompaña.
                  Si alguien cambiara una coma, una fecha o un criterio, el número cambiaría y la
                  pantalla de <Link href="/verificar">Verificar</Link> lo diría en rojo.
                </p>
                <code className="comprobante">{version.huella}</code>
              </details>
            </article>
          );
        })}
      </section>

      {sesion !== undefined && (
        <section aria-labelledby="enmendar-titulo">
          <h2 id="enmendar-titulo">Proponer una enmienda</h2>
          {propuesta.esMia ? (
            enmendando ? (
              <form onSubmit={(e) => void guardarEnmienda(e)}>
                <div className="campo">
                  <label htmlFor="titulo-enmienda">Título</label>
                  <input
                    id="titulo-enmienda"
                    type="text"
                    required
                    minLength={10}
                    maxLength={140}
                    value={titulo}
                    onChange={(e) => {
                      setTitulo(e.target.value);
                    }}
                  />
                </div>
                <div className="campo">
                  <label htmlFor="cuerpo-enmienda">Texto de la propuesta</label>
                  <span className="ayuda" id="ayuda-cuerpo-enmienda">
                    La versión anterior no se toca: esto crea la siguiente.
                  </span>
                  <textarea
                    id="cuerpo-enmienda"
                    required
                    minLength={50}
                    maxLength={4000}
                    aria-describedby="ayuda-cuerpo-enmienda"
                    value={cuerpo}
                    onChange={(e) => {
                      setCuerpo(e.target.value);
                    }}
                  />
                </div>
                <div className="campo">
                  <label htmlFor="motivo-enmienda">¿Qué cambia y por qué?</label>
                  <span className="ayuda" id="ayuda-motivo">
                    Mínimo 20 caracteres. Sin esto, «versión 2» es un número sin información.
                  </span>
                  <textarea
                    id="motivo-enmienda"
                    required
                    minLength={20}
                    maxLength={1000}
                    aria-describedby="ayuda-motivo"
                    value={motivo}
                    onChange={(e) => {
                      setMotivo(e.target.value);
                    }}
                  />
                </div>
                <PlanEjecucionFormulario value={plan} onChange={setPlan} prefijo="plan-enmienda" />
                <button className="boton" type="submit" disabled={enCurso !== undefined}>
                  {enCurso === 'enmendar' ? 'Guardando…' : 'Guardar la versión nueva'}
                </button>{' '}
                <button
                  className="boton secundario"
                  type="button"
                  disabled={enCurso !== undefined}
                  onClick={() => {
                    setEnmendando(false);
                  }}
                >
                  Dejarlo así
                </button>
              </form>
            ) : (
              <button className="boton" type="button" onClick={abrirEnmienda}>
                Enmendar mi propuesta
              </button>
            )
          ) : (
            <Aviso tipo="atencion" titulo="Esta propuesta la escribió otra persona">
              Sólo quien la escribió puede cambiar su texto. Vos podés escribir otra propuesta al
              mismo problema, que queda con tu nombre y su propio historial.{' '}
              <Link href={`/propuestas/nueva?problema=${propuesta.problemaId}`}>
                Escribir otra propuesta
              </Link>
              .
            </Aviso>
          )}
        </section>
      )}
    </>
  );
}
