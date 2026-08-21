'use client';

/**
 * Escribir un problema.
 *
 * Las preguntas son literalmente las del asistente (PRODUCT §5): «en una frase, ¿qué está pasando
 * que no debería estar pasando?» y «¿cómo te diste cuenta?». Ni una palabra de gestión de proyectos:
 * si Sara se encuentra «objetivo», «indicador» y «línea base», entiende que este no es su terreno y
 * no vuelve nunca.
 */

import { useRouter } from 'next/navigation';
import { useEffect, useState, type SyntheticEvent, type ReactNode } from 'react';

import type { ProblemaDetalle } from '@koinonia/contracts';

import { Aviso, ErrorVisible, useSesion } from '../../../components/marco';
import { enviar, nuevoRequestId, traer } from '../../../lib/api';

interface Circulo {
  readonly id: string;
  readonly nombre: string;
  readonly decideSinConsultar: string;
}

export default function NuevoProblema(): ReactNode {
  const router = useRouter();
  const { sesion, cargando } = useSesion();
  const [circulos, setCirculos] = useState<Circulo[]>([]);
  const [titulo, setTitulo] = useState('');
  const [cuerpo, setCuerpo] = useState('');
  const [circuloId, setCirculoId] = useState('');
  const [error, setError] = useState<unknown>(undefined);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    traer<Circulo[]>('/circulos')
      .then((lista) => {
        setCirculos(lista);
        setCirculoId(lista[0]?.id ?? '');
      })
      .catch(setError);
  }, []);

  async function guardar(evento: SyntheticEvent): Promise<void> {
    evento.preventDefault();
    setError(undefined);
    setEnviando(true);
    try {
      const creado = await enviar<ProblemaDetalle>('/problemas', {
        requestId: nuevoRequestId(),
        titulo,
        cuerpo,
        circuloId,
      });
      router.push(`/problemas/${creado.id}`);
    } catch (fallo) {
      setError(fallo);
      setEnviando(false);
    }
  }

  return (
    <>
      <h1>Tengo un problema o una idea</h1>

      {!cargando && sesion === undefined && (
        <Aviso tipo="atencion" titulo="Antes de escribir">
          Para que quede constancia hay que entrar con el correo institucional.{' '}
          <a href="/entrar">Entrar ahora</a>. Lo que escribas acá se conserva mientras tanto.
        </Aviso>
      )}

      <ErrorVisible error={error} />

      <form onSubmit={(e) => void guardar(e)} noValidate>
        <div className="campo">
          <label htmlFor="titulo">
            En una frase, ¿qué está pasando que no debería estar pasando?
          </label>
          <span className="ayuda" id="ayuda-titulo">
            Sin rodeos. Entre 10 y 140 caracteres. Ejemplo: «La sala de estudio cierra a las 6 y los
            de la nocturna no tenemos dónde leer».
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
            A quiénes les pasa, desde cuándo, y qué va a pasar si nadie hace nada. Si no sabés algo,
            escribí «todavía no sé»: vale, y queda como algo que alguien puede averiguar.
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
            Si te equivocás no pasa nada: se reenvía al grupo que corresponde y te decimos por qué.
          </span>
          <select
            id="circulo"
            name="circulo"
            aria-describedby="ayuda-circulo"
            value={circuloId}
            onChange={(e) => {
              setCirculoId(e.target.value);
            }}
          >
            {circulos.map((circulo) => (
              <option key={circulo.id} value={circulo.id}>
                {circulo.nombre} — {circulo.decideSinConsultar}
              </option>
            ))}
          </select>
        </div>

        <button className="boton" type="submit" disabled={enviando}>
          {enviando ? 'Guardando…' : 'Guardar el problema'}
        </button>
      </form>
    </>
  );
}
