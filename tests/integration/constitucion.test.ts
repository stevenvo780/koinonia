/**
 * La constitución digital, de punta a punta y contra PostgreSQL de verdad.
 *
 * Cuatro cosas se miden aquí y ninguna se puede medir con un doble:
 *
 *  1. **La ida y vuelta del codificador es fiel.** Lo que vuelve del ledger produce el mismo texto
 *     versionado que se escribió; si perdiera un campo, el pliegue de la lectura fallaría.
 *  2. **El texto de una versión histórica se recupera y su huella sigue cuadrando.** Tras la
 *     reforma, la versión 1 conserva su letra, y el SHA-256 de esa letra es exactamente el que el
 *     hecho fundacional dejó escrito en el historial. Se recomputa aquí, con `node:crypto`, sin
 *     preguntarle a la aplicación.
 *  3. **La autorización se revalida al RELEER**, no sólo en la orden. Se fabrica en la base una
 *     aprobación de Garantías atribuida a quien no la puso —el movimiento del adversario nº 2, que
 *     no entra por la API— y leer las normas deja de funcionar, con el motivo exacto.
 *  4. **`tech-admin` no puede ninguna de las cinco**: ni fundar, ni proponer, ni transcribir la
 *     votación, ni firmar, ni ratificar. Y no escribe ni un hecho al intentarlo.
 *
 * El orden de los casos importa: construyen un historial y cada uno parte del anterior.
 */

import { createHash } from 'node:crypto';

import { verifyLedger, type PgPool } from '@koinonia/api';
import { parseCanonical } from '@koinonia/crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  apiEnv,
  como,
  entrar,
  FACILITADORA,
  listo,
  skipNote,
  type ApiListo,
} from './helpers/api-env.js';

const env = await apiEnv();

afterAll(async () => {
  if (env.ok) await env.stop();
});

const DIA = 86_400_000;
const CONSTITUCION = '00000000000000000000000000000003';

/** Los cinco de Garantías. El primero ya lo es por el adaptador; los otros cuatro, por el padrón. */
const GARANTES = [
  'garantias.uno@udea.edu.co',
  'garantias.dos@udea.edu.co',
  'garantias.tres@udea.edu.co',
  'garantias.cuatro@udea.edu.co',
  'garantias.cinco@udea.edu.co',
];
const ESTUDIANTE = 'sara.estudia@udea.edu.co';
const ADMINISTRADOR = 'sistemas.admin@udea.edu.co';

/** El núcleo intangible del §6.b, en el orden en que el dominio lo exige, más una regla corriente. */
const REGLAS_V1 = [
  {
    id: 'derecho_de_voz_y_voto',
    titulo: 'Toda persona miembro puede hablar, objetar y votar',
    texto:
      'Nadie puede quitarle a un miembro el derecho a participar en la conversación, a mostrar un ' +
      'daño concreto y a votar. Ni una mayoría, ni quien facilita, ni quien administra.',
  },
  {
    id: 'publicidad_del_registro',
    titulo: 'Lo que pasa queda escrito y cualquiera puede comprobarlo por su cuenta',
    texto:
      'El registro es público y se puede comprobar sin confiar en este servidor ni en quien lo ' +
      'opera. La comprobación no depende de nuestro permiso.',
  },
  {
    id: 'poder_no_transferible',
    titulo: 'La voz no se vende ni se regala en propiedad',
    texto:
      'Prestarle tu voto a alguien es revocable en cualquier momento y caduca solo. Nadie puede ' +
      'comprar poder político ni acumularlo de forma permanente.',
  },
  {
    id: 'caducidad_de_los_acuerdos',
    titulo: 'Los acuerdos caducan, y estas reglas también',
    texto:
      'Ningún acuerdo rige para siempre. Hay que volver a aprobarlo. Nadie queda gobernado ' +
      'indefinidamente por reglas que aprobó gente que ya se fue.',
  },
  {
    id: 'derecho_a_exportar',
    titulo: 'Podés llevarte la historia completa',
    texto:
      'Cualquier miembro puede descargar todo lo que pasó, entero, y usarlo fuera de acá. No hay ' +
      'forma de quedar atrapado en esta herramienta.',
  },
  {
    id: 'lista_taxativa',
    titulo: 'Lo que nunca se decide acá es una lista cerrada',
    texto:
      'Hay asuntos que no se someten a votación por ninguna vía, y esa lista no se amplía con ' +
      'excepciones: ampliarla no es reformar, es fundar otra cosa.',
  },
  {
    id: 'horario_de_la_sala',
    titulo: 'La sala de estudio abre de lunes a viernes',
    texto:
      'La sala de estudio del Instituto abre de lunes a viernes, de ocho de la mañana a seis de ' +
      'la tarde. Cambiar el horario es una reforma de estas reglas.',
  },
] as const;

/** La misma regla corriente, con otra letra. Es lo único que la reforma cambia. */
const HORARIO_REFORMADO = {
  id: 'horario_de_la_sala',
  titulo: 'La sala de estudio abre también los sábados por la mañana',
  texto:
    'La sala de estudio del Instituto abre de lunes a viernes, de ocho de la mañana a nueve de ' +
    'la noche, y los sábados de ocho a doce. Cambiar el horario es una reforma de estas reglas.',
} as const;

/** La huella de una regla, calculada aquí y sin preguntarle a la aplicación. */
function huellaDe(titulo: string, texto: string): string {
  return createHash('sha256').update(`${titulo}\n\n${texto}`, 'utf8').digest('hex');
}

interface ReglaDto {
  readonly id: string;
  readonly titulo: string;
  readonly texto: string;
  readonly irreformable: boolean;
}

interface NormasDto {
  readonly hayNormas: boolean;
  readonly descripcion: string;
  readonly versionVigente: number;
  readonly versiones: readonly {
    readonly version: number;
    readonly rigeDesde: number;
    readonly caduca: number;
    readonly vigente: boolean;
    readonly reglas: readonly ReglaDto[];
  }[];
  readonly nucleo: { readonly reglas: readonly ReglaDto[] };
  readonly reformasEnCurso: readonly { readonly id: string; readonly estado: string }[];
  readonly vedas: readonly { readonly desde: number; readonly hasta: number }[];
}

describe.skipIf(!env.ok)(`la constitución digital, escrita y releída${skipNote(env)}`, () => {
  let e: ApiListo;
  let pool: PgPool;
  let T0: number;

  const testigos = new Map<string, string>();
  const identidades = new Map<string, string>();
  let reformaId = '';
  let uuid = 0;

  function requestId(): string {
    uuid += 1;
    return `00000000-0000-4000-8000-${String(uuid).padStart(12, '0')}`;
  }

  /**
   * Entra y **vuelve a fijar los roles del padrón**.
   *
   * Cada entrada reescribe los roles desde el adaptador de identidad, que sólo conoce a una persona
   * de Garantías. El Círculo son cinco (§3) y sin cinco no se abre ninguna reforma, así que el
   * padrón se completa por donde se completa en producción: en la base.
   */
  async function sesion(correo: string): Promise<string> {
    const { testigo, miembroId } = await entrar(e, correo);
    testigos.set(correo, testigo);
    identidades.set(correo, miembroId);
    await fijarRoles();
    return testigo;
  }

  /**
   * Vuelve a entrar con todas las cuentas.
   *
   * Una sesión dura doce horas y este historial abarca cuarenta y cinco días: cada vez que el
   * reloj salta hay que volver a entrar, igual que le pasaría a cualquiera. Que las pruebas tengan
   * que hacerlo es la señal de que el plazo del §6 se mide de verdad y no se simula.
   */
  async function reentrar(): Promise<void> {
    for (const correo of [...GARANTES, FACILITADORA, ESTUDIANTE, ADMINISTRADOR]) {
      await sesion(correo);
    }
  }

  async function fijarRoles(): Promise<void> {
    const garantes = GARANTES.map((correo) => identidades.get(correo)).filter(
      (id): id is string => id !== undefined,
    );
    if (garantes.length > 0) {
      await e.superPool.query(
        `UPDATE identity.member SET roles = ARRAY['member','guarantees']
          WHERE member_id = ANY($1::char(32)[])`,
        [garantes],
      );
    }
    const admin = identidades.get(ADMINISTRADOR);
    if (admin !== undefined) {
      // El administrador técnico **no es miembro**: no delibera ni vota. Es la tabla del §7.
      await e.superPool.query(
        `UPDATE identity.member SET roles = ARRAY['tech-admin'] WHERE member_id = $1`,
        [admin],
      );
    }
  }

  async function normas(): Promise<NormasDto> {
    const respuesta = await e.app.inject({ method: 'GET', url: '/normas' });
    expect(respuesta.statusCode, respuesta.body).toBe(200);
    return respuesta.json<NormasDto>();
  }

  async function hechosDeLaConstitucion(): Promise<number> {
    const { rows } = await pool.query<{ total: string }>(
      "SELECT count(*)::text AS total FROM governance.event WHERE aggregate_type = 'constitution'",
    );
    return Number(rows[0]?.total ?? '0');
  }

  beforeAll(async () => {
    e = listo(env);
    pool = e.pool;
    T0 = e.reloj.now();
    await reentrar();
  }, 240_000);

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // Antes de fundar: el sistema funciona, y lo dice
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it('sin fundar, las normas no inventan una versión vigente', async () => {
    const cuerpo = await normas();
    expect(cuerpo.hayNormas).toBe(false);
    expect(cuerpo.versionVigente).toBe(0);
    expect(cuerpo.versiones).toStrictEqual([]);
    // Y el núcleo se publica igual desde el primer día: es lo que no depende de que nadie funde.
    expect(cuerpo.nucleo.reglas).toHaveLength(6);
    expect(await hechosDeLaConstitucion()).toBe(0);
  });

  it('no se reforma lo que nadie fundó', async () => {
    const respuesta = await e.app.inject({
      method: 'POST',
      url: '/normas/reformas',
      headers: como(testigos.get(ESTUDIANTE) ?? ''),
      payload: {
        requestId: requestId(),
        via: 'ordinaria',
        sobreLaVersion: 1,
        reglas: REGLAS_V1,
        firmas: 3,
        finDeSemestre: T0 + 300 * DIA,
        votacionesConvocadas: [],
        conversacionAbreEn: T0 + DIA,
        conversacionCierraEn: T0 + 22 * DIA,
      },
    });
    expect(respuesta.statusCode, respuesta.body).toBe(409);
    expect(respuesta.json<{ codigo: string }>().codigo).toBe('CONSTITUTION_NOT_FOUNDED');
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // Fundar
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it('fundar exige el núcleo completo: un documento sin uno de los seis no es esta constitución', async () => {
    const respuesta = await e.app.inject({
      method: 'POST',
      url: '/normas/fundacion',
      headers: como(testigos.get(FACILITADORA) ?? ''),
      payload: {
        requestId: requestId(),
        decisionFundacional: 'd'.repeat(32),
        censo: 300,
        papeletas: 150,
        aFavor: 100,
        votoDirecto: 100,
        rigeDesde: T0,
        reglas: REGLAS_V1.filter((regla) => regla.id !== 'lista_taxativa'),
      },
    });
    expect(respuesta.statusCode, respuesta.body).toBe(422);
    expect(respuesta.json<{ codigo: string }>().codigo).toBe('NUCLEO_INCOMPLETO');
    expect(await hechosDeLaConstitucion()).toBe(0);
  });

  it('fundar con menos de dos tercios de las papeletas no funda nada', async () => {
    const respuesta = await e.app.inject({
      method: 'POST',
      url: '/normas/fundacion',
      headers: como(testigos.get(FACILITADORA) ?? ''),
      payload: {
        requestId: requestId(),
        decisionFundacional: 'd'.repeat(32),
        censo: 300,
        papeletas: 150,
        // 99 de 150: uno menos de los 100 que hacen falta. La aritmética es exacta (ADR-0027).
        aFavor: 99,
        votoDirecto: 100,
        rigeDesde: T0,
        reglas: REGLAS_V1,
      },
    });
    expect(respuesta.statusCode, respuesta.body).toBe(422);
    expect(respuesta.json<{ codigo: string }>().codigo).toBe('FOUNDING_THRESHOLD_NOT_MET');
    expect(await hechosDeLaConstitucion()).toBe(0);
  });

  it('la asamblea funda la versión 1, y la pantalla deja de decir que no hay reglas', async () => {
    const respuesta = await e.app.inject({
      method: 'POST',
      url: '/normas/fundacion',
      headers: como(testigos.get(FACILITADORA) ?? ''),
      payload: {
        requestId: requestId(),
        decisionFundacional: 'd'.repeat(32),
        censo: 300,
        papeletas: 150,
        aFavor: 100,
        votoDirecto: 100,
        rigeDesde: T0,
        reglas: REGLAS_V1,
      },
    });
    expect(respuesta.statusCode, respuesta.body).toBe(201);

    const cuerpo = await normas();
    expect(cuerpo.hayNormas).toBe(true);
    expect(cuerpo.versionVigente).toBe(1);
    expect(cuerpo.versiones).toHaveLength(1);
    expect(cuerpo.versiones[0]?.reglas).toHaveLength(REGLAS_V1.length);
    // Doce meses: la caducidad fundacional del §6, que es la contrapartida de que la regla
    // fundacional sea más baja que la de reforma.
    expect(cuerpo.versiones[0]?.caduca).toBe(Date.UTC(2027, 7, 21, 14, 0, 0, 0));
    // El aviso del dominio va delante de todo: qué rige, desde cuándo y hasta cuándo.
    expect(cuerpo.descripcion).toContain('Rige la versión 1');
  });

  it('el núcleo que se enseña es el texto que se fundó, no una copia en castellano de la API', async () => {
    const cuerpo = await normas();
    const derecho = cuerpo.nucleo.reglas.find((r) => r.id === 'derecho_de_voz_y_voto');
    expect(derecho?.texto).toBe(REGLAS_V1[0].texto);
    expect(cuerpo.nucleo.reglas.every((regla) => regla.irreformable)).toBe(true);
    // En el orden del §6.b —(i) a (vi)—, no en el alfabético de las etiquetas: es una enumeración
    // del documento, y `lista_taxativa` es el punto (vi) aunque su etiqueta empiece por ele.
    expect(cuerpo.nucleo.reglas.map((r) => r.id)).toStrictEqual(
      REGLAS_V1.slice(0, 6).map((r) => r.id),
    );
    // Y la regla corriente NO es irreformable: se dice por dato, no se deduce en la interfaz.
    const horario = cuerpo.versiones[0]?.reglas.find((r) => r.id === 'horario_de_la_sala');
    expect(horario?.irreformable).toBe(false);
  });

  it('el hecho fundacional guarda pares (etiqueta, huella) y NUNCA la prosa', async () => {
    const { rows } = await pool.query<{ payload: string }>(
      `SELECT payload FROM governance.event
        WHERE aggregate_id = $1 AND seq = 0`,
      [CONSTITUCION],
    );
    const texto = rows[0]?.payload;
    expect(texto).toBeDefined();
    // La columna sigue siendo su propia forma canónica: `parseCanonical` lo exige byte a byte.
    expect(() => parseCanonical(texto ?? '')).not.toThrow();
    // Ni una palabra del texto normativo está en el historial: sólo su huella.
    expect(texto).not.toContain('sala de estudio');
    expect(texto).toContain('horario_de_la_sala');
    expect(texto).toContain(huellaDe(REGLAS_V1[6].titulo, REGLAS_V1[6].texto));
  });

  it('la huella de cada regla cuadra con el texto que devuelve la pantalla', async () => {
    const cuerpo = await normas();
    const evento = await payloadDelHecho(0);
    const clauses = (evento['text'] as Record<string, unknown>)['clauses'] as readonly {
      clauseId: string;
      textHash: string;
    }[];
    for (const regla of cuerpo.versiones[0]?.reglas ?? []) {
      const comprometida = clauses.find((c) => c.clauseId === regla.id);
      expect(comprometida, regla.id).toBeDefined();
      expect(huellaDe(regla.titulo, regla.texto), regla.id).toBe(comprometida?.textHash);
    }
  });

  it('el ledger sigue íntegro con los hechos de la constitución dentro', async () => {
    const informe = await verifyLedger(pool);
    expect(informe.findings).toStrictEqual([]);
    expect(informe.ok).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // Reformar
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it('una reforma que toca el núcleo no se abre: los seis puntos no se reforman por ninguna vía', async () => {
    const respuesta = await e.app.inject({
      method: 'POST',
      url: '/normas/reformas',
      headers: como(testigos.get(ESTUDIANTE) ?? ''),
      payload: {
        requestId: requestId(),
        via: 'ordinaria',
        sobreLaVersion: 1,
        reglas: REGLAS_V1.map((regla) =>
          regla.id === 'lista_taxativa'
            ? { ...regla, texto: `${regla.texto} Salvo cuando haga falta.` }
            : regla,
        ),
        firmas: 3,
        finDeSemestre: T0 + 300 * DIA,
        votacionesConvocadas: [],
        conversacionAbreEn: T0 + DIA,
        conversacionCierraEn: T0 + 22 * DIA,
      },
    });
    expect(respuesta.statusCode, respuesta.body).toBe(422);
    expect(respuesta.json<{ codigo: string }>().codigo).toBe('CORE_CLAUSE_ALTERED');
  });

  it('una reforma ordinaria no puede tocar lo que cuesta reformar: eso va por la vía atrincherada', async () => {
    const respuesta = await e.app.inject({
      method: 'POST',
      url: '/normas/reformas',
      headers: como(testigos.get(ESTUDIANTE) ?? ''),
      payload: {
        requestId: requestId(),
        via: 'ordinaria',
        sobreLaVersion: 1,
        reglas: REGLAS_V1,
        mesesDeVigencia: 24,
        firmas: 3,
        finDeSemestre: T0 + 300 * DIA,
        votacionesConvocadas: [],
        conversacionAbreEn: T0 + DIA,
        conversacionCierraEn: T0 + 22 * DIA,
      },
    });
    expect(respuesta.statusCode, respuesta.body).toBe(422);
    expect(respuesta.json<{ codigo: string }>().codigo).toBe('AMENDMENT_RULE_IS_ENTRENCHED');
  });

  it('la conversación previa dura veintiún días, y veinte no valen', async () => {
    const respuesta = await e.app.inject({
      method: 'POST',
      url: '/normas/reformas',
      headers: como(testigos.get(ESTUDIANTE) ?? ''),
      payload: {
        requestId: requestId(),
        via: 'ordinaria',
        sobreLaVersion: 1,
        reglas: [...REGLAS_V1.slice(0, 6), HORARIO_REFORMADO],
        firmas: 3,
        finDeSemestre: T0 + 300 * DIA,
        votacionesConvocadas: [],
        conversacionAbreEn: T0 + DIA,
        conversacionCierraEn: T0 + 21 * DIA,
      },
    });
    expect(respuesta.statusCode, respuesta.body).toBe(422);
    expect(respuesta.json<{ codigo: string }>().codigo).toBe('DELIBERATION_TOO_SHORT');
  });

  it('cualquier miembro abre una reforma: el freno son las firmas, no un permiso', async () => {
    const respuesta = await e.app.inject({
      method: 'POST',
      url: '/normas/reformas',
      headers: como(testigos.get(ESTUDIANTE) ?? ''),
      payload: {
        requestId: requestId(),
        via: 'ordinaria',
        sobreLaVersion: 1,
        reglas: [...REGLAS_V1.slice(0, 6), HORARIO_REFORMADO],
        firmas: 3,
        finDeSemestre: T0 + 300 * DIA,
        votacionesConvocadas: [],
        conversacionAbreEn: T0 + DIA,
        conversacionCierraEn: T0 + 22 * DIA,
      },
    });
    expect(respuesta.statusCode, respuesta.body).toBe(201);

    const cuerpo = respuesta.json<NormasDto>();
    expect(cuerpo.reformasEnCurso).toHaveLength(1);
    reformaId = cuerpo.reformasEnCurso[0]?.id ?? '';
    expect(reformaId).toMatch(/^[0-9a-f]{32}$/u);
    expect(cuerpo.reformasEnCurso[0]?.estado).toBe('En conversación');
    // La veda del §6.c se publica ya traducida a fechas: las dos últimas semanas del semestre.
    expect(cuerpo.vedas).toHaveLength(1);
    expect(cuerpo.vedas[0]?.hasta).toBe(T0 + 300 * DIA);
  });

  it('no se ratifica una reforma que todavía no se votó', async () => {
    const respuesta = await e.app.inject({
      method: 'POST',
      url: `/normas/reformas/${reformaId}/ratificacion`,
      headers: como(testigos.get(FACILITADORA) ?? ''),
      payload: { requestId: requestId(), rigeDesde: T0 + 60 * DIA },
    });
    expect(respuesta.statusCode, respuesta.body).toBe(422);
    expect(respuesta.json<{ codigo: string }>().codigo).toBe('ILLEGAL_TRANSITION');
  });

  it('se transcribe el resultado de la votación, ya cerrada', async () => {
    e.reloj.avanzar(30 * DIA);
    await reentrar();

    const respuesta = await e.app.inject({
      method: 'POST',
      url: `/normas/reformas/${reformaId}/votaciones`,
      headers: como(testigos.get(FACILITADORA) ?? ''),
      payload: {
        requestId: requestId(),
        votacionId: 'c'.repeat(32),
        // El censo de esta comunidad son las personas del padrón; dos tercios de ocho son seis.
        aFavor: 7,
        votoDirecto: 7,
        abrioEn: T0 + 22 * DIA,
        cerroEn: T0 + 29 * DIA,
      },
    });
    expect(respuesta.statusCode, respuesta.body).toBe(201);
    // §6.6 manda que «sin las firmas la regla queda aprobada pero no vigente, y eso es público».
    // Un estado que dijera sólo «votada» escondería justo el caso que el documento manda publicar.
    const estado = respuesta.json<NormasDto>().reformasEnCurso[0]?.estado ?? '';
    expect(estado).toContain('Aprobada y todavía no vigente');
    expect(estado).toContain('3 firmas');
  });

  it('sin las firmas, la regla queda aprobada pero no vigente (§6.6)', async () => {
    const respuesta = await e.app.inject({
      method: 'POST',
      url: `/normas/reformas/${reformaId}/ratificacion`,
      headers: como(testigos.get(FACILITADORA) ?? ''),
      payload: { requestId: requestId(), rigeDesde: T0 + 44 * DIA },
    });
    expect(respuesta.statusCode, respuesta.body).toBe(422);
    expect(respuesta.json<{ codigo: string }>().codigo).toBe('GUARANTEE_THRESHOLD_NOT_MET');
  });

  it('nadie firma en nombre de otra persona, y quien no está en Garantías no firma', async () => {
    const ajena = await e.app.inject({
      method: 'POST',
      url: `/normas/reformas/${reformaId}/aprobaciones`,
      headers: como(testigos.get(ESTUDIANTE) ?? ''),
      payload: { requestId: requestId() },
    });
    expect(ajena.statusCode, ajena.body).toBe(403);
    expect(ajena.json<{ codigo: string }>().codigo).toBe('UNAUTHORIZED_ROLE_NOT_GRANTED');
  });

  it('tres de las cinco personas de Garantías firman, y la misma no firma dos veces', async () => {
    for (const correo of GARANTES.slice(0, 3)) {
      const respuesta = await e.app.inject({
        method: 'POST',
        url: `/normas/reformas/${reformaId}/aprobaciones`,
        headers: como(testigos.get(correo) ?? ''),
        payload: { requestId: requestId() },
      });
      expect(respuesta.statusCode, `${correo}: ${respuesta.body}`).toBe(201);
    }
    const repetida = await e.app.inject({
      method: 'POST',
      url: `/normas/reformas/${reformaId}/aprobaciones`,
      headers: como(testigos.get(GARANTES[0] ?? '') ?? ''),
      payload: { requestId: requestId() },
    });
    expect(repetida.statusCode, repetida.body).toBe(422);
    expect(repetida.json<{ codigo: string }>().codigo).toBe('DUPLICATE_APPROVAL');

    // Con las tres firmas, lo que falta es el plazo y se dice cuál: los catorce días de espera
    // del §6.4 son impugnables ante Garantías, y un plazo que no se publica no se impugna.
    const cuerpo = await normas();
    expect(cuerpo.reformasEnCurso[0]?.estado).toBe(
      'Aprobada y firmada: sólo falta que entre en vigor',
    );
  });

  it('la regla no entra en vigor antes de los catorce días de espera', async () => {
    const respuesta = await e.app.inject({
      method: 'POST',
      url: `/normas/reformas/${reformaId}/ratificacion`,
      headers: como(testigos.get(FACILITADORA) ?? ''),
      payload: { requestId: requestId(), rigeDesde: T0 + 42 * DIA },
    });
    expect(respuesta.statusCode, respuesta.body).toBe(422);
    expect(respuesta.json<{ codigo: string }>().codigo).toBe('WAITING_PERIOD_NOT_ELAPSED');
  });

  it('se ratifica, nace la versión 2 y la 1 NO se borra', async () => {
    e.reloj.avanzar(14 * DIA);
    await reentrar();

    const respuesta = await e.app.inject({
      method: 'POST',
      url: `/normas/reformas/${reformaId}/ratificacion`,
      headers: como(testigos.get(FACILITADORA) ?? ''),
      payload: { requestId: requestId(), rigeDesde: T0 + 44 * DIA },
    });
    expect(respuesta.statusCode, respuesta.body).toBe(201);

    const cuerpo = await normas();
    expect(cuerpo.versionVigente).toBe(2);
    expect(cuerpo.versiones.map((v) => v.version)).toStrictEqual([1, 2]);
    expect(cuerpo.versiones[0]?.vigente).toBe(false);
    expect(cuerpo.versiones[1]?.vigente).toBe(true);
    expect(cuerpo.reformasEnCurso).toStrictEqual([]);
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // La versión histórica: se recupera y su huella sigue cuadrando
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it('la versión 1 conserva su letra exacta y su huella la sigue respaldando', async () => {
    const cuerpo = await normas();
    const vieja = cuerpo.versiones.find((v) => v.version === 1);
    const nueva = cuerpo.versiones.find((v) => v.version === 2);
    const horarioViejo = vieja?.reglas.find((r) => r.id === 'horario_de_la_sala');
    const horarioNuevo = nueva?.reglas.find((r) => r.id === 'horario_de_la_sala');

    // (1) El texto histórico es el de entonces, no el de ahora.
    expect(horarioViejo?.texto).toBe(REGLAS_V1[6].texto);
    expect(horarioNuevo?.texto).toBe(HORARIO_REFORMADO.texto);
    expect(horarioViejo?.texto).not.toBe(horarioNuevo?.texto);

    // (2) Y la huella que el hecho fundacional dejó escrita respalda exactamente ese texto. Se
    //     recomputa aquí con `node:crypto`: `printf '%s\n\n%s' "$titulo" "$cuerpo" | sha256sum`.
    const fundacion = await payloadDelHecho(0);
    const clauses = (fundacion['text'] as Record<string, unknown>)['clauses'] as readonly {
      clauseId: string;
      textHash: string;
    }[];
    const comprometida = clauses.find((c) => c.clauseId === 'horario_de_la_sala');
    expect(huellaDe(horarioViejo?.titulo ?? '', horarioViejo?.texto ?? '')).toBe(
      comprometida?.textHash,
    );

    // (3) Las dos versiones comparten las seis cláusulas del núcleo: se archivan una sola vez.
    const { rows } = await pool.query<{ total: string }>(
      'SELECT count(*)::text AS total FROM governance.clause_text',
    );
    expect(Number(rows[0]?.total ?? '0')).toBe(REGLAS_V1.length + 1);
  });

  it('el texto de una norma es inmutable: ni un UPDATE ni un DELETE lo tocan', async () => {
    await expect(
      e.superPool.query(
        "UPDATE governance.clause_text SET body = 'la sala no abre' WHERE text_hash = $1",
        [huellaDe(REGLAS_V1[6].titulo, REGLAS_V1[6].texto)],
      ),
    ).rejects.toThrow(/inmutable/iu);
    await expect(
      e.superPool.query('DELETE FROM governance.clause_text WHERE text_hash = $1', [
        huellaDe(REGLAS_V1[6].titulo, REGLAS_V1[6].texto),
      ]),
    ).rejects.toThrow(/inmutable/iu);
  });

  it('un título con salto de línea no entra: la huella dejaría de identificar un solo texto', async () => {
    await expect(
      e.superPool.query(
        'INSERT INTO governance.clause_text (text_hash, title, body) VALUES ($1, $2, $3)',
        ['f'.repeat(64), 'una linea\n\notra', 'cuerpo'],
      ),
    ).rejects.toThrow(/check|restricción|constraint/iu);
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // La autorización se revalida AL RELEER
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it('una firma fabricada en la base rompe la lectura, con el motivo exacto', async () => {
    // El adversario nº 2 no entra por la API: entra por la base. Se le atribuye a una persona de
    // Garantías una aprobación que no puso, escribiendo directamente en la columna `actor`.
    const { rows } = await pool.query<{ seq: number; actor: string }>(
      `SELECT seq, actor FROM governance.event
        WHERE aggregate_id = $1 AND event_type = 'ReformApprovedByGuarantor'
        ORDER BY seq ASC LIMIT 1`,
      [CONSTITUCION],
    );
    const firma = rows[0];
    expect(firma).toBeDefined();
    if (firma === undefined) return;
    const original = firma.actor.trimEnd();
    const suplantador = identidades.get(ADMINISTRADOR) ?? '';

    await comoAdministrador(async (client) => {
      await client.query(
        'UPDATE governance.event SET actor = $1 WHERE aggregate_id = $2 AND seq = $3',
        [suplantador, CONSTITUCION, firma.seq],
      );
    });

    // Leer las normas deja de funcionar. Nótese qué NO es lo que falla: la cadena del dominio se
    // **recomputa** al rehidratar, así que está intacta por construcción. Lo que rechaza el
    // historial es la reautorización del pliegue: el sobre y la firma nombran a dos personas.
    const respuesta = await e.app.inject({ method: 'GET', url: '/normas' });
    expect(respuesta.statusCode, respuesta.body).toBe(422);
    expect(respuesta.json<{ codigo: string }>().codigo).toBe('NOT_THE_GUARANTOR');

    // Y el verificador del ledger también lo ve, por otro camino: el hecho ya no hashea igual.
    const informe = await verifyLedger(pool);
    expect(informe.ok).toBe(false);

    // Se deshace la manipulación y todo vuelve a cuadrar: la detección no dejó daño permanente.
    await comoAdministrador(async (client) => {
      await client.query(
        'UPDATE governance.event SET actor = $1 WHERE aggregate_id = $2 AND seq = $3',
        [original, CONSTITUCION, firma.seq],
      );
    });
    expect((await normas()).versionVigente).toBe(2);
    expect((await verifyLedger(pool)).ok).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // `tech-admin` no puede ninguna de las cinco
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it('quien administra no puede fundar, ni proponer, ni transcribir, ni firmar, ni ratificar', async () => {
    e.reloj.avanzar(DIA);
    await reentrar();
    const testigo = testigos.get(ADMINISTRADOR) ?? '';
    const antes = await hechosDeLaConstitucion();

    const intentos: readonly {
      readonly que: string;
      readonly url: string;
      readonly payload: Record<string, unknown>;
    }[] = [
      {
        que: 'fundar',
        url: '/normas/fundacion',
        payload: {
          requestId: requestId(),
          decisionFundacional: 'd'.repeat(32),
          censo: 300,
          papeletas: 150,
          aFavor: 100,
          votoDirecto: 100,
          rigeDesde: T0 + 60 * DIA,
          reglas: REGLAS_V1,
        },
      },
      {
        que: 'proponer',
        url: '/normas/reformas',
        payload: {
          requestId: requestId(),
          via: 'ordinaria',
          sobreLaVersion: 2,
          reglas: REGLAS_V1,
          firmas: 3,
          finDeSemestre: T0 + 300 * DIA,
          votacionesConvocadas: [],
          conversacionAbreEn: T0 + 60 * DIA,
          conversacionCierraEn: T0 + 82 * DIA,
        },
      },
      {
        que: 'transcribir la votación',
        url: `/normas/reformas/${reformaId}/votaciones`,
        payload: {
          requestId: requestId(),
          votacionId: 'c'.repeat(32),
          aFavor: 7,
          votoDirecto: 7,
          abrioEn: T0 + 22 * DIA,
          cerroEn: T0 + 29 * DIA,
        },
      },
      {
        que: 'firmar',
        url: `/normas/reformas/${reformaId}/aprobaciones`,
        payload: { requestId: requestId() },
      },
      {
        que: 'ratificar',
        url: `/normas/reformas/${reformaId}/ratificacion`,
        payload: { requestId: requestId(), rigeDesde: T0 + 60 * DIA },
      },
    ];

    for (const intento of intentos) {
      const respuesta = await e.app.inject({
        method: 'POST',
        url: intento.url,
        headers: como(testigo),
        payload: intento.payload,
      });
      expect(respuesta.statusCode, `${intento.que}: ${respuesta.body}`).toBe(403);
      expect(respuesta.json<{ codigo: string }>().codigo, intento.que).toBe(
        'UNAUTHORIZED_ROLE_NOT_GRANTED',
      );
    }

    // Y no es que se haya escrito y luego se haya deshecho: no se escribió nada.
    expect(await hechosDeLaConstitucion()).toBe(antes);
    expect((await verifyLedger(pool)).ok).toBe(true);
  });

  // ── Utilidades ─────────────────────────────────────────────────────────────────────────────

  async function payloadDelHecho(seq: number): Promise<Record<string, unknown>> {
    const { rows } = await pool.query<{ payload: string }>(
      'SELECT payload FROM governance.event WHERE aggregate_id = $1 AND seq = $2',
      [CONSTITUCION, seq],
    );
    const texto = rows[0]?.payload ?? '{}';
    const payload = JSON.parse(texto) as Record<string, unknown>;
    return payload['body'] as Record<string, unknown>;
  }

  /** Ejecuta como quien administra: superusuario y con el blindaje append-only apagado. */
  async function comoAdministrador(body: (client: PgPool) => Promise<void>): Promise<void> {
    await e.superPool.query('ALTER TABLE governance.event DISABLE TRIGGER trg_event_append_only');
    try {
      await body(e.superPool);
    } finally {
      await e.superPool
        .query('ALTER TABLE governance.event ENABLE ALWAYS TRIGGER trg_event_append_only')
        .catch(() => undefined);
    }
  }
});
