/**
 * Adaptadores de los puertos. Lo concreto, aislado y sustituible.
 */

import { randomBytes, randomUUID } from 'node:crypto';

import { type CircleId, circleId, type Role } from '@koinonia/domain';

import { CIRCULOS } from './circles.js';
import type {
  ClockPort,
  IdentityProviderAdapter,
  IdentityResult,
  MailerPort,
  OutgoingMail,
  RandomPort,
} from './ports.js';

export const systemClock: ClockPort = { now: () => Date.now() };

export const cryptoRandom: RandomPort = {
  bytes: (n: number) => new Uint8Array(randomBytes(n)),
  opaqueId: () => randomBytes(16).toString('hex'),
  uuid: () => randomUUID(),
};

/**
 * Correo por consola, para desarrollo.
 *
 * Escribe en la salida estándar en lugar de mandar nada. Es el adaptador que hace posible levantar
 * el proyecto sin un servidor de correo, y **también** el que hace posible que las pruebas lean el
 * enlace: `MemoryMailer` guarda lo mismo en memoria.
 */
export const consoleMailer: MailerPort = {
  send: async (mail: OutgoingMail): Promise<void> => {
    process.stdout.write(
      `\n──────── correo (adaptador de consola) ────────\n` +
        `Para: ${mail.to}\nAsunto: ${mail.subject}\n\n${mail.text}\n` +
        `──────────────────────────────────────────────\n\n`,
    );
    await Promise.resolve();
  },
};

/** Correo en memoria: lo mismo, pero recuperable. Para las pruebas y para el modo de desarrollo. */
export class MemoryMailer implements MailerPort {
  readonly enviados: OutgoingMail[] = [];

  async send(mail: OutgoingMail): Promise<void> {
    this.enviados.push(mail);
    await Promise.resolve();
  }

  ultimoPara(to: string): OutgoingMail | undefined {
    return this.enviados.filter((mail) => mail.to === to).at(-1);
  }
}

/** Dominio institucional. Es lo único que el MVP verifica (PRODUCT §9). */
export const DOMINIO_INSTITUCIONAL = 'udea.edu.co';

/**
 * Adaptador de identidad del MVP.
 *
 * Comprueba que el correo termina en `@udea.edu.co` y **nada más**. No consulta el directorio de la
 * Universidad, no valida la matrícula contra ningún sistema y no inventa una API que no conocemos.
 *
 * DECISIÓN: esto significa que cualquier persona con un correo institucional entra, incluido el
 * personal docente y administrativo, que no son parte del padrón estudiantil. Es una **debilidad
 * conocida y declarada**, no un descuido: la alternativa —pedir a la Universidad un listado de
 * matriculados— exige un convenio, crea corresponsabilidad sobre datos personales de 300 personas y
 * pone la existencia de la plataforma en manos de la institución que la plataforma va a interpelar.
 * Se prefiere una puerta ancha y declarada a una dependencia institucional silenciosa. La
 * controversia sobre quién es miembro va al Círculo de Garantías (GOVERNANCE §4, fila 19).
 *
 * El alias sale de la parte local del correo. Nunca entra al historial: el historial no guarda
 * personas.
 */
export function udeaIdentityAdapter(options?: {
  /** Correos que además reciben el rol de facilitación. Los fija la operación, no la aplicación. */
  readonly facilitadores?: readonly string[];
  readonly garantias?: readonly string[];
  readonly circulos?: readonly CircleId[];
}): IdentityProviderAdapter {
  const facilitadores = new Set((options?.facilitadores ?? []).map((e) => e.trim().toLowerCase()));
  const garantias = new Set((options?.garantias ?? []).map((e) => e.trim().toLowerCase()));
  const circulos = options?.circulos ?? [
    circleId(CIRCULOS.asamblea.id),
    circleId(CIRCULOS.espacios.id),
  ];

  return {
    nombre: 'udea-dominio-de-correo',
    verify: async (email: string): Promise<IdentityResult> => {
      const normalizado = email.trim().toLowerCase();
      if (!normalizado.endsWith(`@${DOMINIO_INSTITUCIONAL}`)) {
        return {
          ok: false,
          code: 'CORREO_NO_INSTITUCIONAL',
          detail: `sólo entran los correos que terminan en @${DOMINIO_INSTITUCIONAL}`,
        };
      }
      const local = normalizado.slice(0, normalizado.indexOf('@'));
      if (local.length === 0) {
        return {
          ok: false,
          code: 'CORREO_NO_INSTITUCIONAL',
          detail: 'el correo no tiene parte local',
        };
      }
      const roles: Role[] = ['member'];
      if (facilitadores.has(normalizado)) roles.push('facilitator');
      if (garantias.has(normalizado)) roles.push('guarantees');
      return await Promise.resolve({
        ok: true,
        claim: {
          email: normalizado,
          alias: local,
          roles,
          circles: circulos,
          semestre: 's1',
          jornada: 'diurna',
        },
      });
    },
  };
}
