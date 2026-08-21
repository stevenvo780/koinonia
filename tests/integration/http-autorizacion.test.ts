/**
 * Autorización de la capa HTTP, contra la aplicación real y PostgreSQL real.
 *
 * ═══ Lo que estas pruebas existen para demostrar ═══
 *
 * **La autorización horizontal.** La vertical —«¿tenés el rol?»— la prueba todo el mundo. La
 * horizontal —«¿es *tuyo* el recurso?»— se olvida siempre, y es la que rompe un sistema entre
 * iguales: 300 personas con exactamente el mismo rol de miembro. Aquí hay dos miembros con el mismo
 * rol y se comprueba, uno por uno, que ninguno puede tocar lo del otro:
 *
 *   · retirar el aporte de evidencia de la otra persona,
 *   · enmendar la propuesta de la otra persona,
 *   · emitir una papeleta a nombre de la otra persona.
 *
 * Los tres van por la API **directamente**, sin pasar por ninguna interfaz. Es la única forma de
 * probar algo: una comprobación que sólo esconde un botón no es una comprobación.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  apiEnv,
  type ApiListo,
  como,
  entrar,
  FACILITADORA,
  listo,
  skipNote,
} from './helpers/api-env.js';

const env = await apiEnv();

afterAll(async () => {
  if (env.ok) await env.stop();
});

const CIRCULO_ESPACIOS = 'e5bac105b1e00000000000000000000b';

function uuid(semilla: number): string {
  const hex = semilla.toString(16).padStart(32, '0');
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-` +
    `8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  );
}

let n = 0;
const req = (): string => uuid(++n + 0x1000);

describe.skipIf(!env.ok)(`autorización de la API${skipNote(env)}`, () => {
  let e: ApiListo;
  let daniela: { testigo: string; miembroId: string };
  let julian: { testigo: string; miembroId: string };
  let lucia: { testigo: string; miembroId: string };
  let problemaId: string;
  let evidenciaDeDaniela: string;
  let propuestaDeDaniela: string;

  beforeAll(async () => {
    e = listo(env);
    daniela = await entrar(e, 'daniela.ocampo@udea.edu.co');
    julian = await entrar(e, 'julian.restrepo@udea.edu.co');
    lucia = await entrar(e, FACILITADORA);

    const problema = await e.app.inject({
      method: 'POST',
      url: '/problemas',
      headers: como(daniela.testigo),
      payload: {
        requestId: req(),
        titulo: 'La sala de estudio cierra a las 6 de la tarde',
        cuerpo:
          'Los de la nocturna llegamos a las 5:40 y la sala cierra a las 6. No tenemos dónde leer ' +
          'y terminamos parados en el pasillo.',
        circuloId: CIRCULO_ESPACIOS,
      },
    });
    expect(problema.statusCode).toBe(201);
    problemaId = problema.json<{ id: string }>().id;

    const aporte = await e.app.inject({
      method: 'POST',
      url: `/problemas/${problemaId}/evidencia`,
      headers: como(daniela.testigo),
      payload: {
        requestId: req(),
        certeza: 'visto',
        cuerpo: 'El aviso de la puerta dice que cierra a las 6:00 p.m. de lunes a viernes.',
      },
    });
    expect(aporte.statusCode).toBe(201);
    evidenciaDeDaniela = aporte.json<{ evidencias: { id: string }[] }>().evidencias[0]!.id;

    const propuesta = await e.app.inject({
      method: 'POST',
      url: '/propuestas',
      headers: como(daniela.testigo),
      payload: {
        requestId: req(),
        problemaId,
        titulo: 'Pedir que la sala abra hasta las 9 de la noche',
        cuerpo:
          'Radicar una petición a la Dirección del Instituto para que la sala de estudio abra ' +
          'hasta las 9:00 p.m. de lunes a viernes, con la vigilancia que la Universidad ya tiene.',
      },
    });
    expect(propuesta.statusCode).toBe(201);
    propuestaDeDaniela = propuesta.json<{ id: string }>().id;
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // Vertical
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it('sin sesión no se escribe nada, y se dice qué hacer en vez de un código', async () => {
    const respuesta = await e.app.inject({
      method: 'POST',
      url: '/problemas',
      payload: {
        requestId: req(),
        titulo: 'Un problema sin cuenta verificada',
        cuerpo: 'Esto no debería poder escribirse sin haber entrado con el correo institucional.',
        circuloId: CIRCULO_ESPACIOS,
      },
    });
    expect(respuesta.statusCode).toBe(401);
    const cuerpo = respuesta.json<{ codigo: string; mensaje: string; queHacer?: string }>();
    expect(cuerpo.codigo).toBe('UNAUTHORIZED_NOT_AUTHENTICATED');
    expect(cuerpo.mensaje).toMatch(/correo institucional/u);
    expect(cuerpo.queHacer).toBeDefined();
  });

  it('un miembro raso NO puede abrir una votación: cuidar el procedimiento es un encargo', async () => {
    const respuesta = await e.app.inject({
      method: 'POST',
      url: '/decisiones',
      headers: como(julian.testigo),
      payload: {
        requestId: req(),
        propuestaId: propuestaDeDaniela,
        metodo: 'simple-majority',
        duracionHoras: 96,
      },
    });
    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.json<{ codigo: string }>().codigo).toBe('UNAUTHORIZED_ROLE_NOT_GRANTED');
  });

  it('quien facilita SÍ puede, y el motor congela la lista de quiénes podían decidir', async () => {
    const respuesta = await e.app.inject({
      method: 'POST',
      url: '/decisiones',
      headers: como(lucia.testigo),
      payload: {
        requestId: req(),
        propuestaId: propuestaDeDaniela,
        metodo: 'simple-majority',
        duracionHoras: 96,
      },
    });
    expect(respuesta.statusCode).toBe(201);
    const decision = respuesta.json<{ podianDecidir: number; queHaceFaltaParaQuePase: string }>();
    expect(decision.podianDecidir).toBeGreaterThanOrEqual(3);
    // «Qué hace falta para que esto pase» va SIEMPRE, y va en palabras.
    expect(decision.queHaceFaltaParaQuePase).toMatch(/más síes que noes/u);
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // HORIZONTAL — el mismo rol, y aun así no
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it('Julián y Daniela tienen exactamente el mismo rol', async () => {
    const yoJulian = await e.app.inject({
      method: 'GET',
      url: '/auth/yo',
      headers: como(julian.testigo),
    });
    const yoDaniela = await e.app.inject({
      method: 'GET',
      url: '/auth/yo',
      headers: como(daniela.testigo),
    });
    expect(yoJulian.json<{ roles: string[] }>().roles).toEqual(['member']);
    expect(yoDaniela.json<{ roles: string[] }>().roles).toEqual(['member']);
    expect(yoJulian.json<{ miembroId: string }>().miembroId).not.toBe(
      yoDaniela.json<{ miembroId: string }>().miembroId,
    );
  });

  it('HORIZONTAL — Julián no puede retirar el aporte de Daniela', async () => {
    const respuesta = await e.app.inject({
      method: 'POST',
      url: `/problemas/${problemaId}/evidencia/${evidenciaDeDaniela}/retirar`,
      headers: como(julian.testigo),
      payload: { requestId: req(), motivo: 'me parece que sobra este aporte' },
    });
    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.json<{ codigo: string }>().codigo).toBe('UNAUTHORIZED_NOT_THE_OWNER');
    // Y el aporte sigue vivo: no basta con devolver 403, hay que no haber escrito nada.
    const problema = await e.app.inject({ method: 'GET', url: `/problemas/${problemaId}` });
    const evidencias = problema.json<{ evidencias: { id: string; retirada?: unknown }[] }>()
      .evidencias;
    expect(
      evidencias.find((x: { id: string }) => x.id === evidenciaDeDaniela)?.retirada,
    ).toBeUndefined();
  });

  it('HORIZONTAL — Daniela sí puede retirar el suyo, y queda el hueco DECLARADO', async () => {
    const respuesta = await e.app.inject({
      method: 'POST',
      url: `/problemas/${problemaId}/evidencia/${evidenciaDeDaniela}/retirar`,
      headers: como(daniela.testigo),
      payload: {
        requestId: req(),
        motivo: 'me equivoqué de horario: el aviso es del semestre pasado',
      },
    });
    expect(respuesta.statusCode).toBe(200);
    const evidencias = respuesta.json<{
      evidencias: { id: string; retirada?: { motivo: string } }[];
    }>().evidencias;
    const retirada = evidencias.find((x: { id: string }) => x.id === evidenciaDeDaniela);
    // No desaparece: queda con su motivo. Nunca una ausencia silenciosa (PRODUCT §4).
    expect(retirada).toBeDefined();
    expect(retirada?.retirada?.motivo).toMatch(/me equivoqué/u);
  });

  it('HORIZONTAL — Julián no puede enmendar la propuesta de Daniela', async () => {
    const respuesta = await e.app.inject({
      method: 'POST',
      url: `/propuestas/${propuestaDeDaniela}/enmiendas`,
      headers: como(julian.testigo),
      payload: {
        requestId: req(),
        titulo: 'Pedir que la sala abra las 24 horas',
        cuerpo:
          'Radicar una petición para que la sala de estudio abra las 24 horas todos los días del ' +
          'año, incluidos festivos y periodos de receso académico.',
        motivo: 'creo que hay que pedir más de lo que pide ella',
      },
    });
    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.json<{ codigo: string }>().codigo).toBe('UNAUTHORIZED_NOT_THE_OWNER');
    // Y la propuesta sigue en la versión 1.
    const propuesta = await e.app.inject({
      method: 'GET',
      url: `/propuestas/${propuestaDeDaniela}`,
    });
    expect(propuesta.json<{ versiones: unknown[] }>().versiones).toHaveLength(1);
  });

  it('HORIZONTAL — nadie emite una papeleta a nombre de otra persona', async () => {
    // Se abre una votación de consentimiento sobre la propuesta.
    const abierta = await e.app.inject({
      method: 'POST',
      url: '/decisiones',
      headers: como(lucia.testigo),
      payload: {
        requestId: req(),
        propuestaId: propuestaDeDaniela,
        metodo: 'sociocratic-consent',
        duracionHoras: 96,
      },
    });
    expect(abierta.statusCode).toBe(201);
    const decision = abierta.json<{ id: string; huellaVersion: string }>();

    // Julián manda su papeleta y, en el cuerpo, intenta atribuírsela a Daniela. El campo ni
    // siquiera existe en el contrato; el punto es que aunque existiera no serviría, porque el
    // votante lo pone el servidor desde la sesión y `apply` exige que coincida con el firmante.
    const respuesta = await e.app.inject({
      method: 'POST',
      url: `/decisiones/${decision.id}/papeletas`,
      headers: como(julian.testigo),
      payload: {
        requestId: req(),
        huellaVersion: decision.huellaVersion,
        respuesta: { tipo: 'consent', postura: 'consent' },
        // Campos de más: la validación estricta del contrato ni los mira.
        votante: daniela.miembroId,
        voter: daniela.miembroId,
      },
    });
    expect(respuesta.statusCode).toBe(201);

    // La papeleta quedó a nombre de Julián, no de Daniela.
    const comoJulian = await e.app.inject({
      method: 'GET',
      url: `/decisiones/${decision.id}`,
      headers: como(julian.testigo),
    });
    expect(comoJulian.json<{ miRespuesta?: string }>().miRespuesta).toBe('Sin objeción');

    const comoDaniela = await e.app.inject({
      method: 'GET',
      url: `/decisiones/${decision.id}`,
      headers: como(daniela.testigo),
    });
    expect(comoDaniela.json<{ miRespuesta?: string }>().miRespuesta).toBeUndefined();
  });

  it('objetar exige argumento: bloquear tiene que costar, como mínimo, explicarse', async () => {
    const abierta = await e.app.inject({
      method: 'POST',
      url: '/decisiones',
      headers: como(lucia.testigo),
      payload: {
        requestId: req(),
        propuestaId: propuestaDeDaniela,
        metodo: 'sociocratic-consent',
        duracionHoras: 96,
      },
    });
    const decision = abierta.json<{ id: string; huellaVersion: string }>();

    const sinArgumento = await e.app.inject({
      method: 'POST',
      url: `/decisiones/${decision.id}/papeletas`,
      headers: como(julian.testigo),
      payload: {
        requestId: req(),
        huellaVersion: decision.huellaVersion,
        respuesta: {
          tipo: 'consent',
          postura: 'object',
          objecion: { argumento: 'no me gusta', objetivoDanado: 'nada' },
        },
      },
    });
    expect(sinArgumento.statusCode).toBe(400);
    const cuerpo = sinArgumento.json<{ mensaje: string }>();
    expect(cuerpo.mensaje).toMatch(/explicarse/u);
  });

  it('el administrador técnico no gobierna: el rol no concede ninguna escritura de gobierno', async () => {
    // Se comprueba sobre la matriz del dominio, que es donde vive la regla del §7 de GOVERNANCE.
    const { can } = await import('@koinonia/domain');
    const admin = {
      memberId: daniela.miembroId as never,
      roles: ['tech-admin' as const],
      circles: [],
    };
    expect(can(admin, 'problem:create', { kind: 'problem' })).toBe(false);
    expect(can(admin, 'decision:open', { kind: 'decision' })).toBe(false);
    expect(can(admin, 'decision:close', { kind: 'decision' })).toBe(false);
    expect(can(admin, 'decision:cast-ballot', { kind: 'decision' })).toBe(false);
    // Leer sí: lo público se lee sin cuenta, y con más razón con una.
    expect(can(admin, 'problem:read', { kind: 'problem' })).toBe(true);
    expect(can(admin, 'ledger:export', { kind: 'ledger' })).toBe(true);
  });
});
