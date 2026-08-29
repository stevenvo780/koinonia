/**
 * `/mi/rectificacion` — la hermana de `/mi/supresion` (Ley 1581, art. 8 lit. a).
 *
 * Igual que en `http-tareas-adr44.test.ts` para la supresión, esto entra por Fastify de verdad
 * (`app.inject`) contra PostgreSQL real: nada se dobla salvo el reloj, el azar y el correo.
 *
 * Lo que estas pruebas demuestran, en orden:
 *
 *  1. El autoservicio corrige de una vez —sin base legal ni confirmación de irreversibilidad—,
 *     a diferencia de la supresión, y sólo para alias, semestre y jornada: el correo no es uno de
 *     los campos que este esquema acepta (`z.discriminatedUnion`, no un `campo: z.string()`).
 *  2. El hecho que queda escrito no lleva el valor nuevo ni el viejo, sólo una huella del valor y
 *     qué campo cambió.
 *  3. Un reintento de red repite el mismo recibo; la misma clave con OTRO valor es un conflicto, no
 *     una repetición — el agujero exacto que el primer intento de esta tarea dejó abierto.
 *  4. `semestre` y `jornada` sólo aceptan uno de un conjunto cerrado: el ataque real que tumbó el
 *     primer intento —mandar el propio identificador de miembro como «semestre» y tumbar
 *     `/metricas/salud` para siempre— se rechaza en el esquema, antes de tocar la base, y la
 *     métrica sigue viva después de rectificaciones legítimas.
 *  5. El alias deja de ser único por construcción en cuanto deja de derivarse del correo: el mismo
 *     alias exacto que otra persona ya declaró se rechaza, sin escribir nada a medias — y una alta
 *     COMPLETAMENTE NUEVA cuyo alias por defecto choca con uno ya rectificado no se rompe: se
 *     desambigua.
 *  6. El alias corregido sobrevive a un enlace mágico posterior — la razón de ser de
 *     `alias_declarado_en` en `identity.ts`.
 */

import { afterAll, describe, expect, it } from 'vitest';

import { apiEnv, como, entrar, listo, skipNote, type ApiListo } from './helpers/api-env.js';

const env = await apiEnv();
let n = 0x7700;

function requestId(): string {
  const value = (++n).toString(16).padStart(32, '0');
  return (
    `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-` +
    `8${value.slice(17, 20)}-${value.slice(20, 32)}`
  );
}

interface RectificacionRespuesta {
  readonly solicitudId: string;
  readonly radicado: string;
  readonly campo: string;
  readonly aplicadaEn: number;
  readonly estado: string;
}

afterAll(async () => {
  if (env.ok) await env.stop();
});

describe.skipIf(!env.ok)(
  `API de rectificación propia (art. 8 lit. a, Ley 1581)${skipNote(env)}`,
  () => {
    let e: ApiListo;

    it('setup', () => {
      e = listo(env);
    });

    async function filaDeclarativa(
      miembroId: string,
    ): Promise<{ alias: string; semestre: string; jornada: string }> {
      const { rows } = await e.pool.query<{ alias: string; semestre: string; jornada: string }>(
        'SELECT alias, semestre, jornada FROM identity.member WHERE member_id = $1',
        [miembroId],
      );
      const fila = rows[0];
      if (fila === undefined) throw new Error('no existe esa persona en identity.member');
      return fila;
    }

    it('corrige alias, semestre y jornada de una vez, sin base legal ni confirmación', async () => {
      const persona = await entrar(e, 'rectifica.declarativos@udea.edu.co');
      const antes = await filaDeclarativa(persona.miembroId);
      expect(antes.alias).toBe('rectifica.declarativos');
      expect(antes.semestre).toBe('s1');
      expect(antes.jornada).toBe('diurna');

      const alias = await e.app.inject({
        method: 'POST',
        url: '/mi/rectificacion',
        headers: como(persona.testigo),
        payload: { requestId: requestId(), campo: 'alias', valorNuevo: 'Quien firma esto' },
      });
      expect(alias.statusCode, alias.body).toBe(200);
      expect(alias.json<RectificacionRespuesta>()).toMatchObject({
        campo: 'alias',
        estado: 'aplicada',
      });

      const semestre = await e.app.inject({
        method: 'POST',
        url: '/mi/rectificacion',
        headers: como(persona.testigo),
        payload: { requestId: requestId(), campo: 'semestre', valorNuevo: 's8' },
      });
      expect(semestre.statusCode, semestre.body).toBe(200);

      const jornada = await e.app.inject({
        method: 'POST',
        url: '/mi/rectificacion',
        headers: como(persona.testigo),
        payload: { requestId: requestId(), campo: 'jornada', valorNuevo: 'nocturna' },
      });
      expect(jornada.statusCode, jornada.body).toBe(200);

      const despues = await filaDeclarativa(persona.miembroId);
      expect(despues).toStrictEqual({
        alias: 'Quien firma esto',
        semestre: 's8',
        jornada: 'nocturna',
      });
    });

    it('el correo institucional no es uno de los campos que este esquema acepta', async () => {
      const persona = await entrar(e, 'sin-correo-rectificable@udea.edu.co');
      const respuesta = await e.app.inject({
        method: 'POST',
        url: '/mi/rectificacion',
        headers: como(persona.testigo),
        payload: {
          requestId: requestId(),
          campo: 'correo',
          valorNuevo: 'nueva.direccion@udea.edu.co',
        },
      });
      expect(respuesta.statusCode).toBe(400);
      expect(respuesta.json<{ codigo: string }>().codigo).toBe('DATOS_INVALIDOS');
    });

    it(
      'BLOQUEANTE #1 — un identificador de miembro como «semestre» se rechaza en el esquema, ' +
        'antes de llegar a la base, y la métrica sigue viva después de rectificar de verdad',
      async () => {
        const persona = await entrar(e, 'no.tumba.la.metrica@udea.edu.co');

        // El ataque exacto que ejecutó el revisor contra el primer intento: el propio identificador
        // de 32 hex, que cabía sin problema en un `z.string().max(40)`.
        const ataque = await e.app.inject({
          method: 'POST',
          url: '/mi/rectificacion',
          headers: como(persona.testigo),
          payload: { requestId: requestId(), campo: 'semestre', valorNuevo: persona.miembroId },
        });
        expect(ataque.statusCode, ataque.body).toBe(400);
        expect(ataque.json<{ codigo: string }>().codigo).toBe('DATOS_INVALIDOS');

        // Texto libre razonable tampoco cuela: sólo uno de los diez valores reconocidos.
        const textoLibre = await e.app.inject({
          method: 'POST',
          url: '/mi/rectificacion',
          headers: como(persona.testigo),
          payload: { requestId: requestId(), campo: 'semestre', valorNuevo: 'octavo' },
        });
        expect(textoLibre.statusCode).toBe(400);

        const jornadaLibre = await e.app.inject({
          method: 'POST',
          url: '/mi/rectificacion',
          headers: como(persona.testigo),
          payload: { requestId: requestId(), campo: 'jornada', valorNuevo: 'mixta' },
        });
        expect(jornadaLibre.statusCode).toBe(400);

        // Una rectificación DE VERDAD, con un valor del conjunto cerrado.
        const legitima = await e.app.inject({
          method: 'POST',
          url: '/mi/rectificacion',
          headers: como(persona.testigo),
          payload: { requestId: requestId(), campo: 'semestre', valorNuevo: 's5' },
        });
        expect(legitima.statusCode, legitima.body).toBe(200);

        // La métrica pública sigue de pie: nunca vio un identificador de miembro como estrato.
        const salud = await e.app.inject({ method: 'GET', url: '/metricas/salud' });
        expect(salud.statusCode, salud.body).toBe(200);
      },
    );

    it('un valor igual al ya guardado no cuenta como una corrección', async () => {
      const persona = await entrar(e, 'sin.cambio.rectificar@udea.edu.co');
      const respuesta = await e.app.inject({
        method: 'POST',
        url: '/mi/rectificacion',
        headers: como(persona.testigo),
        payload: { requestId: requestId(), campo: 'jornada', valorNuevo: 'diurna' },
      });
      expect(respuesta.statusCode).toBe(422);
      expect(respuesta.json<{ codigo: string; campo?: string }>()).toMatchObject({
        codigo: 'RECTIFICATION_NO_CHANGE',
        campo: 'valorNuevo',
      });
    });

    it('un alias con un carácter NUL se rechaza en el esquema, nunca en PostgreSQL', async () => {
      const persona = await entrar(e, 'sin-nul-en-alias@udea.edu.co');
      const respuesta = await e.app.inject({
        method: 'POST',
        url: '/mi/rectificacion',
        headers: como(persona.testigo),
        payload: { requestId: requestId(), campo: 'alias', valorNuevo: 'Ana\u0000Gómez' },
      });
      expect(respuesta.statusCode, respuesta.body).toBe(400);
      expect(respuesta.json<{ codigo: string }>().codigo).toBe('DATOS_INVALIDOS');
    });

    it('sin sesión no hay rectificación posible', async () => {
      const respuesta = await e.app.inject({
        method: 'POST',
        url: '/mi/rectificacion',
        payload: { requestId: requestId(), campo: 'alias', valorNuevo: 'Alguien sin sesión' },
      });
      expect(respuesta.statusCode).toBe(401);
      expect(respuesta.json<{ codigo: string }>().codigo).toBe('UNAUTHORIZED_NOT_AUTHENTICATED');
    });

    it('un reintento con la misma clave repite el mismo recibo, nunca «sin cambios»', async () => {
      const persona = await entrar(e, 'reintento.rectificar@udea.edu.co');
      const clave = requestId();
      const payload = { requestId: clave, campo: 'alias' as const, valorNuevo: 'Nombre estable' };

      const primero = await e.app.inject({
        method: 'POST',
        url: '/mi/rectificacion',
        headers: como(persona.testigo),
        payload,
      });
      expect(primero.statusCode, primero.body).toBe(200);

      // El segundo intento pide EXACTAMENTE lo mismo que el primero ya aplicó: si el chequeo de
      // réplica no corriera antes que el de negocio, esto saldría 422 RECTIFICATION_NO_CHANGE en vez
      // de repetir el recibo — que es justamente el fallo que este fichero existe para impedir.
      const segundo = await e.app.inject({
        method: 'POST',
        url: '/mi/rectificacion',
        headers: como(persona.testigo),
        payload,
      });
      expect(segundo.statusCode).toBe(200);
      expect(segundo.json<RectificacionRespuesta>()).toStrictEqual(
        primero.json<RectificacionRespuesta>(),
      );

      const eventos = await e.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM governance.event WHERE aggregate_id = $1`,
        [primero.json<RectificacionRespuesta>().solicitudId],
      );
      expect(eventos.rows[0]?.count).toBe('1');
    });

    it(
      'BLOQUEANTE #10 — la misma clave con OTRO valor es un conflicto, no una repetición ' +
        'silenciosa',
      async () => {
        const persona = await entrar(e, 'clave-divergente-rectificar@udea.edu.co');
        const clave = requestId();
        const primero = await e.app.inject({
          method: 'POST',
          url: '/mi/rectificacion',
          headers: como(persona.testigo),
          payload: { requestId: clave, campo: 'semestre', valorNuevo: 's3' },
        });
        expect(primero.statusCode, primero.body).toBe(200);

        // Mismo campo, MISMA clave, OTRO valor: el primer intento de esta tarea confundía esto con
        // «ya se aplicó» y devolvía 200 sin tocar nada.
        const divergente = await e.app.inject({
          method: 'POST',
          url: '/mi/rectificacion',
          headers: como(persona.testigo),
          payload: { requestId: clave, campo: 'semestre', valorNuevo: 's4' },
        });
        expect(divergente.statusCode).toBe(409);
        expect(divergente.json<{ codigo: string }>().codigo).toBe('IDEMPOTENCY_KEY_REUSED');

        // Y el valor sigue siendo el de la primera intención, nunca la segunda.
        const fila = await filaDeclarativa(persona.miembroId);
        expect(fila.semestre).toBe('s3');

        // También un campo distinto bajo la misma clave es un conflicto, no una repetición.
        const otroCampo = await e.app.inject({
          method: 'POST',
          url: '/mi/rectificacion',
          headers: como(persona.testigo),
          payload: { requestId: clave, campo: 'jornada', valorNuevo: 'nocturna' },
        });
        expect(otroCampo.statusCode).toBe(409);
      },
    );

    it('BLOQUEANTE #4 — el alias exacto de otra persona no se acepta, y no se escribe nada a medias', async () => {
      const alicia = await entrar(e, 'alicia.alias.disputado@udea.edu.co');
      const bernardo = await entrar(e, 'bernardo.alias.disputado@udea.edu.co');

      const primero = await e.app.inject({
        method: 'POST',
        url: '/mi/rectificacion',
        headers: como(alicia.testigo),
        payload: { requestId: requestId(), campo: 'alias', valorNuevo: 'Nombre Disputado' },
      });
      expect(primero.statusCode, primero.body).toBe(200);

      const segundo = await e.app.inject({
        method: 'POST',
        url: '/mi/rectificacion',
        headers: como(bernardo.testigo),
        payload: { requestId: requestId(), campo: 'alias', valorNuevo: 'Nombre Disputado' },
      });
      expect(segundo.statusCode).toBe(409);
      expect(segundo.json<{ codigo: string }>().codigo).toBe('RECTIFICATION_ALIAS_IN_USE');

      // Bernardo conserva su alias de siempre: nada quedó escrito a medias.
      const filaBernardo = await filaDeclarativa(bernardo.miembroId);
      expect(filaBernardo.alias).toBe('bernardo.alias.disputado');

      // Y sólo difiere en mayúsculas: la unicidad no distingue caso, porque la lista de
      // delegación (`miembroCirculo`) las muestra igual de parecidas.
      const conOtroCaso = await e.app.inject({
        method: 'POST',
        url: '/mi/rectificacion',
        headers: como(bernardo.testigo),
        payload: { requestId: requestId(), campo: 'alias', valorNuevo: 'nombre disputado' },
      });
      expect(conOtroCaso.statusCode).toBe(409);
    });

    it(
      'una alta completamente nueva cuyo alias por defecto choca con uno ya rectificado se ' +
        'desambigua, en vez de fallar',
      async () => {
        // Alguien rectifica su alias a algo que, por pura coincidencia, es la parte local de un
        // correo que TODAVÍA no existe: `colision.nueva-alta`.
        const yaDeclaro = await entrar(e, 'quien.ya.declaro@udea.edu.co');
        const rectificar = await e.app.inject({
          method: 'POST',
          url: '/mi/rectificacion',
          headers: como(yaDeclaro.testigo),
          payload: { requestId: requestId(), campo: 'alias', valorNuevo: 'colision.nueva.alta' },
        });
        expect(rectificar.statusCode, rectificar.body).toBe(200);

        // Ahora alguien COMPLETAMENTE NUEVO entra con ese exacto correo: su alias por defecto
        // —la parte local— es idéntico al que ya está declarado. Antes de la unicidad esto era
        // estructuralmente imposible; ahora tiene que resolverse sin que esta persona se quede
        // sin poder entrar por primera vez.
        const alta = await e.app.inject({
          method: 'POST',
          url: '/auth/enlace',
          payload: { correo: 'colision.nueva.alta@udea.edu.co' },
        });
        expect(alta.statusCode, alta.body).toBe(202);

        const mensaje = e.correo.ultimoPara('colision.nueva.alta@udea.edu.co');
        expect(mensaje, 'tiene que haber recibido su propio enlace, no un error').toBeDefined();

        const { rows } = await e.pool.query<{ member_id: string; alias: string }>(
          `SELECT member_id, alias FROM identity.member WHERE email = $1`,
          ['colision.nueva.alta@udea.edu.co'],
        );
        const fila = rows[0];
        expect(fila, 'la alta nueva tiene que haber quedado escrita').toBeDefined();
        // Se le dio de alta con un alias DISTINTO del que ya estaba tomado: no se pisó a quien ya
        // lo tenía, y la persona nueva sí pudo entrar.
        expect(fila?.alias).not.toBe('colision.nueva.alta');
        expect(fila?.alias.startsWith('colision.nueva.alta-')).toBe(true);
      },
    );

    it('el hecho que queda escrito no lleva el valor, sólo su huella, y ningún campo de más', async () => {
      const persona = await entrar(e, 'sin-pii-en-el-historial@udea.edu.co');
      const valorSecreto = 'Este texto exacto no puede aparecer en el historial';
      const respuesta = await e.app.inject({
        method: 'POST',
        url: '/mi/rectificacion',
        headers: como(persona.testigo),
        payload: { requestId: requestId(), campo: 'alias', valorNuevo: valorSecreto },
      });
      expect(respuesta.statusCode, respuesta.body).toBe(200);
      const solicitudId = respuesta.json<RectificacionRespuesta>().solicitudId;

      const fila = await e.pool.query<{
        actor: string | null;
        event_type: string;
        aggregate_type: string;
        payload_idx: unknown;
      }>(
        `SELECT actor, event_type, aggregate_type, payload_idx
         FROM governance.event WHERE aggregate_id = $1 AND seq = 0`,
        [solicitudId],
      );
      const evento = fila.rows[0];
      expect(evento).toBeDefined();
      expect(evento?.aggregate_type).toBe('pii_rectification');
      expect(evento?.actor).toBe(persona.miembroId);
      const payloadTexto = JSON.stringify(evento?.payload_idx);
      expect(payloadTexto).not.toContain(valorSecreto);
      // Sólo las siete claves que documenta `pii-rectification.ts`: nada de un `valorViejo`/
      // `valorNuevo` que se coló por accidente.
      expect(Object.keys(evento?.payload_idx as Record<string, unknown>).sort()).toStrictEqual(
        [
          'appliedAt',
          'claimRef',
          'eventId',
          'field',
          'legalBasis',
          'subjectId',
          'valueHash',
        ].sort(),
      );
    });

    it('el alias corregido sobrevive a un enlace mágico posterior; semestre y jornada ya sobrevivían', async () => {
      const persona = await entrar(e, 'alias.sobrevive.enlace@udea.edu.co');
      const antesDeCorregir = await filaDeclarativa(persona.miembroId);
      expect(antesDeCorregir.alias).toBe('alias.sobrevive.enlace');

      const rectificar = await e.app.inject({
        method: 'POST',
        url: '/mi/rectificacion',
        headers: como(persona.testigo),
        payload: { requestId: requestId(), campo: 'alias', valorNuevo: 'Mi alias, no el correo' },
      });
      expect(rectificar.statusCode, rectificar.body).toBe(200);

      // Un segundo `/auth/enlace` para el MISMO correo es exactamente lo que dispara `upsertMember`
      // de nuevo — no hace falta canjear el enlace: la reescritura ocurre al pedirlo.
      const segundoPedido = await e.app.inject({
        method: 'POST',
        url: '/auth/enlace',
        payload: { correo: 'alias.sobrevive.enlace@udea.edu.co' },
      });
      expect(segundoPedido.statusCode).toBe(202);

      const despues = await filaDeclarativa(persona.miembroId);
      expect(despues.alias).toBe('Mi alias, no el correo');
    });
  },
);
