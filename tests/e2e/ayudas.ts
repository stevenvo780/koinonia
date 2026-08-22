/**
 * Ayudas de los escenarios de extremo a extremo.
 *
 * La pieza importante es `apiDirecta`: un cliente que habla con el servicio **sin pasar por la
 * interfaz**. Es lo único que prueba de verdad un permiso. Una comprobación que sólo esconde un
 * botón no es una comprobación: es una decoración, y la primera persona que abra las herramientas
 * de desarrollo lo descubre.
 */

import { readFileSync } from 'node:fs';

import { type APIRequestContext, expect, type Page, request } from '@playwright/test';

import { RUTA_ENTORNO } from './global-setup.js';

export interface Entorno {
  readonly apiUrl: string;
  readonly webUrl: string;
  readonly superUrl: string;
  readonly relojUrl: string;
}

/**
 * Mueve el reloj del servicio.
 *
 * Ver la nota de `PUERTO_RELOJ` en `global-setup.ts`: el servicio recibe su reloj por el puerto que
 * ya tenía, y quien lo mueve es código de pruebas que no se despliega. En el servicio no hay ni una
 * línea que sepa que esto existe.
 */
export async function reiniciarHistorial(): Promise<void> {
  const control = await request.newContext({ baseURL: entorno().relojUrl });
  try {
    const respuesta = await control.post('/reiniciar');
    expect(respuesta.status(), await respuesta.text()).toBe(200);
  } finally {
    await control.dispose();
  }
}

export async function avanzarReloj(ms: number): Promise<void> {
  const control = await request.newContext({ baseURL: entorno().relojUrl });
  try {
    const respuesta = await control.post('/avanzar', { data: { ms } });
    expect(respuesta.status()).toBe(200);
  } finally {
    await control.dispose();
  }
}

export function entorno(): Entorno {
  return JSON.parse(readFileSync(RUTA_ENTORNO, 'utf8')) as Entorno;
}

export function requestId(): string {
  return crypto.randomUUID();
}

export interface Cuenta {
  readonly correo: string;
  readonly testigo: string;
  readonly miembroId: string;
  readonly roles: readonly string[];
}

/**
 * Entra por la API, que es el mismo camino que usa la interfaz.
 *
 * En modo de desarrollo el enlace mágico viaja también en la respuesta, así que no hace falta leer
 * una bandeja de correo. El enlace sigue siendo de un solo uso y sigue venciendo: lo que cambia es
 * de dónde lo saca el test, no cómo funciona.
 */
export async function entrarPorApi(correo: string): Promise<Cuenta> {
  const api = await request.newContext({ baseURL: entorno().apiUrl });
  try {
    const pedido = await api.post('/auth/enlace', { data: { correo } });
    expect(pedido.status(), await pedido.text()).toBe(202);
    const { enlaceDeDesarrollo } = (await pedido.json()) as { enlaceDeDesarrollo?: string };
    expect(enlaceDeDesarrollo, 'el modo de desarrollo debe devolver el enlace').toBeDefined();
    const token = decodeURIComponent(new URL(enlaceDeDesarrollo!).searchParams.get('token') ?? '');

    const sesion = await api.post('/auth/sesion', { data: { token } });
    expect(sesion.status(), await sesion.text()).toBe(200);
    const cuerpo = (await sesion.json()) as {
      testigo: string;
      miembroId: string;
      roles: string[];
    };
    return { correo, testigo: cuerpo.testigo, miembroId: cuerpo.miembroId, roles: cuerpo.roles };
  } finally {
    await api.dispose();
  }
}

/** Cliente de la API con la sesión de alguien. **Se salta la interfaz por completo.** */
export async function apiDirecta(cuenta: Cuenta): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: entorno().apiUrl,
    extraHTTPHeaders: { authorization: `Bearer ${cuenta.testigo}` },
  });
}

/** Declara disponibilidad de manera visible en el escenario; entrar no presupone capacidad. */
export async function declararCapacidad(cuenta: Cuenta, minutosPorSemana = 10_080): Promise<void> {
  const api = await apiDirecta(cuenta);
  try {
    const actual = await api.get('/mi/capacidad');
    expect(actual.status(), await actual.text()).toBe(200);
    const body = (await actual.json()) as { declarada: boolean; revision?: number };
    const guardada = await api.put('/mi/capacidad', {
      data: {
        revision: body.declarada ? body.revision : 0,
        minutosPorSemana,
      },
    });
    expect(guardada.status(), await guardada.text()).toBe(200);
  } finally {
    await api.dispose();
  }
}

/** Cliente de la API sin sesión: el observador anónimo. */
export async function apiAnonima(): Promise<APIRequestContext> {
  return request.newContext({ baseURL: entorno().apiUrl });
}

/**
 * Deja la sesión puesta en el navegador.
 *
 * La cookie la emite la API y el proxy de Next la reenvía; para el navegador es una cookie de
 * primera parte del propio sitio. Aquí se pone a mano porque el test no quiere pasar por la pantalla
 * de entrar en cada escenario, pero el valor es el mismo testigo que emitió el servicio.
 */
export async function ponerSesionEnNavegador(page: Page, cuenta: Cuenta): Promise<void> {
  const url = new URL(entorno().webUrl);
  await page.context().addCookies([
    {
      name: 'koinonia_sesion',
      value: cuenta.testigo,
      domain: url.hostname,
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
}

/** Un problema listo, creado por API para no repetir el formulario en cada escenario. */
export async function crearProblemaPorApi(
  cuenta: Cuenta,
  datos: { readonly titulo: string; readonly cuerpo: string },
): Promise<string> {
  const api = await apiDirecta(cuenta);
  try {
    const respuesta = await api.post('/problemas', {
      data: {
        requestId: requestId(),
        titulo: datos.titulo,
        cuerpo: datos.cuerpo,
        circuloId: CIRCULO_ESPACIOS,
      },
    });
    expect(respuesta.status(), await respuesta.text()).toBe(201);
    return ((await respuesta.json()) as { id: string }).id;
  } finally {
    await api.dispose();
  }
}

export const CIRCULO_ESPACIOS = 'e5bac105b1e00000000000000000000b';

/** Plan reutilizable cuando el escenario crea una propuesta directamente por API. */
export function planDe(responsableId: string): {
  readonly objetivo: string;
  readonly responsableId: string;
  readonly revisarEn: number;
  readonly criteriosDeExito: readonly {
    readonly descripcion: string;
    readonly fuenteDeVerificacion: string;
  }[];
} {
  return {
    objetivo: 'Conseguir que la sala de estudio tenga un horario útil para la jornada nocturna.',
    responsableId,
    revisarEn: Date.now() + 365 * 24 * 60 * 60 * 1000,
    criteriosDeExito: [
      {
        descripcion: 'La sala abre hasta las nueve de la noche al menos tres días por semana.',
        fuenteDeVerificacion: 'Horario oficial publicado por el Instituto',
      },
    ],
  };
}

/** Sufijo único para que dos ejecuciones no choquen en la misma base. */
export function marca(): string {
  return Math.random().toString(36).slice(2, 8);
}
