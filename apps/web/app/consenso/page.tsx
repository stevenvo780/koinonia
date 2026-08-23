'use client';

/**
 * En qué coincide la gente y en qué no.
 *
 * Cuatro decisiones sostienen esta pantalla, y las cuatro son contra la misma tentación —enseñar
 * bandos porque quedan bonitos—:
 *
 *  1. **De dónde sale va arriba, no en una ayuda.** Un mapa de grupos sin esa línea se lee como un
 *     veredicto sobre las personas. Con ella se lee como lo que es: un resumen de respuestas que ya
 *     eran públicas y que cualquiera puede volver a contar.
 *  2. **«No hay grupos claros» es un resultado, no un hueco.** El contrato llega como unión
 *     discriminada, así que aquí no existe la variable `grupos` cuando no hay grupos: no se puede
 *     pintar una lista vacía ni por descuido. Una lista vacía se lee como «no participó nadie», que
 *     es una cosa distinta y falsa.
 *  3. **Los grupos no tienen nombre.** Se numeran desde 1 y nada más. Ponerles etiqueta —«los
 *     críticos»— sería el salto de descripción a veredicto que este análisis no puede dar.
 *  4. **Nunca un callejón.** Cuando todavía no se puede calcular, se dice qué falta y adónde ir.
 */

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

import type { Consenso, ListaDeConsenso } from '@koinonia/contracts';

import { Cargando, ErrorVisible } from '../../components/marco';
import { traer } from '../../lib/api';

function Lista({ lista, id }: { readonly lista: ListaDeConsenso; readonly id: string }): ReactNode {
  return (
    <section aria-labelledby={`${id}-titulo`}>
      <h2 id={`${id}-titulo`}>{lista.titulo}</h2>
      <p>{lista.descripcion}</p>
      {lista.textos.length === 0 ? (
        <div className="vacio" role="status">
          <p>{lista.aviso}</p>
        </div>
      ) : (
        <ul className="tarjetas">
          {lista.textos.map((texto) => (
            <li key={texto.texto}>
              <h3>{texto.texto}</h3>
              <p className="suave">
                Se pronunciaron {texto.respuestas} {texto.respuestas === 1 ? 'persona' : 'personas'}
                .
              </p>
              {/*
                Una tabla y no una barra de color: el nivel de acuerdo tiene que poder leerse con un
                lector de pantalla y sin distinguir colores (WCAG 1.4.1). El encabezado de fila es
                el grupo, así que cada celda se anuncia con su grupo delante.
              */}
              <table className="datos">
                <caption className="suave">Cuánto acuerdo reunió en cada grupo</caption>
                <thead>
                  <tr>
                    <th scope="col">Grupo</th>
                    <th scope="col">De acuerdo</th>
                  </tr>
                </thead>
                <tbody>
                  {texto.acuerdoPorGrupo.map((acuerdo) => (
                    <tr key={acuerdo.grupo}>
                      <th scope="row">Grupo {acuerdo.grupo}</th>
                      <td>{acuerdo.acuerdo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DeDondeSale({ texto }: { readonly texto: string }): ReactNode {
  return (
    <details className="de-donde-sale">
      <summary>¿De dónde salen estos grupos?</summary>
      <p>{texto}</p>
      <p>
        Si querés comprobarlo por tu cuenta,{' '}
        <Link href="/verificar">descargá el historial completo y volvé a contarlo</Link>. No hace
        falta que confíes en esta página.
      </p>
    </details>
  );
}

function SalidasHabituales(): ReactNode {
  return (
    <p>
      Mientras tanto: <Link href="/problemas">mirá los problemas abiertos</Link>,{' '}
      <Link href="/deliberaciones">las conversaciones en curso</Link> o{' '}
      <Link href="/decisiones">las votaciones</Link>.
    </p>
  );
}

export default function ConsensoPantalla(): ReactNode {
  const [consenso, setConsenso] = useState<Consenso | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);

  useEffect(() => {
    traer<Consenso>('/consenso').then(setConsenso).catch(setError);
  }, []);

  return (
    <>
      <h1>En qué coincidimos</h1>
      <p>
        Acá no se vota nada. Se mira cómo respondió la gente en las votaciones que ya cerraron y se
        busca lo que une, no lo que separa: <strong>en qué estamos de acuerdo casi todos</strong>,
        incluso quienes discrepan en lo demás.
      </p>

      <ErrorVisible error={error} />
      {consenso === undefined && error === undefined && <Cargando que="el análisis" />}

      {consenso?.tipo === 'todavia-no' && (
        <div className="vacio" role="status">
          <h2>{consenso.titulo}</h2>
          <p>{consenso.descripcion}</p>
          <p>
            <strong>Qué falta:</strong> {consenso.queFalta}
          </p>
          <p className="suave">
            Van {consenso.votaciones}{' '}
            {consenso.votaciones === 1 ? 'votación cerrada' : 'votaciones cerradas'} y{' '}
            {consenso.personas} {consenso.personas === 1 ? 'persona' : 'personas'} que respondieron.
          </p>
          <SalidasHabituales />
        </div>
      )}

      {consenso?.tipo === 'sin-grupos' && (
        <>
          <div className="aviso atencion" role="status">
            <strong>
              <span aria-hidden="true">! </span>
              {consenso.titulo}:{' '}
            </strong>
            {consenso.descripcion}
          </div>
          <p className="suave">
            Salió de {consenso.votaciones}{' '}
            {consenso.votaciones === 1 ? 'votación cerrada' : 'votaciones cerradas'} y de las
            respuestas de {consenso.personas} {consenso.personas === 1 ? 'persona' : 'personas'}.
          </p>
          <DeDondeSale texto={consenso.deDondeSale} />
          <Lista lista={consenso.acuerdoGeneral} id="acuerdo-general" />
          <SalidasHabituales />
        </>
      )}

      {consenso?.tipo === 'grupos' && (
        <>
          <section aria-labelledby="grupos-titulo">
            <h2 id="grupos-titulo">{consenso.titulo}</h2>
            <p>{consenso.descripcion}</p>
            <p className="suave">
              Salió de {consenso.votaciones} votaciones cerradas y de las respuestas de{' '}
              {consenso.personas} personas.
            </p>
            <DeDondeSale texto={consenso.deDondeSale} />

            <ul className="tarjetas">
              {consenso.grupos.map((grupo) => (
                <li key={grupo.numero}>
                  <h3>Grupo {grupo.numero}</h3>
                  <p>
                    {grupo.personas} {grupo.personas === 1 ? 'persona' : 'personas'}
                    {consenso.miGrupo === grupo.numero && (
                      // Se dice con palabras y no sólo con un color de fondo: el criterio 1.4.1 no
                      // admite que la única señal sea visual.
                      <>
                        {' '}
                        <span className="etiqueta">Acá quedaste vos</span>
                      </>
                    )}
                  </p>
                </li>
              ))}
            </ul>

            {consenso.miGrupo === undefined && (
              <p className="suave">
                Vos no aparecés en ningún grupo porque no respondiste en ninguna de esas votaciones.{' '}
                <Link href="/decisiones">Mirá si hay alguna abierta</Link>.
              </p>
            )}
          </section>

          {/* Lo que une va PRIMERO. Es una decisión de producto, no de maquetación: quien abre
              esta pantalla y lo primero que ve son los bandos se lleva la lectura contraria a la
              que el análisis puede sostener. */}
          <Lista lista={consenso.enQueCoinciden} id="coinciden" />
          <Lista lista={consenso.enQueSeSeparan} id="separan" />

          <section aria-labelledby="ojo-titulo">
            <h2 id="ojo-titulo">Cómo NO leer esto</h2>
            <p>
              Esto describe respuestas, no personas. Nadie «es» de un grupo: cada quien respondió lo
              que respondió en unas votaciones concretas, y en la siguiente puede quedar en otro
              lado. Los grupos no son bandos, no tienen representantes y no deciden nada.
            </p>
            <p>
              Sirve para una sola cosa: <strong>encontrar por dónde seguir la conversación</strong>.
              Lo que aparece arriba, donde coincide casi todo el mundo, suele ser mejor punto de
              partida que lo que aparece abajo.
            </p>
          </section>
        </>
      )}
    </>
  );
}
