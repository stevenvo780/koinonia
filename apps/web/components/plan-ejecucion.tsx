'use client';

import type { ReactNode } from 'react';

import type { PlanEjecucion } from '@koinonia/contracts';

export type BorradorPlanEjecucion = {
  readonly objetivo: string;
  readonly revisarEn: string;
  readonly criterioDescripcion: string;
  readonly fuenteDeVerificacion: string;
};

export function fechaColombia(ms = Date.now()): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ms));
  const parte = (tipo: Intl.DateTimeFormatPartTypes): string =>
    partes.find((item) => item.type === tipo)?.value ?? '';
  return `${parte('year')}-${parte('month')}-${parte('day')}`;
}

export function sumarDiasColombia(dias: number, desde = Date.now()): string {
  const [anoTexto = '', mesTexto = '', diaTexto = ''] = fechaColombia(desde).split('-');
  const ano = Number(anoTexto);
  const mes = Number(mesTexto);
  const dia = Number(diaTexto);
  return fechaColombia(Date.UTC(ano, mes - 1, dia + dias, 17));
}

/** Fecha seleccionada a las 12:00 de Colombia, para que no cambie al verla desde otra zona horaria. */
export function mediodiaColombia(fecha: string): number {
  return new Date(`${fecha}T12:00:00-05:00`).getTime();
}

export function borradorPlanInicial(): BorradorPlanEjecucion {
  return {
    objetivo: '',
    revisarEn: sumarDiasColombia(45),
    criterioDescripcion: '',
    fuenteDeVerificacion: '',
  };
}

export function borradorDesdePlan(plan: PlanEjecucion | undefined): BorradorPlanEjecucion {
  if (plan === undefined) return borradorPlanInicial();
  const criterio = plan.criteriosDeExito[0];
  return {
    objetivo: plan.objetivo,
    revisarEn: fechaColombia(plan.revisarEn),
    criterioDescripcion: criterio?.descripcion ?? '',
    fuenteDeVerificacion: criterio?.fuenteDeVerificacion ?? '',
  };
}

export function convertirPlan(
  borrador: BorradorPlanEjecucion,
  responsableId: string | undefined,
): PlanEjecucion | undefined {
  if (responsableId === undefined || borrador.revisarEn === '') return undefined;
  return {
    objetivo: borrador.objetivo,
    responsableId,
    revisarEn: mediodiaColombia(borrador.revisarEn),
    criteriosDeExito: [
      {
        descripcion: borrador.criterioDescripcion,
        fuenteDeVerificacion: borrador.fuenteDeVerificacion,
      },
    ],
  };
}

export function PlanEjecucionFormulario({
  value,
  onChange,
  bloqueado = false,
  prefijo = 'plan',
}: {
  readonly value: BorradorPlanEjecucion;
  readonly onChange: (siguiente: BorradorPlanEjecucion) => void;
  readonly bloqueado?: boolean;
  readonly prefijo?: string;
}): ReactNode {
  const actualizar = (campo: keyof BorradorPlanEjecucion, contenido: string): void => {
    onChange({ ...value, [campo]: contenido });
  };
  const minimo = sumarDiasColombia(1);

  return (
    <fieldset className="plan-ejecucion" disabled={bloqueado}>
      <legend>Si esto se aprueba, ¿cómo sabremos qué hacer después?</legend>
      <p className="suave">
        Este plan se revisa antes de decidir. Así el acuerdo no se queda en una frase sin próximo
        paso. Al guardarlo, vos asumís la responsabilidad inicial; nadie puede dejársela a otra
        persona sin que esa persona acepte.
      </p>
      <div className="campo">
        <label htmlFor={`${prefijo}-objetivo`}>¿Qué debería cambiar si esto sale bien?</label>
        <span className="ayuda" id={`${prefijo}-ayuda-objetivo`}>
          Describí el cambio que la comunidad quiere lograr, no sólo la actividad.
        </span>
        <textarea
          id={`${prefijo}-objetivo`}
          required
          minLength={20}
          maxLength={1000}
          aria-describedby={`${prefijo}-ayuda-objetivo`}
          value={value.objetivo}
          onChange={(event) => {
            actualizar('objetivo', event.target.value);
          }}
        />
      </div>
      <div className="campo">
        <label htmlFor={`${prefijo}-revision`}>¿Cuándo volvemos a mirar si funcionó?</label>
        <span className="ayuda" id={`${prefijo}-ayuda-revision`}>
          Tiene que quedar después de que cierre y termine la revisión. La fecha se guarda al
          mediodía de Colombia para que no cambie al verla desde otro lugar.
        </span>
        <input
          id={`${prefijo}-revision`}
          type="date"
          required
          min={minimo}
          aria-describedby={`${prefijo}-ayuda-revision`}
          value={value.revisarEn}
          onChange={(event) => {
            actualizar('revisarEn', event.target.value);
          }}
        />
      </div>
      <div className="campo">
        <label htmlFor={`${prefijo}-criterio`}>
          ¿Qué tendría que pasar para decir que funcionó?
        </label>
        <span className="ayuda" id={`${prefijo}-ayuda-criterio`}>
          Escribí un resultado observable. Podrás sumar más criterios en una siguiente etapa.
        </span>
        <textarea
          id={`${prefijo}-criterio`}
          required
          minLength={20}
          maxLength={500}
          aria-describedby={`${prefijo}-ayuda-criterio`}
          value={value.criterioDescripcion}
          onChange={(event) => {
            actualizar('criterioDescripcion', event.target.value);
          }}
        />
      </div>
      <div className="campo">
        <label htmlFor={`${prefijo}-fuente`}>¿Dónde lo comprobamos?</label>
        <span className="ayuda" id={`${prefijo}-ayuda-fuente`}>
          Por ejemplo, un acta, una respuesta recibida o una lista de asistencia.
        </span>
        <input
          id={`${prefijo}-fuente`}
          type="text"
          required
          minLength={5}
          maxLength={500}
          aria-describedby={`${prefijo}-ayuda-fuente`}
          value={value.fuenteDeVerificacion}
          onChange={(event) => {
            actualizar('fuenteDeVerificacion', event.target.value);
          }}
        />
      </div>
    </fieldset>
  );
}

export function PlanEjecucionVisible({
  plan,
  titulo = 'Qué pasará si se aprueba',
  nivel = 'h2',
}: {
  readonly plan: PlanEjecucion | undefined;
  readonly titulo?: string;
  readonly nivel?: 'h2' | 'h4';
}): ReactNode {
  if (plan === undefined) {
    return (
      <AvisoPlanHistorico>
        Esta versión es anterior a que se pidiera un plan de ejecución. Conserva lo que se escribió,
        pero no permite inventar un siguiente paso ahora.
      </AvisoPlanHistorico>
    );
  }

  return (
    <section aria-label={titulo} className="plan-visible">
      {nivel === 'h2' ? <h2>{titulo}</h2> : <h4>{titulo}</h4>}
      <p>
        <strong>El cambio que buscamos:</strong> {plan.objetivo}
      </p>
      <p>
        <strong>Responsabilidad inicial:</strong> quien escribió esta versión la asumió
        personalmente. Nadie puede dejársela a otra persona sin su aceptación.
      </p>
      <p>
        <strong>Volvemos a mirar:</strong>{' '}
        {new Intl.DateTimeFormat('es-CO', {
          dateStyle: 'long',
          timeZone: 'America/Bogota',
        }).format(new Date(plan.revisarEn))}
        .
      </p>
      {nivel === 'h2' ? <h3>Cómo sabremos si funcionó</h3> : <h5>Cómo sabremos si funcionó</h5>}
      <ul>
        {plan.criteriosDeExito.map((criterio) => (
          <li key={`${criterio.descripcion}-${criterio.fuenteDeVerificacion}`}>
            {criterio.descripcion}{' '}
            <span className="suave">Lo comprobamos en: {criterio.fuenteDeVerificacion}.</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AvisoPlanHistorico({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <div className="aviso atencion" role="note">
      <strong>Esta información no quedó registrada: </strong>
      {children}
    </div>
  );
}
