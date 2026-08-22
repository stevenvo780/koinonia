/**
 * El corte vertical entero, por HTTP, contra PostgreSQL real.
 *
 * Problema → evidencia → propuesta → **enmienda** → abrir → votar → cerrar → resultado con traza →
 * verificar integridad → **manipular por debajo** → comprobar que la verificación lo denuncia.
 *
 * Dos afirmaciones que esta prueba sostiene y que son el corazón del proyecto:
 *
 *  1. **La versión 1 sigue intacta después de que existe la versión 2.** No «equivalente»: la misma
 *     palabra por palabra, con el mismo comprobante, y verificando.
 *  2. **El resultado es un dato derivado.** No se guarda una conclusión y se cree: se vuelve a
 *     contar desde los hechos y tiene que dar lo mismo. Cuando no da lo mismo, se dice en voz alta.
 */

import { type PgPool, type PgPoolClient } from '@koinonia/api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  apiEnv,
  type ApiListo,
  como,
  entrar,
  FACILITADORA,
  listo,
  planDe,
  skipNote,
} from './helpers/api-env.js';

const env = await apiEnv();

afterAll(async () => {
  if (env.ok) await env.stop();
});

const CIRCULO_ESPACIOS = 'e5bac105b1e00000000000000000000b';
const HORA = 3_600_000;

let n = 0;
function req(): string {
  const hex = (++n + 0x5000).toString(16).padStart(32, '0');
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-` +
    `8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  );
}

/** Como el administrador con `root`: superusuario y con el blindaje apagado a propósito. */
async function comoAdministrador<T>(
  pool: PgPool,
  body: (client: PgPoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('ALTER TABLE governance.event DISABLE TRIGGER trg_event_append_only');
    return await body(client);
  } finally {
    await client
      .query('ALTER TABLE governance.event ENABLE ALWAYS TRIGGER trg_event_append_only')
      .catch(() => undefined);
    client.release();
  }
}

describe.skipIf(!env.ok)(`ciclo completo por HTTP${skipNote(env)}`, () => {
  let e: ApiListo;
  let daniela: { testigo: string; miembroId: string };
  let julian: { testigo: string; miembroId: string };
  let andres: { testigo: string; miembroId: string };
  let lucia: { testigo: string; miembroId: string };

  let problemaId: string;
  let propuestaId: string;
  let huellaV1: string;
  let huellaV2: string;
  let decisionId: string;

  beforeAll(async () => {
    e = listo(env);
    daniela = await entrar(e, 'daniela.ocampo@udea.edu.co');
    julian = await entrar(e, 'julian.restrepo@udea.edu.co');
    andres = await entrar(e, 'andres.villa@udea.edu.co');
    lucia = await entrar(e, FACILITADORA);
  });

  it('el primer día la portada dice que no hay nada, y no muestra un tablero de ceros', async () => {
    const portada = await e.app.inject({ method: 'GET', url: '/portada' });
    expect(portada.statusCode).toBe(200);
    expect(portada.json<{ primerDia: boolean }>().primerDia).toBe(true);
  });

  it('1 · Daniela escribe el problema', async () => {
    const respuesta = await e.app.inject({
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
    expect(respuesta.statusCode).toBe(201);
    const problema = respuesta.json<{ id: string; estado: string; lesPasaLoMismo: number }>();
    problemaId = problema.id;
    expect(problema.estado).toBe('recogiendo-evidencia');
    expect(problema.lesPasaLoMismo).toBe(0);
  });

  it('2 · doce personas dicen que les pasa lo mismo, y sale el número, nunca los nombres', async () => {
    for (const quien of [julian, andres]) {
      const respuesta = await e.app.inject({
        method: 'POST',
        url: `/problemas/${problemaId}/me-pasa`,
        headers: como(quien.testigo),
        payload: { requestId: req() },
      });
      expect(respuesta.statusCode).toBe(200);
    }
    const problema = await e.app.inject({ method: 'GET', url: `/problemas/${problemaId}` });
    const cuerpo = problema.json<Record<string, unknown>>();
    expect(cuerpo['lesPasaLoMismo']).toBe(2);
    // Agregado y sin nombres: la lista no viaja en ninguna forma (PRODUCT §4, ADR-0040).
    expect(JSON.stringify(cuerpo)).not.toContain(julian.miembroId);
    expect(JSON.stringify(cuerpo)).not.toContain(andres.miembroId);
  });

  it('3 · Andrés sube el dato, marcado como lo que es', async () => {
    const respuesta = await e.app.inject({
      method: 'POST',
      url: `/problemas/${problemaId}/evidencia`,
      headers: como(andres.testigo),
      payload: {
        requestId: req(),
        certeza: 'visto',
        cuerpo:
          'De los 300 matriculados del Instituto, 86 están en la jornada nocturna. Está en el ' +
          'consolidado de matrícula del semestre.',
        fuente: 'Consolidado de matrícula 2026-2',
      },
    });
    expect(respuesta.statusCode).toBe(201);
    const evidencias = respuesta.json<{ evidencias: { certeza: string; esMia: boolean }[] }>()
      .evidencias;
    expect(evidencias).toHaveLength(1);
    expect(evidencias[0]?.certeza).toBe('visto');
    expect(evidencias[0]?.esMia).toBe(true);
  });

  it('4 · Sara redacta la propuesta; no se propone sin problema', async () => {
    const huerfana = await e.app.inject({
      method: 'POST',
      url: '/propuestas',
      headers: como(daniela.testigo),
      payload: {
        requestId: req(),
        problemaId: 'f'.repeat(32),
        titulo: 'Una propuesta que no cuelga de nada',
        cuerpo:
          'Esto no debería poder crearse, porque toda propuesta responde a un problema que existe ' +
          'de verdad en el historial.',
        plan: planDe(daniela.miembroId),
      },
    });
    expect(huerfana.statusCode).toBe(404);

    const respuesta = await e.app.inject({
      method: 'POST',
      url: '/propuestas',
      headers: como(daniela.testigo),
      payload: {
        requestId: req(),
        problemaId,
        titulo: 'Pedir que la sala abra hasta las 9 de la noche',
        cuerpo:
          'Radicar una petición a la Dirección del Instituto para que la sala de estudio abra ' +
          'hasta las 9:00 p.m. de lunes a viernes. La llave y el registro de uso quedan a cargo ' +
          'de una comisión estudiantil.',
        plan: planDe(daniela.miembroId),
      },
    });
    expect(respuesta.statusCode).toBe(201);
    const propuesta = respuesta.json<{
      id: string;
      versiones: { version: number; huella: string }[];
    }>();
    propuestaId = propuesta.id;
    expect(propuesta.versiones).toHaveLength(1);
    huellaV1 = propuesta.versiones[0]!.huella;
  });

  it('5 · Daniela enmienda: aparece la V2 y la V1 SIGUE INTACTA', async () => {
    const antes = await e.app.inject({ method: 'GET', url: `/propuestas/${propuestaId}` });
    const v1Antes = antes.json<{
      versiones: { version: number; cuerpo: string; huella: string }[];
    }>().versiones[0]!;

    const respuesta = await e.app.inject({
      method: 'POST',
      url: `/propuestas/${propuestaId}/enmiendas`,
      headers: como(daniela.testigo),
      payload: {
        requestId: req(),
        titulo: 'Pedir que la sala abra hasta las 9 de la noche',
        cuerpo:
          'Radicar una petición a la Dirección del Instituto para que la sala de estudio abra ' +
          'hasta las 9:00 p.m. de lunes a viernes, con la vigilancia institucional que la ' +
          'Universidad ya tiene. La comisión estudiantil sólo lleva el registro de uso.',
        motivo:
          'Dejar la llave a una comisión estudiantil le traslada a estudiantes una ' +
          'responsabilidad patrimonial que no pueden asumir.',
        plan: {
          ...planDe(daniela.miembroId),
          objetivo:
            'Conseguir el horario nocturno sin trasladar a estudiantes la custodia patrimonial.',
        },
      },
    });
    expect(respuesta.statusCode).toBe(201);
    const versiones = respuesta.json<{
      versiones: { version: number; cuerpo: string; huella: string; motivo?: string }[];
    }>().versiones;

    expect(versiones).toHaveLength(2);
    // ═══ Lo que hay que demostrar ═══
    const v1Despues = versiones[0]!;
    expect(v1Despues.version).toBe(1);
    expect(v1Despues.cuerpo).toBe(v1Antes.cuerpo);
    expect(v1Despues.huella).toBe(v1Antes.huella);
    expect(v1Despues.huella).toBe(huellaV1);

    const v2 = versiones[1]!;
    expect(v2.version).toBe(2);
    expect(v2.cuerpo).not.toBe(v1Antes.cuerpo);
    expect(v2.huella).not.toBe(huellaV1);
    expect(v2.motivo).toMatch(/responsabilidad patrimonial/u);
    huellaV2 = v2.huella;
  });

  it('6 · quien facilita abre la votación sobre la V2', async () => {
    const respuesta = await e.app.inject({
      method: 'POST',
      url: '/decisiones',
      headers: como(lucia.testigo),
      payload: {
        requestId: req(),
        propuestaId,
        metodo: 'simple-majority',
        duracionHoras: 96,
      },
    });
    expect(respuesta.statusCode).toBe(201);
    const decision = respuesta.json<{
      id: string;
      huellaVersion: string;
      estado: string;
      podianDecidir: number;
      queHaceFaltaParaQuePase: string;
    }>();
    decisionId = decision.id;
    expect(decision.estado).toBe('Open');
    // Se decide sobre la V2, que es la vigente.
    expect(decision.huellaVersion).toBe(huellaV2);
    expect(decision.podianDecidir).toBe(4);
    expect(decision.queHaceFaltaParaQuePase).toMatch(/abstenciones no cuentan/u);
  });

  it('7 · una papeleta sobre la V1 se RECHAZA: estar de acuerdo con un texto es con ESE texto', async () => {
    const respuesta = await e.app.inject({
      method: 'POST',
      url: `/decisiones/${decisionId}/papeletas`,
      headers: como(julian.testigo),
      payload: {
        requestId: req(),
        huellaVersion: huellaV1,
        respuesta: { tipo: 'binary', aprueba: true },
      },
    });
    expect(respuesta.statusCode).toBe(422);
    const cuerpo = respuesta.json<{ codigo: string; mensaje: string }>();
    expect(cuerpo.codigo).toBe('BALLOT_STALE_PROPOSAL_VERSION');
    expect(cuerpo.mensaje).toMatch(/el texto cambió/iu);
  });

  it('8 · se vota: tres a favor, una abstención', async () => {
    for (const quien of [daniela, julian, andres]) {
      const respuesta = await e.app.inject({
        method: 'POST',
        url: `/decisiones/${decisionId}/papeletas`,
        headers: como(quien.testigo),
        payload: {
          requestId: req(),
          huellaVersion: huellaV2,
          respuesta: { tipo: 'binary', aprueba: true },
        },
      });
      expect(respuesta.statusCode).toBe(201);
    }
    const abstencion = await e.app.inject({
      method: 'POST',
      url: `/decisiones/${decisionId}/papeletas`,
      headers: como(lucia.testigo),
      payload: {
        requestId: req(),
        huellaVersion: huellaV2,
        respuesta: { tipo: 'abstain' },
      },
    });
    expect(abstencion.statusCode).toBe(201);
    expect(abstencion.json<{ miRespuesta: string }>().miRespuesta).toBe('Me abstengo');
  });

  it('9 · cambiar de opinión es una virtud: manda la última papeleta', async () => {
    const cambio = await e.app.inject({
      method: 'POST',
      url: `/decisiones/${decisionId}/papeletas`,
      headers: como(andres.testigo),
      payload: {
        requestId: req(),
        huellaVersion: huellaV2,
        respuesta: { tipo: 'binary', aprueba: false },
      },
    });
    expect(cambio.statusCode).toBe(201);
    expect(cambio.json<{ miRespuesta: string }>().miRespuesta).toBe('No');
  });

  it('10 · no se cierra antes de tiempo, y se dice por qué', async () => {
    const respuesta = await e.app.inject({
      method: 'POST',
      url: `/decisiones/${decisionId}/cerrar`,
      headers: como(lucia.testigo),
      payload: { requestId: req() },
    });
    expect(respuesta.statusCode).toBe(409);
    expect(respuesta.json<{ codigo: string }>().codigo).toBe('CIERRE_ANTICIPADO_NO_PERMITIDO');
  });

  it('11 · vencida la ventana se cierra, y sale el resultado con su traza en palabras', async () => {
    e.reloj.avanzar(96 * HORA + 1000);

    // La sesión dura 12 horas y la votación 96: al vencer la ventana, la sesión con la que se abrió
    // ya no vale. Es el comportamiento correcto —una sesión de cuatro días sería una sesión que
    // sobrevive a un teléfono prestado— y la interfaz lo resuelve pidiendo entrar otra vez.
    const caducada = await e.app.inject({
      method: 'POST',
      url: `/decisiones/${decisionId}/cerrar`,
      headers: como(lucia.testigo),
      payload: { requestId: req() },
    });
    expect(caducada.statusCode).toBe(401);

    lucia = await entrar(e, FACILITADORA);
    const respuesta = await e.app.inject({
      method: 'POST',
      url: `/decisiones/${decisionId}/cerrar`,
      headers: como(lucia.testigo),
      payload: { requestId: req() },
    });
    expect(respuesta.statusCode).toBe(200);
    const resultado = respuesta.json<{
      desenlace: string;
      desenlaceEnPalabras: string;
      relato: string;
      pasos: { id: string; explicacion: string }[];
      participacion: { emitidas: number; representadas: number; podianDecidir: number };
      comprobante: string;
    }>();

    // 2 síes (Daniela, Julián), 1 no (Andrés, que cambió), 1 abstención (Lucía).
    expect(resultado.desenlace).toBe('approved');
    expect(resultado.desenlaceEnPalabras).toBe('Aprobada');
    expect(resultado.participacion).toEqual({
      emitidas: 4,
      representadas: 4,
      podianDecidir: 4,
    });
    expect(resultado.pasos.length).toBeGreaterThan(1);
    expect(resultado.comprobante).toMatch(/^[0-9a-f]{64}$/u);
    // La traza está en castellano y no menciona ni una vez la palabra de la que viene.
    const traza = `${resultado.relato} ${resultado.pasos.map((p: { explicacion: string }) => p.explicacion).join(' ')}`;
    expect(traza.toLowerCase()).not.toContain('hash');
    expect(traza.toLowerCase()).not.toContain('merkle');
  });

  it('12 · el resultado se puede volver a pedir y da exactamente lo mismo', async () => {
    const a = await e.app.inject({ method: 'GET', url: `/decisiones/${decisionId}/resultado` });
    const b = await e.app.inject({ method: 'GET', url: `/decisiones/${decisionId}/resultado` });
    expect(a.statusCode).toBe(200);
    expect(a.json<{ comprobante: string }>().comprobante).toBe(
      b.json<{ comprobante: string }>().comprobante,
    );
  });

  it('13 · verificar integridad: todo en verde, y explicado para quien no sabe qué es esto', async () => {
    const respuesta = await e.app.inject({ method: 'GET', url: '/integridad' });
    expect(respuesta.statusCode).toBe(200);
    const informe = respuesta.json<{
      todoBien: boolean;
      hechosRevisados: number;
      comprobaciones: { id: string; bien: boolean; queSeComprobo: string; queSignifica: string }[];
      comoComprobarloVosMismo: { explicacion: string; comando: string; urlDeDescarga: string };
    }>();

    expect(informe.todoBien).toBe(true);
    expect(informe.hechosRevisados).toBeGreaterThan(5);
    expect(informe.comprobaciones.map((c: { id: string }) => c.id).sort()).toEqual([
      'cadena',
      'ejecucion',
      'resultados',
      'textos',
    ]);
    for (const comprobacion of informe.comprobaciones) {
      expect(comprobacion.bien).toBe(true);
      // Qué se comprobó y qué significa: un semáforo sin explicación no informa.
      expect(comprobacion.queSeComprobo.length).toBeGreaterThan(30);
      expect(comprobacion.queSignifica.length).toBeGreaterThan(30);
      expect(comprobacion.queSeComprobo.toLowerCase()).not.toContain('hash');
    }
    // Y cómo comprobarlo sin confiar en esta página, que es lo único que prueba algo.
    expect(informe.comoComprobarloVosMismo.comando).toContain('verificador');
  });

  it('14 · el historial se exporta entero, para recalcularlo por fuera', async () => {
    const respuesta = await e.app.inject({ method: 'GET', url: '/integridad/exportar' });
    expect(respuesta.statusCode).toBe(200);
    const exportado = respuesta.json<{ formato: number; eventos: Record<string, string>[] }>();
    expect(exportado.formato).toBe(1);
    expect(exportado.eventos.length).toBeGreaterThan(5);
    for (const evento of exportado.eventos) {
      expect(evento['huella']).toMatch(/^[0-9a-f]{64}$/u);
      expect(evento['huellaAnterior']).toMatch(/^[0-9a-f]{64}$/u);
    }
  });

  it('15 · INMUTABILIDAD — alterar el historial por debajo, y que la verificación lo DENUNCIE', async () => {
    // El administrador con `root` cambia un byte del texto de la versión 1 de la propuesta: el
    // ataque interesante, porque cambia lo que se sometió a votación sin tocar ningún voto.
    await comoAdministrador(e.superPool, async (client) => {
      const { rows } = await client.query<{ leaf_index: string; payload: string }>(
        `SELECT leaf_index::text AS leaf_index, payload FROM governance.event
          WHERE aggregate_id = $1 AND event_type = 'ProposalDrafted'`,
        [propuestaId],
      );
      const fila = rows[0];
      expect(fila).toBeDefined();
      const alterado = fila!.payload.replace('9:00 p.m.', '6:00 p.m.');
      expect(alterado).not.toBe(fila!.payload);
      await client.query('UPDATE governance.event SET payload = $1 WHERE leaf_index = $2::bigint', [
        alterado,
        fila!.leaf_index,
      ]);
    });

    const respuesta = await e.app.inject({ method: 'GET', url: '/integridad' });
    const informe = respuesta.json<{
      todoBien: boolean;
      comprobaciones: { id: string; bien: boolean; queSignifica: string; detalle?: string }[];
    }>();

    expect(informe.todoBien).toBe(false);
    const cadena = informe.comprobaciones.find((c: { id: string }) => c.id === 'cadena');
    expect(cadena?.bien).toBe(false);
    // No es un error técnico escupido: dice qué significa, en palabras.
    expect(cadena?.queSignifica).toMatch(/cuarentena|alarma pública/u);
    expect(cadena?.detalle).toBeDefined();
  });
});
