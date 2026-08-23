'use client';

/**
 * Emitir la respuesta.
 *
 * ═══ «¿Alguien objeta?», no «vote sí o no» ═══
 *
 * Cuando el método es el de acuerdo interno, la pregunta que ve la persona es literalmente
 * **«¿Alguien objeta?»** y las tres respuestas son *sin objeción*, *tengo una reserva* y *objeto*.
 * No es una etiqueta bonita para un sí/no: son cosas distintas. «Tengo una reserva» se registra y no
 * bloquea; «objeto» bloquea y por eso exige un argumento y decir qué objetivo del grupo se daña.
 * El criterio se enuncia con esas palabras: *no hace falta que a todos les guste; hace falta que
 * nadie muestre un daño*.
 *
 * Y en las dos papeletas va, siempre, **qué hace falta para que esto pase**. La disputa de una
 * asamblea es casi siempre sobre el denominador; decirlo antes de votar la elimina.
 */

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type SyntheticEvent, type ReactNode } from 'react';

import type { DecisionDetalle } from '@koinonia/contracts';

import { Aviso, Cargando, ErrorVisible, useSesion } from '../../../components/marco';
import { PlanEjecucionVisible } from '../../../components/plan-ejecucion';
import { useAccionUnica } from '../../../lib/acciones';
import { cuando, enviar, plazo, traer } from '../../../lib/api';

type Postura = 'consent' | 'concern' | 'object';
type Binario = 'si' | 'no' | 'abstengo';

export default function Decision(): ReactNode {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { sesion } = useSesion();

  const [decision, setDecision] = useState<DecisionDetalle | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const [errorEnvio, setErrorEnvio] = useState<unknown>(undefined);
  const [enviado, setEnviado] = useState(false);
  const [errorCierre, setErrorCierre] = useState<unknown>(undefined);
  // Las dos acciones más caras de la pantalla comparten guarda: mientras una está en vuelo, ni ella
  // ni la otra pueden volver a salir. Y las dos conservan su clave de idempotencia entre reintentos,
  // que es lo que impide que una respuesta perdida se convierta en dos papeletas o en dos cierres.
  const { enCurso, ejecutar } = useAccionUnica();

  const [postura, setPostura] = useState<Postura>('consent');
  const [binario, setBinario] = useState<Binario>('si');
  const [argumento, setArgumento] = useState('');
  const [objetivo, setObjetivo] = useState('');

  const recargar = useCallback(() => {
    setError(undefined);
    traer<DecisionDetalle>(`/decisiones/${id}`).then(setDecision).catch(setError);
  }, [id]);

  useEffect(recargar, [recargar]);

  async function responder(evento: SyntheticEvent): Promise<void> {
    evento.preventDefault();
    setErrorEnvio(undefined);
    setEnviado(false);
    if (decision === undefined) return;
    const respuesta =
      decision.metodo === 'sociocratic-consent'
        ? {
            tipo: 'consent' as const,
            postura,
            ...(postura === 'object' ? { objecion: { argumento, objetivoDanado: objetivo } } : {}),
          }
        : binario === 'abstengo'
          ? { tipo: 'abstain' as const }
          : { tipo: 'binary' as const, aprueba: binario === 'si' };

    const resultado = await ejecutar(
      'papeleta',
      { huellaVersion: decision.huellaVersion, respuesta },
      (requestId) =>
        enviar<DecisionDetalle>(`/decisiones/${id}/papeletas`, {
          requestId,
          huellaVersion: decision.huellaVersion,
          respuesta,
        }),
    );
    if (resultado.estado === 'hecho') {
      setDecision(resultado.valor);
      setEnviado(true);
    } else if (resultado.estado === 'fallo') setErrorEnvio(resultado.error);
  }

  async function cerrar(): Promise<void> {
    setErrorCierre(undefined);
    const resultado = await ejecutar('cerrar', {}, (requestId) =>
      enviar(`/decisiones/${id}/cerrar`, { requestId }),
    );
    if (resultado.estado === 'hecho') router.push(`/decisiones/${id}/resultado`);
    else if (resultado.estado === 'fallo') setErrorCierre(resultado.error);
  }

  // Mismo callejón que había en el detalle de un problema: el aviso solo, sin reintento ni vuelta.
  if (error !== undefined) {
    return (
      <>
        <h1>No pudimos abrir esta decisión</h1>
        <ErrorVisible error={error} />
        <p>
          <button className="boton" type="button" onClick={recargar}>
            Volver a intentar
          </button>{' '}
          <Link className="boton secundario" href="/decisiones">
            Ver todas las decisiones
          </Link>
        </p>
      </>
    );
  }
  if (decision === undefined) return <Cargando que="la decisión" />;

  const consentimiento = decision.metodo === 'sociocratic-consent';
  const cerrada = decision.estado !== 'Open';

  return (
    <>
      <h1>{decision.titulo}</h1>

      <p className="suave">
        {cerrada ? 'Ya cerró' : plazo(decision.cierraEn)} · {cuando(decision.cierraEn)}
      </p>

      <section aria-labelledby="texto-titulo">
        <h2 id="texto-titulo">El texto que se está decidiendo</h2>
        <div className="version vigente">
          <p className="texto" style={{ whiteSpace: 'pre-wrap' }}>
            {decision.cuerpoVersion}
          </p>
        </div>
        <p className="suave">
          <Link href={`/propuestas/${decision.propuestaId}`}>
            Ver la propuesta completa y sus versiones anteriores
          </Link>
        </p>
      </section>

      <PlanEjecucionVisible plan={decision.plan} />

      {/* Qué hace falta para que esto pase. SIEMPRE, y antes de responder. */}
      <section aria-labelledby="regla-titulo">
        <h2 id="regla-titulo">Qué hace falta para que esto pase</h2>
        <div className="aviso" role="note">
          <p>{decision.queHaceFaltaParaQuePase}</p>
          <p className="suave">
            {decision.podianDecidir === 1
              ? 'Podía decidir acá 1 persona'
              : `Podían decidir acá ${String(decision.podianDecidir)} personas`}
            . La lista se cerró al abrir la votación y ya no cambia.{' '}
            {decision.seManifestaron === 1
              ? `Se manifestó ${String(decision.seManifestaron)}`
              : `Se manifestaron ${String(decision.seManifestaron)}`}
            .
          </p>
        </div>
      </section>

      <ErrorVisible error={errorEnvio} />
      {enviado && (
        <Aviso tipo="bien" titulo="Quedó registrado">
          Tu respuesta es «{decision.miRespuesta}». Podés cambiarla hasta que cierre: cambiar de
          opinión después de leer a los demás es una virtud, no una trampa. Vale la última.
        </Aviso>
      )}

      {cerrada && (
        <Aviso tipo="atencion" titulo="Esta votación ya cerró">
          <Link href={`/decisiones/${id}/resultado`}>Ver el resultado y por qué salió eso</Link>.
        </Aviso>
      )}

      {sesion?.roles.includes('facilitator') && !cerrada && (
        <section aria-labelledby="cerrar-decision-titulo">
          <h2 id="cerrar-decision-titulo">Cerrar y publicar el resultado</h2>
          <p className="suave">
            Sólo hacelo cuando haya terminado el plazo. Si todavía no se puede cerrar, te vamos a
            decir por qué sin perder ninguna respuesta escrita.
          </p>
          <ErrorVisible error={errorCierre} />
          <button
            className="boton secundario"
            type="button"
            onClick={() => void cerrar()}
            disabled={enCurso !== undefined}
          >
            {enCurso === 'cerrar' ? 'Cerrando…' : 'Cerrar y publicar el resultado'}
          </button>
        </section>
      )}

      {!cerrada && !decision.puedoDecidir && (
        <Aviso tipo="atencion" titulo="No podés responder acá">
          {decision.motivoNoPuedo ?? 'No estabas en la lista de quienes podían decidir aquí.'}
          {sesion === undefined && (
            <>
              {' '}
              <Link href="/entrar">Entrar con el correo institucional</Link>.
            </>
          )}
        </Aviso>
      )}

      {!cerrada && decision.puedoDecidir && (
        <form onSubmit={(e) => void responder(e)} noValidate>
          {consentimiento ? (
            <>
              <fieldset className="opciones">
                <legend>¿Alguien objeta?</legend>
                <p className="suave" id="ayuda-consentimiento">
                  No hace falta que a todos les guste; hace falta que nadie muestre un daño.
                </p>
                <div className="opcion">
                  <input
                    type="radio"
                    id="p-consent"
                    name="postura"
                    checked={postura === 'consent'}
                    onChange={() => {
                      setPostura('consent');
                    }}
                    aria-describedby="ayuda-consentimiento"
                  />
                  <label htmlFor="p-consent">
                    Sin objeción
                    <span className="explica">
                      No veo un daño al propósito común. No quiere decir que me encante.
                    </span>
                  </label>
                </div>
                <div className="opcion">
                  <input
                    type="radio"
                    id="p-concern"
                    name="postura"
                    checked={postura === 'concern'}
                    onChange={() => {
                      setPostura('concern');
                    }}
                  />
                  <label htmlFor="p-concern">
                    Tengo una reserva
                    <span className="explica">
                      Queda escrita para que se tenga en cuenta, y no bloquea.
                    </span>
                  </label>
                </div>
                <div className="opcion">
                  <input
                    type="radio"
                    id="p-object"
                    name="postura"
                    checked={postura === 'object'}
                    onChange={() => {
                      setPostura('object');
                    }}
                  />
                  <label htmlFor="p-object">
                    Objeto
                    <span className="explica">
                      Esto bloquea, y por eso hay que decir qué se daña y por qué.
                    </span>
                  </label>
                </div>
              </fieldset>

              {postura === 'object' && (
                <div id="detalle-objecion">
                  <div className="campo">
                    <label htmlFor="objetivo">¿Qué objetivo del grupo se daña?</label>
                    <span className="ayuda" id="ayuda-objetivo">
                      Una objeción señala un daño a lo que el grupo se propuso. Sin eso es una
                      preferencia, que se registra como reserva.
                    </span>
                    <input
                      id="objetivo"
                      type="text"
                      required
                      minLength={5}
                      aria-describedby="ayuda-objetivo"
                      value={objetivo}
                      onChange={(e) => {
                        setObjetivo(e.target.value);
                      }}
                    />
                  </div>
                  <div className="campo">
                    <label htmlFor="argumento">¿Por qué? Contá el daño concreto.</label>
                    <span className="ayuda" id="ayuda-argumento">
                      Mínimo 40 caracteres. Bloquear a la comunidad tiene que costar, como mínimo,
                      explicarse.
                    </span>
                    <textarea
                      id="argumento"
                      required
                      minLength={40}
                      aria-describedby="ayuda-argumento"
                      value={argumento}
                      onChange={(e) => {
                        setArgumento(e.target.value);
                      }}
                    />
                  </div>
                </div>
              )}
            </>
          ) : (
            <fieldset className="opciones">
              <legend>¿Estás de acuerdo con este texto?</legend>
              <div className="opcion">
                <input
                  type="radio"
                  id="b-si"
                  name="binario"
                  checked={binario === 'si'}
                  onChange={() => {
                    setBinario('si');
                  }}
                />
                <label htmlFor="b-si">Sí</label>
              </div>
              <div className="opcion">
                <input
                  type="radio"
                  id="b-no"
                  name="binario"
                  checked={binario === 'no'}
                  onChange={() => {
                    setBinario('no');
                  }}
                />
                <label htmlFor="b-no">No</label>
              </div>
              <div className="opcion">
                <input
                  type="radio"
                  id="b-abstengo"
                  name="binario"
                  checked={binario === 'abstengo'}
                  onChange={() => {
                    setBinario('abstengo');
                  }}
                />
                <label htmlFor="b-abstengo">
                  Me abstengo
                  <span className="explica">
                    Cuenta para la participación mínima, pero no para el «más síes que noes».
                  </span>
                </label>
              </div>
            </fieldset>
          )}

          {decision.miRespuesta !== undefined && !enviado && (
            <p className="suave">
              Tu respuesta ahora mismo es «{decision.miRespuesta}». Si mandás otra, vale la última.
            </p>
          )}

          <button className="boton" type="submit" disabled={enCurso !== undefined}>
            {enCurso === 'papeleta'
              ? 'Enviando…'
              : decision.miRespuesta === undefined
                ? 'Enviar mi respuesta'
                : 'Cambiar mi respuesta'}
          </button>
        </form>
      )}
    </>
  );
}
