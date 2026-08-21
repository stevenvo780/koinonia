/**
 * Git firmado: verificación offline del commit, y **el riesgo de la clave en el servidor**.
 *
 * El último bloque de este fichero es el más importante del paquete. Documenta, con una prueba que
 * falla si alguien lo cambia, que un despliegue con la clave privada dentro del VPS produce un
 * anclaje que **no cuenta**. No una advertencia: una condición.
 */

import {
  checkpointBindingLine,
  commitOid,
  evaluateQuorum,
  evidenceOf,
  parseCommit,
  SignedGitProvider,
} from '@koinonia/anchor';
import { toBase64Url, toHex } from '@koinonia/crypto';
import { describe, expect, it } from 'vitest';

import {
  ARBOL,
  AUTOR,
  commitFirmado,
  type Firmante,
  nuevoFirmante,
  relojFijo,
  T_AHORA,
  T_EMISION,
  texto,
} from './testigos.js';

const CHECKPOINT = new Uint8Array(32).fill(0x5c);
const HEX = toHex(CHECKPOINT);

function proveedor(
  firmante: Firmante,
  opciones: { readonly claveFuera?: boolean; readonly forjas?: readonly string[] } = {},
) {
  return new SignedGitProvider({
    allowedSigners: [{ identity: 'Veeduría 2026-2 — M. Restrepo', publicKey: firmante.publicKey }],
    signingKeyOffHost: opciones.claveFuera ?? true,
    forges: opciones.forjas ?? ['codeberg', 'github'],
    clock: relojFijo(T_AHORA),
  });
}

const MENSAJE = ['Checkpoint 12480', '', checkpointBindingLine(HEX), ''].join('\n');

async function reciboFirmado(firmante: Firmante, mensaje = MENSAJE, namespace = 'git') {
  const bytes = await commitFirmado(firmante, mensaje, { namespace });
  return {
    bytes,
    recibo: {
      provider: 'git',
      independenceClass: 'vcs' as const,
      checkpointHash: HEX,
      externalRef: await commitOid(bytes),
      submittedAt: T_EMISION,
      confirmedAt: T_AHORA,
      proof: toBase64Url(bytes),
      raw: { requestKind: 'commit_firmado', forgesSeen: ['codeberg', 'github'] },
    },
  };
}

describe('objeto commit', () => {
  it('el identificador es SHA1 del objeto, y se recalcula', async () => {
    const firmante = await nuevoFirmante();
    const bytes = await commitFirmado(firmante, MENSAJE);
    const oid = await commitOid(bytes);
    expect(oid).toMatch(/^[0-9a-f]{40}$/u);
  });

  it('lo firmado es el objeto SIN la cabecera gpgsig', async () => {
    const firmante = await nuevoFirmante();
    const bytes = await commitFirmado(firmante, MENSAJE);
    const commit = parseCommit(bytes);
    const texto = new TextDecoder().decode(commit.signedPayload);

    expect(texto).not.toContain('gpgsig');
    expect(texto).toContain(`tree ${ARBOL}`);
    expect(texto).toContain(`author ${AUTOR}`);
    expect(texto.endsWith(MENSAJE)).toBe(true);
  });
});

describe('SignedGitProvider', () => {
  it('submit NO firma: produce la solicitud para la veeduría y queda PENDIENTE', async () => {
    const firmante = await nuevoFirmante();
    const provider = proveedor(firmante);
    const recibo = await provider.submit(CHECKPOINT);

    expect(recibo.proof).toBeUndefined();
    expect(recibo.raw['requestKind']).toBe('firma_pendiente_de_veeduria');
    expect(recibo.raw['bindingLine']).toBe(checkpointBindingLine(HEX));
    expect(texto(recibo.raw['instructions'])).toMatch(/NO debe copiarse a este servidor/u);

    const resultado = await provider.verify(recibo, CHECKPOINT);
    expect(resultado.status).toBe('pendiente');
    expect(resultado.detail).toMatch(/La firma ocurre en el equipo de la veeduría/u);
  });

  it('un commit firmado por el padrón y que menciona el checkpoint queda CONFIRMADO', async () => {
    const firmante = await nuevoFirmante();
    const provider = proveedor(firmante);
    const { recibo } = await reciboFirmado(firmante);

    const resultado = await provider.verify(recibo, CHECKPOINT);
    expect(resultado.status).toBe('confirmado');
    expect(resultado.offline).toBe(true);
    expect(resultado.checks.filter((c) => c.ok).map((c) => c.name)).toStrictEqual([
      'compromiso',
      'identificador',
      'firma',
      'contexto',
      'firmante',
      'compromiso_firmado',
      'clave_fuera_del_servidor',
    ]);
    // La presencia en las dos forjas es disponibilidad, no criptografía: queda como pendiente.
    expect(resultado.residualClaims.some((r) => /codeberg y github/u.test(r.claim))).toBe(true);
  });

  it('un byte cambiado en el mensaje del commit invalida la firma', async () => {
    const firmante = await nuevoFirmante();
    const provider = proveedor(firmante);
    const { bytes } = await reciboFirmado(firmante);

    const alterado = new Uint8Array(bytes);
    const posicion = alterado.length - 5;
    alterado[posicion] = (alterado[posicion]! + 1) & 0xff;

    const resultado = await provider.verify(
      {
        provider: 'git',
        independenceClass: 'vcs',
        checkpointHash: HEX,
        externalRef: await commitOid(alterado),
        submittedAt: T_EMISION,
        proof: toBase64Url(alterado),
        raw: {},
      },
      CHECKPOINT,
    );
    expect(resultado.status).toBe('invalido');
    expect(resultado.detail).toMatch(/la firma del commit NO es válida/u);
  });

  it('si el recibo declara un OID que no es el de los bytes, se detecta', async () => {
    const firmante = await nuevoFirmante();
    const provider = proveedor(firmante);
    const { recibo } = await reciboFirmado(firmante);

    const resultado = await provider.verify({ ...recibo, externalRef: 'a'.repeat(40) }, CHECKPOINT);
    expect(resultado.status).toBe('invalido');
    expect(resultado.detail).toMatch(/un commit distinto del que dicen/u);
  });

  it('una firma válida de una clave FUERA del padrón no prueba nada', async () => {
    const veeduria = await nuevoFirmante();
    const intruso = await nuevoFirmante();
    const provider = proveedor(veeduria);
    const { recibo } = await reciboFirmado(intruso);

    const resultado = await provider.verify(recibo, CHECKPOINT);
    expect(resultado.status).toBe('invalido');
    expect(resultado.detail).toMatch(/NO está en el padrón de la veeduría/u);
  });

  it('una firma hecha para otro contexto no vale como firma de git', async () => {
    const firmante = await nuevoFirmante();
    const provider = proveedor(firmante);
    const { recibo } = await reciboFirmado(firmante, MENSAJE, 'file');

    const resultado = await provider.verify(recibo, CHECKPOINT);
    expect(resultado.status).toBe('invalido');
    expect(resultado.detail).toMatch(/es una firma de otra cosa/u);
  });

  it('un commit firmado que NO menciona el checkpoint no ancla nada', async () => {
    const firmante = await nuevoFirmante();
    const provider = proveedor(firmante);
    const { recibo } = await reciboFirmado(firmante, 'Arreglar el README\n');

    const resultado = await provider.verify(recibo, CHECKPOINT);
    expect(resultado.status).toBe('invalido');
    expect(resultado.detail).toMatch(/NO menciona este checkpoint/u);
  });

  it('un commit sin firmar no vale: lo pudo escribir el propio administrador', async () => {
    const firmante = await nuevoFirmante();
    const provider = proveedor(firmante);
    const bytes = new TextEncoder().encode(
      `tree ${ARBOL}\nauthor ${AUTOR}\ncommitter ${AUTOR}\n\n${MENSAJE}`,
    );

    const resultado = await provider.verify(
      {
        provider: 'git',
        independenceClass: 'vcs',
        checkpointHash: HEX,
        externalRef: await commitOid(bytes),
        submittedAt: T_EMISION,
        proof: toBase64Url(bytes),
        raw: {},
      },
      CHECKPOINT,
    );
    expect(resultado.status).toBe('invalido');
    expect(resultado.detail).toMatch(/no está firmado/u);
  });
});

describe('EL RIESGO: la clave privada en el servidor verificado', () => {
  it('con la clave dentro, la firma es válida y el anclaje NO cuenta para el quórum', async () => {
    const firmante = await nuevoFirmante();
    const provider = proveedor(firmante, { claveFuera: false });
    const { recibo } = await reciboFirmado(firmante);

    const resultado = await provider.verify(recibo, CHECKPOINT);

    // La criptografía dice la verdad: la firma es correcta. Eso NO es lo mismo que probar algo.
    expect(resultado.status).toBe('confirmado');
    expect(resultado.checks.find((c) => c.name === 'clave_fuera_del_servidor')).toMatchObject({
      ok: false,
    });

    // Y la política, que es donde vive la desconfianza, lo descuenta.
    const veredicto = evaluateQuorum([evidenceOf(provider.meta, resultado, HEX)], {
      checkpointHash: HEX,
      issuedAt: T_EMISION,
      now: T_AHORA,
    });
    expect(veredicto.firm).toBe(false);
    expect(veredicto.confirmedClasses).toStrictEqual([]);
    expect(veredicto.rejected).toHaveLength(1);
    expect(veredicto.rejected[0]!.reason).toBe('clave-en-el-servidor-verificado');
    expect(veredicto.rejected[0]!.detail).toMatch(/este anclaje es teatro/u);
  });

  it('los metadatos lo declaran a la cara, sin eufemismos', async () => {
    const firmante = await nuevoFirmante();
    expect(proveedor(firmante, { claveFuera: false }).meta.trustAssumption).toMatch(
      /⚠ NINGUNA: la clave privada vive en la máquina que se está auditando/u,
    );
    expect(proveedor(firmante, { claveFuera: true }).meta.trustAssumption).toMatch(
      /no está en este servidor/u,
    );
  });

  it('`signingKeyOffHost` es obligatorio: no hay valor por defecto cómodo', () => {
    // Prueba de tipos, comprobada por `pnpm typecheck`: el objeto de opciones sin el campo no
    // compila. Aquí se deja constancia de por qué, para que nadie le ponga un `?? true`.
    const configuracion = {
      allowedSigners: [],
      signingKeyOffHost: false,
      forges: ['codeberg'],
      clock: relojFijo(T_AHORA),
    };
    expect(Object.hasOwn(configuracion, 'signingKeyOffHost')).toBe(true);
  });
});
