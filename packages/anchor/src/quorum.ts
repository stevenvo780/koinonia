/**
 * **La política de quórum, como código.**
 *
 * Un checkpoint sólo se declara `FIRME` cuando lo confirman **dos clases de independencia
 * distintas**. La palabra que hace todo el trabajo es *distintas*: dos confirmaciones de la misma
 * clase no son dos testigos, son uno con dos nombres. Ese es el error que hace inútil el anclaje
 * múltiple —tres proveedores que en el fondo dependen del mismo tercero— y por eso la regla vive
 * aquí, con pruebas de propiedad detrás, y no en un párrafo de un documento que nadie ejecuta.
 *
 * ═══ Las cinco razones por las que un anclaje NO cuenta ═══
 *
 *  1. `no-confirmado` — la verificación no salió `confirmado`. Un `pendiente` o un `incompleto` es
 *     una promesa, no una prueba.
 *  2. `checkpoint-distinto` — el recibo ancla otro resumen. Es el ataque de reciclar un recibo viejo.
 *  3. `proveedor-repetido` — el mismo proveedor dos veces. Un proveedor es un testigo, no dos.
 *  4. `clase-repetida` — otra clase ya aportó. Es la regla central.
 *  5. `clave-en-el-servidor-verificado` — la clave privada del proveedor vive en la máquina que se
 *     está auditando. **Nunca cuenta.** Quien puede reescribir la historia puede firmar la versión
 *     falsa, así que ese anclaje no aporta independencia: aporta la ilusión de aportarla, que es
 *     peor. Es el «teatro» del §8.2 convertido en una condición del código.
 *
 * ═══ La degradación ═══
 *
 * Sin quórum, el estado público **no es «verde con un asterisco»**: es `NO ANCLADO`, con la fecha
 * desde la que no hay anclaje válido. A las 24 h pasa a alerta visible en portada; a las 72 h, las
 * decisiones adoptadas en ese lapso quedan marcadas *pendientes de confirmación de integridad*. Esa
 * última consecuencia es de gobernanza, no técnica, y es la única que hace que alguien repare el
 * problema (§8.4.4).
 *
 * DECISIÓN (discrepancia entre el enunciado y la spec §8.4): el enunciado dice que **toda** falla
 * degrada a `NO ANCLADO` de inmediato; la spec dice que se degrada «sin quórum a las 24 h». Se
 * implementa lo primero —la ausencia de quórum es ya el estado degradado desde el segundo cero— y
 * se conserva el umbral de 24 h como un escalón MÁS fuerte (`NO_ANCLADO_ALERTA`). Motivo: durante
 * esas primeras 24 h la historia reciente es efectivamente alterable (§«no garantiza» 3), y llamar
 * a eso «anclado» sería exactamente la confianza falsa que el documento se pasa doce páginas
 * evitando. Un estado que sólo se vuelve honesto al día siguiente no es un estado honesto.
 */

import type {
  IndependenceClass,
  ProviderMetadata,
  VerificationOutcome,
  VerificationStatus,
} from './types.js';

/** Dos clases distintas. No es configurable a la baja: con una sola clase no hay independencia. */
export const MIN_INDEPENDENCE_CLASSES = 2;

/** Horas sin quórum tras las que el estado se hace visible en portada (§8.4.3). */
export const ALERT_HOURS = 24;

/** Horas sin quórum tras las que las decisiones del lapso quedan marcadas (§8.4.4). */
export const CRITICAL_HOURS = 72;

export type PublicAnchorState =
  /** Dos clases de independencia distintas lo confirmaron. */
  | 'FIRME'
  /** Aún no hay quórum. Lo ocurrido desde el último checkpoint firme es alterable. */
  | 'NO_ANCLADO'
  /** 24 h sin quórum: visible en portada y en la pantalla de verificación. */
  | 'NO_ANCLADO_ALERTA'
  /** 72 h sin quórum: las decisiones del lapso quedan pendientes de confirmación de integridad. */
  | 'NO_ANCLADO_CRITICO';

export type RejectionReason =
  | 'no-confirmado'
  | 'checkpoint-distinto'
  | 'proveedor-repetido'
  | 'clase-repetida'
  | 'clave-en-el-servidor-verificado';

export interface RejectedAnchor {
  readonly provider: string;
  readonly independenceClass: IndependenceClass;
  readonly reason: RejectionReason;
  readonly detail: string;
}

/**
 * Lo mínimo que la política necesita saber de un anclaje. Deliberadamente plano: la política no
 * debe poder mirar dentro de un recibo ni volver a verificar nada. Verificar es de los proveedores;
 * decidir si cuenta es de aquí.
 */
export interface AnchorEvidence {
  readonly provider: string;
  readonly independenceClass: IndependenceClass;
  readonly status: VerificationStatus;
  /** `false` ⇒ la clave privada vive en la máquina verificada. */
  readonly signingKeyOffHost: boolean;
  /** Hex del checkpoint al que el recibo dice referirse. */
  readonly checkpointHash: string;
}

/** Construye la evidencia a partir de lo que devuelven el proveedor y su verificación. */
export function evidenceOf(
  meta: ProviderMetadata,
  outcome: VerificationOutcome,
  checkpointHash: string,
): AnchorEvidence {
  return {
    provider: meta.id,
    independenceClass: meta.independenceClass,
    status: outcome.status,
    signingKeyOffHost: meta.signingKeyOffHost,
    checkpointHash,
  };
}

export interface QuorumOptions {
  /** Hex del checkpoint que se está evaluando. */
  readonly checkpointHash: string;
  /** `issuedAt` del checkpoint, RFC 3339 UTC. */
  readonly issuedAt: string;
  /** Instante de la evaluación, RFC 3339 UTC. Inyectado: aquí no se lee el reloj. */
  readonly now: string;
  /** Sólo para pruebas y para simulaciones. Nunca por debajo de 2 en producción. */
  readonly minClasses?: number;
}

export interface QuorumVerdict {
  readonly firm: boolean;
  readonly state: PublicAnchorState;
  /** Clases distintas que aportaron una confirmación, ordenadas. */
  readonly confirmedClasses: readonly IndependenceClass[];
  /** Proveedores que aportaron, en el mismo orden que las clases. */
  readonly countedProviders: readonly string[];
  readonly rejected: readonly RejectedAnchor[];
  /** Horas transcurridas desde `issuedAt`. */
  readonly hoursSinceIssued: number;
  /** `true` ⇒ las decisiones del lapso se marcan *pendientes de confirmación de integridad*. */
  readonly decisionsPendingIntegrity: boolean;
  /** Una o dos frases en castellano llano. Es lo que se le enseña a la asamblea. */
  readonly explanation: string;
}

const RFC3339_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function hoursBetween(from: string, to: string): number {
  if (!RFC3339_UTC_MS.test(from) || !RFC3339_UTC_MS.test(to)) {
    throw new RangeError(
      `los instantes deben ser RFC 3339 UTC exactos (YYYY-MM-DDTHH:MM:SS.sssZ); llegaron ` +
        `'${from}' y '${to}'`,
    );
  }
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    throw new RangeError('instante no interpretable');
  }
  // Nunca negativo: un reloj que va hacia atrás no debe poder «rejuvenecer» un checkpoint viejo y
  // devolverlo al estado benigno. Si `now < issuedAt`, la antigüedad es cero, no negativa.
  return Math.max(0, (end - start) / 3_600_000);
}

/**
 * Evalúa el quórum. **Función pura.** No verifica nada, no habla con nadie y no lee el reloj: recibe
 * la evidencia ya verificada y el instante como datos, y devuelve el veredicto con el motivo exacto
 * por el que cada anclaje descartado no contó.
 */
export function evaluateQuorum(
  evidence: readonly AnchorEvidence[],
  options: QuorumOptions,
): QuorumVerdict {
  const minClasses = options.minClasses ?? MIN_INDEPENDENCE_CLASSES;
  const hoursSinceIssued = hoursBetween(options.issuedAt, options.now);

  const rejected: RejectedAnchor[] = [];
  const classToProvider = new Map<IndependenceClass, string>();
  const seenProviders = new Set<string>();

  for (const item of evidence) {
    const reject = (reason: RejectionReason, detail: string): void => {
      rejected.push({
        provider: item.provider,
        independenceClass: item.independenceClass,
        reason,
        detail,
      });
    };

    // ORDEN DE LAS COMPROBACIONES: primero los defectos **intrínsecos** del recibo y sólo después
    // «eres un duplicado». Al revés, un recibo viejo reciclado que llega junto a otro del mismo
    // proveedor se descartaría como «repetido», que es cierto pero inútil: el motivo que hay que
    // poner en el acta es que alguien intentó colar el anclaje de otra historia. Y además, si el
    // primer recibo de un proveedor es basura y el segundo es legítimo, el segundo debe contar: sólo
    // entran al censo de duplicados los que llegan hasta aquí sanos. Lo encontró una prueba de
    // propiedad, no una lectura.
    if (item.checkpointHash !== options.checkpointHash) {
      reject(
        'checkpoint-distinto',
        `el recibo ancla ${item.checkpointHash.slice(0, 16)}… y estamos evaluando ` +
          `${options.checkpointHash.slice(0, 16)}…: un recibo viejo no ancla la historia de hoy`,
      );
      continue;
    }

    if (!item.signingKeyOffHost) {
      reject(
        'clave-en-el-servidor-verificado',
        `la clave privada de '${item.provider}' vive en la máquina que se está auditando. Quien ` +
          'pueda reescribir la historia puede firmar la versión falsa: este anclaje es teatro y no ' +
          'cuenta para el quórum',
      );
      continue;
    }

    if (item.status !== 'confirmado') {
      reject(
        'no-confirmado',
        `la verificación de '${item.provider}' quedó en '${item.status}': una promesa de anclaje ` +
          'no es un anclaje',
      );
      continue;
    }

    if (seenProviders.has(item.provider)) {
      reject(
        'proveedor-repetido',
        `'${item.provider}' ya aportó: un mismo proveedor es un solo testigo, por muchos recibos ` +
          'que emita',
      );
      continue;
    }
    seenProviders.add(item.provider);

    const already = classToProvider.get(item.independenceClass);
    if (already !== undefined) {
      reject(
        'clase-repetida',
        `'${already}' ya aportó por la clase '${item.independenceClass}'. Dos anclajes de la misma ` +
          'clase comparten modo de falla: no son dos testigos independientes',
      );
      continue;
    }
    classToProvider.set(item.independenceClass, item.provider);
  }

  const confirmedClasses = [...classToProvider.keys()].sort();
  const countedProviders = confirmedClasses.map((klass) => classToProvider.get(klass) ?? '');
  const firm = confirmedClasses.length >= minClasses;

  const state: PublicAnchorState = firm
    ? 'FIRME'
    : hoursSinceIssued >= CRITICAL_HOURS
      ? 'NO_ANCLADO_CRITICO'
      : hoursSinceIssued >= ALERT_HOURS
        ? 'NO_ANCLADO_ALERTA'
        : 'NO_ANCLADO';

  return {
    firm,
    state,
    confirmedClasses,
    countedProviders,
    rejected,
    hoursSinceIssued,
    decisionsPendingIntegrity: !firm && hoursSinceIssued >= CRITICAL_HOURS,
    explanation: explain(state, confirmedClasses, hoursSinceIssued, minClasses),
  };
}

const NOMBRE_DE_CLASE: Record<IndependenceClass, string> = {
  blockchain: 'Bitcoin',
  vcs: 'un repositorio público firmado',
  'human-witness': 'testigos por correo',
  'third-party-log': 'un registro público ajeno',
};

function explain(
  state: PublicAnchorState,
  classes: readonly IndependenceClass[],
  hours: number,
  minClasses: number,
): string {
  const nombres = classes.map((klass) => NOMBRE_DE_CLASE[klass]);
  const horas = Math.floor(hours);

  if (state === 'FIRME') {
    return (
      `El resumen de esta historia quedó registrado fuera de este servidor en ${String(classes.length)} ` +
      `sitios de naturaleza distinta: ${nombres.join(' y ')}. Para cambiar la historia sin que se ` +
      'note habría que alterar todos esos sitios a la vez, y no hay una sola persona que pueda.'
    );
  }

  const conseguidos =
    classes.length === 0
      ? 'ninguno todavía'
      : `sólo ${nombres.join(' y ')} (hace falta ${String(minClasses)})`;

  if (state === 'NO_ANCLADO_CRITICO') {
    return (
      `Llevamos ${String(horas)} horas sin registrar este resumen fuera del servidor: ${conseguidos}. ` +
      'Las decisiones tomadas en este lapso quedan marcadas como PENDIENTES DE CONFIRMACIÓN DE ' +
      'INTEGRIDAD. No quiere decir que estén mal; quiere decir que hoy nadie puede demostrar que ' +
      'no fueron alteradas. Hay que avisar a la veeduría.'
    );
  }

  if (state === 'NO_ANCLADO_ALERTA') {
    return (
      `Llevamos ${String(horas)} horas sin registrar este resumen fuera del servidor: ${conseguidos}. ` +
      'Lo ocurrido desde entonces todavía NO está protegido contra una alteración hecha desde ' +
      'dentro. No es prueba de que algo esté mal; sí es motivo para avisar a la veeduría.'
    );
  }

  return (
    `Este resumen aún no está registrado fuera del servidor: ${conseguidos}. Es lo normal durante ` +
    'las primeras horas, mientras el sello de Bitcoin madura y la veeduría firma. Hasta que lo ' +
    'esté, lo ocurrido desde el último anclaje firme podría alterarse sin contradecir nada externo.'
  );
}
