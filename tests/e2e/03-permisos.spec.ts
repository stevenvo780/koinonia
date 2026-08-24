/**
 * ESCENARIO 3 — Permisos, **llamando directamente a la API**.
 *
 * Nunca se confía en la validación del cliente. Todo lo de aquí se hace por HTTP contra el servicio,
 * saltándose la interfaz por completo: es la única forma de probar un permiso. Esconder un botón no
 * es autorizar; es decorar.
 *
 * Se prueban las dos clases, y la segunda es la que casi nadie prueba:
 *
 *  · **Vertical**: sin cuenta no se escribe; un miembro raso no abre ni cierra votaciones.
 *  · **Horizontal**: dos personas con EXACTAMENTE el mismo rol, y ninguna puede tocar lo de la otra.
 */

import { expect, test } from '@playwright/test';

import {
  apiAnonima,
  apiDirecta,
  CIRCULO_ESPACIOS,
  type Cuenta,
  crearProblemaPorApi,
  entrarPorApi,
  marca,
  planDe,
  ponerSesionEnNavegador,
  requestId,
} from './ayudas.js';
import { CORREO_FACILITADORA } from './global-setup.js';

test.describe.configure({ mode: 'serial' });

let daniela: Cuenta;
let julian: Cuenta;
let lucia: Cuenta;
const sufijo = marca();

let problemaId: string;
let evidenciaDeDaniela: string;
let propuestaDeDaniela: string;

test.beforeAll(async () => {
  daniela = await entrarPorApi(`d.permisos.${sufijo}@udea.edu.co`);
  julian = await entrarPorApi(`j.permisos.${sufijo}@udea.edu.co`);
  lucia = await entrarPorApi(CORREO_FACILITADORA);

  problemaId = await crearProblemaPorApi(daniela, {
    titulo: `Problema para probar permisos ${sufijo}`,
    cuerpo:
      'Este problema existe para comprobar que nadie puede tocar lo que escribió otra persona, ' +
      'ni siquiera llamando a la API directamente.',
  });

  const api = await apiDirecta(daniela);
  const aporte = await api.post(`/problemas/${problemaId}/evidencia`, {
    data: {
      requestId: requestId(),
      certeza: 'visto',
      cuerpo: 'El aviso de la puerta dice que cierra a las 6:00 p.m. de lunes a viernes.',
    },
  });
  expect(aporte.status(), await aporte.text()).toBe(201);
  evidenciaDeDaniela = ((await aporte.json()) as { evidencias: { id: string }[] }).evidencias[0]!
    .id;

  const propuesta = await api.post('/propuestas', {
    data: {
      requestId: requestId(),
      problemaId,
      titulo: 'Propuesta de Daniela para probar permisos',
      cuerpo:
        'Este texto existe para comprobar que sólo su autora puede enmendarlo, y que llamar a la ' +
        'API directamente no cambia esa respuesta.',
      plan: planDe(daniela.miembroId),
    },
  });
  expect(propuesta.status(), await propuesta.text()).toBe(201);
  propuestaDeDaniela = ((await propuesta.json()) as { id: string }).id;
  await api.dispose();
});

test('VERTICAL — sin cuenta no se escribe, y la respuesta dice qué hacer', async () => {
  const api = await apiAnonima();
  const respuesta = await api.post('/problemas', {
    data: {
      requestId: requestId(),
      titulo: 'Un problema escrito sin haber entrado nunca',
      cuerpo: 'Esto no debería quedar registrado en ninguna parte del historial.',
      circuloId: CIRCULO_ESPACIOS,
    },
  });
  expect(respuesta.status()).toBe(401);
  const cuerpo = (await respuesta.json()) as { codigo: string; mensaje: string; queHacer?: string };
  expect(cuerpo.codigo).toBe('UNAUTHORIZED_NOT_AUTHENTICATED');
  expect(cuerpo.mensaje).toContain('correo institucional');
  expect(cuerpo.queHacer).toBeTruthy();
  await api.dispose();
});

test('VERTICAL — un miembro raso no abre una votación, aunque llame a la API', async () => {
  const api = await apiDirecta(julian);
  const respuesta = await api.post('/decisiones', {
    data: {
      requestId: requestId(),
      propuestaId: propuestaDeDaniela,
      metodo: 'simple-majority',
      duracionHoras: 24,
    },
  });
  expect(respuesta.status()).toBe(403);
  expect(((await respuesta.json()) as { codigo: string }).codigo).toBe(
    'UNAUTHORIZED_ROLE_NOT_GRANTED',
  );
  await api.dispose();
});

test('VERTICAL — un miembro raso tampoco cierra una votación ajena', async () => {
  const apiLucia = await apiDirecta(lucia);
  const abierta = await apiLucia.post('/decisiones', {
    data: {
      requestId: requestId(),
      propuestaId: propuestaDeDaniela,
      metodo: 'simple-majority',
      duracionHoras: 24,
    },
  });
  expect(abierta.status(), await abierta.text()).toBe(201);
  const decisionId = ((await abierta.json()) as { id: string }).id;
  await apiLucia.dispose();

  const apiJulian = await apiDirecta(julian);
  const cierre = await apiJulian.post(`/decisiones/${decisionId}/cerrar`, {
    data: { requestId: requestId() },
  });
  expect(cierre.status()).toBe(403);
  await apiJulian.dispose();
});

test('HORIZONTAL — Julián y Daniela tienen exactamente el mismo rol', () => {
  expect(julian.roles).toEqual(daniela.roles);
  expect(julian.roles).toEqual(['member']);
  expect(julian.miembroId).not.toBe(daniela.miembroId);
});

test('HORIZONTAL — Julián no puede retirar el aporte de Daniela, ni por API', async () => {
  const api = await apiDirecta(julian);
  const respuesta = await api.post(
    `/problemas/${problemaId}/evidencia/${evidenciaDeDaniela}/retirar`,
    { data: { requestId: requestId(), motivo: 'me parece que este aporte sobra acá' } },
  );
  expect(respuesta.status()).toBe(403);
  expect(((await respuesta.json()) as { codigo: string }).codigo).toBe(
    'UNAUTHORIZED_NOT_THE_OWNER',
  );

  // Y no se escribió nada: no basta con devolver 403.
  const problema = await api.get(`/problemas/${problemaId}`);
  const evidencias = (
    (await problema.json()) as {
      evidencias: { id: string; retirada?: unknown }[];
    }
  ).evidencias;
  expect(evidencias.find((e) => e.id === evidenciaDeDaniela)?.retirada).toBeUndefined();
  await api.dispose();
});

test('HORIZONTAL — Julián no puede enmendar la propuesta de Daniela, ni por API', async () => {
  const api = await apiDirecta(julian);
  const respuesta = await api.post(`/propuestas/${propuestaDeDaniela}/enmiendas`, {
    data: {
      requestId: requestId(),
      titulo: 'Un título que Julián no puede poner',
      cuerpo:
        'Este texto no debería llegar nunca al historial, porque la propuesta la escribió otra ' +
        'persona y enmendar no es una acción de rol, es una acción de autoría.',
      motivo: 'quiero cambiar la propuesta de otra persona sin su permiso',
      plan: planDe(julian.miembroId),
    },
  });
  expect(respuesta.status()).toBe(403);
  expect(((await respuesta.json()) as { codigo: string }).codigo).toBe(
    'UNAUTHORIZED_NOT_THE_OWNER',
  );

  // Sigue habiendo una sola versión.
  const propuesta = await api.get(`/propuestas/${propuestaDeDaniela}`);
  expect(((await propuesta.json()) as { versiones: unknown[] }).versiones).toHaveLength(1);
  await api.dispose();
});

test('HORIZONTAL — ni quien facilita puede editar lo ajeno: facilitar no es corregir', async () => {
  const api = await apiDirecta(lucia);
  const respuesta = await api.post(
    `/problemas/${problemaId}/evidencia/${evidenciaDeDaniela}/retirar`,
    { data: { requestId: requestId(), motivo: 'como facilito, lo retiro yo y listo' } },
  );
  expect(respuesta.status()).toBe(403);
  await api.dispose();
});

test('HORIZONTAL — nadie emite una papeleta a nombre de otra persona', async () => {
  const apiLucia = await apiDirecta(lucia);
  const abierta = await apiLucia.post('/decisiones', {
    data: {
      requestId: requestId(),
      propuestaId: propuestaDeDaniela,
      metodo: 'simple-majority',
      duracionHoras: 24,
    },
  });
  const decision = (await abierta.json()) as { id: string; huellaVersion: string };
  await apiLucia.dispose();

  // Julián manda la papeleta e intenta atribuírsela a Daniela por todos los nombres de campo
  // plausibles. Ninguno sirve: el votante lo pone el servidor desde la sesión, y el motor exige al
  // plegar que el firmante del hecho y el autor de la papeleta sean la misma persona.
  const api = await apiDirecta(julian);
  const respuesta = await api.post(`/decisiones/${decision.id}/papeletas`, {
    data: {
      requestId: requestId(),
      huellaVersion: decision.huellaVersion,
      respuesta: { tipo: 'binary', aprueba: false },
      votante: daniela.miembroId,
      voter: daniela.miembroId,
      miembroId: daniela.miembroId,
      actor: daniela.miembroId,
    },
  });
  expect(respuesta.status(), await respuesta.text()).toBe(201);
  await api.dispose();

  // La papeleta quedó a nombre de Julián.
  const comoJulian = await apiDirecta(julian);
  const vistaJulian = (await (await comoJulian.get(`/decisiones/${decision.id}`)).json()) as {
    yaVotaste: boolean;
  };
  // No dice hacia dónde votó Julián (ADR-0010): sólo que él sí, la papeleta no quedó a nadie más.
  expect(vistaJulian.yaVotaste).toBe(true);
  await comoJulian.dispose();

  // Y Daniela no tiene ninguna.
  const comoDaniela = await apiDirecta(daniela);
  const vistaDaniela = (await (await comoDaniela.get(`/decisiones/${decision.id}`)).json()) as {
    yaVotaste: boolean;
  };
  expect(vistaDaniela.yaVotaste).toBe(false);
  await comoDaniela.dispose();
});

test('la interfaz tampoco ofrece lo que la API no permite', async ({ page }) => {
  // No es una garantía —la garantía está arriba— pero sí es lo correcto: no se ofrece un botón que
  // va a fallar. Que se ofreciera no abriría un agujero; que no se ofrezca evita un desengaño.
  await ponerSesionEnNavegador(page, julian);
  await page.goto(`/propuestas/${propuestaDeDaniela}`);
  await expect(page.getByText('Esta propuesta la escribió otra persona')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enmendar mi propuesta' })).toHaveCount(0);
});
