import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { apiEnv, como, entrar, FACILITADORA, listo, planDe, skipNote } from './helpers/api-env.js';
import type { ApiListo } from './helpers/api-env.js';

/**
 * El proceso de consejo, de punta a punta y por HTTP.
 *
 * ═══ Por qué esta prueba existe además de las del motor ═══
 *
 * Porque el fallo que se repitió tres veces esta semana no fue nunca de una pieza: fue de la
 * costura. El paquete verificable que ninguna ruta servía, las purgas que nadie llamaba, el permiso
 * que faltaba para una purga que la propia migración daba por hecha. Cada mitad probada, y entre
 * ellas la única pregunta que importa sin contestar.
 *
 * `packages/domain/test/tally-advice-process.test.ts` prueba el escrutinio. Esto prueba que se
 * pueda ABRIR, ACONSEJAR, DECIDIR y CERRAR contra la aplicación entera y una base de verdad — que
 * es lo que hace que el método exista para una persona y no sólo en el repositorio.
 *
 * ═══ Y por qué este método SÍ se puede abrir ═══
 *
 * Los otros cuatro que faltaban del pliego —puntuación, rondas, menciones, pares— comparan opciones
 * entre sí, y `abrirDecision` congela una sola: la propuesta. Con una sola opción «cuál gana» no es
 * una pregunta, y el motor los rechaza (`MULTI_METHOD_NEEDS_TWO_OPTIONS`). El proceso de consejo
 * decide SOBRE esa única propuesta, que es exactamente lo que tiene delante. Por eso es el que se
 * construyó, y por eso lleva a seis los métodos abribles.
 */

const env = await apiEnv();

afterAll(async () => {
  if (env.ok) await env.stop();
});

// «Espacios y Bienestar», el mismo círculo al que pertenece quien entra por el camino normal —
// es el que usan las demás pruebas de integración por esa razón.
const CIRCULO = 'e5bac105b1e00000000000000000000b';
let contador = 0;
function req(): string {
  const hex = (++contador + 0xc000).toString(16).padStart(32, '0');
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-` +
    `8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  );
}

describe.skipIf(!env.ok)(`proceso de consejo por HTTP${skipNote(env)}`, () => {
  let e: ApiListo;
  let facilitadora: { testigo: string; miembroId: string };
  let gente: readonly { testigo: string; miembroId: string }[];
  let decisionId = '';
  let huellaVersion = '';
  let propuestaId = '';

  beforeAll(async () => {
    e = listo(env);
    // El describe de otros ficheros gasta el cupo de enlace de FACILITADORA dentro de la hora.
    e.reloj.avanzar(2 * 60 * 60 * 1000);
    facilitadora = await entrar(e, FACILITADORA);
    gente = await Promise.all(
      [
        'consejo.uno@udea.edu.co',
        'consejo.dos@udea.edu.co',
        'consejo.tres@udea.edu.co',
        'consejo.cuatro@udea.edu.co',
      ].map((correo) => entrar(e, correo)),
    );
  });

  it('se abre: decide quien la abre, y hacen falta tres consejos', async () => {
    const autor = gente[0];
    if (autor === undefined) throw new Error('falta autor');

    const problema = await e.app.inject({
      method: 'POST',
      url: '/problemas',
      headers: como(autor.testigo),
      payload: {
        requestId: req(),
        titulo: 'Con qué programa se llevan las actas',
        cuerpo: 'Hoy cada quien usa lo suyo y después nadie encuentra nada. Hay que elegir uno.',
        circuloId: CIRCULO,
      },
    });
    expect(problema.statusCode, problema.body).toBe(201);

    const propuesta = await e.app.inject({
      method: 'POST',
      url: '/propuestas',
      headers: como(autor.testigo),
      payload: {
        requestId: req(),
        problemaId: problema.json<{ id: string }>().id,
        titulo: 'Usar el mismo programa de actas para todo el Instituto',
        cuerpo: 'La propuesta concreta: que las actas se lleven todas en el mismo sitio.',
        plan: planDe(autor.miembroId),
      },
    });
    expect(propuesta.statusCode, propuesta.body).toBe(201);
    propuestaId = propuesta.json<{ id: string }>().id;

    const decision = await e.app.inject({
      method: 'POST',
      url: '/decisiones',
      headers: como(facilitadora.testigo),
      payload: {
        requestId: req(),
        propuestaId,
        metodo: 'advice-process',
        duracionHoras: 1,
        configuracion: { metodo: 'advice-process', consejosMinimos: 3 },
      },
    });
    expect(decision.statusCode, decision.body).toBe(201);
    const cuerpo = decision.json<{ id: string; huellaVersion: string; metodo: string }>();
    expect(cuerpo.metodo).toBe('advice-process');
    decisionId = cuerpo.id;
    huellaVersion = cuerpo.huellaVersion;
  });

  it('la pantalla de quien decide dice que decide, y cuántos consejos faltan', async () => {
    const vista = await e.app.inject({
      method: 'GET',
      url: `/decisiones/${decisionId}`,
      headers: como(facilitadora.testigo),
    });
    const consejo = vista.json<{
      procesoDeConsejo?: { decidoYo: boolean; consejosMinimos: number; consejosDados: number };
    }>().procesoDeConsejo;

    expect(consejo).toBeDefined();
    expect(consejo?.decidoYo).toBe(true);
    expect(consejo?.consejosMinimos).toBe(3);
    expect(consejo?.consejosDados).toBe(0);
  });

  it('a quien NO decide le dice que no, y no le deja emitir la decisión', async () => {
    const otra = gente[1];
    if (otra === undefined) throw new Error('falta persona');

    const vista = await e.app.inject({
      method: 'GET',
      url: `/decisiones/${decisionId}`,
      headers: como(otra.testigo),
    });
    expect(
      vista.json<{ procesoDeConsejo?: { decidoYo: boolean } }>().procesoDeConsejo?.decidoYo,
    ).toBe(false);

    /*
     * Y el servidor lo impide, no sólo la pantalla. Es la misma doctrina que la guarda de los
     * métodos comparativos: una regla que sólo aplica el navegador es una sugerencia, y quien llame
     * a la API se la salta.
     */
    const intento = await e.app.inject({
      method: 'POST',
      url: `/decisiones/${decisionId}/papeletas`,
      headers: como(otra.testigo),
      payload: {
        requestId: req(),
        huellaVersion,
        respuesta: { tipo: 'binary', aprueba: true },
      },
    });
    expect(intento.statusCode, intento.body).toBe(422);
    // El prefijo  lo pone `InvalidBallotError`, igual que `CONFIG_` en los de configuración.
    expect(intento.json<{ codigo: string }>().codigo).toBe('BALLOT_NOT_THE_DECIDER');
  });

  it('un consejo sin razones se rechaza en la frontera', async () => {
    const otra = gente[1];
    if (otra === undefined) throw new Error('falta persona');
    const corto = await e.app.inject({
      method: 'POST',
      url: `/decisiones/${decisionId}/papeletas`,
      headers: como(otra.testigo),
      payload: {
        requestId: req(),
        huellaVersion,
        respuesta: { tipo: 'advice', postura: 'a-favor', razones: 'me parece bien' },
      },
    });
    expect(corto.statusCode, corto.body).toBe(400);
  });

  it('tres personas aconsejan y el contador lo refleja', async () => {
    const posturas = ['a-favor', 'en-contra', 'matiz'] as const;
    for (const [i, postura] of posturas.entries()) {
      const quien = gente[i + 1];
      if (quien === undefined) throw new Error('falta persona');
      const res = await e.app.inject({
        method: 'POST',
        url: `/decisiones/${decisionId}/papeletas`,
        headers: como(quien.testigo),
        payload: {
          requestId: req(),
          huellaVersion,
          respuesta: {
            tipo: 'advice',
            postura,
            razones:
              'Lo pensé con calma y esto es lo que me parece, con razones de sobra para que cuente.',
          },
        },
      });
      expect(res.statusCode, `${postura}: ${res.body}`).toBe(201);
    }

    const vista = await e.app.inject({
      method: 'GET',
      url: `/decisiones/${decisionId}`,
      headers: como(facilitadora.testigo),
    });
    expect(
      vista.json<{ procesoDeConsejo?: { consejosDados: number } }>().procesoDeConsejo
        ?.consejosDados,
    ).toBe(3);
  });

  it('quien decide resuelve EN CONTRA de los consejos, y el cierre lo respeta', async () => {
    /*
     * Dos aconsejaron a favor o con matices y una en contra; quien decide dice que no. Si el cierre
     * saliera «aprobada» porque el consejo mayoritario era favorable, esto sería una votación con
     * pasos de más — que es exactamente lo que este método NO es.
     */
    const decide = await e.app.inject({
      method: 'POST',
      url: `/decisiones/${decisionId}/papeletas`,
      headers: como(facilitadora.testigo),
      payload: { requestId: req(), huellaVersion, respuesta: { tipo: 'binary', aprueba: false } },
    });
    expect(decide.statusCode, decide.body).toBe(201);

    e.reloj.avanzar(2 * 60 * 60 * 1000);
    facilitadora = await entrar(e, FACILITADORA);

    const cierre = await e.app.inject({
      method: 'POST',
      url: `/decisiones/${decisionId}/cerrar`,
      headers: como(facilitadora.testigo),
      payload: { requestId: req() },
    });
    expect(cierre.statusCode, cierre.body).toBe(200);

    const resultado = cierre.json<{ desenlace: string; relato: string; tablas: unknown[] }>();
    expect(resultado.desenlace).toBe('rejected');
    // Y el relato dice por qué, en palabras: que el consejo no ata es la mitad del método.
    expect(resultado.relato).toContain('El consejo no ata');
    // La tabla de quién aconsejó sale con nombres, no con identificadores de 32 hex.
    expect(JSON.stringify(resultado.tablas)).not.toMatch(/[0-9a-f]{32}/u);
  });

  it('CONSENSO de punta a punta: nadie bloquea pero se apartan demasiados', async () => {
    /*
     * El otro método que faltaba del pliego, en el caso que lo define. Cuatro se manifiestan: dos
     * de acuerdo y dos apartándose. Nadie bloquea — con `sociocratic-consent` esto pasaría — y acá
     * NO pasa, porque la mitad se apartó y el tope es un cuarto. Ésa es la diferencia entera entre
     * los dos métodos, ejecutada contra la aplicación y una base de verdad.
     */
    const autor = gente[0];
    if (autor === undefined) throw new Error('falta autor');
    e.reloj.avanzar(24 * 60 * 60 * 1000);
    facilitadora = await entrar(e, FACILITADORA);
    const votantes = await Promise.all(
      gente.map((_, i) =>
        entrar(e, `consejo.${['uno', 'dos', 'tres', 'cuatro'][i] ?? 'uno'}@udea.edu.co`),
      ),
    );

    const problema = await e.app.inject({
      method: 'POST',
      url: '/problemas',
      headers: como(votantes[0]?.testigo ?? ''),
      payload: {
        requestId: req(),
        titulo: 'Cómo se reparten los turnos de la sala',
        cuerpo: 'Los turnos se reparten como se puede y siempre hay alguien que queda por fuera.',
        circuloId: CIRCULO,
      },
    });
    expect(problema.statusCode, problema.body).toBe(201);

    const propuesta = await e.app.inject({
      method: 'POST',
      url: '/propuestas',
      headers: como(votantes[0]?.testigo ?? ''),
      payload: {
        requestId: req(),
        problemaId: problema.json<{ id: string }>().id,
        titulo: 'Repartir los turnos por sorteo cada semestre',
        cuerpo: 'La propuesta concreta: que los turnos se sorteen al empezar cada semestre.',
        plan: planDe(votantes[0]?.miembroId ?? ''),
      },
    });
    expect(propuesta.statusCode, propuesta.body).toBe(201);

    const decision = await e.app.inject({
      method: 'POST',
      url: '/decisiones',
      headers: como(facilitadora.testigo),
      payload: {
        requestId: req(),
        propuestaId: propuesta.json<{ id: string }>().id,
        metodo: 'consensus',
        duracionHoras: 1,
      },
    });
    expect(decision.statusCode, decision.body).toBe(201);
    const abierta = decision.json<{ id: string; huellaVersion: string; metodo: string }>();
    expect(abierta.metodo).toBe('consensus');

    // Apartarse SIN motivo se rechaza: sin decir de qué, no queda constancia de nada.
    const sinMotivo = await e.app.inject({
      method: 'POST',
      url: `/decisiones/${abierta.id}/papeletas`,
      headers: como(votantes[2]?.testigo ?? ''),
      payload: {
        requestId: req(),
        huellaVersion: abierta.huellaVersion,
        respuesta: { tipo: 'consensus', postura: 'me-aparto' },
      },
    });
    expect(sinMotivo.statusCode, sinMotivo.body).toBe(422);

    const posturas = ['de-acuerdo', 'de-acuerdo', 'me-aparto', 'me-aparto'] as const;
    for (const [i, p] of posturas.entries()) {
      const quien = votantes[i];
      if (quien === undefined) throw new Error('falta persona');
      const res = await e.app.inject({
        method: 'POST',
        url: `/decisiones/${abierta.id}/papeletas`,
        headers: como(quien.testigo),
        payload: {
          requestId: req(),
          huellaVersion: abierta.huellaVersion,
          respuesta:
            p === 'me-aparto'
              ? {
                  tipo: 'consensus',
                  postura: p,
                  razon:
                    'No lo voy a impedir pero no lo apoyo, y quiero que quede escrito por qué no.',
                }
              : { tipo: 'consensus', postura: p },
        },
      });
      expect(res.statusCode, `${p}: ${res.body}`).toBe(201);
    }

    e.reloj.avanzar(2 * 60 * 60 * 1000);
    facilitadora = await entrar(e, FACILITADORA);
    const cierre = await e.app.inject({
      method: 'POST',
      url: `/decisiones/${abierta.id}/cerrar`,
      headers: como(facilitadora.testigo),
      payload: { requestId: req() },
    });
    expect(cierre.statusCode, cierre.body).toBe(200);

    const resultado = cierre.json<{ desenlace: string; relato: string }>();
    expect(resultado.desenlace).toBe('rejected');
    // Y lo dice como lo que es: así no, no que no. Se reformula, no se acata.
    expect(resultado.relato).toContain('No es un rechazo');
  });
});
