/**
 * Las consultas de estado contra la aplicación real y PostgreSQL real.
 *
 * ═══ Lo que estas pruebas existen para demostrar ═══
 *
 * Hay dos rutas nuevas que le contestan **200 a cualquiera**: si hay sesión, y si esta sesión puede
 * pedir la lista de integrantes de un grupo. Una ruta así es una superficie que cualquiera puede
 * interrogar en bucle, y el fallo que hay que impedir no es que filtre datos —no lleva ninguno—,
 * sino que se convierta en **oráculo**: que sus respuestas, comparadas entre sí, contesten preguntas
 * que nadie tiene derecho a hacer. Las dos preguntas peligrosas son siempre las mismas:
 *
 *   · «¿existe una cuenta con este correo?» → se responde enumerando el padrón del Instituto;
 *   · «¿existe este grupo, aunque no me dejen verlo?» → se responde mapeando la organización.
 *
 * Contra la primera, el cuerpo del «no hay sesión» es **uno solo**: sin cookie, con la cookie vacía,
 * con un testigo inventado, con un testigo bien formado que no es de nadie, con una sesión revocada
 * y con una sesión vencida sale exactamente el mismo byte. La prueba los compara todos entre sí, no
 * uno contra una constante: es la misma forma de comprobación que sostiene la regla de la pantalla
 * de entrada —el mismo texto exista o no la cuenta— y por la misma razón.
 *
 * Contra la segunda, la consulta de acceso contesta lo mismo para un grupo que existe y no integrás
 * que para un grupo que no existe.
 *
 * Y sobre todo: **ninguna de las dos autoriza nada**. Las últimas pruebas hacen lo que haría alguien
 * que se falsifica el 200 en el navegador —llamar a la operación de verdad igual— y comprueban que
 * la operación contesta 401 y 403 como si la consulta no existiera. Van por la API directamente,
 * saltándose la interfaz, que es la única forma de probar algo.
 */

import { accesoAMiembros, estadoSesion, type Sesion } from '@koinonia/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { apiEnv, type ApiListo, como, entrar, listo, skipNote } from './helpers/api-env.js';

const env = await apiEnv();

afterAll(async () => {
  if (env.ok) await env.stop();
});

/** Todo el que entra queda en Asamblea y en Espacios (`udeaIdentityAdapter`). */
const ESPACIOS = 'e5bac105b1e00000000000000000000b';
/** Existe en la configuración del despliegue y no lo integra nadie: el «no es tuyo». */
const ACADEMICO = 'acade31c0000000000000000000000c1';
/** No existe: el «no está». Tiene que ser indistinguible del anterior. */
const INEXISTENTE = 'f'.repeat(32);

/** Lo que dura una sesión, de `identity.ts`. */
const VIGENCIA_SESION_MS = 12 * 60 * 60 * 1000;

/** Un testigo con la pinta exacta de uno bueno, que no es de nadie. */
const TESTIGO_DE_NADIE = '9'.repeat(64);

describe.skipIf(!env.ok)(`consultas de estado${skipNote(env)}`, () => {
  let e: ApiListo;
  let daniela: { testigo: string; miembroId: string };
  let julian: { testigo: string; miembroId: string };

  beforeAll(async () => {
    e = listo(env);
    daniela = await entrar(e, 'daniela.ocampo@udea.edu.co');
    julian = await entrar(e, 'julian.restrepo@udea.edu.co');
  });

  /**
   * TODO lo que quien pregunta puede observar de una respuesta: el código, el cuerpo y **todas** las
   * cabeceras menos la fecha.
   *
   * Las cabeceras entran a propósito. Un dato que se filtra no tiene por qué ir en el cuerpo: un
   * `set-cookie` que sólo aparece cuando la sesión existió, o una cabecera de diagnóstico añadida
   * con la mejor intención, son un canal igual de bueno para distinguir los casos que aquí tienen
   * que ser indistinguibles. Comparar el cuerpo y nada más dejaría ese hueco abierto.
   */
  function observar(respuesta: {
    readonly statusCode: number;
    readonly headers: Record<string, unknown>;
    readonly body: string;
  }): Record<string, unknown> {
    const { date: _fecha, ...cabeceras } = respuesta.headers;
    return { codigo: respuesta.statusCode, cabeceras, cuerpo: respuesta.body };
  }

  async function observarEstado(
    headers: Record<string, string> = {},
    consulta = '',
  ): Promise<Record<string, unknown>> {
    return observar(await e.app.inject({ method: 'GET', url: `/auth/estado${consulta}`, headers }));
  }

  async function observarAcceso(
    circuloId: string,
    testigo?: string,
    consulta = '',
  ): Promise<Record<string, unknown>> {
    const respuesta = await e.app.inject({
      method: 'GET',
      url: `/circulos/${circuloId}/miembros/acceso${consulta}`,
      ...(testigo === undefined ? {} : { headers: como(testigo) }),
    });
    // Que el cuerpo cumpla el contrato estricto es parte de lo observable: un `motivo` añadido
    // mañana revienta acá antes de que nadie lo compare.
    expect(accesoAMiembros.parse(respuesta.json())).toBeDefined();
    return observar(respuesta);
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // Estado de la sesión
  // ═════════════════════════════════════════════════════════════════════════════════════════════

  it('sin credencial contesta 200 y dice que no hay sesión, en vez de 401', async () => {
    const respuesta = await e.app.inject({ method: 'GET', url: '/auth/estado' });
    expect(respuesta.statusCode).toBe(200);
    // Se valida con el esquema real, no con una forma parecida escrita a mano: si el servidor
    // añadiera un campo, `.strict()` lo convierte en un fallo acá.
    expect(estadoSesion.parse(respuesta.json())).toEqual({ abierta: false });
    expect(respuesta.body).toBe('{"abierta":false}');
  });

  it('con sesión contesta 200 y trae exactamente lo mismo que /auth/yo', async () => {
    const estado = await e.app.inject({
      method: 'GET',
      url: '/auth/estado',
      headers: como(daniela.testigo),
    });
    const yo = await e.app.inject({
      method: 'GET',
      url: '/auth/yo',
      headers: como(daniela.testigo),
    });
    expect(estado.statusCode).toBe(200);
    expect(yo.statusCode).toBe(200);

    const leido = estadoSesion.parse(estado.json());
    expect(leido.abierta).toBe(true);
    // Dos rutas, una sola verdad: la consulta no es una proyección distinta que pueda desviarse.
    if (leido.abierta) expect(leido.sesion).toEqual(yo.json<Sesion>());
  });

  it('/auth/yo NO cambió: sigue siendo 401 sin credencial y la sesión con ella', async () => {
    // La ruta nueva existe para no torcer el significado de ésta. Si alguien «arreglara» también
    // `/auth/yo` para que contestara 200, esta prueba lo dice.
    const sin = await e.app.inject({ method: 'GET', url: '/auth/yo' });
    expect(sin.statusCode).toBe(401);
    expect(sin.json<{ codigo: string }>().codigo).toBe('UNAUTHORIZED_NOT_AUTHENTICATED');

    const con = await e.app.inject({
      method: 'GET',
      url: '/auth/yo',
      headers: como(julian.testigo),
    });
    expect(con.statusCode).toBe(200);
    expect(con.json<Sesion>().miembroId).toBe(julian.miembroId);
  });

  it('no hay manera de preguntar por otra persona: la cadena de consulta no se mira', async () => {
    // No es que se rechace el selector: es que **no existe**. La respuesta depende sólo de la
    // credencial que trae la petición, así que nombrar a alguien no cambia nada.
    const limpia = await observarEstado();
    for (const consulta of [
      '?correo=daniela.ocampo@udea.edu.co',
      `?miembroId=${daniela.miembroId}`,
      '?abierta=true',
      '?_=1755950000000',
    ]) {
      expect(await observarEstado({}, consulta)).toEqual(limpia);
    }

    // Y con credencial propia, nombrar a otra persona tampoco convierte a quien pregunta en ella.
    const suya = await observarEstado(como(julian.testigo));
    expect(await observarEstado(como(julian.testigo), `?miembroId=${daniela.miembroId}`)).toEqual(
      suya,
    );
    expect(suya).not.toEqual(limpia);
  });

  it('la respuesta de sesión no la puede guardar ninguna caché por el camino', async () => {
    // Una respuesta de sesión guardada por un intermediario es la sesión de una persona servida a
    // otra. Ésta la pide todo el mundo en cada carga, incluido quien no ha entrado.
    for (const headers of [{}, como(daniela.testigo)]) {
      const respuesta = await e.app.inject({ method: 'GET', url: '/auth/estado', headers });
      expect(respuesta.headers['cache-control']).toBe('no-store');
    }
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // Acceso a la lista de integrantes
  // ═════════════════════════════════════════════════════════════════════════════════════════════

  it('quien integra el grupo puede, y la colección se lo confirma', async () => {
    const respuesta = await e.app.inject({
      method: 'GET',
      url: `/circulos/${ESPACIOS}/miembros/acceso`,
      headers: como(daniela.testigo),
    });
    expect(respuesta.statusCode).toBe(200);
    expect(accesoAMiembros.parse(respuesta.json())).toEqual({ puedoVer: true });

    // La consulta no promete de más: lo que dice que se puede, se puede de verdad.
    const coleccion = await e.app.inject({
      method: 'GET',
      url: `/circulos/${ESPACIOS}/miembros`,
      headers: como(daniela.testigo),
    });
    expect(coleccion.statusCode).toBe(200);
  });

  it('un grupo ajeno y un grupo inexistente contestan lo mismo, byte a byte', async () => {
    // El corazón de la consulta de capacidad. Si el «no existe» saliera por otro camino, esta ruta
    // sería un detector de grupos; y aunque hoy `GET /circulos` sea público, una consulta que
    // distingue «no está» de «no es tuyo» es exactamente la que mañana filtra lo que sí es privado.
    const ajeno = await observarAcceso(ACADEMICO, daniela.testigo);
    const inexistente = await observarAcceso(INEXISTENTE, daniela.testigo);
    expect(ajeno).toEqual(inexistente);
    expect(ajeno['cuerpo']).toBe('{"puedoVer":false}');

    // Y para quien no ha entrado, los tres casos —incluido el grupo que sí integraría— son iguales.
    const anonimoAjeno = await observarAcceso(ACADEMICO);
    expect(await observarAcceso(INEXISTENTE)).toEqual(anonimoAjeno);
    expect(await observarAcceso(ESPACIOS)).toEqual(anonimoAjeno);
  });

  it('la consulta de acceso tampoco tiene selector: no se pregunta por terceros', async () => {
    const suya = await observarAcceso(ESPACIOS, daniela.testigo);
    expect(
      await observarAcceso(ESPACIOS, daniela.testigo, `?miembroId=${julian.miembroId}`),
    ).toEqual(suya);
    // Y el grupo ajeno no se vuelve visible por nombrar a quien sí lo integraría.
    expect(
      await observarAcceso(ACADEMICO, daniela.testigo, `?miembroId=${daniela.miembroId}`),
    ).toEqual(await observarAcceso(ACADEMICO, daniela.testigo));
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // Consultar no es autorizar
  // ═════════════════════════════════════════════════════════════════════════════════════════════

  it('falsificar el «sí» no sirve de nada: la colección vuelve a decidir', async () => {
    // Quien se invente `{"puedoVer":true}` en el navegador consigue una sola cosa: hacer la llamada
    // de verdad. Acá se hace esa llamada a mano, saltándose cualquier interfaz.
    const acceso = await e.app.inject({
      method: 'GET',
      url: `/circulos/${ACADEMICO}/miembros/acceso`,
      headers: como(julian.testigo),
    });
    expect(acceso.json<{ puedoVer: boolean }>().puedoVer).toBe(false);

    const ajena = await e.app.inject({
      method: 'GET',
      url: `/circulos/${ACADEMICO}/miembros`,
      headers: como(julian.testigo),
    });
    expect(ajena.statusCode).toBe(403);

    const anonima = await e.app.inject({ method: 'GET', url: `/circulos/${ESPACIOS}/miembros` });
    expect(anonima.statusCode).toBe(401);
  });

  it('un «hay sesión» falsificado no abre ninguna operación protegida', async () => {
    // La consulta de sesión no es una credencial ni la sustituye: sin testigo, lo protegido sigue
    // cerrado aunque el cliente jure que hay sesión.
    for (const url of ['/mi/tareas', '/mi/capacidad', '/auth/yo']) {
      const respuesta = await e.app.inject({ method: 'GET', url });
      expect(respuesta.statusCode).toBe(401);
    }
    const escritura = await e.app.inject({
      method: 'POST',
      url: '/problemas',
      payload: {
        requestId: '00000000-0000-4000-8000-0000000000e5',
        titulo: 'Un problema escrito sin haber entrado',
        cuerpo:
          'La consulta de estado dijo que había sesión, pero la escritura no le pregunta a la ' +
          'consulta: le pregunta a la credencial, que no está.',
        circuloId: ESPACIOS,
      },
    });
    expect(escritura.statusCode).toBe(401);
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // Indistinguibilidad. Va al final porque adelanta el reloj y vence lo que hubiera abierto.
  // ═════════════════════════════════════════════════════════════════════════════════════════════

  it('seis maneras de no tener sesión, una sola respuesta', async () => {
    const revocada = await entrar(e, 'sara.velez@udea.edu.co');
    const salida = await e.app.inject({
      method: 'POST',
      url: '/auth/salir',
      headers: como(revocada.testigo),
    });
    expect(salida.statusCode).toBe(200);

    const vencida = await entrar(e, 'tomas.arango@udea.edu.co');
    e.reloj.avanzar(VIGENCIA_SESION_MS + 60_000);

    const maneras: Record<string, Record<string, string>> = {
      'sin nada': {},
      'cookie vacía': { cookie: 'koinonia_sesion=' },
      'cookie inventada': { cookie: 'koinonia_sesion=esto-no-es-un-testigo' },
      'portador inventado': { authorization: 'Bearer esto-tampoco' },
      'testigo de nadie': { authorization: `Bearer ${TESTIGO_DE_NADIE}` },
      'sesión revocada': como(revocada.testigo),
      'sesión vencida': como(vencida.testigo),
    };

    const vistas = new Map<string, Record<string, unknown>>();
    for (const [nombre, headers] of Object.entries(maneras)) {
      vistas.set(nombre, await observarEstado(headers));
    }

    // Se comparan todas contra todas, no contra una constante escrita a mano: lo que importa no es
    // qué contesta, es que **no haya dos respuestas distintas** entre las que elegir para deducir
    // si una cuenta existe, si existió, o si la sesión venció en vez de no haber empezado nunca.
    const referencia = vistas.get('sin nada');
    for (const [nombre, vista] of vistas) {
      expect(vista, `«${nombre}» se distingue de «sin nada»`).toEqual(referencia);
    }
    expect(referencia?.['cuerpo']).toBe('{"abierta":false}');

    // Y la sesión vencida tampoco se distingue en la ruta estricta: allí las siete son 401.
    const yoVencida = await e.app.inject({
      method: 'GET',
      url: '/auth/yo',
      headers: como(vencida.testigo),
    });
    expect(yoVencida.statusCode).toBe(401);
  });
});
