/**
 * La pantalla «Reuniones» (PRODUCT §4), por HTTP y contra PostgreSQL real.
 *
 * A diferencia de `http-objeciones.test.ts`, `registrarRutasDeReuniones` SÍ está enganchada a
 * `buildApp` desde este mismo encargo (`services/api/src/http/app.ts`), así que no hace falta un
 * segundo Fastify: todo pasa por `e.app`, igual que el resto del corte vertical.
 *
 * Convocar → publicar el acta → convertir un acuerdo en la propuesta que ya se creó por la única
 * puerta que existe (`POST /propuestas`) → comprobar que el enlace exige que sea la MISMA propuesta
 * del MISMO problema, no cualquier propuesta que el cliente decida nombrar.
 */

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
const CIRCULO_ASAMBLEA = 'a55a11b1ea00000000000000000000a1';

let n = 0;
function req(): string {
  const hex = (++n + 0x9000).toString(16).padStart(32, '0');
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-` +
    `8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  );
}

interface ErrorHttp {
  readonly codigo: string;
  readonly mensaje: string;
}

interface ReunionDetalleHttp {
  readonly id: string;
  readonly titulo: string;
  readonly circuloId: string;
  readonly cuando: number;
  readonly lugar?: string;
  readonly enlaceRemoto?: string;
  readonly puntosOrdenDelDia: number;
  readonly actaPublicada: boolean;
  readonly laConvoqueYo: boolean;
  readonly ordenDelDia: readonly { readonly id: string; readonly texto: string }[];
  readonly resumenActa?: string;
  readonly asistentes: readonly string[];
  readonly actaSinAsistentes: boolean;
  readonly acuerdos: readonly {
    readonly id: string;
    readonly texto: string;
    readonly problemaId?: string;
    readonly propuestaId?: string;
    readonly puedeConvertirseEnPropuesta: boolean;
  }[];
}

async function crearProblemaBase(e: ApiListo, testigo: string, titulo: string): Promise<string> {
  const respuesta = await e.app.inject({
    method: 'POST',
    url: '/problemas',
    headers: como(testigo),
    payload: {
      requestId: req(),
      titulo,
      cuerpo: 'Un cuerpo con longitud suficiente para pasar el mínimo exigido por el dominio.',
      circuloId: CIRCULO_ESPACIOS,
    },
  });
  expect(respuesta.statusCode).toBe(201);
  return respuesta.json<{ id: string }>().id;
}

describe.skipIf(!env.ok)(`la pantalla «Reuniones» por HTTP${skipNote(env)}`, () => {
  let e: ApiListo;
  let daniela: { testigo: string; miembroId: string };
  let julian: { testigo: string; miembroId: string };

  beforeAll(async () => {
    e = listo(env);
    daniela = await entrar(e, 'daniela.reuniones@udea.edu.co');
    julian = await entrar(e, 'julian.reuniones@udea.edu.co');
    // La facilitadora entra igual que en los demás escenarios, aunque acá no haga falta ningún rol
    // especial: convocar y publicar el acta son actos de MIEMBRO (ver `access.ts`).
    await entrar(e, FACILITADORA);
  });

  it('no se convoca sin sesión', async () => {
    const respuesta = await e.app.inject({
      method: 'POST',
      url: '/reuniones',
      payload: {
        requestId: req(),
        titulo: 'Asamblea ordinaria de agosto',
        circuloId: CIRCULO_ESPACIOS,
        cuando: Date.UTC(2026, 8, 3, 21, 0, 0),
        lugar: 'Salón 12-104',
        ordenDelDia: [{ texto: 'Revisar el horario de la sala de estudio nocturna.' }],
      },
    });
    expect(respuesta.statusCode).toBe(401);
  });

  it('no se convoca sin lugar ni enlace remoto: el formulario lo dice antes de viajar', async () => {
    const respuesta = await e.app.inject({
      method: 'POST',
      url: '/reuniones',
      headers: como(daniela.testigo),
      payload: {
        requestId: req(),
        titulo: 'Asamblea ordinaria de agosto',
        circuloId: CIRCULO_ESPACIOS,
        cuando: Date.UTC(2026, 8, 3, 21, 0, 0),
        ordenDelDia: [{ texto: 'Revisar el horario de la sala de estudio nocturna.' }],
      },
    });
    expect(respuesta.statusCode).toBe(400);
  });

  it('no se convoca sobre un grupo que no existe', async () => {
    const respuesta = await e.app.inject({
      method: 'POST',
      url: '/reuniones',
      headers: como(daniela.testigo),
      payload: {
        requestId: req(),
        titulo: 'Asamblea ordinaria de agosto',
        circuloId: 'f'.repeat(32),
        cuando: Date.UTC(2026, 8, 3, 21, 0, 0),
        lugar: 'Salón 12-104',
        ordenDelDia: [{ texto: 'Revisar el horario de la sala de estudio nocturna.' }],
      },
    });
    expect(respuesta.statusCode).toBe(404);
  });

  it('no se convoca enlazando un problema que no existe', async () => {
    const respuesta = await e.app.inject({
      method: 'POST',
      url: '/reuniones',
      headers: como(daniela.testigo),
      payload: {
        requestId: req(),
        titulo: 'Asamblea ordinaria de agosto',
        circuloId: CIRCULO_ESPACIOS,
        cuando: Date.UTC(2026, 8, 3, 21, 0, 0),
        lugar: 'Salón 12-104',
        ordenDelDia: [{ texto: 'Tratar un problema inventado.', problemaId: 'a'.repeat(32) }],
      },
    });
    expect(respuesta.statusCode).toBe(404);
  });

  describe('el recorrido completo: convocar, publicar el acta y convertir un acuerdo', () => {
    let problemaId: string;
    let reunionId: string;
    let acuerdoConvertibleId: string;
    let acuerdoSinProblemaId: string;

    it('1 · Daniela escribe el problema que la reunión va a tratar', async () => {
      problemaId = await crearProblemaBase(
        e,
        daniela.testigo,
        'La sala de estudio cierra a las 6 de la tarde',
      );
    });

    it('2 · Daniela convoca la reunión, con el problema enlazado en el orden del día', async () => {
      const respuesta = await e.app.inject({
        method: 'POST',
        url: '/reuniones',
        headers: como(daniela.testigo),
        payload: {
          requestId: req(),
          titulo: 'Asamblea ordinaria de Espacios y Bienestar',
          circuloId: CIRCULO_ESPACIOS,
          cuando: Date.UTC(2026, 8, 3, 21, 0, 0),
          lugar: 'Salón 12-104, Bloque 12',
          ordenDelDia: [
            { texto: 'Revisar el horario de la sala de estudio nocturna.', problemaId },
          ],
        },
      });
      expect(respuesta.statusCode).toBe(201);
      const reunion = respuesta.json<ReunionDetalleHttp>();
      reunionId = reunion.id;
      expect(reunion.titulo).toBe('Asamblea ordinaria de Espacios y Bienestar');
      expect(reunion.lugar).toBe('Salón 12-104, Bloque 12');
      expect(reunion.puntosOrdenDelDia).toBe(1);
      expect(reunion.actaPublicada).toBe(false);
      expect(reunion.laConvoqueYo).toBe(true);
      expect(reunion.ordenDelDia[0]?.texto).toMatch(/sala de estudio/u);
    });

    it('3 · aparece en la lista, y «la convoqué yo» distingue a quien la convocó', async () => {
      const listaComoDaniela = await e.app.inject({
        method: 'GET',
        url: '/reuniones',
        headers: como(daniela.testigo),
      });
      const propia = listaComoDaniela
        .json<readonly ReunionDetalleHttp[]>()
        .find((r) => r.id === reunionId);
      expect(propia?.laConvoqueYo).toBe(true);

      const listaComoJulian = await e.app.inject({
        method: 'GET',
        url: '/reuniones',
        headers: como(julian.testigo),
      });
      const ajena = listaComoJulian
        .json<readonly ReunionDetalleHttp[]>()
        .find((r) => r.id === reunionId);
      expect(ajena?.laConvoqueYo).toBe(false);
    });

    it('4 · HORIZONTAL — Julián no puede publicar el acta de la reunión de Daniela', async () => {
      const respuesta = await e.app.inject({
        method: 'POST',
        url: `/reuniones/${reunionId}/acta`,
        headers: como(julian.testigo),
        payload: {
          requestId: req(),
          resumen: 'Julián intenta publicar el acta de una reunión que convocó Daniela.',
          asistentes: [],
          acuerdos: [],
        },
      });
      expect(respuesta.statusCode).toBe(403);
    });

    it('5 · Daniela publica el acta: sin asistentes, se permite y queda marcada', async () => {
      const respuesta = await e.app.inject({
        method: 'POST',
        url: `/reuniones/${reunionId}/acta`,
        headers: como(daniela.testigo),
        payload: {
          requestId: req(),
          resumen:
            'Se discutió el horario de la sala de estudio nocturna y se acordó pedir la extensión.',
          asistentes: [],
          acuerdos: [
            {
              texto: 'Pedir que la sala abra hasta las 9 de la noche entre semana.',
              problemaId,
            },
            { texto: 'Reservar el salón 12-104 para la próxima reunión de seguimiento.' },
          ],
        },
      });
      expect(respuesta.statusCode).toBe(200);
      const reunion = respuesta.json<ReunionDetalleHttp>();
      expect(reunion.actaPublicada).toBe(true);
      expect(reunion.actaSinAsistentes).toBe(true);
      expect(reunion.acuerdos).toHaveLength(2);

      const convertible = reunion.acuerdos.find((a) => a.problemaId === problemaId);
      const sinProblema = reunion.acuerdos.find((a) => a.problemaId === undefined);
      expect(convertible?.puedeConvertirseEnPropuesta).toBe(true);
      expect(sinProblema?.puedeConvertirseEnPropuesta).toBe(false);
      acuerdoConvertibleId = convertible!.id;
      acuerdoSinProblemaId = sinProblema!.id;
    });

    it('no hay un segundo «publicar acta» para la misma reunión', async () => {
      const respuesta = await e.app.inject({
        method: 'POST',
        url: `/reuniones/${reunionId}/acta`,
        headers: como(daniela.testigo),
        payload: {
          requestId: req(),
          resumen: 'Segundo intento de publicar el acta de la misma reunión ya publicada.',
          asistentes: [],
          acuerdos: [],
        },
      });
      expect(respuesta.statusCode).toBe(422);
      expect(respuesta.json<ErrorHttp>().codigo).toBe('MINUTES_ALREADY_PUBLISHED');
    });

    it('un acuerdo sin problema declarado no se puede enlazar con una propuesta', async () => {
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
            'hasta las 9:00 p.m. de lunes a viernes entre semana.',
          plan: planDe(daniela.miembroId),
        },
      });
      expect(propuesta.statusCode).toBe(201);
      const propuestaId = propuesta.json<{ id: string }>().id;

      const respuesta = await e.app.inject({
        method: 'POST',
        url: `/reuniones/${reunionId}/acuerdos/${acuerdoSinProblemaId}/propuesta`,
        headers: como(daniela.testigo),
        payload: { requestId: req(), propuestaId },
      });
      expect(respuesta.statusCode).toBe(422);
      expect(respuesta.json<ErrorHttp>().codigo).toBe('AGREEMENT_WITHOUT_PROBLEM');
    });

    it('6 · una propuesta de OTRO problema no se cuela como la que salió de este acuerdo', async () => {
      const otroProblemaId = await crearProblemaBase(
        e,
        daniela.testigo,
        'Un problema completamente distinto, sin relación con la sala de estudio',
      );
      const propuestaAjena = await e.app.inject({
        method: 'POST',
        url: '/propuestas',
        headers: como(daniela.testigo),
        payload: {
          requestId: req(),
          problemaId: otroProblemaId,
          titulo: 'Una propuesta que no responde al acuerdo de esta reunión',
          cuerpo:
            'Esta propuesta responde a un problema distinto: no puede pasar como el fruto de un ' +
            'acuerdo de la reunión de Espacios y Bienestar.',
          plan: planDe(daniela.miembroId),
        },
      });
      expect(propuestaAjena.statusCode).toBe(201);

      const respuesta = await e.app.inject({
        method: 'POST',
        url: `/reuniones/${reunionId}/acuerdos/${acuerdoConvertibleId}/propuesta`,
        headers: como(daniela.testigo),
        payload: { requestId: req(), propuestaId: propuestaAjena.json<{ id: string }>().id },
      });
      expect(respuesta.statusCode).toBe(409);
      expect(respuesta.json<ErrorHttp>().codigo).toBe('PROPOSAL_PROBLEM_MISMATCH');
    });

    it('7 · Daniela convierte el acuerdo en la propuesta que sí responde al mismo problema', async () => {
      const propuesta = await e.app.inject({
        method: 'POST',
        url: '/propuestas',
        headers: como(daniela.testigo),
        payload: {
          requestId: req(),
          problemaId,
          titulo: 'Pedir que la sala abra hasta las 9 de la noche, versión del acuerdo',
          cuerpo:
            'Radicar una petición a la Dirección del Instituto para que la sala de estudio abra ' +
            'hasta las 9:00 p.m. de lunes a viernes, tal como se acordó en la reunión.',
          plan: planDe(daniela.miembroId),
        },
      });
      expect(propuesta.statusCode).toBe(201);
      const propuestaId = propuesta.json<{ id: string }>().id;

      const respuesta = await e.app.inject({
        method: 'POST',
        url: `/reuniones/${reunionId}/acuerdos/${acuerdoConvertibleId}/propuesta`,
        headers: como(daniela.testigo),
        payload: { requestId: req(), propuestaId },
      });
      expect(respuesta.statusCode).toBe(200);
      const reunion = respuesta.json<ReunionDetalleHttp>();
      const acuerdo = reunion.acuerdos.find((a) => a.id === acuerdoConvertibleId);
      expect(acuerdo?.propuestaId).toBe(propuestaId);
      expect(acuerdo?.puedeConvertirseEnPropuesta).toBe(false);

      // Ya enlazado: un segundo intento se rechaza, no se sobrescribe.
      const segundo = await e.app.inject({
        method: 'POST',
        url: `/reuniones/${reunionId}/acuerdos/${acuerdoConvertibleId}/propuesta`,
        headers: como(daniela.testigo),
        payload: { requestId: req(), propuestaId },
      });
      expect(segundo.statusCode).toBe(422);
      expect(segundo.json<ErrorHttp>().codigo).toBe('AGREEMENT_ALREADY_LINKED');
    });
  });

  it('convocar acepta un enlace remoto solo, sin lugar físico', async () => {
    const respuesta = await e.app.inject({
      method: 'POST',
      url: '/reuniones',
      headers: como(daniela.testigo),
      payload: {
        requestId: req(),
        titulo: 'Reunión virtual de coordinación',
        circuloId: CIRCULO_ASAMBLEA,
        cuando: Date.UTC(2026, 8, 10, 21, 0, 0),
        enlaceRemoto: 'https://meet.example.org/instituto-agosto',
        ordenDelDia: [{ texto: 'Coordinar la agenda del próximo mes con los demás círculos.' }],
      },
    });
    expect(respuesta.statusCode).toBe(201);
    const reunion = respuesta.json<ReunionDetalleHttp>();
    expect(reunion.enlaceRemoto).toMatch(/meet\.example\.org/u);
    expect(reunion.lugar).toBeUndefined();
  });
});
