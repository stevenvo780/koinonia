/**
 * **Los ataques.**
 *
 * Cada bloque construye el export que produciría un administrador con `root` y comprueba dos cosas
 * distintas, no una:
 *
 *  1. que el verificador lo detecta;
 *  2. que lo detecta **por el motivo correcto**, y que NO levanta los motivos que no corresponden.
 *
 * Lo segundo importa tanto como lo primero. Un verificador que se pone rojo por casualidad es un
 * verificador que un día se pondrá verde por casualidad, y aquí las asserts negativas —«y NO
 * aparece CADENA_ROTA»— son las que prueban que la detección viene de donde decimos.
 */

import {
  buildCommitBytes,
  canonicalReceipt,
  checkpointBindingLine,
  commitOid,
  type AnchorReceipt,
} from '@koinonia/anchor';
import {
  canonicalize,
  canonicalizeToBytes,
  concatBytes,
  DOMAIN,
  fromBase64Url,
  sha256,
  toBase64Url,
  toHex,
  type JsonObject,
  type JsonValue,
} from '@koinonia/crypto';
import {
  anchorReceiptPath,
  memorySource,
  SALIDA,
  verificarExport,
  type CodigoHallazgo,
  type ResultadoVerificacion,
} from '@koinonia/verificar';
import { describe, expect, it } from 'vitest';

import {
  AHORA,
  anclar,
  construirLedger,
  DECISION_A,
  DECISION_C,
  nuevoFirmante,
  renderExport,
  type Ledger,
} from './fabrica.js';

const ledgerLimpio = await anclar(await construirLedger());

function clonar(ledger: Ledger): Ledger {
  return {
    registros: ledger.registros.map((registro) => ({ ...registro, event: { ...registro.event } })),
    sellos: ledger.sellos.map((sello) => ({ ...sello })),
    cursorNextLeafIndex: ledger.cursorNextLeafIndex,
    anclajes: new Map(ledger.anclajes),
    cabeceras: new Map(ledger.cabeceras),
    confianza: ledger.confianza,
  };
}

/**
 * Verifica como lo haría alguien que hizo las cosas bien: con el padrón de claves obtenido POR OTRO
 * CANAL (`--confianza`), no el que viene dentro del paquete. Si se usara el del paquete, todas las
 * comprobaciones de firma seguirían pasando pero el verificador levantaría —con razón— el aviso de
 * que las claves las puso el verificado. Eso tiene su propio test más abajo.
 */
async function verificar(
  ledger: Ledger,
  opciones: { readonly sinAnclajes?: boolean } = {},
): Promise<ResultadoVerificacion> {
  const objetivo = opciones.sinAnclajes === true ? { ...ledger, anclajes: new Map() } : ledger;
  return verificarExport({
    source: memorySource('koinonia-export', await renderExport(objetivo)),
    confianza: ledgerLimpio.confianza,
    ahora: AHORA,
  });
}

function codigos(resultado: ResultadoVerificacion): readonly CodigoHallazgo[] {
  return [...new Set(resultado.hallazgos.map((hallazgo) => hallazgo.codigo))].sort();
}

// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('un export legítimo', () => {
  it('verifica entero y sale VERDE', async () => {
    const resultado = await verificar(ledgerLimpio);

    expect(codigos(resultado)).toStrictEqual([]);
    expect(resultado.ok).toBe(true);
    expect(resultado.salida).toBe(SALIDA.ok);
    expect(resultado.eventos).toBe(17);
    expect(resultado.checkpoints).toBe(2);
    expect(resultado.anclaje?.verdict.firm).toBe(true);
    expect(resultado.anclaje?.verdict.confirmedClasses).toStrictEqual([
      'blockchain',
      'human-witness',
      'vcs',
    ]);
    expect(resultado.pasos.every((paso) => paso.ok)).toBe(true);
  });

  it('si el padrón de claves sale del propio paquete, lo avisa', async () => {
    // Comprobar un carné contra la lista que trae el propio carné. Las firmas son válidas; lo que
    // no queda probado es que sean de quien dicen.
    const resultado = await verificarExport({
      source: memorySource('koinonia-export', await renderExport(ledgerLimpio)),
      ahora: AHORA,
    });

    expect(codigos(resultado)).toStrictEqual(['RAIZ_DE_CONFIANZA_DEL_EXPORT']);
    expect(resultado.salida).toBe(SALIDA.sinAnclajeFirme);
    expect(resultado.anclaje?.verdict.firm).toBe(true);
  });

  it('sin anclajes queda ÁMBAR, nunca verde: la coherencia interna no prueba lo que parece', async () => {
    const resultado = await verificar(ledgerLimpio, { sinAnclajes: true });

    expect(codigos(resultado)).toStrictEqual(['SIN_ANCLAJE']);
    expect(resultado.salida).toBe(SALIDA.sinAnclajeFirme);
    // Todo lo interno cuadra. Y aun así no es verde.
    expect(resultado.pasos.filter((paso) => !paso.ok).map((paso) => paso.nombre)).toStrictEqual([
      'anclaje',
    ]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('ATAQUE 1 — un byte alterado en el contenido de un registro', () => {
  it('se detecta como REGISTRO_ALTERADO, con el registro exacto', async () => {
    const ledger = clonar(ledgerLimpio);
    const victima = ledger.registros.find(
      (registro) => registro.event.aggregateId === DECISION_A && registro.event.seq === 0,
    );
    if (victima === undefined) throw new Error('no se encontró el registro a alterar');

    // «3 de marzo» -> «3 de mayo». Sigue siendo JSON canónico perfecto: lo que cambia es el hecho.
    victima.event = {
      ...victima.event,
      payload: { resumen: 'Aprobar el acta de la asamblea del 3 de mayo' } satisfies JsonObject,
    };

    const resultado = await verificar(ledger);

    expect(codigos(resultado)).toContain('REGISTRO_ALTERADO');
    const hallazgo = resultado.hallazgos.find((h) => h.codigo === 'REGISTRO_ALTERADO');
    expect(hallazgo?.agregado).toBe(DECISION_A);
    expect(hallazgo?.seq).toBe(0);
    expect(resultado.salida).toBe(SALIDA.integridadInterna);

    // Y NO se cuenta dos veces como cadena rota: es el mismo hecho con otro nombre.
    expect(codigos(resultado)).not.toContain('CADENA_ROTA');
  });
});

describe('ATAQUE 2 — un registro INTERIOR borrado', () => {
  it('se detecta como HUECO_EN_EL_INDICE y además rompe la cadena del expediente', async () => {
    const ledger = clonar(ledgerLimpio);
    const posicion = ledger.registros.findIndex(
      (registro) => registro.event.aggregateId === DECISION_A && registro.event.seq === 2,
    );
    ledger.registros.splice(posicion, 1);

    const resultado = await verificar(ledger);
    const encontrados = codigos(resultado);

    expect(encontrados).toContain('HUECO_EN_EL_INDICE');
    expect(encontrados).toContain('CADENA_ROTA');
    expect(resultado.salida).toBe(SALIDA.integridadInterna);

    const hueco = resultado.hallazgos.find((h) => h.codigo === 'HUECO_EN_EL_INDICE');
    expect(hueco?.detalle).toMatch(/faltan 1 registros/u);
    const cadena = resultado.hallazgos.find((h) => h.codigo === 'CADENA_ROTA');
    expect(cadena?.agregado).toBe(DECISION_A);
    expect(cadena?.detalle).toMatch(/seq-mismatch/u);
  });
});

describe('ATAQUE 3 — la COLA truncada', () => {
  it('lo detecta SÓLO el contador de índices repartidos, y lo nombra COLA_TRUNCADA', async () => {
    const ledger = clonar(ledgerLimpio);
    // Se cortan los dos últimos registros. Están DESPUÉS del último sello, así que ningún sello los
    // cubre; y borrar el final no deja huecos, así que `count = max + 1` sigue dando verde. Si el
    // export no publicara el cursor, esto sería INDETECTABLE.
    ledger.registros.splice(-2);

    const resultado = await verificar(ledger);

    expect(codigos(resultado)).toStrictEqual(['COLA_TRUNCADA']);
    expect(resultado.salida).toBe(SALIDA.integridadInterna);

    const hallazgo = resultado.hallazgos[0];
    expect(hallazgo?.detalle).toMatch(/repartió 17 números y el paquete sólo llega hasta 15/u);
    expect(hallazgo?.detalle).toMatch(/faltan 2 registros del FINAL/u);

    // Todo lo demás cuadra: cadenas, sellos, continuidad y anclaje. Es exactamente lo que hace
    // peligroso este ataque, y por eso la aserción negativa vale tanto como la positiva.
    expect(codigos(resultado)).not.toContain('HUECO_EN_EL_INDICE');
    expect(codigos(resultado)).not.toContain('CADENA_ROTA');
    expect(codigos(resultado)).not.toContain('RAIZ_MERKLE_NO_COINCIDE');
    expect(resultado.anclaje?.verdict.firm).toBe(true);
  });

  it('si el atacante ajusta también el contador, lo denuncia el sello que ya no tiene respaldo', async () => {
    const ledger = clonar(ledgerLimpio);
    ledger.registros.splice(-8); // se lleva por delante el último sello
    ledger.cursorNextLeafIndex = ledger.registros.length;

    const resultado = await verificar(ledger);

    expect(codigos(resultado)).toContain('CHECKPOINT_SIN_RESPALDO');
    expect(codigos(resultado)).not.toContain('COLA_TRUNCADA');
  });
});

describe('ATAQUE 4 — un expediente ENTERO borrado, con el índice recompactado', () => {
  it('lo detecta la espina dorsal, y sólo ella: PUNTERO_COLGANTE', async () => {
    const ledger = clonar(ledgerLimpio);

    // El atacante borra los registros del expediente, RENUMERA para no dejar huecos y ajusta el
    // contador. Deja intacta la anotación de nacimiento en la espina, porque tocarla rompería la
    // cadena de la espina, que es lo único que no puede recomponer sin recalcular todo el resto.
    ledger.registros = ledger.registros.filter(
      (registro) => registro.event.aggregateId !== DECISION_C,
    );
    for (const [indice, registro] of ledger.registros.entries()) registro.leafIndex = indice;
    ledger.cursorNextLeafIndex = ledger.registros.length;

    const resultado = await verificar(ledger);

    expect(codigos(resultado)).toStrictEqual(['PUNTERO_COLGANTE']);
    expect(resultado.salida).toBe(SALIDA.integridadInterna);

    const hallazgo = resultado.hallazgos[0];
    expect(hallazgo?.agregado).toBe(DECISION_C);
    expect(hallazgo?.detalle).toMatch(/fue borrado entero, o reescrito desde cero/u);

    // Ninguna de las otras capas lo ve. Ésta es la prueba de que la espina hace falta.
    expect(codigos(resultado)).not.toContain('HUECO_EN_EL_INDICE');
    expect(codigos(resultado)).not.toContain('COLA_TRUNCADA');
    expect(codigos(resultado)).not.toContain('CADENA_ROTA');
    expect(codigos(resultado)).not.toContain('RAIZ_MERKLE_NO_COINCIDE');
    expect(resultado.anclaje?.verdict.firm).toBe(true);
  });
});

describe('ATAQUE 5 — un sello con la raíz falsa pero internamente coherente', () => {
  it('se detecta como RAIZ_MERKLE_NO_COINCIDE, y el sello NO aparece como incoherente', async () => {
    const ledger = clonar(ledgerLimpio);
    const sello = ledger.sellos.at(-1);
    if (sello === undefined) throw new Error('sin sellos');

    // Raíz inventada y hash del sello RECALCULADO para que cuadre consigo mismo. Por dentro es
    // impecable: el atacante hizo bien su trabajo.
    const raizFalsa = toHex(await sha256(new TextEncoder().encode('historia alternativa')));
    const preimagen: JsonObject = {
      treeSize: sello.treeSize,
      rootHash: raizFalsa,
      headsRoot: sello.headsRoot,
      ...(sello.prevCheckpoint === undefined ? {} : { prevCheckpoint: sello.prevCheckpoint }),
      issuedAt: sello.issuedAt,
    };
    sello.rootHash = raizFalsa;
    sello.checkpointHash = toHex(
      await sha256(concatBytes(Uint8Array.of(DOMAIN.checkpoint), canonicalizeToBytes(preimagen))),
    );

    const resultado = await verificar(ledger);
    const encontrados = codigos(resultado);

    expect(encontrados).toContain('RAIZ_MERKLE_NO_COINCIDE');
    // «Internamente coherente»: el identificador del sello SÍ sale de sus propios datos.
    expect(encontrados).not.toContain('CHECKPOINT_INCOHERENTE');
    expect(encontrados).not.toContain('CADENA_DE_CHECKPOINTS_ROTA');
    // Y no existe prueba de continuidad posible hacia una raíz inventada.
    expect(encontrados).toContain('PRUEBA_DE_CONSISTENCIA_INVALIDA');
    // Al cambiar la raíz cambia el identificador del sello, y los comprobantes externos —que
    // registraron el identificador VERDADERO— dejan de corresponder. El ataque se delata dos veces.
    expect(encontrados).toContain('ANCLAJE_NO_CORRESPONDE');
    expect(resultado.salida).toBe(SALIDA.checkpoints);
  });
});

describe('ATAQUE 6 — la REESCRITURA DEL PASADO, con todo recalculado', () => {
  // El ataque que da sentido al proyecto entero: el administrador cambia un hecho antiguo y vuelve
  // a calcular cadenas, censos, sellos y pruebas de continuidad. El resultado es una historia
  // internamente PERFECTA. Nada de lo que hay dentro del servidor puede distinguirla de la buena.

  const reescribir = async (): Promise<Ledger> => {
    const falso = await construirLedger({
      resumenA: 'Aprobar el acta de la asamblea del 3 de mayo',
    });
    // Los anclajes son los de la historia VERDADERA: ya salieron del servidor y él no los controla.
    return {
      ...falso,
      anclajes: ledgerLimpio.anclajes,
      cabeceras: ledgerLimpio.cabeceras,
      confianza: ledgerLimpio.confianza,
    };
  };

  it('SIN anclaje externo es INDETECTABLE, y así hay que decirlo', async () => {
    const resultado = await verificar(await reescribir(), { sinAnclajes: true });

    // Ni una sola alarma. La historia falsa pasa todas las comprobaciones internas.
    expect(codigos(resultado)).toStrictEqual(['SIN_ANCLAJE']);
    expect(resultado.salida).toBe(SALIDA.sinAnclajeFirme);
  });

  it('CON anclaje externo se detecta y se nombra ANCLAJE_NO_CORRESPONDE', async () => {
    const resultado = await verificar(await reescribir());
    const encontrados = codigos(resultado);

    expect(encontrados).toContain('ANCLAJE_NO_CORRESPONDE');
    expect(resultado.salida).toBe(SALIDA.anclajeInvalido);

    // Ninguna comprobación INTERNA se queja: la historia falsa es impecable por dentro. Lo único
    // que la desmiente es lo que salió del servidor y él no pudo cambiar.
    expect(encontrados).not.toContain('REGISTRO_ALTERADO');
    expect(encontrados).not.toContain('CADENA_ROTA');
    expect(encontrados).not.toContain('RAIZ_MERKLE_NO_COINCIDE');
    expect(encontrados).not.toContain('PRUEBA_DE_CONSISTENCIA_INVALIDA');

    const hallazgo = resultado.hallazgos.find((h) => h.codigo === 'ANCLAJE_NO_CORRESPONDE');
    expect(hallazgo?.detalle).toMatch(/es auténtico y registra el resumen/u);
    // Se detecta por las TRES clases a la vez: no depende de que una sola siga en pie.
    expect(resultado.hallazgos.filter((h) => h.codigo === 'ANCLAJE_NO_CORRESPONDE')).toHaveLength(
      3,
    );
  });
});

describe('ATAQUE 7 — un comprobante de anclaje falsificado', () => {
  it('un commit firmado por una clave ajena al padrón es ANCLAJE_INVALIDO', async () => {
    const ledger = clonar(ledgerLimpio);
    const sello = ledger.sellos.at(-1);
    if (sello === undefined) throw new Error('sin sellos');

    // El atacante firma un commit impecable, con la línea de compromiso correcta… con SU clave.
    const impostor = await nuevoFirmante();
    const autor = 'Veeduria <veeduria@ejemplo.org> 1787100000 +0000';
    const base = {
      tree: '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
      author: autor,
      committer: autor,
      message: `Checkpoint ${String(sello.treeSize)}\n\n${checkpointBindingLine(sello.checkpointHash)}\n`,
    };
    const armadura = await impostor.firmar('git', buildCommitBytes(base));
    const objeto = buildCommitBytes({ ...base, signature: armadura });

    const falsificado: AnchorReceipt = {
      provider: 'git',
      independenceClass: 'vcs',
      checkpointHash: sello.checkpointHash,
      externalRef: await commitOid(objeto),
      submittedAt: AHORA,
      confirmedAt: AHORA,
      proof: toBase64Url(objeto),
      raw: { forgesSeen: ['codeberg', 'github'] },
    };
    ledger.anclajes.set('git', falsificado);

    const resultado = await verificar(ledger);

    expect(codigos(resultado)).toContain('ANCLAJE_INVALIDO');
    expect(resultado.hallazgos.find((h) => h.codigo === 'ANCLAJE_INVALIDO')?.detalle).toMatch(
      /NO está en el padrón de la veeduría/u,
    );
    expect(resultado.salida).toBe(SALIDA.anclajeInvalido);

    // Con git caído siguen quedando dos clases distintas, así que el quórum se mantiene. Ésa es la
    // razón de ser del 2-de-3: un anclaje comprometido no tumba la garantía.
    expect(resultado.anclaje?.verdict.firm).toBe(true);
  });

  it('un sello de OpenTimestamps con un byte tocado es ANCLAJE_INVALIDO', async () => {
    const ledger = clonar(ledgerLimpio);
    const original = ledger.anclajes.get('ots');
    if (original?.proof === undefined) throw new Error('sin sello OTS');
    const bytes = fromBase64Url(original.proof);
    bytes[70] = (bytes[70] ?? 0) ^ 0x01;
    ledger.anclajes.set('ots', { ...original, proof: toBase64Url(bytes) });

    const resultado = await verificar(ledger);

    expect(codigos(resultado)).toContain('ANCLAJE_INVALIDO');
    expect(resultado.hallazgos.find((h) => h.codigo === 'ANCLAJE_INVALIDO')?.detalle).toMatch(
      /el sello es falso/u,
    );
  });

  it('un acuse de testigo inventado no cuela: la firma no verifica', async () => {
    const ledger = clonar(ledgerLimpio);
    const original = ledger.anclajes.get('correo');
    if (original === undefined) throw new Error('sin recibo de correo');
    const crudos = original.raw['acks'];
    if (!Array.isArray(crudos)) throw new Error('sin acuses');
    const acuses = crudos as readonly JsonValue[];

    // Se cambia la fecha del acuse: la firma se hizo sobre la fecha vieja.
    const manipulados: JsonValue[] = acuses.map((acuse) => {
      const objeto = comoObjeto(acuse);
      return objeto === undefined ? acuse : { ...objeto, seenAt: '2026-08-21T11:31:00.000Z' };
    });
    ledger.anclajes.set('correo', {
      ...original,
      raw: { ...original.raw, acks: manipulados },
    });

    const resultado = await verificar(ledger);

    // El proveedor de correo deja de confirmar; el quórum sobrevive con las otras dos clases.
    const correo = resultado.anclaje?.resultados.find((r) => r.provider === 'correo');
    expect(correo?.status).toBe('pendiente');
    expect(correo?.checks.some((c) => /NO es válida/u.test(c.detail))).toBe(true);
    expect(resultado.anclaje?.verdict.firm).toBe(true);
  });

  it('un recibo que ni siquiera es JSON canónico se rechaza antes de creerle nada', async () => {
    const ficheros = await renderExport(ledgerLimpio);
    const sello = ledgerLimpio.sellos.at(-1)!;
    const ruta = anchorReceiptPath(sello.treeSize, 'git');
    const recibo = ledgerLimpio.anclajes.get('git')!;
    // Mismo objeto lógico, otro texto: claves reordenadas a mano.
    ficheros.set(ruta, `${JSON.stringify(JSON.parse(canonicalReceipt(recibo)), ['provider'])}\n`);

    // Se rehace el índice para que el atacante no se delate por ahí.
    const resultado = await verificarExport({
      source: memorySource('koinonia-export', await reindexar(ficheros)),
      confianza: ledgerLimpio.confianza,
      ahora: AHORA,
    });

    expect(codigos(resultado)).toContain('ANCLAJE_INVALIDO');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('el índice del paquete', () => {
  it('detecta una descarga corrupta, y el catálogo dice que no protege contra más', async () => {
    const ficheros = await renderExport(ledgerLimpio);
    ficheros.set('heads.json', `${ficheros.get('heads.json') ?? ''} `);

    const resultado = await verificarExport({
      source: memorySource('koinonia-export', ficheros),
      confianza: ledgerLimpio.confianza,
      ahora: AHORA,
    });

    expect(codigos(resultado)).toContain('FICHERO_ALTERADO');
  });

  it('un paquete sin `README-VERIFICACION.txt` está incompleto: es la garantía de última instancia', async () => {
    const ficheros = await renderExport(ledgerLimpio);
    ficheros.delete('README-VERIFICACION.txt');

    const resultado = await verificarExport({
      source: memorySource('koinonia-export', ficheros),
      confianza: ledgerLimpio.confianza,
      ahora: AHORA,
    });

    expect(codigos(resultado)).toStrictEqual(['EXPORT_INCOMPLETO']);
    expect(resultado.salida).toBe(SALIDA.exportIlegible);
  });

  it('un registro que no está en forma canónica JCS se detecta', async () => {
    const ficheros = await renderExport(ledgerLimpio);
    const lineas = (ficheros.get('events.ndjson') ?? '').split('\n');
    // Mismo objeto, claves reordenadas: JSON válido y equivalente, pero no es lo que se hasheó.
    const original = JSON.parse(lineas[3] ?? '{}') as Record<string, unknown>;
    lineas[3] = JSON.stringify(original, Object.keys(original).reverse());
    ficheros.set('events.ndjson', lineas.join('\n'));

    const resultado = await verificarExport({
      source: memorySource('koinonia-export', await reindexar(ficheros)),
      confianza: ledgerLimpio.confianza,
      ahora: AHORA,
    });

    expect(codigos(resultado)).toContain('EVENTO_NO_CANONICO');
  });
});

function comoObjeto(valor: JsonValue): Record<string, JsonValue> | undefined {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, JsonValue>)
    : undefined;
}

/** Recalcula el índice, como haría un atacante que no quiere delatarse por ahí. */
async function reindexar(ficheros: Map<string, string>): Promise<Map<string, string>> {
  const salida = new Map(ficheros);
  const manifiesto = JSON.parse(salida.get('manifest.json') ?? '{}') as Record<string, unknown>;
  salida.delete('manifest.json');
  const codificador = new TextEncoder();
  const entradas: { path: string; sha256: string }[] = [];
  for (const [ruta, contenido] of [...salida].sort(([a], [b]) => (a < b ? -1 : 1))) {
    entradas.push({ path: ruta, sha256: toHex(await sha256(codificador.encode(contenido))) });
  }
  salida.set('manifest.json', `${canonicalize({ ...manifiesto, files: entradas })}\n`);
  return salida;
}
