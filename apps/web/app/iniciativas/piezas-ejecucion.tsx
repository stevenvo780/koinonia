'use client';

/**
 * Las piezas que las dos pantallas de ejecución —el detalle de una iniciativa y «Mis tareas»—
 * necesitan y que no existían: el peldaño de incumplimiento de una tarea, lo que el plan compromete
 * y la ventana de impugnación que separa «se aprobó» de «se puede empezar».
 *
 * Vive en `app/iniciativas/` y no en `components/`: `components/piezas.tsx` es la biblioteca común
 * de las 23 pantallas y está fuera de mi propiedad en este encargo. `app/iniciativas/` y
 * `app/mis-tareas/` sí son míos, y Next.js admite colocar módulos que no son rutas dentro de una
 * carpeta de rutas —`[id]/evaluacion.tsx` ya lo hace—, así que este es el sitio donde las dos
 * pantallas pueden compartir sin tocar nada de nadie.
 *
 * ═══ Por qué el peldaño se pinta con `<Ficha>` y no con un componente propio ═══
 *
 * Una tarea ya lleva una `<Ficha>` con su estado (`En curso`, `Bloqueada`…). El peldaño es una
 * lectura DISTINTA sobre la misma tarea —el estado dice dónde está el trabajo; el peldaño dice qué
 * le toca a la comunidad hacer al respecto— y por eso va en su propio bloque, con su explicación al
 * lado y no como una segunda píldora suelta que se confundiría con la primera. La explicación no es
 * opcional ni está plegada: sin ella «Pasó la fecha» es un reproche, y con ella es una instrucción.
 */

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

import type { Hito, Tarea } from '@koinonia/contracts';

import {
  ESCALON_EN_PALABRAS,
  ESCALON_EXPLICACION,
  ESCALON_PRIVADO,
  ESCALON_VARIANTE,
  escalonesPorTarea,
  type EscalonTarea,
  type EscalonesDeIniciativa,
} from './escalones';
import { duracionEnPalabras, ordenDelTrabajo, resumirPlan, ventanaDeImpugnacion } from './plan';
import { Aviso } from '../../components/marco';
import { Ficha, Meta, Plazo } from '../../components/piezas';
import { cerrarFrase, cuando, traer } from '../../lib/api';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Los peldaños
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Trae los peldaños de una o varias iniciativas y los devuelve en un único índice
 * `tareaId → peldaño`. Los identificadores de tarea son opacos y únicos, así que aplanar varias
 * iniciativas en un solo mapa no puede colisionar y le ahorra a quien llama tener que recordar de
 * qué iniciativa venía cada tarea.
 *
 * **Un fallo acá no rompe la pantalla.** El peldaño es una capa de lectura sobre un trabajo que ya
 * se ve entero sin ella; si la petición falla —o si quien mira no tiene sesión y por tanto no le
 * corresponde ver ninguno—, la pantalla se queda sin peldaños y no muestra ningún error. Lo
 * contrario sería castigar la lectura de una iniciativa por un dato accesorio.
 *
 * `sello` es lo que hace que el peldaño no se quede viejo. El peldaño lo calcula el servidor a
 * partir del estado de la tarea, así que bloquearla o pedir ayuda lo cambia — pero esas acciones no
 * cambian la lista de iniciativas, y sin una segunda señal el efecto no se volvería a disparar y la
 * pantalla seguiría diciendo «pasó la fecha» junto a una tarea que acaba de quedar detenida. Quien
 * llama pasa acá algo que cambie con cada mutación (la `revision` de cada tarea sirve, y es
 * exactamente lo que el servidor incrementa al escribir).
 */
export function useEscalones(
  iniciativaIds: readonly string[],
  sello = '',
): ReadonlyMap<string, EscalonTarea> {
  // La clave estable evita que un array nuevo con los mismos ids relance la petición en cada
  // render: `useEffect` compara por identidad, y `iniciativaIds` casi siempre se construye al vuelo.
  // Ordenada y sin repetidos: «Mis tareas» pasa una lista con un id por TAREA, y varias tareas de
  // la misma iniciativa pedirían la misma respuesta varias veces.
  const clave = [...new Set(iniciativaIds)].sort().join(',');
  const [indice, setIndice] = useState<ReadonlyMap<string, EscalonTarea>>(new Map());

  useEffect(() => {
    const ids = clave === '' ? [] : clave.split(',');
    if (ids.length === 0) {
      setIndice(new Map());
      return;
    }
    let vivo = true;
    void Promise.all(
      ids.map(async (id) => {
        try {
          return await traer<EscalonesDeIniciativa>(`/iniciativas/${id}/escalones`);
        } catch {
          return undefined;
        }
      }),
    ).then((respuestas) => {
      if (!vivo) return;
      const juntos = new Map<string, EscalonTarea>();
      for (const respuesta of respuestas) {
        for (const [tareaId, escalon] of escalonesPorTarea(respuesta)) juntos.set(tareaId, escalon);
      }
      setIndice(juntos);
    });
    return () => {
      vivo = false;
    };
  }, [clave, sello]);

  return indice;
}

/**
 * El sello que le toca a una lista de tareas: su identidad y su revisión. La `revision` de una
 * tarea es opaca y el servidor la sube en cada escritura, así que cambia exactamente cuando puede
 * haber cambiado el peldaño y no antes — mucho más barato que volver a pedirlo con un temporizador.
 */
export function selloDeTareas(
  tareas: readonly { readonly id: string; readonly revision: number }[],
): string {
  return tareas.map((tarea) => `${tarea.id}:${String(tarea.revision)}`).join('|');
}

/**
 * El peldaño de UNA tarea, dicho entero: la palabra, la explicación y —si es de los dos privados—
 * la constancia de que nadie más lo está viendo.
 *
 * Esa última frase es la mitad del requisito de ADR-0040 que el servidor no puede cumplir por sí
 * solo: filtra bien, pero quien recibe un recordatorio a 48 h de la fecha no tiene forma de saber
 * que es privado si la pantalla no se lo dice, y un recordatorio que se cree público **es** una
 * sanción aunque nadie más lo lea.
 */
export function PeldanoDeTarea({ escalon }: { readonly escalon: EscalonTarea }): ReactNode {
  const variante = ESCALON_VARIANTE[escalon];
  const privado = ESCALON_PRIVADO[escalon];
  return (
    <div className={variante === 'atencion' ? 'aviso atencion' : 'aviso'} role="note">
      <Ficha variante={variante}>{ESCALON_EN_PALABRAS[escalon]}</Ficha>
      <p>{ESCALON_EXPLICACION[escalon]}</p>
      {privado && <p className="suave">Sólo lo ves vos. No aparece para el resto del círculo.</p>}
    </div>
  );
}

/**
 * El aviso de iniciativa cuando alguna de sus tareas llegó al techo de la escalera.
 *
 * No dice cuántas ni cuáles, y desde luego no dice de quién: dice qué se mira y qué NO se mira. El
 * pliego pide literalmente que en ese peldaño «el objeto sea el acuerdo o la carga, no la persona»,
 * y esa frase tiene que estar en la pantalla, no sólo en el ADR — quien abre la iniciativa y ve que
 * el círculo va a revisar algo necesita leer, en ese mismo momento, que no lo van a revisar a él.
 */
export function AvisoDeRevisionColectiva(): ReactNode {
  return (
    <Aviso tipo="atencion" titulo="Hay algo que el círculo tiene que mirar en conjunto">
      Alguna tarea de esta iniciativa volvió al círculo varias veces o coincide con otras detenidas.
      Lo que se abre es una conversación sobre el acuerdo y el reparto de la carga, no sobre quién
      la llevaba. Cuando una tarea se atasca tres veces, casi siempre se planeó mal, no se hizo mal.
    </Aviso>
  );
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// El plan comprometido
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Los campos del plan que faltaban por mostrar, en la forma que evita el formulario abrumador que
 * este encargo señalaba como riesgo.
 *
 * **Qué se ve siempre**: una sola línea con las cuatro cifras del plan —hitos, tareas, tiempo
 * estimado, respaldos aportados—. Es lo que contesta «¿de qué tamaño es esto?» sin hacer leer nada.
 *
 * **Qué se pliega**: el orden del trabajo, tarea por tarea. Es la información más larga y la que
 * menos gente necesita a la vez —importa cuando vas a tomar una tarea, no cuando pasás mirando—, y
 * cada tarea ya dice sus propias dependencias en su tarjeta. Acá está el mapa completo, para quien
 * lo busca.
 *
 * **Qué NO se ve, y no es un olvido**: recursos que hacen falta, riesgos y presupuesto. Ver la
 * cabecera de `plan.ts`: el dominio no los guarda en ninguna parte, y pintar un campo vacío
 * prometería que el sistema los recuerda.
 */
export function PlanComprometido({
  hitos,
  tareas,
}: {
  readonly hitos: readonly Hito[];
  readonly tareas: readonly Tarea[];
}): ReactNode {
  const resumen = resumirPlan({ hitos, tareas });
  if (resumen.tareas === 0) return null;
  const orden = ordenDelTrabajo(tareas);
  return (
    <section aria-labelledby="plan-comprometido-titulo">
      <h2 id="plan-comprometido-titulo">De qué tamaño es este compromiso</h2>
      <Meta>
        {`${String(resumen.hitos)} ${resumen.hitos === 1 ? 'hito' : 'hitos'}`}
        {`${String(resumen.tareas)} ${resumen.tareas === 1 ? 'tarea' : 'tareas'}`}
        {`${duracionEnPalabras(resumen.esfuerzoMinutos)} de trabajo estimado`}
        {resumen.evidencias > 0
          ? `${String(resumen.evidencias)} ${
              resumen.evidencias === 1 ? 'dato que lo respalda' : 'datos que lo respaldan'
            }`
          : null}
      </Meta>
      <p className="suave">
        El tiempo es una estimación del plan, repartida entre todas las tareas: no mide lo que hizo
        nadie.
      </p>

      {orden.length > 0 && (
        <details>
          <summary>
            Ver el orden del trabajo ({orden.length}{' '}
            {orden.length === 1 ? 'tarea espera a otra' : 'tareas esperan a otra'})
          </summary>
          <p className="suave">
            Una tarea que espera no está frenada por nadie: está esperando su turno. Cuando lo de
            arriba se completa, la de abajo puede empezar.
          </p>
          <ul>
            {orden.map((fila) => (
              <li key={fila.id}>
                <p>
                  <strong>{fila.titulo}</strong>
                  {fila.libre ? ' ya puede empezar.' : ' necesita que antes termine:'}
                </p>
                {!fila.libre && (
                  <ul>
                    {fila.espera.map((paso, indice) => (
                      // Índice como clave: los pasos son estáticos por render y no se reordenan.
                      <li key={indice}>
                        {paso.titulo} {paso.completada ? '(ya está)' : '(todavía no)'}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// El nacimiento de la iniciativa y su ventana de impugnación
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * De dónde salió esta iniciativa y qué falta para poder arrancar.
 *
 * El detalle ya decía «la decisión fue aprobada pero todavía puede impugnarse» y la fecha en que se
 * podrá ratificar. Faltaban las tres cosas que convierten esa frase en algo con lo que una persona
 * puede hacer algo:
 *
 *  1. **Que nació sola.** Nadie creó esta iniciativa a mano: apareció en el mismo acto en que la
 *     decisión se cerró (ADR-0043), y por eso no hay ningún botón de «crear iniciativa» en ninguna
 *     parte. Quien no sepa eso busca el botón.
 *  2. **Cuánto falta**, como cuenta atrás y no sólo como fecha: `<Plazo>` ya sabe decir «2 días» en
 *     grande y la frase completa para quien usa lector de pantalla.
 *  3. **Cuánto dura la ventana y qué pasa al final.** La duración se calcula de los dos instantes
 *     que manda el servidor —ver `ventanaDeImpugnacion` en `plan.ts`—, así que si el Instituto
 *     cambia el plazo, la pantalla lo dice bien sin que nadie la toque.
 */
export function AntesDeArrancar({
  decisionId,
  creadaEn,
  ratificableEn,
  activa,
  activadaEn,
}: {
  readonly decisionId: string;
  readonly creadaEn: number;
  readonly ratificableEn: number | undefined;
  readonly activa: boolean;
  readonly activadaEn: number | undefined;
}): ReactNode {
  // `Date.now()` una sola vez por render y no dentro de cada frase, para que la cuenta atrás y el
  // «ya venció» nunca se contradigan entre sí por unos milisegundos.
  const ahora = Date.now();
  const ventana = ventanaDeImpugnacion(creadaEn, ratificableEn, ahora);

  return (
    <section aria-labelledby="nacimiento-titulo">
      <h2 id="nacimiento-titulo">De dónde sale y cuándo se puede empezar</h2>
      <p>
        Esta iniciativa no la creó nadie a mano: nació en el mismo momento en que se cerró la
        votación que la aprobó, el {cerrarFrase(cuando(creadaEn))} Por eso el objetivo, la persona
        responsable inicial y los criterios ya vienen puestos: son los que se votaron.
      </p>
      <p>
        <Link href={`/decisiones/${decisionId}/resultado`}>Ver la decisión que la creó</Link>
      </p>

      {activa ? (
        <p>
          El plazo para impugnarla terminó y quedó ratificada
          {activadaEn === undefined ? '.' : ` el ${cerrarFrase(cuando(activadaEn))}`} Ya se puede
          organizar y repartir el trabajo.
        </p>
      ) : (
        <>
          <p>
            Antes de empezar hay un plazo para impugnarla
            {ventana === undefined
              ? '.'
              : ` de ${String(ventana.horas)} horas desde que la votación cerró.`}{' '}
            Es a propósito: si algo del procedimiento estuvo mal, todavía se puede decir, y deshacer
            trabajo ya hecho sale mucho más caro que esperar.
          </p>
          {ventana !== undefined && !ventana.vencida && (
            <>
              <Plazo ms={ventana.ratificableEn} ahora={ahora} />
              <p className="suave">
                Falta para poder ratificarla. Hasta entonces no corresponde empezar trabajo que no
                se pueda deshacer.
              </p>
            </>
          )}
          {ventana !== undefined && ventana.vencida && (
            <p>
              El plazo terminó el {cerrarFrase(cuando(ventana.ratificableEn))} Falta que alguien de
              facilitación o de garantías la ratifique para abrir el trabajo.
            </p>
          )}
        </>
      )}
    </section>
  );
}
