/**
 * El contrato de las pantallas nuevas.
 *
 * Lo que estas pruebas existen para fijar es **una** cosa por encima de todas: que «no hay grupos
 * claros» no se pueda confundir jamás con «no hay datos», ni una lista vacía con una ausencia de
 * participación. Por eso el consenso viaja como unión discriminada y no como un objeto con campos
 * opcionales: con `grupos?: Grupo[]` una interfaz podría pintar cero tarjetas y contar una mentira
 * sin que nada fallara. Aquí se comprueba que el compilador y Zod lo impiden.
 */

import { describe, expect, it } from 'vitest';

import {
  abrirDecision,
  circulo,
  consenso,
  delegar,
  forbiddenTermsIn,
  historial,
  normas,
  panelDeDelegaciones,
  repartoDeLaVoz,
  revocarDelegacion,
} from '../src/index.js';

const id = '0123456789abcdef0123456789abcdef';
const uuid = '11111111-2222-4333-8444-555555555555';

describe('contrato de círculos', () => {
  it('un grupo siempre dice qué decide sin consultar a nadie', () => {
    expect(() =>
      circulo.parse({ id, nombre: 'Espacios y Bienestar', decideSinConsultar: '' }),
    ).toThrow();
    const parsed = circulo.parse({
      id,
      nombre: 'Espacios y Bienestar',
      decideSinConsultar: 'El uso de los espacios y los horarios',
    });
    expect(parsed.decideSinConsultar).not.toBe('');
  });
});

describe('contrato del consenso', () => {
  const listaVacia = { titulo: 't', descripcion: 'd', textos: [], aviso: 'no hubo' };

  it('«no hay grupos claros» es una variante propia, no un mapa con cero grupos', () => {
    const sinGrupos = consenso.parse({
      tipo: 'sin-grupos',
      titulo: 'No hay grupos claros',
      descripcion: 'Las respuestas no separan a las personas en bandos distinguibles.',
      deDondeSale: 'sale de las votaciones cerradas',
      personas: 24,
      votaciones: 5,
      acuerdoGeneral: listaVacia,
    });
    expect(sinGrupos.tipo).toBe('sin-grupos');
    // El discriminante es lo que obliga a la interfaz a contemplarlo: no hay ningún camino en el
    // que `grupos` exista y esté vacío.
    expect('grupos' in sinGrupos).toBe(false);
  });

  it('un mapa de grupos NO se puede publicar sin decir de dónde sale', () => {
    expect(() =>
      consenso.parse({
        tipo: 'grupos',
        titulo: 'Grupos de opinión',
        descripcion: 'd',
        personas: 24,
        votaciones: 5,
        grupos: [{ numero: 1, personas: 12 }],
        enQueCoinciden: listaVacia,
        enQueSeSeparan: listaVacia,
      }),
    ).toThrow();
  });

  it('los grupos se numeran desde 1: el cero es el lenguaje de la máquina', () => {
    expect(() =>
      consenso.parse({
        tipo: 'grupos',
        titulo: 'Grupos de opinión',
        descripcion: 'd',
        deDondeSale: 'de las votaciones cerradas',
        personas: 2,
        votaciones: 3,
        grupos: [{ numero: 0, personas: 2 }],
        enQueCoinciden: listaVacia,
        enQueSeSeparan: listaVacia,
      }),
    ).toThrow();
  });

  it('«todavía no» siempre dice qué falta: nunca deja a nadie en un callejón', () => {
    const schema = consenso.options[2];
    expect(() =>
      schema.parse({
        tipo: 'todavia-no',
        titulo: 'No hay grupos claros',
        descripcion: 'd',
        personas: 0,
        votaciones: 0,
      }),
    ).toThrow();
  });

  it('el acuerdo por grupo viaja ya redondeado a palabras, no como número suelto', () => {
    const parsed = consenso.parse({
      tipo: 'sin-grupos',
      titulo: 'No hay grupos claros',
      descripcion: 'd',
      deDondeSale: 'de las votaciones cerradas',
      personas: 24,
      votaciones: 5,
      acuerdoGeneral: {
        titulo: 'En lo que coincide la gente',
        descripcion: 'd',
        textos: [
          {
            texto: 'Pedir que la sala abra hasta las nueve',
            respuestas: 20,
            acuerdoPorGrupo: [{ grupo: 1, acuerdo: '82,4 %' }],
          },
        ],
        aviso: '',
      },
    });
    const primero = parsed.tipo === 'sin-grupos' ? parsed.acuerdoGeneral.textos[0] : undefined;
    // Cadena y no número: quien consuma esto no puede volver a redondear por su cuenta y producir
    // un porcentaje distinto del que enseña otra pantalla.
    expect(typeof primero?.acuerdoPorGrupo[0]?.acuerdo).toBe('string');
  });
});

describe('contrato de las delegaciones', () => {
  it('delegar es estricto: un campo de más no se ignora, se rechaza', () => {
    expect(delegar.parse({ requestId: uuid, enQuienId: id }).enQuienId).toBe(id);
    // El intento clásico de atribuirle el acto a otra persona metiendo el sujeto en el cuerpo.
    expect(() => delegar.parse({ requestId: uuid, enQuienId: id, delegante: id })).toThrow();
  });

  it('revocar no lleva nada más que la clave de idempotencia', () => {
    expect(revocarDelegacion.parse({ requestId: uuid }).requestId).toBe(uuid);
    expect(() => revocarDelegacion.parse({ requestId: uuid, delegacionId: id })).toThrow();
  });

  it('el reparto de la voz se cuenta en personas enteras y con una frase', () => {
    const parsed = repartoDeLaVoz.parse({
      prestaron: 4,
      cargan: 2,
      maximo: 3,
      tope: 30,
      comoEsta: 'Los votos prestados están repartidos entre 2 personas.',
      devueltos: 0,
    });
    expect(Number.isInteger(parsed.maximo)).toBe(true);
    // El tope nunca puede ser cero: una delegación habilitada y a la vez imposible de ejercer es
    // el fallo silencioso que INV-32 describe.
    expect(() => repartoDeLaVoz.parse({ ...parsed, tope: 0 })).toThrow();
  });

  it('el panel explica cómo funciona antes de ofrecer nada', () => {
    const parsed = panelDeDelegaciones.parse({
      comoFunciona: ['Si votás vos, tu voto manda y el préstamo no se usa.'],
      votaciones: [],
    });
    expect(parsed.comoFunciona.length).toBeGreaterThan(0);
  });

  it('abrir una votación con préstamo de voto es explícito, nunca lo que pasa por defecto', () => {
    const sinDecir = abrirDecision.parse({
      requestId: uuid,
      propuestaId: id,
      metodo: 'simple-majority',
      duracionHoras: 24,
    });
    expect(sinDecir.delegacion).toBeUndefined();
    const conDelegacion = abrirDecision.parse({
      requestId: uuid,
      propuestaId: id,
      metodo: 'simple-majority',
      duracionHoras: 24,
      delegacion: true,
    });
    expect(conDelegacion.delegacion).toBe(true);
  });
});

describe('contrato de las normas', () => {
  it('una regla dice por dato si es irreformable: no se deduce en la interfaz', () => {
    const parsed = normas.parse({
      hayNormas: false,
      titulo: 'Las reglas del juego',
      descripcion: 'd',
      versionVigente: 0,
      versiones: [],
      nucleo: {
        titulo: 'Lo que no se puede cambiar',
        explicacion: 'e',
        reglas: [{ id: 'derecho_de_voz_y_voto', titulo: 't', texto: 'x', irreformable: true }],
      },
      vias: [{ nombre: 'Cambiar una regla', paraQue: 'p', requisitos: ['2 de cada 3'] }],
      reformasEnCurso: [],
      vedas: [],
    });
    expect(parsed.nucleo.reglas[0]?.irreformable).toBe(true);
  });
});

describe('contrato del historial', () => {
  it('una línea del historial no tiene dónde poner quién lo hizo', () => {
    const parsed = historial.parse({
      total: 3,
      enLaLista: 3,
      delSellado: 0,
      hechos: [
        { numero: 3, cuando: 1_800_000_000_000, que: 'Alguien respondió', sobre: 'Una votación' },
      ],
      hayMas: false,
    });
    // El actor existe en el historial y sale en la descarga completa, pero **no cabe** en esta
    // proyección: mientras una conversación tiene la autoría sellada, una lista con nombres la
    // rompería desde fuera. Que no exista el campo es la garantía; que no se rellene sería una
    // costumbre.
    expect(Object.keys(parsed.hechos[0] ?? {})).not.toContain('quien');
    expect(Object.keys(parsed.hechos[0] ?? {})).not.toContain('actor');
  });

  it('los hechos se numeran desde 1, como cuenta una persona', () => {
    expect(() =>
      historial.parse({
        total: 1,
        enLaLista: 1,
        delSellado: 0,
        hechos: [{ numero: 0, cuando: 1, que: 'q', sobre: 's' }],
        hayMas: false,
      }),
    ).toThrow();
  });
});

describe('la regla de oro sobre los textos fijos del contrato', () => {
  it('ninguna palabra prohibida se cuela en lo que estas pantallas mandan escrito', () => {
    // Los textos que viajan como literales del contrato son texto visible: si uno de ellos trajera
    // jerga, ninguna prueba de pantalla lo cazaría, porque la pantalla sólo lo repite.
    const literales = [
      'Prestar tu voto',
      'Qué tan repartida está la voz',
      'Todo lo que quedó escrito',
      'Las reglas del juego',
      'Quién decide qué',
      'En qué coincidimos',
      'No hay grupos claros',
    ];
    for (const literal of literales) {
      expect(forbiddenTermsIn(literal), literal).toEqual([]);
    }
  });
});
