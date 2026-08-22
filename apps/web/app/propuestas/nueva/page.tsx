'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type SyntheticEvent, type ReactNode } from 'react';

import type { ProblemaDetalle, PropuestaDetalle } from '@koinonia/contracts';

import { Aviso, ErrorVisible, useSesion } from '../../../components/marco';
import {
  PlanEjecucionFormulario,
  borradorPlanInicial,
  convertirPlan,
  type BorradorPlanEjecucion,
} from '../../../components/plan-ejecucion';
import { useAccionUnica } from '../../../lib/acciones';
import { enviar, traer } from '../../../lib/api';

function Formulario(): ReactNode {
  const router = useRouter();
  const params = useSearchParams();
  const problemaId = params.get('problema') ?? '';
  const { sesion, cargando } = useSesion();

  const [problema, setProblema] = useState<ProblemaDetalle | undefined>(undefined);
  const [titulo, setTitulo] = useState('');
  const [cuerpo, setCuerpo] = useState('');
  const [plan, setPlan] = useState<BorradorPlanEjecucion>(borradorPlanInicial);
  const [error, setError] = useState<unknown>(undefined);
  const { enCurso, ejecutar } = useAccionUnica();

  useEffect(() => {
    if (problemaId === '') return;
    traer<ProblemaDetalle>(`/problemas/${problemaId}`).then(setProblema).catch(setError);
  }, [problemaId]);

  async function guardar(evento: SyntheticEvent): Promise<void> {
    evento.preventDefault();
    setError(undefined);
    const planParaEnviar = convertirPlan(plan, sesion?.miembroId);
    if (planParaEnviar === undefined) {
      setError(new Error('Entrá con tu correo institucional antes de guardar la propuesta.'));
      return;
    }
    const resultado = await ejecutar(
      'guardar',
      { problemaId, titulo, cuerpo, plan: planParaEnviar },
      (requestId) =>
        enviar<PropuestaDetalle>('/propuestas', {
          requestId,
          problemaId,
          titulo,
          cuerpo,
          plan: planParaEnviar,
        }),
    );
    if (resultado.estado === 'hecho') router.push(`/propuestas/${resultado.valor.id}`);
    else if (resultado.estado === 'fallo') setError(resultado.error);
  }

  // No se propone sin problema (PRODUCT §4). Y en vez de un error, se ofrece crearlo.
  if (problemaId === '') {
    return (
      <>
        <h1>Escribir una propuesta</h1>
        <Aviso tipo="atencion" titulo="Falta el problema">
          Toda propuesta responde a un problema. Elegí uno de la{' '}
          <Link href="/problemas">lista</Link> o{' '}
          <Link href="/problemas/nuevo">escribí el problema primero</Link>.
        </Aviso>
      </>
    );
  }

  return (
    <>
      {problema !== undefined && (
        <p className="suave">
          Responde a: <Link href={`/problemas/${problemaId}`}>{problema.titulo}</Link>
        </p>
      )}
      <h1>Escribir una propuesta</h1>

      {!cargando && sesion === undefined && (
        <Aviso tipo="atencion" titulo="Antes de escribir">
          Hay que entrar con el correo institucional. <Link href="/entrar">Entrar</Link>.
        </Aviso>
      )}

      <ErrorVisible error={error} />

      <form onSubmit={(e) => void guardar(e)}>
        <div className="campo">
          <label htmlFor="titulo">¿Qué se propone, en una frase?</label>
          <span className="ayuda" id="ayuda-titulo">
            Empezá con un verbo: pedir, montar, redactar, conseguir.
          </span>
          <input
            id="titulo"
            type="text"
            required
            minLength={10}
            maxLength={140}
            aria-describedby="ayuda-titulo"
            value={titulo}
            onChange={(e) => {
              setTitulo(e.target.value);
            }}
          />
        </div>

        <div className="campo">
          <label htmlFor="cuerpo">¿Qué se hace, concretamente?</label>
          <span className="ayuda" id="ayuda-cuerpo">
            Mínimo 50 caracteres. Quién hace qué, para cuándo, y qué hace falta que hoy no hay.
          </span>
          <textarea
            id="cuerpo"
            required
            minLength={50}
            maxLength={4000}
            aria-describedby="ayuda-cuerpo"
            value={cuerpo}
            onChange={(e) => {
              setCuerpo(e.target.value);
            }}
          />
        </div>

        <PlanEjecucionFormulario
          value={plan}
          onChange={setPlan}
          bloqueado={cargando || sesion === undefined}
        />

        <button
          className="boton"
          type="submit"
          disabled={cargando || sesion === undefined || enCurso !== undefined}
        >
          {enCurso === 'guardar' ? 'Guardando…' : 'Guardar la propuesta'}
        </button>
      </form>
    </>
  );
}

export default function NuevaPropuesta(): ReactNode {
  return (
    // `role="status"` para que la espera se anuncie: sin él, quien usa un lector de pantalla se
    // queda ante una página que no dice nada mientras se resuelven los parámetros de la dirección.
    <Suspense
      fallback={
        <p className="cargando" role="status">
          Cargando el formulario…
        </p>
      }
    >
      <Formulario />
    </Suspense>
  );
}
