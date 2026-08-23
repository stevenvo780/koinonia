'use client';

/**
 * El asistente de acción sistémica (ADR-0052, PRODUCT.md §5): la puerta de entrada.
 *
 * Dos cosas y nada más: empezar un plan nuevo, o retomar uno que ya está en marcha. No hay un
 * tercer camino porque no lo hay en la API: `GET /asistente/borradores` sólo lista los propios, sin
 * fecha de inicio (`BorradorResumenDto` no la trae), así que cada tarjeta se identifica por la frase
 * que ya lleva escrita en vez de por una fecha — es, de hecho, mejor pista de cuál es cuál que un
 * timestamp.
 *
 * Nada de esto necesita sesión para EXPLICARSE —el título y el «cómo funciona» se ven igual sin
 * cuenta—, pero sí para guardar: sin sesión no hay a quién atarle el borrador (el propio dominio
 * dice que un borrador es de una persona, ver `services/api/src/http/rutas-asistente.ts`).
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import type { BorradorDetalleDto, BorradorResumenDto } from '@koinonia/contracts';

import { FichaEstadoBorrador } from '../../components/asistente';
import { Aviso, ErrorVisible, useSesion } from '../../components/marco';
import { Esqueleto, Meta, Tarjeta, Vacio } from '../../components/piezas';
import { useAccionUnica } from '../../lib/acciones';
import { enviar, traer } from '../../lib/api';

export default function Asistente(): ReactNode {
  const router = useRouter();
  const { sesion, cargando: cargandoSesion } = useSesion();
  const [borradores, setBorradores] = useState<BorradorResumenDto[] | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const { enCurso, ejecutar } = useAccionUnica();

  useEffect(() => {
    if (cargandoSesion || sesion === undefined) return;
    traer<BorradorResumenDto[]>('/asistente/borradores').then(setBorradores).catch(setError);
  }, [cargandoSesion, sesion]);

  async function empezar(): Promise<void> {
    const resultado = await ejecutar('empezar', {}, () =>
      enviar<BorradorDetalleDto>('/asistente/borradores', {}),
    );
    if (resultado.estado === 'hecho') {
      router.push(`/asistente/${resultado.valor.id}/preguntas/1`);
    } else if (resultado.estado === 'fallo') {
      setError(resultado.error);
    }
  }

  return (
    <div className="pagina-indice">
      <h1>El asistente</h1>
      <p className="lede">
        Convierte una idea suelta en un plan, una pregunta por pantalla. No es un examen: sólo dos
        de las 27 preguntas son obligatorias, «todavía no sé» también vale como respuesta, y podés
        parar cuando quieras y seguir después justo donde ibas.
      </p>
      <p className="suave">
        Un ayudante automático puede ofrecerte ideas si se lo pedís y das tu permiso. Nunca decide
        nada por vos: lo que escribe se muestra aparte, con su propio marco, hasta que decidís
        usarlo, editarlo o descartarlo.
      </p>

      {!cargandoSesion && sesion === undefined && (
        <Aviso tipo="atencion" titulo="Antes de empezar">
          Para guardar el plan a medida que avanzás hay que entrar con el correo institucional.{' '}
          <Link href="/entrar">Entrar</Link>.
        </Aviso>
      )}

      <ErrorVisible error={error} />

      <p>
        <button
          className="boton accion"
          type="button"
          disabled={cargandoSesion || sesion === undefined || enCurso !== undefined}
          onClick={() => void empezar()}
        >
          {enCurso === 'empezar' ? 'Empezando…' : 'Empezar un plan nuevo'}
        </button>
      </p>

      {sesion !== undefined && borradores === undefined && error === undefined && (
        <Esqueleto que="tus planes en marcha" />
      )}

      {sesion !== undefined && borradores !== undefined && (
        <section aria-labelledby="borradores-titulo">
          <h2 id="borradores-titulo">Tus planes</h2>
          {borradores.length === 0 ? (
            <Vacio
              titulo="Todavía no empezaste ningún plan"
              salida={{ href: '/problemas', texto: 'Ver los problemas que ya se escribieron' }}
            >
              <p>
                Un plan te ayuda a pensar antes de escribir un problema o una propuesta. También
                podés saltarte este paso y escribir directo.
              </p>
            </Vacio>
          ) : (
            <ul className="tarjetas">
              {borradores.map((borrador) => (
                <Tarjeta
                  key={borrador.id}
                  titulo={borrador.frase.texto}
                  enlace={`/asistente/${borrador.id}`}
                >
                  <FichaEstadoBorrador estado={borrador.estado} />
                  <Meta>{`${String(borrador.cuantasRespondidas)} de 27 preguntas respondidas`}</Meta>
                </Tarjeta>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
