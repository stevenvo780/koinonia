/**
 * Ayudas de los escenarios de extremo a extremo.
 *
 * La pieza importante es `apiDirecta`: un cliente que habla con el servicio **sin pasar por la
 * interfaz**. Es lo único que prueba de verdad un permiso. Una comprobación que sólo esconde un
 * botón no es una comprobación: es una decoración, y la primera persona que abra las herramientas
 * de desarrollo lo descubre.
 */

import { readFileSync } from 'node:fs';

import { type APIRequestContext, expect, type Locator, type Page, request } from '@playwright/test';

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

// ═════════════════════════════════════════════════════════════════════════════════════════════
// La pantalla de verificación
//
// Dos piezas que comprueban lo mismo desde escenarios distintos —el ledger manipulado de verdad en
// `05` y los tres estados de la pantalla en `14`— y que por eso viven acá y no duplicadas.
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * El contenido de la página, sin el armazón.
 *
 * Acotar a `main` no es cosmético: Next inyecta fuera del contenido su propio anunciador de cambios
 * de ruta, un `<div role="alert">` **vacío** que nunca dice nada. Sin acotar, `getByRole('alert')`
 * deja de ser único y una comprobación de «no hay ninguna alarma» pasa a contar la de Next, que es
 * la peor clase de falso positivo: el que hace fallar una prueba correcta.
 */
export function contenido(page: Page): Locator {
  return page.locator('main');
}

/**
 * Los puntos de la revisión que la pantalla de verificación destaca como fallados.
 *
 * Se localizan por el papel que juegan —un artículo con nombre accesible propio— y por la palabra
 * que llevan escrita, no por la clase que los pinta de rojo. El color es lo que primero se mueve en
 * un rediseño, y quien no lo distingue tiene que poder leer lo mismo.
 */
export function puntoQueFalla(page: Page): Locator {
  return contenido(page).getByRole('article').filter({ hasText: 'Acá no cuadra' });
}

/**
 * La frase que sostiene la credibilidad de la pantalla de verificación, tal cual se lee.
 *
 * Tiene que aparecer en **los tres estados** —vacío, sin confirmar y alarma—. Sin ella la pantalla
 * es el servidor dando fe de sí mismo y callándose que es parte interesada, que es exactamente la
 * pieza que se pierde en la primera refactorización que busque una pantalla «más limpia».
 *
 * Va como expresión regular porque la mayúscula inicial depende de dónde arranque la frase dentro
 * del párrafo; lo demás es literal, palabra por palabra.
 */
export const NO_ES_PRUEBA_DE_SI_MISMA = /[Ee]sta página no es prueba de sí misma/u;

/**
 * Cada aparición de «está todo bien» en un texto, junto con lo que la precede.
 *
 * El proyecto proscribe que el servidor se ponga en verde a sí mismo, pero la pantalla sí **nombra**
 * la frase —«acá no vas a leer que está todo bien»— justamente para rechazarla. Exigir su ausencia
 * literal sería exigir algo falso; lo que hay que exigir es que **toda** aparición vaya negada, y
 * para eso hace falta mirar lo que viene antes.
 */
export function afirmacionesDeQueEstaBien(texto: string): readonly string[] {
  return [...texto.matchAll(/(.{0,45})(?:está todo bien|está bien|todo bien)/gisu)].map(
    (coincidencia) => coincidencia[1] ?? '',
  );
}
