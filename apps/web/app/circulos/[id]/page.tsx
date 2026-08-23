'use client';

/**
 * Un grupo: qué decide y quiénes lo integran.
 *
 * La lista de integrantes **no es pública**: la pide sólo quien pertenece al grupo, y quien no
 * pertenece recibe un 403 de la API aunque llame sin pasar por acá. Aquí no se esconde un botón
 * para «proteger» nada —eso sería decorar—: se pide, y si la respuesta es que no, se explica por
 * qué en vez de dejar un hueco.
 */

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import type { Circulo, MiembrosCirculo } from '@koinonia/contracts';

import { Cargando, ErrorVisible } from '../../../components/marco';
import { respuestaEsperada, traer } from '../../../lib/api';

export default function DetalleCirculo(): ReactNode {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [circulo, setCirculo] = useState<Circulo | undefined>(undefined);
  const [noExiste, setNoExiste] = useState(false);
  const [miembros, setMiembros] = useState<MiembrosCirculo | undefined>(undefined);
  const [sinPermiso, setSinPermiso] = useState<string | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);

  useEffect(() => {
    traer<Circulo[]>('/circulos')
      .then((lista) => {
        const encontrado = lista.find((candidato) => candidato.id === id);
        if (encontrado === undefined) setNoExiste(true);
        else setCirculo(encontrado);
      })
      .catch(setError);
  }, [id]);

  useEffect(() => {
    traer<MiembrosCirculo>(`/circulos/${id}/miembros`)
      .then(setMiembros)
      .catch((fallo: unknown) => {
        // Un 401 y un 403 no son un error de la pantalla: son la respuesta correcta a alguien que
        // no puede ver esto. Se cuentan como tales y se explican; cualquier otra cosa sí es un
        // fallo y se pinta como fallo.
        if (respuestaEsperada(fallo, 401)) {
          setSinPermiso(
            'Para ver quiénes integran un grupo hay que entrar con el correo institucional.',
          );
          return;
        }
        if (respuestaEsperada(fallo, 403)) {
          setSinPermiso(
            'Sólo quienes integran este grupo pueden ver la lista. No es un directorio público.',
          );
          return;
        }
        setError(fallo);
      });
  }, [id]);

  if (noExiste) {
    return (
      <>
        <h1>Ese grupo no existe</h1>
        <div className="vacio" role="status">
          <p>
            Puede que el enlace esté mal copiado o que el grupo se haya disuelto. Lo que decidió
            mientras existía sigue en el historial y no se borra.
          </p>
          <p>
            <Link href="/circulos">Ver todos los grupos</Link> ·{' '}
            <Link href="/historial">Ver el historial</Link>
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <h1>{circulo?.nombre ?? 'Un grupo'}</h1>

      <ErrorVisible error={error} />
      {/* `noExiste` no se comprueba: si fuera cierto, esta rama ya habría vuelto arriba. */}
      {circulo === undefined && error === undefined && <Cargando que="el grupo" />}

      {circulo !== undefined && (
        <p>
          <strong>Decide sin consultar a nadie:</strong> {circulo.decideSinConsultar}
        </p>
      )}

      <section aria-labelledby="quienes-titulo">
        <h2 id="quienes-titulo">Quiénes lo integran</h2>

        {sinPermiso !== undefined && (
          <div className="vacio" role="status">
            <p>{sinPermiso}</p>
            <p>
              Lo que este grupo <strong>decidió</strong> sí es público, aunque no lo sea quién lo
              integra: <Link href="/decisiones">mirá las votaciones</Link> o{' '}
              <Link href="/historial">el historial</Link>.
            </p>
            <p>
              <Link className="boton secundario" href="/entrar">
                Entrar con el correo institucional
              </Link>
            </p>
          </div>
        )}

        {miembros === undefined && sinPermiso === undefined && error === undefined && (
          <Cargando que="las personas del grupo" />
        )}

        {miembros !== undefined && miembros.length === 0 && (
          <div className="vacio" role="status">
            <p>
              Este grupo todavía no tiene a nadie. Mientras no tenga integrantes, lo que le
              correspondería lo decide la Asamblea completa.
            </p>
            <p>
              <Link href="/circulos">Ver los demás grupos</Link>
            </p>
          </div>
        )}

        {miembros !== undefined && miembros.length > 0 && (
          <>
            <p className="suave">
              {miembros.length} {miembros.length === 1 ? 'persona' : 'personas'}. Sólo el nombre con
              el que cada quien aparece: acá no hay correos, ni semestres, ni cuánto participó cada
              cual.
            </p>
            <ul className="tarjetas">
              {miembros.map((miembro) => (
                <li key={miembro.id}>{miembro.alias}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      <p>
        <Link href="/circulos">Volver a todos los grupos</Link>
      </p>
    </>
  );
}
