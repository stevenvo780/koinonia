/**
 * `GET /mi/tareas`: lo tuyo, y sólo lo tuyo.
 *
 * ═══ Qué demuestra este fichero ═══
 *
 * «Mis tareas» se armaba pidiendo `GET /iniciativas`, o sea el detalle completo de **todas** las
 * iniciativas del Instituto, y filtraba en el navegador con `tarea.esMia`. Ese filtro es de pintado:
 * el título y la descripción del trabajo de cualquiera ya habían viajado por la red y estaban en la
 * memoria del teléfono. Un filtro que corre después de la copia no es una protección, y encima se
 * paga en datos móviles.
 *
 * Un filtro de servidor sólo vale si se prueba **desde fuera y con dos personas de verdad**: una
 * comprobación que mira el mismo array que acaba de construir la interfaz no prueba nada. Así que
 * acá hay dos miembros con el mismo rol, cada uno con su tarea, y se comprueba:
 *
 *  · que a cada uno le llega su tarea y ninguna otra;
 *  · que el título y la descripción de la tarea ajena **no aparecen en ningún sitio del cuerpo**,
 *    ni siquiera dentro de otro campo —por eso se busca sobre el JSON crudo y no sobre los objetos
 *    ya interpretados—;
 *  · que sin sesión esto es un 401 y no una lista vacía, que sería la respuesta que invita a probar;
 *  · que no hay selector de sujeto, tampoco escondido en la dirección.
 */

import { persistInitiativeLogWithin, withTransaction } from '@koinonia/api';
import {
  activateInitiative,
  createInitiative,
  decisionId,
  eventId,
  hash,
  initiativeId,
  instant,
  proposalId,
} from '@koinonia/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  apiEnv,
  type ApiListo,
  como,
  declararCapacidad,
  entrar,
  listo,
  skipNote,
} from './helpers/api-env.js';

const env = await apiEnv();
const CIRCLE = 'e5bac105b1e00000000000000000000b';
const DAY = 24 * 60 * 60 * 1_000;
let n = 0x7700;

function requestId(): string {
  const value = (++n).toString(16).padStart(32, '0');
  return (
    `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-` +
    `8${value.slice(17, 20)}-${value.slice(20, 32)}`
  );
}

interface Session {
  readonly testigo: string;
  readonly miembroId: string;
}

interface MiTareaView {
  readonly iniciativaId: string;
  readonly objetivo: string;
  readonly dependenciasPendientes: number;
  readonly tarea: {
    readonly id: string;
    readonly titulo: string;
    readonly descripcion: string;
    readonly dependeDe: readonly string[];
    readonly destinatarioId: string;
    readonly ofertaId: string;
    readonly revision: number;
    readonly estado: string;
    readonly esMia: boolean;
  };
}

interface InitiativeView {
  readonly hitos: readonly { readonly id: string }[];
  readonly tareas: readonly {
    readonly id: string;
    readonly titulo: string;
    readonly ofertaId: string;
    readonly revision: number;
  }[];
}

const TITULO_DE_SARA = 'Contar cuántas personas usan la sala después de las seis';
const TITULO_DE_ANDRES = 'Pedir por escrito el registro de entradas al edificio';
const DESCRIPCION_DE_ANDRES =
  'Redactar la solicitud formal a la administración y dejar constancia de la fecha de entrega.';

afterAll(async () => {
  if (env.ok) await env.stop();
});

describe.skipIf(!env.ok)(`GET /mi/tareas${skipNote(env)}`, () => {
  let e: ApiListo;
  let responsable: Session;
  let sara: Session;
  let andres: Session;
  let iniciativa: string;
  let tareaDeSara: string;
  let tareaDeAndres: string;

  async function iniciativaActiva(responsibleId: string): Promise<string> {
    const id = initiativeId(e.azar.opaqueId());
    const at = instant(e.reloj.now());
    let log = await createInitiative(
      { eventId: eventId(e.azar.opaqueId()), at, actor: 'system' },
      {
        initiativeId: id,
        outcomeKind: 'approved',
        decisionId: decisionId(e.azar.opaqueId()),
        proposalId: proposalId(e.azar.opaqueId()),
        proposalVersionHash: hash('7'.repeat(64)),
        decisionResultHash: hash('8'.repeat(64)),
        circleId: CIRCLE as never,
        executionPlan: {
          objective: 'Averiguar de verdad cuánta gente se queda sin sala después de las seis.',
          responsibleId: responsibleId as never,
          reviewAt: instant(e.reloj.now() + 30 * DAY),
          successCriteria: [
            {
              description: 'Hay un conteo con fechas y un pedido formal con acuse de recibo.',
              evidenceSource: 'Registro público de la iniciativa',
            },
          ],
        },
      },
    );
    log = await activateInitiative(
      log,
      { eventId: eventId(e.azar.opaqueId()), at, actor: 'system' },
      {
        ratificationEventId: eventId(e.azar.opaqueId()),
        ratificationEventHash: hash('9'.repeat(64)),
      },
    );
    await withTransaction(e.pool, (client) =>
      persistInitiativeLogWithin(client, log, { requestId: requestId() }),
    );
    return id;
  }

  async function ofrecer(
    milestone: string,
    recipient: Session,
    titulo: string,
    descripcion: string,
  ): Promise<string> {
    const respuesta = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${iniciativa}/tareas`,
      headers: como(responsable.testigo),
      payload: {
        requestId: requestId(),
        hitoId: milestone,
        destinatarioId: recipient.miembroId,
        titulo,
        descripcion,
        venceEn: e.reloj.now() + 10 * DAY,
        esfuerzoMinutos: 120,
        dependeDe: [],
      },
    });
    expect(respuesta.statusCode, respuesta.body).toBe(201);
    const vista = respuesta.json<InitiativeView>();
    return vista.tareas.find((t) => t.titulo === titulo)!.id;
  }

  beforeAll(async () => {
    e = listo(env);
    responsable = await entrar(e, 'responsable.mitareas@udea.edu.co');
    sara = await entrar(e, 'sara.mitareas@udea.edu.co');
    andres = await entrar(e, 'andres.mitareas@udea.edu.co');
    await declararCapacidad(e, sara.testigo, 600);
    await declararCapacidad(e, andres.testigo, 600);

    iniciativa = await iniciativaActiva(responsable.miembroId);
    const hito = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${iniciativa}/hitos`,
      headers: como(responsable.testigo),
      payload: {
        requestId: requestId(),
        titulo: 'Reunir la evidencia del primer mes',
        criterioDeTerminacion: 'Hay conteo propio y respuesta escrita de la administración.',
        venceEn: e.reloj.now() + 20 * DAY,
      },
    });
    expect(hito.statusCode, hito.body).toBe(201);
    const milestone = hito.json<InitiativeView>().hitos[0]!.id;

    tareaDeSara = await ofrecer(
      milestone,
      sara,
      TITULO_DE_SARA,
      'Anotar cada día cuánta gente se queda en el pasillo cuando cierra la sala.',
    );
    tareaDeAndres = await ofrecer(milestone, andres, TITULO_DE_ANDRES, DESCRIPCION_DE_ANDRES);
  });

  it('le entrega a cada persona su tarea y ninguna más', async () => {
    const respuesta = await e.app.inject({
      method: 'GET',
      url: '/mi/tareas',
      headers: como(sara.testigo),
    });
    expect(respuesta.statusCode, respuesta.body).toBe(200);
    const mias = respuesta.json<MiTareaView[]>();

    expect(mias).toHaveLength(1);
    expect(mias[0]!.tarea.id).toBe(tareaDeSara);
    expect(mias[0]!.tarea.titulo).toBe(TITULO_DE_SARA);
    expect(mias[0]!.tarea.destinatarioId).toBe(sara.miembroId);
    expect(mias[0]!.tarea.esMia).toBe(true);
    expect(mias[0]!.iniciativaId).toBe(iniciativa);
  });

  it('no deja rastro de la tarea ajena en ninguna parte del cuerpo', async () => {
    const respuesta = await e.app.inject({
      method: 'GET',
      url: '/mi/tareas',
      headers: como(sara.testigo),
    });
    expect(respuesta.statusCode).toBe(200);

    // Sobre el texto crudo a propósito: comprobar los objetos ya interpretados sólo mira los campos
    // que a una se le ocurre mirar, y la fuga de la que veníamos era justo un campo que nadie miraba.
    const crudo = respuesta.body;
    expect(crudo).not.toContain(TITULO_DE_ANDRES);
    expect(crudo).not.toContain(DESCRIPCION_DE_ANDRES);
    // Que no aparezca **quién es la otra persona** es lo que sostiene la promesa de la pantalla:
    // ningún identificador de miembro ajeno viaja acá, ni como destinatario ni como responsable.
    expect(crudo).not.toContain(andres.miembroId);
    expect(crudo).toContain(sara.miembroId);
  });

  it('cada fila que entrega es de quien pregunta, sin excepción', async () => {
    for (const quien of [sara, andres]) {
      const respuesta = await e.app.inject({
        method: 'GET',
        url: '/mi/tareas',
        headers: como(quien.testigo),
      });
      expect(respuesta.statusCode).toBe(200);
      for (const fila of respuesta.json<MiTareaView[]>()) {
        expect(fila.tarea.esMia, `${fila.tarea.titulo} no es de quien la pidió`).toBe(true);
        expect(fila.tarea.destinatarioId).toBe(quien.miembroId);
      }
    }
  });

  it('y al revés: Andrés recibe la suya y no la de Sara', async () => {
    const respuesta = await e.app.inject({
      method: 'GET',
      url: '/mi/tareas',
      headers: como(andres.testigo),
    });
    expect(respuesta.statusCode, respuesta.body).toBe(200);
    const suyas = respuesta.json<MiTareaView[]>();

    expect(suyas).toHaveLength(1);
    expect(suyas[0]!.tarea.id).toBe(tareaDeAndres);
    expect(respuesta.body).not.toContain(TITULO_DE_SARA);
    expect(respuesta.body).not.toContain(tareaDeSara);
  });

  it('quien no tiene ninguna tarea recibe una lista vacía, no la de los demás', async () => {
    const nadie = await entrar(e, 'nadie.mitareas@udea.edu.co');
    const respuesta = await e.app.inject({
      method: 'GET',
      url: '/mi/tareas',
      headers: como(nadie.testigo),
    });
    expect(respuesta.statusCode, respuesta.body).toBe(200);
    expect(respuesta.json<MiTareaView[]>()).toEqual([]);
  });

  it('sin sesión no responde una lista vacía: responde 401', async () => {
    // Devolver `[]` a quien no ha entrado convierte la ruta en un oráculo cómodo y, sobre todo,
    // hace que un fallo de sesión parezca «no tenés trabajo asignado».
    const respuesta = await e.app.inject({ method: 'GET', url: '/mi/tareas' });
    expect(respuesta.statusCode, respuesta.body).toBe(401);
    expect(respuesta.json<{ codigo: string }>().codigo).toBe('UNAUTHORIZED_NOT_AUTHENTICATED');
  });

  it('no acepta un selector de sujeto escondido en la dirección', async () => {
    const respuesta = await e.app.inject({
      method: 'GET',
      url: `/mi/tareas?miembro=${andres.miembroId}`,
      headers: como(sara.testigo),
    });
    expect(respuesta.statusCode, respuesta.body).toBe(400);
    expect(respuesta.body).not.toContain(TITULO_DE_ANDRES);
  });

  it('cuenta las dependencias pendientes sin nombrar tareas de otras personas', async () => {
    const conDependencia = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${iniciativa}/tareas`,
      headers: como(responsable.testigo),
      payload: {
        requestId: requestId(),
        hitoId: (
          await e.app.inject({
            method: 'GET',
            url: `/iniciativas/${iniciativa}`,
            headers: como(responsable.testigo),
          })
        ).json<InitiativeView>().hitos[0]!.id,
        destinatarioId: sara.miembroId,
        titulo: 'Redactar el informe con los dos conteos',
        descripcion:
          'Juntar el conteo propio y la respuesta oficial en un texto que se pueda leer.',
        venceEn: e.reloj.now() + 15 * DAY,
        esfuerzoMinutos: 90,
        // Depende de la tarea de Andrés: la cuenta tiene que reflejarlo sin decir cuál es.
        dependeDe: [tareaDeAndres],
      },
    });
    expect(conDependencia.statusCode, conDependencia.body).toBe(201);

    const respuesta = await e.app.inject({
      method: 'GET',
      url: '/mi/tareas',
      headers: como(sara.testigo),
    });
    expect(respuesta.statusCode).toBe(200);
    const mias = respuesta.json<MiTareaView[]>();
    const informe = mias.find((m) => m.tarea.titulo === 'Redactar el informe con los dos conteos');

    expect(informe?.dependenciasPendientes).toBe(1);

    // Lo que **no** sale es el texto: la pantalla decía «Antes deben completarse: ⟨títulos⟩» y para
    // eso necesitaba las tareas de los demás. Con la cuenta le basta para saber si puede empezar.
    expect(respuesta.body).not.toContain(TITULO_DE_ANDRES);
    expect(respuesta.body).not.toContain(DESCRIPCION_DE_ANDRES);
    expect(respuesta.body).not.toContain(andres.miembroId);

    // La referencia opaca sí sale, y es correcto que salga: es un campo **de la tarea propia** —de
    // qué depende mi trabajo— y esos identificadores ya son públicos en la iniciativa, que es donde
    // ese trabajo se rinde. Borrarlo sería falsear la tarea de Sara para aparentar un aislamiento
    // que el modelo no tiene. Lo que se protege es el contenido y de quién es, no la existencia de
    // una dependencia que la propia interfaz necesita para no dejarla empezar antes de tiempo.
    expect(informe?.tarea.dependeDe).toEqual([tareaDeAndres]);
  });
});
