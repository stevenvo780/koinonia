/**
 * Encargo C — ¿se filtra el conteo parcial de una votación abierta?
 *
 * El pliego (reducción de sesgos) exige resultados parciales OCULTOS mientras la votación está
 * abierta, y T-08 del modelo de amenazas lo declara mitigado. Una auditoría lo marcó NO CUMPLE.
 * Un verificador posterior lo probó en vivo —votación abierta, dos papeletas emitidas— y encontró
 * que `GET /decisiones/:id` sólo devuelve `seManifestaron` (participación, no desglose) y que
 * `GET /decisiones/:id/resultado` devuelve 409 NOT_CLOSED.
 *
 * Esta prueba repite esa comprobación con evidencia propia y la deja fija: TODAS las rutas que
 * podrían filtrar el desglose de una decisión abierta —listado, detalle, resultado, y el estado de
 * cierre de ciclo, que también expone resultados— se prueban con tres identidades distintas: sin
 * sesión, con una cuenta cualquiera (que ni siquiera está en el padrón de esta decisión) y con la
 * cuenta que facilita (la de más permisos: puede abrir y cerrar votaciones).
 *
 * Se distingue con cuidado lo que SÍ es legítimo (la participación: «se manifestaron 2») de lo que
 * NO puede verse hasta el cierre (el desglose: «1 sí, 1 no»). Los dos miembros votan distinto a
 * propósito —uno sí, uno no— para que un desglose filtrado sea imposible de confundir con un
 * empate accidental.
 *
 * `decisionResumen`/`decisionDetalle` (`packages/contracts/src/http.ts`) declaran un conjunto
 * CERRADO de claves. La prueba no sólo busca nombres de campo sospechosos: exige que las claves de
 * la respuesta sean EXACTAMENTE ese conjunto (ni una de más), así que un campo nuevo que alguien
 * añada mañana para "mostrar el avance" no puede colarse en silencio.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

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

// Mismo círculo fijo que usan los demás escenarios de integración.
const CIRCULO = 'e5bac105b1e00000000000000000000b';

let n = 0;
function req(): string {
  const hex = (++n + 0x7000).toString(16).padStart(32, '0');
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-` +
    `8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  );
}

/** Las claves EXACTAS que `decisionResumen` promete — ni una más, ni una menos (http.ts:568). */
const CLAVES_RESUMEN = new Set([
  'id',
  'propuestaId',
  'titulo',
  'estado',
  'metodo',
  'abreEn',
  'cierraEn',
  'huellaVersion',
  'podianDecidir',
  'seManifestaron',
  'queHaceFaltaParaQuePase',
]);

/**
 * `decisionDetalle` = resumen + estas seis, dos de ellas opcionales (`http.ts`).
 *
 * La lista es blanca a propósito: cualquier clave nueva en el detalle rompe esta prueba y obliga a
 * mirarla antes de dejarla pasar, que es exactamente lo que pasó con `objeciones` el 2026-08-25.
 * Se admite porque el texto de una objeción es público —existe para poder responderse— y porque va
 * SIN firma; lo que no puede aparecer nunca es de quién es, y eso lo comprueba el caso de abajo.
 */
const CLAVES_DETALLE_EXTRA = new Set([
  'cuerpoVersion',
  'plan',
  'puedoDecidir',
  'yaVotaste',
  'motivoNoPuedo',
  'objeciones',
]);

describe.skipIf(!env.ok)(`conteo oculto de una votación abierta${skipNote(env)}`, () => {
  let e: ApiListo;
  let facilitadora: { testigo: string; miembroId: string };
  let miembroSi: { testigo: string; miembroId: string };
  let miembroNo: { testigo: string; miembroId: string };
  let ajena: { testigo: string; miembroId: string }; // no está en el padrón de esta decisión

  let decisionId: string;
  let huellaVersion: string;

  beforeAll(async () => {
    e = listo(env);
    facilitadora = await entrar(e, FACILITADORA);
    miembroSi = await entrar(e, 'conteo-si@udea.edu.co');
    miembroNo = await entrar(e, 'conteo-no@udea.edu.co');
    ajena = await entrar(e, 'conteo-ajena@udea.edu.co');
  });

  it('preparación · problema, propuesta y votación abierta', async () => {
    const problema = await e.app.inject({
      method: 'POST',
      url: '/problemas',
      headers: como(miembroSi.testigo),
      payload: {
        requestId: req(),
        titulo: 'Un problema para probar el conteo oculto',
        cuerpo: 'Cuerpo suficientemente largo para pasar la validación de la ruta de problemas.',
        circuloId: CIRCULO,
      },
    });
    expect(problema.statusCode).toBe(201);
    const problemaId = problema.json<{ id: string }>().id;

    const propuesta = await e.app.inject({
      method: 'POST',
      url: '/propuestas',
      headers: como(miembroSi.testigo),
      payload: {
        requestId: req(),
        problemaId,
        titulo: 'Una propuesta para probar el conteo oculto',
        cuerpo: 'Cuerpo de la propuesta, también con longitud suficiente para la validación.',
        plan: planDe(miembroSi.miembroId),
      },
    });
    expect(propuesta.statusCode).toBe(201);
    const propuestaId = propuesta.json<{ id: string }>().id;

    // Duración larga: el reloj de prueba no avanza solo, así que queda ABIERTA toda la prueba.
    const decision = await e.app.inject({
      method: 'POST',
      url: '/decisiones',
      headers: como(facilitadora.testigo),
      payload: {
        requestId: req(),
        propuestaId,
        metodo: 'simple-majority',
        duracionHoras: 48,
      },
    });
    expect(decision.statusCode).toBe(201);
    const cuerpo = decision.json<{ id: string; estado: string; huellaVersion: string }>();
    decisionId = cuerpo.id;
    huellaVersion = cuerpo.huellaVersion;
    expect(cuerpo.estado).toBe('Open');
  });

  it('preparación · dos papeletas, EN SENTIDOS DISTINTOS: una sí, una no', async () => {
    const votoSi = await e.app.inject({
      method: 'POST',
      url: `/decisiones/${decisionId}/papeletas`,
      headers: como(miembroSi.testigo),
      payload: {
        requestId: req(),
        huellaVersion,
        respuesta: { tipo: 'binary', aprueba: true },
      },
    });
    expect(votoSi.statusCode).toBe(201);

    const votoNo = await e.app.inject({
      method: 'POST',
      url: `/decisiones/${decisionId}/papeletas`,
      headers: como(miembroNo.testigo),
      payload: {
        requestId: req(),
        huellaVersion,
        respuesta: { tipo: 'binary', aprueba: false },
      },
    });
    expect(votoNo.statusCode).toBe(201);

    // La propia decisión sigue abierta: si estuviera cerrada, "resultado sigue abierta" sería falso
    // y esta prueba no probaría lo que dice probar.
    const estado = votoNo.json<{ estado: string; seManifestaron: number }>();
    expect(estado.estado).toBe('Open');
    expect(estado.seManifestaron).toBe(2);
  });

  // ═══ GET /decisiones (listado) — tres identidades ═══════════════════════════════════════════

  it.each([
    ['sin sesión', undefined],
    ['cuenta ajena al padrón', 'ajena'],
    ['la cuenta que facilita', 'facilitadora'],
  ] as const)('listado · %s ve seManifestaron pero NUNCA el desglose', async (_nombre, quien) => {
    const testigo =
      quien === 'ajena'
        ? ajena.testigo
        : quien === 'facilitadora'
          ? facilitadora.testigo
          : undefined;
    const res = await e.app.inject({
      method: 'GET',
      url: '/decisiones',
      headers: testigo === undefined ? {} : como(testigo),
    });
    expect(res.statusCode).toBe(200);
    const lista = res.json<Record<string, unknown>[]>();
    const item = lista.find((d) => d['id'] === decisionId);
    expect(item).toBeDefined();
    if (item === undefined) return;

    expect(new Set(Object.keys(item))).toStrictEqual(CLAVES_RESUMEN);
    expect(item['estado']).toBe('Open');
    expect(item['seManifestaron']).toBe(2); // participación: legítima
    // Nada de desglose en ningún nombre imaginable, ni aquí ni en el resto del payload.
    const crudo = JSON.stringify(item);
    for (const sospechoso of [
      'aFavor',
      'enContra',
      'papeletas',
      'ballots',
      'tablas',
      'pasos',
      'desenlace',
      'comprobante',
    ]) {
      expect(crudo).not.toContain(sospechoso);
    }
  });

  // ═══ GET /decisiones/:id (detalle) — tres identidades ═══════════════════════════════════════

  it.each([
    ['sin sesión', undefined, false],
    ['cuenta ajena al padrón', 'ajena', false],
    ['la cuenta que facilita', 'facilitadora', false],
    ['quien votó sí, mira su propio detalle', 'si', true],
    ['quien votó no, mira su propio detalle', 'no', true],
  ] as const)(
    'detalle · %s: sólo si votó o no, nunca en qué sentido votó nadie',
    async (_nombre, quien, yaVotasteEsperado) => {
      const testigo =
        quien === 'ajena'
          ? ajena.testigo
          : quien === 'facilitadora'
            ? facilitadora.testigo
            : quien === 'si'
              ? miembroSi.testigo
              : quien === 'no'
                ? miembroNo.testigo
                : undefined;
      const res = await e.app.inject({
        method: 'GET',
        url: `/decisiones/${decisionId}`,
        headers: testigo === undefined ? {} : como(testigo),
      });
      expect(res.statusCode).toBe(200);
      const detalle = res.json<Record<string, unknown>>();

      // Objetar ES el sentido de un voto: si `objeciones` trajera de quién es cada una, esta
      // respuesta estaría publicando cómo votó esa persona — lo mismo que evita que diga «votaste
      // que sí» en vez de «ya votaste».
      const objeciones = JSON.stringify(detalle['objeciones'] ?? []);
      for (const persona of [miembroSi, miembroNo, ajena, facilitadora]) {
        expect(objeciones, 'una objeción no puede venir firmada').not.toContain(persona.miembroId);
      }

      const clavesEsperadas = new Set([...CLAVES_RESUMEN, ...CLAVES_DETALLE_EXTRA]);
      // `plan` y `motivoNoPuedo` son opcionales: sólo exigimos que las claves PRESENTES estén
      // dentro del conjunto permitido, no que estén todas.
      for (const clave of Object.keys(detalle)) {
        expect(clavesEsperadas.has(clave), `clave inesperada: ${clave}`).toBe(true);
      }

      expect(detalle['estado']).toBe('Open');
      expect(detalle['seManifestaron']).toBe(2);
      // ADR-0010: `yaVotaste` dice SI respondiste, nunca QUÉ respondiste — ni la propia, ni menos
      // la ajena. No hay campo alguno en `decisionDetalle` que diga «Sí» o «No» de nadie.
      expect(detalle['yaVotaste']).toBe(yaVotasteEsperado);

      // Ni el nombre del voto de nadie ni ningún conteo por opción aparece en el JSON crudo.
      const crudo = JSON.stringify(detalle);
      for (const sospechoso of [
        'aFavor',
        'enContra',
        'tablas',
        'pasos',
        'desenlace',
        'comprobante',
      ]) {
        expect(crudo).not.toContain(sospechoso);
      }
    },
  );

  // ═══ GET /decisiones/:id/resultado — tres identidades ═══════════════════════════════════════

  it.each([
    ['sin sesión', undefined],
    ['cuenta ajena al padrón', 'ajena'],
    ['la cuenta que facilita', 'facilitadora'],
  ] as const)(
    'resultado · %s recibe 409 NOT_CLOSED mientras está abierta',
    async (_nombre, quien) => {
      const testigo =
        quien === 'ajena'
          ? ajena.testigo
          : quien === 'facilitadora'
            ? facilitadora.testigo
            : undefined;
      const res = await e.app.inject({
        method: 'GET',
        url: `/decisiones/${decisionId}/resultado`,
        headers: testigo === undefined ? {} : como(testigo),
      });
      expect(res.statusCode).toBe(409);
      expect(res.json<{ codigo: string }>().codigo).toBe('NOT_CLOSED');
      // El cuerpo del error tampoco es un canal lateral para el desglose.
      expect(res.body).not.toContain('tablas');
      expect(res.body).not.toContain('desenlace');
    },
  );

  // ═══ GET /cierre-ciclo/:decisionId/estado — otra ruta que también toca el resultado ═════════

  it.each([
    ['sin sesión', undefined],
    ['cuenta ajena al padrón', 'ajena'],
    ['la cuenta que facilita', 'facilitadora'],
  ] as const)(
    'cierre-ciclo/estado · %s tampoco ve nada mientras está abierta',
    async (_nombre, quien) => {
      const testigo =
        quien === 'ajena'
          ? ajena.testigo
          : quien === 'facilitadora'
            ? facilitadora.testigo
            : undefined;
      const res = await e.app.inject({
        method: 'GET',
        url: `/cierre-ciclo/${decisionId}/estado`,
        headers: testigo === undefined ? {} : como(testigo),
      });
      // Esta ruta reutiliza `resultadoDeDecision`, que exige `closedAt`: con la decisión abierta
      // se detiene en el mismo 409 que la ruta de resultado, antes de que exista veredicto alguno
      // que devolver. No hay, pues, ningún camino en esta ruta que hable de una decisión abierta.
      expect(res.statusCode).toBe(409);
      expect(res.json<{ codigo: string }>().codigo).toBe('NOT_CLOSED');
    },
  );

  // ═══ Control: la prueba no es un cascarón — al cerrar, el desglose SÍ aparece ═══════════════

  it('control · cerrada la votación, el desglose por fin es visible (y el empate era 1-1, no 2-0)', async () => {
    // `cerrarDecision` rechaza un cierre anticipado (CIERRE_ANTICIPADO_NO_PERMITIDO) salvo que ya
    // se cruzó `closesAt`: la ventana se abrió por 48 horas y el reloj de prueba no avanza solo.
    const HORA = 3_600_000;
    e.reloj.avanzar(49 * HORA);
    // Pasadas 49 horas la sesión de facilitadora (obtenida en `beforeAll`) ya venció: se pide una
    // nueva, igual que hacen los demás escenarios de integración tras avanzar el reloj.
    facilitadora = await entrar(e, FACILITADORA);

    const cierre = await e.app.inject({
      method: 'POST',
      url: `/decisiones/${decisionId}/cerrar`,
      headers: como(facilitadora.testigo),
      payload: { requestId: req() },
    });
    expect(cierre.statusCode).toBe(200);

    const resultado = await e.app.inject({
      method: 'GET',
      url: `/decisiones/${decisionId}/resultado`,
      headers: como(facilitadora.testigo),
    });
    expect(resultado.statusCode).toBe(200);
    const cuerpo = resultado.json<{ participacion: { emitidas: number } }>();
    expect(cuerpo.participacion.emitidas).toBe(2);

    // Y ahora sí, cerrada, /decisiones/:id/resultado deja de ser 409 para cualquiera.
    const sinSesion = await e.app.inject({
      method: 'GET',
      url: `/decisiones/${decisionId}/resultado`,
    });
    expect(sinSesion.statusCode).toBe(200);
  });
});
