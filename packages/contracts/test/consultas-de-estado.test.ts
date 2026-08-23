/**
 * Las consultas de estado: las dos únicas preguntas que contestan **200 siempre**.
 *
 * ═══ Qué demuestran estas pruebas ═══
 *
 * Una consulta que le contesta 200 a cualquiera es, por definición, una superficie que cualquiera
 * puede interrogar. Sólo es admisible si su respuesta no dice nada que quien pregunta no supiera ya,
 * y eso no se consigue con buena voluntad en el manejador: se consigue con un esquema que **no tenga
 * dónde escribir el dato de más**. De ahí que estas pruebas insistan tanto en el rechazo de campos
 * adicionales, que a primera vista parece pedantería de validación:
 *
 *  · un `motivo` en la respuesta de acceso distinguiría «no pertenecés» de «no existe»;
 *  · un `cuantos` diría el tamaño de un grupo al que no pertenecés;
 *  · un `correo` o un `existe` en la respuesta de sesión convertirían la consulta en el enumerador
 *    de padrón que la pantalla de entrada tiene prohibido ser.
 *
 * Ninguno de esos campos cabe. `.strict()` los convierte en un error de frontera —ruidoso, en la
 * prueba, hoy— en vez de en un campo que alguien añade de buena fe y que el cliente ignora en
 * silencio mientras viaja por la red.
 *
 * La última parte prueba la **secuencia**: con capacidad negativa, la colección protegida no se
 * llega a pedir. No es una prueba de interfaz —no hay navegador acá—, es una prueba de la función
 * que la interfaz ejecuta, con el transporte sustituido por un espía que anota qué se pidió.
 */

import { describe, expect, it } from 'vitest';

import {
  accesoAMiembros,
  estadoSesion,
  miembrosSiPuedo,
  rutaDeAccesoAMiembros,
  rutaDeMiembros,
} from '../src/http.js';

const CIRCULO = 'e5bac105b1e00000000000000000000b';
const MIEMBRO = '0123456789abcdef0123456789abcdef';

const SESION = {
  miembroId: MIEMBRO,
  alias: 'daniela.ocampo',
  roles: ['member'],
  circulos: [CIRCULO],
  expiraEn: 1_800_000_000_000,
};

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Estado de la sesión
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('contrato de la consulta de estado de sesión', () => {
  it('sin sesión hay exactamente un campo, y no cabe ninguno más', () => {
    expect(estadoSesion.parse({ abierta: false })).toEqual({ abierta: false });
    // La clave que no está no aparece como `undefined`: lo que se serializa es un solo campo.
    expect(Object.keys(estadoSesion.parse({ abierta: false }))).toEqual(['abierta']);

    // Los cuatro campos que convertirían esto en un oráculo, uno por uno.
    expect(estadoSesion.safeParse({ abierta: false, motivo: 'la cookie venció' }).success).toBe(
      false,
    );
    expect(estadoSesion.safeParse({ abierta: false, existeLaCuenta: false }).success).toBe(false);
    expect(estadoSesion.safeParse({ abierta: false, correo: 'quien@udea.edu.co' }).success).toBe(
      false,
    );
    expect(estadoSesion.safeParse({ abierta: false, sesion: SESION }).success).toBe(false);
  });

  it('con sesión va la sesión entera, y nada más que la sesión', () => {
    const abierta = { abierta: true, sesion: SESION };
    expect(estadoSesion.parse(abierta)).toEqual(abierta);

    expect(estadoSesion.safeParse({ abierta: true }).success).toBe(false);
    expect(estadoSesion.safeParse({ ...abierta, testigo: 'no-debe-viajar-acá' }).success).toBe(
      false,
    );
  });

  it('la sesión anidada también es estricta: no se cuela un campo por dentro', () => {
    // Ésta es la que se olvida. El envoltorio estricto no sirve de nada si el objeto de dentro
    // acepta lo que le echen: el correo entraría igual, sólo que un nivel más abajo.
    expect(
      estadoSesion.safeParse({
        abierta: true,
        sesion: { ...SESION, correo: 'daniela.ocampo@udea.edu.co' },
      }).success,
    ).toBe(false);
    expect(
      estadoSesion.safeParse({ abierta: true, sesion: { ...SESION, semestre: 7 } }).success,
    ).toBe(false);
  });

  it('exige la sesión completa y bien formada, no una parecida', () => {
    for (const campo of ['miembroId', 'alias', 'roles', 'circulos', 'expiraEn'] as const) {
      const incompleta = Object.fromEntries(
        Object.entries(SESION).filter(([clave]) => clave !== campo),
      );
      expect(estadoSesion.safeParse({ abierta: true, sesion: incompleta }).success).toBe(false);
    }
    expect(
      estadoSesion.safeParse({ abierta: true, sesion: { ...SESION, roles: ['dueño'] } }).success,
    ).toBe(false);
    expect(
      estadoSesion.safeParse({ abierta: true, sesion: { ...SESION, miembroId: 'daniela' } })
        .success,
    ).toBe(false);
  });

  it('el discriminante no admite disfraces ni una tercera respuesta', () => {
    expect(estadoSesion.safeParse({}).success).toBe(false);
    expect(estadoSesion.safeParse({ abierta: 'false' }).success).toBe(false);
    expect(estadoSesion.safeParse({ abierta: 0 }).success).toBe(false);
    expect(estadoSesion.safeParse({ abierta: null }).success).toBe(false);
    // «No sé» no existe: o hay sesión o no la hay. Un tercer estado sería justo el sitio donde
    // cabría «hay cuenta pero no sesión», que es lo que no se puede decir.
    expect(estadoSesion.safeParse({ abierta: 'quizás' }).success).toBe(false);
    expect(estadoSesion.options).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Acceso a la lista de integrantes
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('contrato de la consulta de acceso a integrantes', () => {
  it('un esquema y un booleano: las dos respuestas son indistinguibles en forma', () => {
    expect(accesoAMiembros.parse({ puedoVer: true })).toEqual({ puedoVer: true });
    expect(accesoAMiembros.parse({ puedoVer: false })).toEqual({ puedoVer: false });
    expect(Object.keys(accesoAMiembros.parse({ puedoVer: true }))).toEqual(
      Object.keys(accesoAMiembros.parse({ puedoVer: false })),
    );
  });

  it('no hay dónde escribir el motivo, el conteo ni la existencia', () => {
    for (const demas of [
      { motivo: 'no integrás este grupo' },
      { motivo: 'ese grupo no existe' },
      { existe: false },
      { cuantos: 12 },
      { roles: ['facilitator'] },
      { circuloId: CIRCULO },
    ]) {
      expect(accesoAMiembros.safeParse({ puedoVer: false, ...demas }).success).toBe(false);
    }
  });

  it('rechaza el booleano ausente o disfrazado de otra cosa', () => {
    expect(accesoAMiembros.safeParse({}).success).toBe(false);
    expect(accesoAMiembros.safeParse({ puedoVer: 'sí' }).success).toBe(false);
    expect(accesoAMiembros.safeParse({ puedoVer: 1 }).success).toBe(false);
    expect(accesoAMiembros.safeParse({ puedeVer: true }).success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// La secuencia: preguntar antes de pedir
// ═══════════════════════════════════════════════════════════════════════════════════════════════

interface Espia {
  readonly traer: <T>(ruta: string) => Promise<T>;
  readonly pedidas: readonly string[];
}

/**
 * Transporte de mentira que anota, en orden, cada ruta que se le pide.
 *
 * Lo que no esté en el mapa **se rechaza**, igual que haría la colección protegida contestando 401
 * o 403: el cliente real convierte esas respuestas en una excepción.
 */
function espiar(respuestas: Readonly<Record<string, unknown>>): Espia {
  const pedidas: string[] = [];
  return {
    pedidas,
    traer: <T>(ruta: string): Promise<T> => {
      pedidas.push(ruta);
      return Object.prototype.hasOwnProperty.call(respuestas, ruta)
        ? Promise.resolve(respuestas[ruta] as T)
        : Promise.reject(new Error(`el servidor rechaza ${ruta}`));
    },
  };
}

const ACCESO = rutaDeAccesoAMiembros(CIRCULO);
const COLECCION = rutaDeMiembros(CIRCULO);

describe('la interfaz pregunta antes de pedir la colección protegida', () => {
  it('la consulta de estado cuelga de la colección, no al revés', () => {
    expect(COLECCION).toBe(`/circulos/${CIRCULO}/miembros`);
    expect(ACCESO).toBe(`${COLECCION}/acceso`);
  });

  it('con acceso negativo NO se llega a pedir la colección protegida', async () => {
    // El espía no tiene preparada la colección: si se pidiera, esto reventaría. Pero no se deja a
    // que reviente —se comprueba la lista entera de rutas pedidas, que es la afirmación real—.
    const espia = espiar({ [ACCESO]: { puedoVer: false } });
    await expect(miembrosSiPuedo(CIRCULO, espia.traer)).resolves.toBeUndefined();
    expect(espia.pedidas).toEqual([ACCESO]);
    expect(espia.pedidas).not.toContain(COLECCION);
  });

  it('con acceso afirmativo pide la colección, y en ese orden', async () => {
    const lista = [{ id: MIEMBRO, alias: 'daniela.ocampo' }];
    const espia = espiar({ [ACCESO]: { puedoVer: true }, [COLECCION]: lista });
    await expect(miembrosSiPuedo(CIRCULO, espia.traer)).resolves.toEqual(lista);
    expect(espia.pedidas).toEqual([ACCESO, COLECCION]);
  });

  it('una respuesta de acceso que no cumple el contrato es un fallo, no un sí', async () => {
    // Un cuerpo vacío tiene `puedoVer` indefinido, que en JavaScript es falso «por suerte». Acá no
    // se depende de esa suerte: se valida, revienta, y la colección tampoco se pide.
    const espia = espiar({ [ACCESO]: {}, [COLECCION]: [] });
    await expect(miembrosSiPuedo(CIRCULO, espia.traer)).rejects.toThrow();
    expect(espia.pedidas).toEqual([ACCESO]);
  });

  it('un «sí» falsificado en el transporte llega hasta la colección, y allí decide el servidor', async () => {
    // Ésta es la prueba de que la consulta NO autoriza: si alguien fabrica el 200 afirmativo en el
    // cliente, lo único que consigue es hacer la llamada de verdad. Lo que conteste la colección lo
    // decide el servidor —acá, el transporte la rechaza; en `tests/integration` se comprueba contra
    // la aplicación real que lo que contesta es 401 o 403—.
    const espia = espiar({ [ACCESO]: { puedoVer: true } });
    await expect(miembrosSiPuedo(CIRCULO, espia.traer)).rejects.toThrow();
    expect(espia.pedidas).toEqual([ACCESO, COLECCION]);
  });
});
