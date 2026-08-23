'use client';

/**
 * Escribir un problema.
 *
 * Las preguntas son literalmente las del asistente (PRODUCT §5): «en una frase, ¿qué está pasando
 * que no debería estar pasando?» y «¿cómo te diste cuenta?». Ni una palabra de gestión de proyectos:
 * si Sara se encuentra «objetivo», «indicador» y «línea base», entiende que este no es su terreno y
 * no vuelve nunca.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type SyntheticEvent, type ReactNode } from 'react';

import type { ProblemaDetalle } from '@koinonia/contracts';

import { Aviso, Cargando, ErrorVisible, useSesion } from '../../../components/marco';
import { useAccionUnica } from '../../../lib/acciones';
import { cerrarFrase, enviar, traer } from '../../../lib/api';

interface Circulo {
  readonly id: string;
  readonly nombre: string;
  readonly decideSinConsultar: string;
}

export default function NuevoProblema(): ReactNode {
  const router = useRouter();
  const { sesion, cargando } = useSesion();
  const [circulos, setCirculos] = useState<Circulo[] | undefined>(undefined);
  const [titulo, setTitulo] = useState('');
  const [cuerpo, setCuerpo] = useState('');
  const [circuloId, setCirculoId] = useState('');
  const [error, setError] = useState<unknown>(undefined);
  const [errorCirculos, setErrorCirculos] = useState<unknown>(undefined);
  const { enCurso, ejecutar } = useAccionUnica();

  const cargarCirculos = useCallback(() => {
    setErrorCirculos(undefined);
    traer<Circulo[]>('/circulos')
      .then((lista) => {
        setCirculos(lista);
        setCirculoId(lista[0]?.id ?? '');
      })
      .catch(setErrorCirculos);
  }, []);

  useEffect(cargarCirculos, [cargarCirculos]);

  async function guardar(evento: SyntheticEvent): Promise<void> {
    evento.preventDefault();
    setError(undefined);
    const resultado = await ejecutar('guardar', { titulo, cuerpo, circuloId }, (requestId) =>
      enviar<ProblemaDetalle>('/problemas', { requestId, titulo, cuerpo, circuloId }),
    );
    if (resultado.estado === 'hecho') router.push(`/problemas/${resultado.valor.id}`);
    else if (resultado.estado === 'fallo') setError(resultado.error);
  }

  const elegido = circulos?.find((circulo) => circulo.id === circuloId);

  return (
    <>
      <h1>Tengo un problema o una idea</h1>

      {!cargando && sesion === undefined && (
        <Aviso tipo="atencion" titulo="Antes de escribir">
          Para que quede constancia hay que entrar con el correo institucional.{' '}
          {/* `Link` y no `<a>`: una navegación completa tira el borrador que ya escribiste. */}
          <Link href="/entrar">Entrar ahora</Link>. Lo que escribas acá se conserva mientras tanto.
        </Aviso>
      )}

      <ErrorVisible error={error} />

      {/*
       * Sin la lista de grupos no hay formulario. Antes se pintaba igual, con el desplegable vacío
       * y `circuloId` en cadena vacía: la persona escribía dos párrafos y el servidor los rechazaba
       * al final. Un formulario que no puede tener éxito no se enseña.
       */}
      {errorCirculos !== undefined ? (
        <>
          <ErrorVisible error={errorCirculos} />
          <p>
            No pudimos traer la lista de grupos que deciden, y sin ella lo que escribas no se puede
            guardar. No perdés nada por intentarlo otra vez.
          </p>
          <p>
            <button className="boton" type="button" onClick={cargarCirculos}>
              Volver a intentar
            </button>{' '}
            <Link className="boton secundario" href="/problemas">
              Ver los problemas que ya existen
            </Link>
          </p>
        </>
      ) : circulos === undefined ? (
        <Cargando que="los grupos que deciden" />
      ) : (
        <form onSubmit={(e) => void guardar(e)} noValidate>
          <div className="campo">
            <label htmlFor="titulo">
              En una frase, ¿qué está pasando que no debería estar pasando?
            </label>
            <span className="ayuda" id="ayuda-titulo">
              Sin rodeos. Entre 10 y 140 caracteres. Ejemplo: «La sala de estudio cierra a las 6 y
              los de la nocturna no tenemos dónde leer».
            </span>
            <input
              id="titulo"
              name="titulo"
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
            <label htmlFor="cuerpo">¿Cómo te diste cuenta? Contá el hecho concreto.</label>
            <span className="ayuda" id="ayuda-cuerpo">
              A quiénes les pasa, desde cuándo, y qué va a pasar si nadie hace nada. Si no sabés
              algo, escribí «todavía no sé»: vale, y queda como algo que alguien puede averiguar.
            </span>
            <textarea
              id="cuerpo"
              name="cuerpo"
              required
              minLength={30}
              maxLength={4000}
              aria-describedby="ayuda-cuerpo"
              value={cuerpo}
              onChange={(e) => {
                setCuerpo(e.target.value);
              }}
            />
          </div>

          <div className="campo">
            <label htmlFor="circulo">¿Quién decide esto?</label>
            <span className="ayuda" id="ayuda-circulo">
              Si te equivocás no pasa nada: se reenvía al grupo que corresponde y te decimos por
              qué.
            </span>
            {/*
             * En la opción va **sólo el nombre del grupo**. Antes iba «nombre — qué decide», y un
             * desplegable no parte el texto en dos renglones: en un teléfono de 360 px la opción
             * elegida se leía «Asamblea del Instituto — Todo lo q», recortada justo en lo único que
             * hace falta para elegir bien. Lo que cada grupo decide se dice debajo, entero y con
             * renglones, y va enganchado al desplegable con `aria-describedby` para que quien usa
             * un lector de pantalla lo oiga al llegar al campo; `aria-live` lo vuelve a decir cada
             * vez que la elección cambia, que es cuando importa.
             */}
            <select
              id="circulo"
              name="circulo"
              aria-describedby="ayuda-circulo detalle-circulo"
              value={circuloId}
              onChange={(e) => {
                setCirculoId(e.target.value);
              }}
            >
              {circulos.map((circulo) => (
                <option key={circulo.id} value={circulo.id}>
                  {circulo.nombre}
                </option>
              ))}
            </select>
            <span className="ayuda" id="detalle-circulo" aria-live="polite">
              {elegido === undefined
                ? 'Elegí un grupo para ver qué decide.'
                : cerrarFrase(
                    `${elegido.nombre} decide sin consultar a nadie: ${elegido.decideSinConsultar}`,
                  )}
            </span>
          </div>

          <button className="boton" type="submit" disabled={enCurso !== undefined}>
            {enCurso === 'guardar' ? 'Guardando…' : 'Guardar el problema'}
          </button>
        </form>
      )}
    </>
  );
}
