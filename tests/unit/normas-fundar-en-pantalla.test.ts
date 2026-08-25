/**
 * Lo que `/normas/fundar` asume sobre el dominio y el contrato, sin poder importarla.
 *
 * `apps/web` no declara `"type": "module"` en su `package.json` —es un proyecto de Next con
 * `moduleResolution: Bundler`—, así que bajo el `NodeNext` de `tsconfig.check.json`, que es el que
 * compila `tests/**`, cualquier fichero suyo se lee como CommonJS y `verbatimModuleSyntax` lo
 * rechaza (TS1295/TS1287). Importarlo desde aquí rompe `pnpm run typecheck` del repositorio
 * entero. Es la misma razón que documenta `tests/unit/metodos-en-pantalla.test.ts`, y la misma
 * salida: se protege el **hecho** del dominio y del contrato, no el fichero de la pantalla. Cuatro
 * cosas asume `apps/web/app/normas/fundar/page.tsx` sin poder comprobarlas por su cuenta, y cada
 * una tiene su prueba acá:
 *
 *  1. Sólo quien cuida el procedimiento o las garantías puede fundar (`constitution:found`), y
 *     hace falta sesión — ni siquiera `tech-admin` puede, y un observador anónimo tampoco.
 *  2. Los límites de una regla que el editor exige a mano —título de 4 a 160 caracteres sin salto
 *     de línea, texto de 20 a 8000, identificador en minúsculas— son los mismos que valida
 *     `reglaRedactada` en `@koinonia/contracts`.
 *  3. El identificador de la fundación tiene el mismo formato que `opaqueId`: 32 caracteres
 *     hexadecimales en minúscula.
 *  4. El cuerpo que la pantalla arma para `POST /normas/fundacion` tiene exactamente los campos
 *     que `fundarNormas` exige: ni de más (el esquema es `.strict()`) ni de menos.
 *
 * Comprobado rompiéndolo: subir el mínimo de `texto` a 21 en la cabeza (sin tocar el contrato)
 * hace fallar el caso 2; sacar `'guarantees'` de la lista de quién puede fundar hace fallar el
 * caso 1; quitar `reglas` de la lista de campos hace fallar el caso 4. Restaurado después.
 */

import { describe, expect, it } from 'vitest';

import { ANONYMOUS, can, memberId, ROLES, type Actor, type Role } from '@koinonia/domain';
import { fundarNormas, opaqueId, reglaRedactada } from '@koinonia/contracts';

function actorConRoles(...roles: readonly Role[]): Actor {
  return { memberId: memberId('1'.repeat(32)), roles, circles: [] };
}

describe('quién puede fundar, tal como lo asume la pantalla', () => {
  // La copia que vive en `/normas/page.tsx` y `/normas/fundar/page.tsx`: el gate de la pantalla
  // es exactamente esta lista, escrita a mano, y esta prueba la confronta con `access.ts`.
  const PUEDEN_FUNDAR: readonly Role[] = ['facilitator', 'guarantees'];

  it('facilitación y garantías pueden fundar; ningún otro rol, tech-admin incluido', () => {
    for (const role of ROLES) {
      const permitido = can(actorConRoles(role), 'constitution:found', { kind: 'constitution' });
      expect(permitido).toBe(PUEDEN_FUNDAR.includes(role));
    }
  });

  it('sin sesión no se funda, aunque el rol alcance', () => {
    // `ANONYMOUS` no tiene ninguno de los dos roles, así que se prueba aparte un actor CON el rol
    // pero SIN identidad: es la comprobación de `authenticated: true`, no la del rol.
    const facilitadorSinIdentidad: Actor = {
      memberId: undefined,
      roles: ['facilitator'],
      circles: [],
    };
    expect(can(facilitadorSinIdentidad, 'constitution:found', { kind: 'constitution' })).toBe(
      false,
    );
    expect(can(ANONYMOUS, 'constitution:found', { kind: 'constitution' })).toBe(false);
  });
});

describe('los límites de una regla, tal como los exige el editor de /normas/fundar', () => {
  const idValido = 'regla_valida';
  const tituloDe = (largo: number): string => 'x'.repeat(largo);
  const textoDe = (largo: number): string => 'x'.repeat(largo);

  it('el título: 4 caracteres pasan, 3 no', () => {
    expect(
      reglaRedactada.safeParse({ id: idValido, titulo: tituloDe(4), texto: textoDe(20) }).success,
    ).toBe(true);
    expect(
      reglaRedactada.safeParse({ id: idValido, titulo: tituloDe(3), texto: textoDe(20) }).success,
    ).toBe(false);
  });

  it('el título: 160 caracteres pasan, 161 no', () => {
    expect(
      reglaRedactada.safeParse({ id: idValido, titulo: tituloDe(160), texto: textoDe(20) }).success,
    ).toBe(true);
    expect(
      reglaRedactada.safeParse({ id: idValido, titulo: tituloDe(161), texto: textoDe(20) }).success,
    ).toBe(false);
  });

  it('el título no admite un salto de línea', () => {
    expect(
      reglaRedactada.safeParse({
        id: idValido,
        titulo: 'línea uno\nlínea dos y algo más',
        texto: textoDe(20),
      }).success,
    ).toBe(false);
  });

  it('el texto: 20 caracteres pasan, 19 no', () => {
    expect(
      reglaRedactada.safeParse({ id: idValido, titulo: tituloDe(10), texto: textoDe(20) }).success,
    ).toBe(true);
    expect(
      reglaRedactada.safeParse({ id: idValido, titulo: tituloDe(10), texto: textoDe(19) }).success,
    ).toBe(false);
  });

  it('el texto: 8000 caracteres pasan, 8001 no', () => {
    expect(
      reglaRedactada.safeParse({ id: idValido, titulo: tituloDe(10), texto: textoDe(8000) })
        .success,
    ).toBe(true);
    expect(
      reglaRedactada.safeParse({ id: idValido, titulo: tituloDe(10), texto: textoDe(8001) })
        .success,
    ).toBe(false);
  });

  it('el identificador: minúsculas, dígitos y guion bajo, empieza por letra, hasta 32', () => {
    const base = { titulo: tituloDe(10), texto: textoDe(20) };
    expect(reglaRedactada.safeParse({ ...base, id: 'a'.repeat(32) }).success).toBe(true);
    expect(reglaRedactada.safeParse({ ...base, id: 'a'.repeat(33) }).success).toBe(false);
    expect(reglaRedactada.safeParse({ ...base, id: '1abc' }).success).toBe(false);
    expect(reglaRedactada.safeParse({ ...base, id: 'Abc' }).success).toBe(false);
    expect(reglaRedactada.safeParse({ ...base, id: 'abc-def' }).success).toBe(false);
  });
});

describe('el identificador de la fundación, tal como lo pide el campo de la pantalla', () => {
  it('coincide con el formato de opaqueId en los casos representativos', () => {
    const casos = [
      '0'.repeat(32),
      'abcdef01234567890123456789abcdef',
      'g'.repeat(32), // 'g' no es hexadecimal
      'A'.repeat(32), // mayúscula
      'a'.repeat(31), // corto
      'a'.repeat(33), // largo
      '',
    ];
    for (const caso of casos) {
      const esperado = opaqueId.safeParse(caso).success;
      const loQueAceptaLaPantalla = /^[0-9a-f]{32}$/u.test(caso);
      expect(loQueAceptaLaPantalla).toBe(esperado);
    }
  });
});

describe('el cuerpo que /normas/fundar manda a POST /normas/fundacion', () => {
  it('tiene exactamente los campos que fundarNormas exige, ni uno de más ni de menos', () => {
    const CAMPOS_QUE_ARMA_LA_PANTALLA = new Set([
      'requestId',
      'decisionFundacional',
      'censo',
      'papeletas',
      'aFavor',
      'votoDirecto',
      'rigeDesde',
      'reglas',
    ]);
    expect(new Set(Object.keys(fundarNormas.shape))).toEqual(CAMPOS_QUE_ARMA_LA_PANTALLA);
  });
});
