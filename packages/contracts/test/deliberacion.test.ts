/**
 * El contrato de la deliberación, con dos obsesiones.
 *
 * La primera es la **fuga de autoría**. `DeliberationState` lleva el `authorId` de cada aporte en
 * memoria, en todas las etapas (ADR-0049): el dominio no puede impedir que alguien serialice el
 * registro crudo hacia el cliente. Lo que sí se puede hacer —y es lo que se comprueba aquí— es que
 * el DTO sea **estricto**, de modo que el registro del motor no encaje en él: si mañana una ruta
 * intentara devolver `state.contributions` tal cual, no compila y, si alguien lo fuerza, no valida.
 *
 * La segunda es la **regla de oro** (ADR-0041). Todo texto de este contrato acaba en una pantalla, y
 * se comprueba contra la lista ejecutable de `glossary.ts`, no contra el buen juicio de quien lo
 * escribió.
 */

import {
  CONTRIBUTION_KINDS,
  DELIBERATION_STAGES,
  POSITION_MODES,
  REASON_RELATIONS,
} from '@koinonia/domain';
import { describe, expect, it } from 'vitest';

import { forbiddenTermsIn, normalizeForGlossary } from '../src/glossary.js';
import {
  abrirDeliberacion,
  aportar,
  APORTE_EN_PALABRAS,
  aporteDeliberacion,
  clavesDeAporte,
  AVISO_AUTORIA_OCULTA,
  AVISO_AUTORIA_SOLO_DEL_GRUPO,
  AVISO_AUTORIA_VISIBLE,
  avanzarEtapa,
  deliberacionDetalle,
  ETAPA_EN_PALABRAS,
  ETAPA_PARA_QUE_SIRVE,
  etapaDeliberacion,
  GRAVEDAD_EN_PALABRAS,
  MENSAJES_DELIBERACION,
  MODO_POSICION_EN_PALABRAS,
  RELACION_RAZON_EN_PALABRAS,
  TIPO_APORTE_EN_PALABRAS,
  tipoAporte,
} from '../src/http.js';

const id = '0123456789abcdef0123456789abcdef';
const otro = 'fedcba9876543210fedcba9876543210';
const peticion = '00000000-0000-4000-8000-000000000001';

const textoLargo = 'Los de la nocturna llegamos y la sala ya cerró: no tenemos dónde leer.';

describe('contrato de la deliberación: forma', () => {
  it('la lista de etapas y de tipos es exactamente la del motor, sin copias que se desincronicen', () => {
    expect(etapaDeliberacion.options).toEqual([...DELIBERATION_STAGES]);
    expect(tipoAporte.options).toEqual([...CONTRIBUTION_KINDS]);
    expect(Object.keys(ETAPA_EN_PALABRAS).sort()).toEqual([...DELIBERATION_STAGES].sort());
    expect(Object.keys(ETAPA_PARA_QUE_SIRVE).sort()).toEqual([...DELIBERATION_STAGES].sort());
    expect(Object.keys(TIPO_APORTE_EN_PALABRAS).sort()).toEqual([...CONTRIBUTION_KINDS].sort());
    expect(Object.keys(MODO_POSICION_EN_PALABRAS).sort()).toEqual([...POSITION_MODES].sort());
    expect(Object.keys(RELACION_RAZON_EN_PALABRAS).sort()).toEqual([...REASON_RELATIONS].sort());
  });

  it('las etapas se llaman en pantalla como manda el encargo', () => {
    expect(Object.values(ETAPA_EN_PALABRAS)).toEqual([
      'Preguntas',
      'Perspectivas',
      'Alternativas',
      'Objeciones',
      'Enmiendas',
      'Listo para decidir',
    ]);
  });

  it('abrir una conversación exige plazo, problema y clave de petición, y nada más', () => {
    const bueno = { requestId: peticion, problemaId: id, duracionHoras: 48 };
    expect(abrirDeliberacion.parse(bueno)).toEqual(bueno);
    expect(abrirDeliberacion.safeParse({ ...bueno, duracionHoras: 0 }).success).toBe(false);
    expect(abrirDeliberacion.safeParse({ ...bueno, duracionHoras: 721 }).success).toBe(false);
    // Ni la etapa ni quien la abre se eligen desde el cuerpo de la petición.
    expect(abrirDeliberacion.safeParse({ ...bueno, etapa: 'objeciones' }).success).toBe(false);
    expect(abrirDeliberacion.safeParse({ ...bueno, autorId: otro }).success).toBe(false);
  });

  it('cada clase de aporte llega con su arista obligatoria y sin campos de más', () => {
    const pregunta = {
      requestId: peticion,
      tipo: 'posicion' as const,
      modo: 'pregunta_aclaratoria' as const,
      texto: textoLargo,
    };
    expect(aportar.parse(pregunta)).toEqual(pregunta);

    // Una razón sin la postura a la que se refiere no es un aporte: es un comentario suelto.
    expect(
      aportar.safeParse({
        requestId: peticion,
        tipo: 'razon',
        relacion: 'sostiene',
        texto: textoLargo,
      }).success,
    ).toBe(false);

    // Una evidencia respalda una razón, nunca una postura directamente.
    expect(
      aportar.safeParse({
        requestId: peticion,
        tipo: 'evidencia',
        posicionId: id,
        texto: textoLargo,
      }).success,
    ).toBe(false);

    // Un riesgo declara su gravedad, y la gravedad no tiene valor por defecto.
    expect(
      aportar.safeParse({
        requestId: peticion,
        tipo: 'riesgo',
        salidaId: id,
        impacto: textoLargo,
        mitigacion: textoLargo,
      }).success,
    ).toBe(false);
    expect(
      aportar.safeParse({
        requestId: peticion,
        tipo: 'riesgo',
        salidaId: id,
        gravedad: 6,
        impacto: textoLargo,
        mitigacion: textoLargo,
      }).success,
    ).toBe(false);

    // Un supuesto que no se aplica a nada, y una salida sin origen, no entran.
    expect(
      aportar.safeParse({ requestId: peticion, tipo: 'supuesto', aplicaA: [], texto: textoLargo })
        .success,
    ).toBe(false);
    expect(
      aportar.safeParse({
        requestId: peticion,
        tipo: 'alternativa',
        problemaId: id,
        saleDe: [],
        texto: textoLargo,
      }).success,
    ).toBe(false);

    // Y un conjunto de aristas no repite el mismo destino.
    expect(
      aportar.safeParse({
        requestId: peticion,
        tipo: 'supuesto',
        aplicaA: [id, id],
        texto: textoLargo,
      }).success,
    ).toBe(false);
  });

  it('un aporte con menos de veinte caracteres es una reacción, no un aporte', () => {
    expect(
      aportar.safeParse({
        requestId: peticion,
        tipo: 'posicion',
        modo: 'afirmacion',
        texto: 'Sí, claro',
      }).success,
    ).toBe(false);
  });

  it('nadie se atribuye un aporte a otra persona desde el cuerpo de la petición', () => {
    for (const intruso of ['autorId', 'authorId', 'actor', 'miembroId', 'esMio']) {
      expect(
        aportar.safeParse({
          requestId: peticion,
          tipo: 'posicion',
          modo: 'afirmacion',
          texto: textoLargo,
          [intruso]: otro,
        }).success,
        `${intruso} tiene que ser un error de frontera, no un campo ignorado en silencio`,
      ).toBe(false);
    }
  });

  it('avanzar de etapa no lleva a qué etapa: sólo existe el sucesor exacto', () => {
    expect(avanzarEtapa.parse({ requestId: peticion })).toEqual({ requestId: peticion });
    expect(avanzarEtapa.safeParse({ requestId: peticion, a: 'listo_para_decidir' }).success).toBe(
      false,
    );
  });
});

describe('contrato de la deliberación: la autoría no se cuela por el DTO', () => {
  const aporteVisible = {
    id,
    tipo: 'posicion' as const,
    etapa: 'perspectivas' as const,
    etapaEnPalabras: 'Perspectivas',
    comoSeLlama: 'Postura',
    texto: textoLargo,
    responde: [],
    vigente: true,
    cuando: 1_800_000_000_000,
  };

  it('el aporte se lee sin autoría, y eso es un estado válido y no un dato incompleto', () => {
    const parsed = aporteDeliberacion.parse(aporteVisible);
    expect(parsed.autorId).toBeUndefined();
    expect(parsed.esMio).toBeUndefined();
  });

  it('el registro CRUDO del motor no encaja en el DTO', () => {
    // Esto es la prueba del punto (b) de la deuda: quien tenga el estado plegado tiene la autoría, y
    // el único obstáculo entre eso y el cliente es que el DTO sea estricto. Si alguien serializara
    // `state.contributions` tal cual —con `contributionId`, `body`, `authorId`, `seq`—, aquí falla.
    const registroDelMotor = {
      contributionId: id,
      stage: 'perspectivas',
      body: { kind: 'posicion', mode: 'afirmacion', text: textoLargo },
      authorId: otro,
      supersedesContributionId: undefined,
      submittedAt: 1_800_000_000_000,
      seq: 3,
    };
    const resultado = aporteDeliberacion.safeParse(registroDelMotor);
    expect(resultado.success).toBe(false);
    expect(JSON.stringify(resultado)).not.toContain(otro);
  });

  it('un aporte no acepta claves desconocidas aunque traigan la autoría dentro', () => {
    expect(aporteDeliberacion.safeParse({ ...aporteVisible, authorId: otro }).success).toBe(false);
    expect(aporteDeliberacion.safeParse({ ...aporteVisible, autor: otro }).success).toBe(false);
    expect(aporteDeliberacion.safeParse({ ...aporteVisible, seq: 3 }).success).toBe(false);
  });

  it('el detalle exige decir si la autoría se ve y explicarlo, siempre', () => {
    const detalle = {
      id,
      problemaId: otro,
      problemaTitulo: 'La sala cierra a las seis',
      circuloId: id,
      etapa: 'perspectivas' as const,
      etapaEnPalabras: 'Perspectivas',
      queSeHaceEnEstaEtapa: ETAPA_PARA_QUE_SIRVE.perspectivas,
      abreEn: 1_800_000_000_000,
      cierraEn: 1_800_003_600_000,
      cuantosAportes: 1,
      autoriaVisible: false,
      avisoDeAutoria: AVISO_AUTORIA_OCULTA,
      aportes: [aporteVisible],
      queSePuedeEscribirAhora: 'Acá se escribe: postura, razón, dato que lo respalda y supuesto.',
      tiposQueSeAdmitenAhora: ['posicion' as const],
      modosQueSeAdmitenAhora: ['afirmacion' as const],
      relacionesQueSeAdmitenAhora: ['sostiene' as const],
      laSalidaDebeCorregirAOtra: false,
      puedoAportar: true,
      puedoAvanzarEtapa: false,
    };
    expect(deliberacionDetalle.parse(detalle).avisoDeAutoria).toBe(AVISO_AUTORIA_OCULTA);
    const sinAviso: Record<string, unknown> = { ...detalle };
    delete sinAviso['avisoDeAutoria'];
    expect(deliberacionDetalle.safeParse(sinAviso).success).toBe(false);
  });
});

describe('contrato de la deliberación: la pantalla dice la verdad y no dice jerga', () => {
  const textosVisibles: readonly string[] = [
    ...Object.values(ETAPA_EN_PALABRAS),
    ...Object.values(ETAPA_PARA_QUE_SIRVE),
    ...Object.values(TIPO_APORTE_EN_PALABRAS),
    ...Object.values(MODO_POSICION_EN_PALABRAS),
    ...Object.values(RELACION_RAZON_EN_PALABRAS),
    ...Object.values(GRAVEDAD_EN_PALABRAS),
    ...Object.values(MENSAJES_DELIBERACION),
    AVISO_AUTORIA_OCULTA,
    AVISO_AUTORIA_VISIBLE,
    AVISO_AUTORIA_SOLO_DEL_GRUPO,
  ];

  it('ni una palabra de la lista prohibida en ningún texto que acabe en pantalla', () => {
    for (const texto of textosVisibles) {
      expect(forbiddenTermsIn(texto), `«${texto}»`).toEqual([]);
    }
  });

  it('el aviso de autoría oculta declara de quién NO protege', () => {
    const normalizado = normalizeForGlossary(AVISO_AUTORIA_OCULTA);
    expect(normalizado).toContain('administra el servidor');
    // «Anónimo» a secas promete algo que el sistema no da: la autoría está en la base de datos.
    expect(normalizado).not.toContain('anonim');
    // Y no depende del papel de nadie: quien cuida el procedimiento tampoco lo ve antes.
    expect(normalizado).toContain('quien cuida el procedimiento');
  });

  it('el aviso de autoría visible no promete que lo escrito antes haya cambiado', () => {
    expect(forbiddenTermsIn(AVISO_AUTORIA_VISIBLE)).toEqual([]);
    expect(normalizeForGlossary(AVISO_AUTORIA_VISIBLE)).not.toContain('anonim');
  });

  it('hay un aviso para quien lee el contenido sin poder ver los nombres', () => {
    // Cerrar la etapa no vuelve la autoría pública: la vuelve legible para el grupo competente
    // (`deliberation:read-authorship` es de círculo). Sin este tercer aviso, la pantalla afirmaría
    // que ya se ve quién escribió cada cosa y no mostraría ni un nombre.
    expect(normalizeForGlossary(AVISO_AUTORIA_SOLO_DEL_GRUPO)).toContain('publico');
    expect(normalizeForGlossary(AVISO_AUTORIA_SOLO_DEL_GRUPO)).not.toContain('anonim');
  });

  it('lo que se ofrece escribir se nombra por el ACTO, no por el tipo de aporte', () => {
    // BUG ENCONTRADO EN PRUEBAS. En «Preguntas» el motor admite un aporte de tipo `posicion`, pero
    // sólo en modo pregunta. La primera versión de esto nombraba la fila por el tipo y decía «acá se
    // escribe: postura» justo en la etapa que rechaza una postura.
    expect(
      clavesDeAporte({
        tiposQueSeAdmitenAhora: ['posicion', 'razon', 'evidencia'],
        modosQueSeAdmitenAhora: ['pregunta_aclaratoria'],
        relacionesQueSeAdmitenAhora: ['responde'],
      }),
    ).toEqual(['pregunta', 'responde', 'evidencia']);

    expect(
      clavesDeAporte({
        tiposQueSeAdmitenAhora: ['posicion', 'razon'],
        modosQueSeAdmitenAhora: ['afirmacion'],
        relacionesQueSeAdmitenAhora: ['sostiene'],
      }),
    ).toEqual(['postura', 'sostiene']);

    // Y una etapa sin escritura no ofrece nada, ni siquiera «nada».
    expect(
      clavesDeAporte({
        tiposQueSeAdmitenAhora: [],
        modosQueSeAdmitenAhora: [],
        relacionesQueSeAdmitenAhora: [],
      }),
    ).toEqual([]);

    for (const clave of Object.keys(APORTE_EN_PALABRAS) as (keyof typeof APORTE_EN_PALABRAS)[]) {
      expect(forbiddenTermsIn(APORTE_EN_PALABRAS[clave].nombre)).toEqual([]);
      expect(forbiddenTermsIn(APORTE_EN_PALABRAS[clave].ayuda)).toEqual([]);
    }
  });

  it('el rechazo por etapa se explica sin nombrar la tabla interna', () => {
    const mensaje = MENSAJES_DELIBERACION['CONTRIBUTION_KIND_NOT_ALLOWED'] ?? '';
    expect(mensaje).not.toBe('');
    for (const etapa of DELIBERATION_STAGES) {
      expect(mensaje).not.toContain(etapa);
    }
    for (const tipo of CONTRIBUTION_KINDS) {
      expect(mensaje).not.toContain(tipo);
    }
  });
});
