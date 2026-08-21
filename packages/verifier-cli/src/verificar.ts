/**
 * El verificador: **nueve comprobaciones sobre un fichero, sin hablar con nadie**.
 *
 * Lo importante de este módulo no es lo que comprueba sino de dónde saca los datos: de un paquete
 * autocontenido, con una implementación escrita aquí y no importada de `services/api`. Si el
 * verificador reutilizara el código del servidor, un error en ese código sería invisible para los
 * dos a la vez —comprobaría que el servidor está de acuerdo consigo mismo—. Aquí el algoritmo del
 * §6.4 (el hash del checkpoint) y el del §6.2 (la raíz de las cabezas) están **reimplementados**, y
 * que las dos implementaciones coincidan es parte de la prueba.
 *
 * Orden de las comprobaciones, de dentro hacia fuera:
 *
 *   1. El paquete está completo y los ficheros son los que dice el índice.
 *   2. Cada registro está escrito en la única forma admitida y su resumen cuadra.
 *   3. Las cadenas de cada expediente enlazan.
 *   4. La numeración global es densa **incluida la cola**.
 *   5. La espina dorsal no tiene punteros colgantes.
 *   6. El censo de cabezas coincide con lo recalculado.
 *   7. Cada sello periódico cuadra consigo mismo y con la historia.
 *   8. Cada sello continúa al anterior (RFC 6962).
 *   9. Los comprobantes de registro externo son auténticos y hay quórum.
 *
 * Las ocho primeras las puede falsificar quien controle el servidor: son coherencia interna, y una
 * historia reescrita entera las pasa todas. **La novena es la única que él no controla**, y por eso
 * el informe la trata aparte y por eso un paquete sin anclajes nunca se declara verde del todo.
 */

import {
  assertCanonicalEvent,
  canonicalizeToBytes,
  type ChainLink,
  concatBytes,
  DOMAIN,
  fromHex,
  type JsonObject,
  hashEvent,
  MerkleTree,
  sha256,
  toHex,
  verifyChain,
  verifyConsistency,
  zeroHash,
} from '@koinonia/crypto';
import {
  type AnchorProvider,
  type AnchorReceipt,
  evaluateQuorum,
  evidenceOf,
  type AnchorEvidence,
  NO_HEADERS,
  OpenTimestampsProvider,
  parseReceipt,
  type QuorumVerdict,
  SignedGitProvider,
  staticHeaders,
  type VerificationOutcome,
  WitnessEmailProvider,
} from '@koinonia/anchor';

import {
  BITCOIN_HEADERS_FILE,
  CHECKPOINTS_FILE,
  consistencyProofPath,
  decodeText,
  EVENT_HASHES_FILE,
  EVENTS_FILE,
  EXPORT_FORMAT_VERSION,
  type ExportedCheckpoint,
  type ExportedEvent,
  type ExportedEventHashes,
  type ExportedHead,
  ExportFormatError,
  type ExportSource,
  HEADS_FILE,
  MANIFEST_FILE,
  type ExportManifest,
  ndjsonLines,
  parseBitcoinHeaders,
  parseCheckpoint,
  parseConsistencyProof,
  parseEventHashes,
  parseHeads,
  parseManifest,
  parseTrustRoster,
  README_FILE,
  sinSaltoFinal,
  TRUST_FILE,
  type TrustRoster,
} from './formato.js';
import { type CodigoSalida, type Hallazgo, salidaPara, severidadDe } from './hallazgos.js';

const AGGREGATE_OPENED = 'AgregadoAbierto';

/** Lee un fichero del paquete o lanza. Evita la afirmación no nula, que aquí sería una promesa. */
async function leerTexto(source: ExportSource, ruta: string): Promise<string> {
  const bytes = await source.read(ruta);
  if (bytes === undefined) throw new ExportFormatError(ruta, 'no está en el paquete');
  return decodeText(ruta, bytes);
}

export interface Paso {
  readonly nombre: string;
  readonly ok: boolean;
  readonly detalle: string;
}

export interface EstadoAnclaje {
  readonly treeSize: number;
  readonly verdict: QuorumVerdict;
  readonly resultados: readonly VerificationOutcome[];
}

export interface ResultadoVerificacion {
  readonly ok: boolean;
  readonly salida: CodigoSalida;
  readonly hallazgos: readonly Hallazgo[];
  readonly pasos: readonly Paso[];
  readonly eventos: number;
  readonly agregados: number;
  readonly checkpoints: number;
  readonly anclaje: EstadoAnclaje | undefined;
  readonly desde: string | undefined;
  readonly hasta: string | undefined;
}

export interface OpcionesVerificacion {
  readonly source: ExportSource;
  /**
   * Padrón de firmantes fijado **fuera** del paquete. Si falta, se usa el del propio paquete y se
   * levanta el aviso `RAIZ_DE_CONFIANZA_DEL_EXPORT`, que explica por qué eso prueba menos.
   */
  readonly confianza?: TrustRoster;
  /** Instante actual, RFC 3339 UTC. Inyectado: el verificador no lee el reloj por su cuenta. */
  readonly ahora: string;
  /** Modo `--explicar`: recibe la prosa de cada paso antes de ejecutarlo. */
  readonly explicar?: (texto: string) => void;
}

const FICHEROS_OBLIGATORIOS = [
  MANIFEST_FILE,
  EVENTS_FILE,
  EVENT_HASHES_FILE,
  HEADS_FILE,
  CHECKPOINTS_FILE,
  README_FILE,
];

export async function verificarExport(
  opciones: OpcionesVerificacion,
): Promise<ResultadoVerificacion> {
  const { source } = opciones;
  const hallazgos: Hallazgo[] = [];
  const pasos: Paso[] = [];
  const explicar = opciones.explicar ?? ((): void => undefined);

  const anota = (
    codigo: Hallazgo['codigo'],
    detalle: string,
    extra: Partial<Hallazgo> = {},
  ): void => {
    hallazgos.push({ codigo, detalle, ...extra });
  };
  const paso = (nombre: string, ok: boolean, detalle: string): void => {
    pasos.push({ nombre, ok, detalle });
  };

  const vacio = (mensaje: string): ResultadoVerificacion => ({
    ok: false,
    salida: salidaPara(hallazgos),
    hallazgos,
    pasos: [...pasos, { nombre: 'lectura', ok: false, detalle: mensaje }],
    eventos: 0,
    agregados: 0,
    checkpoints: 0,
    anclaje: undefined,
    desde: undefined,
    hasta: undefined,
  });

  // ── 1. El paquete ──────────────────────────────────────────────────────────────────────────
  explicar(
    'Primero miro que el paquete esté completo. Un paquete es un directorio de ficheros de texto ' +
      'con un índice (manifest.json) que anota el resumen de cada uno. Ese índice sirve para ' +
      'detectar una descarga a medias; NO sirve contra quien produjo el paquete, porque él calcula ' +
      'los resúmenes. Lo digo ahora para que no te fíes de este primer visto bueno más de la cuenta.',
  );

  const presentes = new Set(await source.list());
  const faltantes = FICHEROS_OBLIGATORIOS.filter((fichero) => !presentes.has(fichero));
  if (faltantes.length > 0) {
    anota('EXPORT_INCOMPLETO', `faltan: ${faltantes.join(', ')}`);
    return vacio(`al paquete le faltan ${String(faltantes.length)} ficheros obligatorios`);
  }

  let manifiesto: ExportManifest;
  try {
    manifiesto = parseManifest(await leerTexto(source, MANIFEST_FILE));
  } catch (error) {
    anota('EXPORT_INCOMPLETO', descripcion(error));
    return vacio('el índice del paquete no se puede leer');
  }

  if (manifiesto.formatVersion !== EXPORT_FORMAT_VERSION) {
    anota(
      'FORMATO_DESCONOCIDO',
      `el paquete usa el formato ${String(manifiesto.formatVersion)} y esta versión entiende el ` +
        String(EXPORT_FORMAT_VERSION),
    );
    return vacio('formato desconocido');
  }

  let ficherosAlterados = 0;
  for (const entrada of manifiesto.files) {
    const bytes = await source.read(entrada.path);
    if (bytes === undefined) {
      anota('EXPORT_INCOMPLETO', `el índice menciona ${entrada.path} y no está en el paquete`);
      continue;
    }
    if (toHex(await sha256(bytes)) !== entrada.sha256) {
      ficherosAlterados++;
      anota('FICHERO_ALTERADO', `${entrada.path} no coincide con el resumen del índice`, {
        esperado: entrada.sha256,
        obtenido: toHex(await sha256(bytes)),
      });
    }
  }
  paso(
    'paquete',
    ficherosAlterados === 0,
    `${String(manifiesto.files.length)} ficheros, formato ${String(manifiesto.formatVersion)}`,
  );

  // ── 2. Registros ───────────────────────────────────────────────────────────────────────────
  explicar(
    'Ahora leo los registros uno a uno. Cada registro se escribe de UNA sola manera posible —claves ' +
      'en orden, sin espacios— para que su resumen se pueda recalcular igual en cualquier ordenador. ' +
      'Recalculo ese resumen sobre el contenido que veo y lo comparo con el que quedó guardado. Si ' +
      'alguien cambió una coma de un acta, aquí salta.',
  );

  const eventos: ExportedEvent[] = [];
  try {
    const textoEventos = await leerTexto(source, EVENTS_FILE);
    const textoHashes = await leerTexto(source, EVENT_HASHES_FILE);
    const lineasEventos = ndjsonLines(EVENTS_FILE, textoEventos);
    const lineasHashes = ndjsonLines(EVENT_HASHES_FILE, textoHashes);

    if (lineasEventos.length !== lineasHashes.length) {
      anota(
        'EXPORT_INCOMPLETO',
        `hay ${String(lineasEventos.length)} registros y ${String(lineasHashes.length)} resúmenes`,
      );
      return vacio('el paquete no es coherente consigo mismo');
    }

    for (const [index, linea] of lineasEventos.entries()) {
      let hashes: ExportedEventHashes;
      try {
        hashes = parseEventHashes(lineasHashes[index] ?? '', index);
      } catch (error) {
        anota('EVENTO_NO_CANONICO', descripcion(error), { leafIndex: index });
        continue;
      }
      let evento;
      try {
        evento = leerEvento(linea, index);
      } catch (error) {
        anota('EVENTO_NO_CANONICO', descripcion(error), { leafIndex: hashes.leafIndex });
        continue;
      }
      eventos.push({ leafIndex: hashes.leafIndex, event: evento, line: linea, hashes });
    }
  } catch (error) {
    anota('EXPORT_INCOMPLETO', descripcion(error));
    return vacio('los registros no se pueden leer');
  }

  const alterados: number[] = [];
  for (const registro of eventos) {
    const recomputado = await hashEvent(fromHex(registro.hashes.prevHash), registro.event);
    if (toHex(recomputado) !== registro.hashes.eventHash) {
      alterados.push(registro.leafIndex);
      anota(
        'REGISTRO_ALTERADO',
        `el contenido del registro ${String(registro.leafIndex)} no produce el resumen guardado`,
        {
          leafIndex: registro.leafIndex,
          agregado: registro.event.aggregateId,
          seq: registro.event.seq,
          esperado: registro.hashes.eventHash,
          obtenido: toHex(recomputado),
        },
      );
    }
  }
  paso(
    'registros',
    alterados.length === 0,
    `${String(eventos.length)} registros: escritura canónica y resúmenes correctos`,
  );

  // ── 3 y 4. Numeración global, con la cola ──────────────────────────────────────────────────
  explicar(
    'Los registros se numeran 0, 1, 2… sin saltos. Compruebo dos cosas distintas: que no falte ' +
      'ninguno EN MEDIO, y que no falte ninguno AL FINAL. La segunda es la que casi siempre se ' +
      'olvida: si borrás los últimos registros, la numeración sigue pareciendo continua. Lo que lo ' +
      'delata es que el sistema anota cuántos números llegó a repartir.',
  );

  const indices = eventos.map((registro) => registro.leafIndex);
  const ausentes: number[] = [];
  const ultimo = indices.length === 0 ? -1 : Math.max(...indices);
  const conjunto = new Set(indices);
  for (let i = 0; i <= ultimo; i++) if (!conjunto.has(i)) ausentes.push(i);

  if (ausentes.length > 0) {
    anota(
      'HUECO_EN_EL_INDICE',
      `faltan ${String(ausentes.length)} registros; los primeros números ausentes son ` +
        ausentes.slice(0, 20).join(', '),
      { leafIndex: ausentes[0] },
    );
  }

  const esperadosPorElCursor = ultimo + 1;
  if (manifiesto.cursorNextLeafIndex !== esperadosPorElCursor) {
    const faltan = manifiesto.cursorNextLeafIndex - esperadosPorElCursor;
    anota(
      'COLA_TRUNCADA',
      `el sistema repartió ${String(manifiesto.cursorNextLeafIndex)} números y el paquete sólo ` +
        `llega hasta ${String(esperadosPorElCursor)}: faltan ${String(faltan)} registros del FINAL`,
      { esperado: String(manifiesto.cursorNextLeafIndex), obtenido: String(esperadosPorElCursor) },
    );
  }
  paso(
    'numeración',
    ausentes.length === 0 && manifiesto.cursorNextLeafIndex === esperadosPorElCursor,
    ultimo < 0 ? 'sin registros' : `0..${String(ultimo)}, sin huecos ni cola cortada`,
  );

  // ── 5. Cadenas por expediente ──────────────────────────────────────────────────────────────
  explicar(
    'Cada expediente —una propuesta, una votación— es una cadena: cada registro menciona el resumen ' +
      'del anterior. Recorro cada cadena entera. Si alguien quitó, insertó o movió un registro ' +
      'intermedio, la cadena se corta y te digo en cuál exactamente.',
  );

  const porAgregado = new Map<string, ExportedEvent[]>();
  for (const registro of eventos) {
    const lista = porAgregado.get(registro.event.aggregateId) ?? [];
    lista.push(registro);
    porAgregado.set(registro.event.aggregateId, lista);
  }

  const cabezasRecalculadas = new Map<string, { seq: number; hash: string; tipo: string }>();
  let cadenasRotas = 0;
  for (const [aggregateId, flujo] of [...porAgregado].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const genesis = flujo[0];
    const esEspina = aggregateId === manifiesto.spineAggregateId;
    const genesisPrevHash = esEspina
      ? zeroHash()
      : genesis?.hashes.spineHash === undefined
        ? zeroHash()
        : fromHex(genesis.hashes.spineHash);

    const eslabones: ChainLink[] = flujo.map((registro) => ({
      event: registro.event,
      prevHash: fromHex(registro.hashes.prevHash),
      eventHash: fromHex(registro.hashes.eventHash),
    }));
    const resultado = await verifyChain(eslabones, {
      aggregateId,
      genesisPrevHash,
      initialSeq: genesis?.event.seq ?? 0,
    });

    if (!resultado.ok) {
      // `event-hash-mismatch` ya se informó arriba como REGISTRO_ALTERADO, que es el nombre que
      // entiende una persona. Repetirlo aquí sería contar el mismo hecho dos veces.
      if (resultado.reason !== 'event-hash-mismatch') {
        cadenasRotas++;
        anota('CADENA_ROTA', `${resultado.reason}: ${resultado.detail}`, {
          agregado: aggregateId,
          leafIndex: flujo[resultado.brokenAt]?.leafIndex,
          seq: resultado.brokenAtSeq ?? undefined,
          esperado: resultado.expected ?? undefined,
          obtenido: resultado.actual ?? undefined,
        });
      }
      continue;
    }

    const ultimoDelFlujo = flujo.at(-1);
    if (ultimoDelFlujo !== undefined) {
      cabezasRecalculadas.set(aggregateId, {
        seq: ultimoDelFlujo.event.seq,
        hash: toHex(resultado.head),
        tipo: ultimoDelFlujo.event.aggregateType,
      });
    }
  }
  paso(
    'expedientes',
    cadenasRotas === 0,
    `${String(porAgregado.size)} expedientes con su cadena de resúmenes intacta`,
  );

  // ── 6. Espina dorsal ───────────────────────────────────────────────────────────────────────
  explicar(
    'Hay un expediente especial, la espina, donde queda anotado el nacimiento de todos los demás. ' +
      'Sirve para detectar la desaparición de un expediente ENTERO, que las cadenas por sí solas no ' +
      'ven: si borrás una propuesta completa, ninguna cadena se rompe, porque la cadena rota se ' +
      'fue con ella. Lo que queda es la anotación de su nacimiento, apuntando al vacío.',
  );

  const espina = porAgregado.get(manifiesto.spineAggregateId) ?? [];
  if (espina.length === 0) {
    anota('ESPINA_AUSENTE', 'no hay ni un registro de la espina dorsal');
  }

  const genesisReales = new Map<string, string>(); // eventHash -> aggregateId
  for (const registro of eventos) {
    if (registro.event.seq === 0) {
      genesisReales.set(registro.hashes.eventHash, registro.event.aggregateId);
    }
  }

  const declarados = new Set<string>();
  let colgantes = 0;
  for (const registro of espina) {
    if (registro.event.eventType !== AGGREGATE_OPENED) continue;
    const aggregateId = registro.event.payload['aggregateId'];
    const genesisHash = registro.event.payload['genesisHash'];
    if (typeof aggregateId !== 'string' || typeof genesisHash !== 'string') {
      colgantes++;
      anota('PUNTERO_COLGANTE', 'anotación de nacimiento ilegible', {
        leafIndex: registro.leafIndex,
        seq: registro.event.seq,
      });
      continue;
    }
    declarados.add(aggregateId);
    const dueno = genesisReales.get(genesisHash);
    if (dueno === undefined) {
      colgantes++;
      anota(
        'PUNTERO_COLGANTE',
        `la espina anota el nacimiento del expediente ${aggregateId} y no queda ningún registro ` +
          `con ese resumen: fue borrado entero, o reescrito desde cero`,
        {
          agregado: aggregateId,
          leafIndex: registro.leafIndex,
          esperado: genesisHash,
          obtenido: 'ausente',
        },
      );
      continue;
    }
    if (dueno !== aggregateId) {
      colgantes++;
      anota(
        'PUNTERO_COLGANTE',
        `la espina atribuye el nacimiento ${genesisHash.slice(0, 16)}… a ${aggregateId} y ` +
          `pertenece a ${dueno}`,
        { agregado: aggregateId, esperado: aggregateId, obtenido: dueno },
      );
    }
  }

  for (const aggregateId of porAgregado.keys()) {
    if (aggregateId === manifiesto.spineAggregateId) continue;
    if (!declarados.has(aggregateId)) {
      colgantes++;
      anota(
        'AGREGADO_NO_REGISTRADO',
        `${aggregateId} tiene registros y la espina nunca anotó su nacimiento`,
        { agregado: aggregateId },
      );
    }
  }
  paso(
    'espina',
    colgantes === 0 && espina.length > 0,
    `${String(declarados.size)} expedientes abiertos, ${String(declarados.size)} nacimientos presentes y enlazados`,
  );

  // ── 7. Censo de cabezas ────────────────────────────────────────────────────────────────────
  let cabezas: readonly ExportedHead[] = [];
  try {
    cabezas = parseHeads(await leerTexto(source, HEADS_FILE));
  } catch (error) {
    anota('EXPORT_INCOMPLETO', descripcion(error));
  }

  let cabezasMal = 0;
  const declaradasPorId = new Map(cabezas.map((cabeza) => [cabeza.aggregateId, cabeza]));
  for (const [aggregateId, recalculada] of cabezasRecalculadas) {
    const declarada = declaradasPorId.get(aggregateId);
    if (declarada === undefined) {
      cabezasMal++;
      anota('CABEZA_INCOHERENTE', `${aggregateId} tiene registros y no aparece en el censo`, {
        agregado: aggregateId,
      });
      continue;
    }
    if (declarada.headHash !== recalculada.hash || declarada.seq !== recalculada.seq) {
      cabezasMal++;
      anota('CABEZA_INCOHERENTE', `el censo no coincide con lo recalculado para ${aggregateId}`, {
        agregado: aggregateId,
        esperado: `seq=${String(recalculada.seq)} hash=${recalculada.hash}`,
        obtenido: `seq=${String(declarada.seq)} hash=${declarada.headHash}`,
      });
    }
  }
  for (const cabeza of cabezas) {
    if (cabezasRecalculadas.has(cabeza.aggregateId)) continue;
    // Si el expediente TIENE registros pero su cadena está rota, ya se informó como CADENA_ROTA.
    // Volver a contarlo aquí como «no queda ni un registro suyo» sería, además de redundante,
    // literalmente falso, y un verificador que dice algo falso pierde la autoridad de todo lo demás.
    if (porAgregado.has(cabeza.aggregateId)) continue;
    cabezasMal++;
    anota(
      'CABEZA_INCOHERENTE',
      `el censo declara ${cabeza.aggregateId} y no queda ni un registro suyo`,
      { agregado: cabeza.aggregateId },
    );
  }
  paso('censo', cabezasMal === 0, `${String(cabezas.length)} expedientes en el censo`);

  // ── 8. Sellos periódicos ───────────────────────────────────────────────────────────────────
  explicar(
    'Cada cierto tiempo el sistema publica un sello que resume TODA la historia hasta ese momento en ' +
      'un solo valor, con un método (árbol de Merkle) que hace imposible cambiar un solo registro sin ' +
      'cambiar el resumen. Recalculo cada sello desde cero con los registros del paquete. Si alguien ' +
      'reescribió el pasado y publicó un sello nuevo que parece coherente, aquí no cuela: el sello ' +
      'que recalculo es el de la historia que TENGO, y si no es el que está publicado, algo se movió.',
  );

  const checkpoints: ExportedCheckpoint[] = [];
  try {
    const lineas = ndjsonLines(CHECKPOINTS_FILE, await leerTexto(source, CHECKPOINTS_FILE));
    for (const [index, linea] of lineas.entries()) checkpoints.push(parseCheckpoint(linea, index));
  } catch (error) {
    anota('EXPORT_INCOMPLETO', descripcion(error));
  }
  checkpoints.sort((a, b) => a.treeSize - b.treeSize);

  const hashesDeEventos = eventos.map((registro) => fromHex(registro.hashes.eventHash));
  let sellosMal = 0;
  let previo: ExportedCheckpoint | undefined;

  for (const checkpoint of checkpoints) {
    const recalculado = toHex(await hashDeCheckpoint(checkpoint));
    if (recalculado !== checkpoint.checkpointHash) {
      sellosMal++;
      anota('CHECKPOINT_INCOHERENTE', 'el identificador del sello no sale de sus propios datos', {
        treeSize: checkpoint.treeSize,
        esperado: recalculado,
        obtenido: checkpoint.checkpointHash,
      });
    }

    const esperadoPrevio = previo?.checkpointHash;
    if (checkpoint.prevCheckpoint !== esperadoPrevio) {
      sellosMal++;
      anota('CADENA_DE_CHECKPOINTS_ROTA', 'el sello no encadena con el anterior', {
        treeSize: checkpoint.treeSize,
        esperado: esperadoPrevio ?? '(ninguno: sería el primero)',
        obtenido: checkpoint.prevCheckpoint ?? '(ninguno)',
      });
    }

    if (checkpoint.treeSize > eventos.length) {
      sellosMal++;
      anota(
        'CHECKPOINT_SIN_RESPALDO',
        `el sello dice resumir ${String(checkpoint.treeSize)} registros y el paquete trae ` +
          String(eventos.length),
        { treeSize: checkpoint.treeSize },
      );
      previo = checkpoint;
      continue;
    }

    const raiz = toHex(
      (await MerkleTree.build(hashesDeEventos.slice(0, checkpoint.treeSize))).root(),
    );
    if (raiz !== checkpoint.rootHash) {
      sellosMal++;
      anota(
        'RAIZ_MERKLE_NO_COINCIDE',
        `recalculando el sello con los ${String(checkpoint.treeSize)} primeros registros sale otro ` +
          'valor: la historia que acompaña a este sello no es la que se selló',
        { treeSize: checkpoint.treeSize, esperado: raiz, obtenido: checkpoint.rootHash },
      );
    }

    const raizCabezas = toHex(await raizDeCabezas(eventos.slice(0, checkpoint.treeSize)));
    if (raizCabezas !== checkpoint.headsRoot) {
      sellosMal++;
      anota('RAIZ_DE_CABEZAS_NO_COINCIDE', 'el censo de expedientes que sella no es el real', {
        treeSize: checkpoint.treeSize,
        esperado: raizCabezas,
        obtenido: checkpoint.headsRoot,
      });
    }

    previo = checkpoint;
  }
  paso(
    'sellos',
    sellosMal === 0,
    checkpoints.length === 0
      ? 'el paquete no trae ningún sello'
      : `${String(checkpoints.length)} sellos recalculados desde cero`,
  );

  // ── 9. Continuidad entre sellos ────────────────────────────────────────────────────────────
  explicar(
    'Entre dos sellos consecutivos se publica una prueba matemática de que el segundo sólo AÑADE ' +
      'registros al primero: no cambia ni quita ninguno de los anteriores. Es la prueba que protege a ' +
      'quien guardó un sello viejo y ya no tiene la historia entera. La compruebo aquí.',
  );

  let continuidadMal = 0;
  for (let i = 1; i < checkpoints.length; i++) {
    const anterior = checkpoints[i - 1];
    const actual = checkpoints[i];
    if (anterior === undefined || actual === undefined) continue;
    const ruta = consistencyProofPath(anterior.treeSize, actual.treeSize);
    const bytes = await source.read(ruta);

    if (bytes === undefined) {
      continuidadMal++;
      anota(
        'PRUEBA_DE_CONSISTENCIA_AUSENTE',
        `no viene ${ruta}; se comprobó recalculándola con los registros del propio paquete`,
        { treeSize: actual.treeSize },
      );
      continue;
    }

    let prueba;
    try {
      prueba = parseConsistencyProof(ruta, decodeText(ruta, bytes));
    } catch (error) {
      continuidadMal++;
      anota('PRUEBA_DE_CONSISTENCIA_INVALIDA', descripcion(error), { treeSize: actual.treeSize });
      continue;
    }

    const valida = await verifyConsistency(
      BigInt(anterior.treeSize),
      BigInt(actual.treeSize),
      prueba.proof.map(fromHex),
      fromHex(anterior.rootHash),
      fromHex(actual.rootHash),
    );
    if (!valida) {
      continuidadMal++;
      anota(
        'PRUEBA_DE_CONSISTENCIA_INVALIDA',
        `la prueba de que el sello ${String(actual.treeSize)} continúa al ${String(anterior.treeSize)} ` +
          'no se sostiene: entre uno y otro se tocó el pasado',
        { treeSize: actual.treeSize },
      );
    }
  }
  paso(
    'continuidad',
    continuidadMal === 0,
    checkpoints.length < 2
      ? 'hace falta más de un sello para comprobar continuidad'
      : `${String(checkpoints.length - 1)} tramos de continuidad verificados`,
  );

  // ── 10. Anclaje externo ────────────────────────────────────────────────────────────────────
  explicar(
    'Y ahora lo único que un administrador con acceso total NO puede falsificar. Todo lo anterior lo ' +
      'puede rehacer: si reescribe la historia entera y recalcula cadenas, sellos y pruebas, todo ' +
      'cuadra. Lo que no puede rehacer es lo que ya salió de su servidor: un resumen dentro de ' +
      'Bitcoin, un commit firmado con una clave que él no tiene, el correo que varias personas ' +
      'recibieron. Compruebo esos comprobantes y exijo DOS de naturaleza distinta.',
  );

  const anclaje = await verificarAnclajes({
    source,
    checkpoints,
    confianza: opciones.confianza,
    ahora: opciones.ahora,
    anota,
    paso,
  });

  const salida = salidaPara(hallazgos);
  return {
    ok: hallazgos.every((hallazgo) => severidadDe(hallazgo.codigo) === 'nota'),
    salida,
    hallazgos,
    pasos,
    eventos: eventos.length,
    agregados: porAgregado.size,
    checkpoints: checkpoints.length,
    anclaje,
    desde: eventos[0]?.event.occurredAt,
    hasta: eventos.at(-1)?.event.occurredAt,
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Anclajes
// ═════════════════════════════════════════════════════════════════════════════════════════════

interface ContextoAnclaje {
  readonly source: ExportSource;
  readonly checkpoints: readonly ExportedCheckpoint[];
  readonly confianza: TrustRoster | undefined;
  readonly ahora: string;
  readonly anota: (codigo: Hallazgo['codigo'], detalle: string, extra?: Partial<Hallazgo>) => void;
  readonly paso: (nombre: string, ok: boolean, detalle: string) => void;
}

async function verificarAnclajes(ctx: ContextoAnclaje): Promise<EstadoAnclaje | undefined> {
  const ultimo = ctx.checkpoints.at(-1);
  if (ultimo === undefined) {
    ctx.anota('SIN_ANCLAJE', 'el paquete no trae ningún sello, así que tampoco hay qué anclar');
    ctx.paso('anclaje', false, 'sin sellos: no hay nada anclado');
    return undefined;
  }

  let confianza = ctx.confianza;
  if (confianza === undefined) {
    const bytes = await ctx.source.read(TRUST_FILE);
    if (bytes === undefined) {
      ctx.anota(
        'EXPORT_INCOMPLETO',
        `no hay padrón de firmantes: ni se pasó \`--confianza\` ni el paquete trae ${TRUST_FILE}`,
      );
      ctx.paso('anclaje', false, 'sin padrón de firmantes no se puede comprobar ninguna firma');
      return undefined;
    }
    try {
      confianza = parseTrustRoster(TRUST_FILE, decodeText(TRUST_FILE, bytes));
    } catch (error) {
      ctx.anota('EXPORT_INCOMPLETO', descripcion(error));
      return undefined;
    }
    // VERIFICAR: este paquete debería llevar EMPOTRADO el padrón real de la veeduría, publicado en
    // el repositorio anclado, para que la caída al padrón del export sea la excepción y no lo
    // normal. Hoy no existe ese padrón fijado: la asamblea todavía no ha nombrado veeduría ni ha
    // generado las claves. Mientras tanto el verificador hace lo honesto —usar el del paquete y
    // decir en voz alta que eso prueba menos—, pero el día de la puesta en marcha hay que fijar las
    // claves aquí y publicar el sha256 del tarball dentro del propio git anclado (§9.2).
    ctx.anota(
      'RAIZ_DE_CONFIANZA_DEL_EXPORT',
      `las claves salieron de ${TRUST_FILE}, dentro del propio paquete`,
    );
  }

  const cabeceras = await leerCabecerasBitcoin(ctx.source);
  const proveedores = construirProveedores(confianza, cabeceras, ctx.ahora);

  const ficheros = (await ctx.source.list()).filter(
    (ruta) => ruta.startsWith(`anchors/${String(ultimo.treeSize)}/`) && ruta.endsWith('.json'),
  );

  if (ficheros.length === 0) {
    ctx.anota(
      'SIN_ANCLAJE',
      `el sello ${String(ultimo.treeSize)} no trae ningún comprobante de registro externo`,
      { treeSize: ultimo.treeSize },
    );
    ctx.paso('anclaje', false, 'el último sello no está registrado fuera de este servidor');
    return undefined;
  }

  const evidencia: AnchorEvidence[] = [];
  const resultados: VerificationOutcome[] = [];

  for (const ruta of ficheros.sort()) {
    let recibo: AnchorReceipt;
    try {
      recibo = parseReceipt(sinSaltoFinal(await leerTexto(ctx.source, ruta)));
    } catch (error) {
      ctx.anota('ANCLAJE_INVALIDO', `${ruta}: ${descripcion(error)}`, {
        treeSize: ultimo.treeSize,
      });
      continue;
    }

    const proveedor = proveedores.get(recibo.provider);
    if (proveedor === undefined) {
      ctx.anota(
        'SIN_QUORUM_DE_ANCLAJE',
        `el comprobante '${recibo.provider}' es de un tipo que esta versión no sabe comprobar; no ` +
          'cuenta para el quórum',
        { treeSize: ultimo.treeSize },
      );
      continue;
    }

    // ═══ La bifurcación que nombra los dos ataques distintos ═══
    //
    // Si el comprobante se refiere a OTRO resumen, hay que averiguar si es auténtico antes de
    // llamarlo falso. Un comprobante auténtico de otra historia es la señal más fuerte que existe:
    // significa que la historia cambió DESPUÉS de registrarse fuera. Un comprobante roto es otra
    // cosa, más torpe, y merece otro nombre.
    if (recibo.checkpointHash !== ultimo.checkpointHash) {
      const propio = await proveedor.verify(recibo, fromHex(recibo.checkpointHash));
      if (propio.status === 'invalido') {
        ctx.anota('ANCLAJE_INVALIDO', `${ruta}: ${propio.detail}`, { treeSize: ultimo.treeSize });
      } else {
        ctx.anota(
          'ANCLAJE_NO_CORRESPONDE',
          `el comprobante de '${recibo.provider}' es auténtico y registra el resumen ` +
            `${recibo.checkpointHash.slice(0, 16)}…, mientras que la historia de este paquete produce ` +
            `${ultimo.checkpointHash.slice(0, 16)}…`,
          {
            treeSize: ultimo.treeSize,
            esperado: ultimo.checkpointHash,
            obtenido: recibo.checkpointHash,
          },
        );
      }
      resultados.push(propio);
      evidencia.push(evidenceOf(proveedor.meta, propio, recibo.checkpointHash));
      continue;
    }

    const resultado = await proveedor.verify(recibo, fromHex(ultimo.checkpointHash));
    resultados.push(resultado);
    evidencia.push(evidenceOf(proveedor.meta, resultado, recibo.checkpointHash));
    if (resultado.status === 'invalido') {
      ctx.anota('ANCLAJE_INVALIDO', `${ruta}: ${resultado.detail}`, { treeSize: ultimo.treeSize });
    }
  }

  const verdict = evaluateQuorum(evidencia, {
    checkpointHash: ultimo.checkpointHash,
    issuedAt: ultimo.issuedAt,
    now: ctx.ahora,
  });

  if (!verdict.firm) {
    ctx.anota('SIN_QUORUM_DE_ANCLAJE', verdict.explanation, { treeSize: ultimo.treeSize });
  }

  ctx.paso(
    'anclaje',
    verdict.firm,
    verdict.firm
      ? `registrado fuera en ${String(verdict.confirmedClasses.length)} sitios independientes: ` +
          verdict.countedProviders.join(', ')
      : 'falta la confirmación externa',
  );

  return { treeSize: ultimo.treeSize, verdict, resultados };
}

function construirProveedores(
  confianza: TrustRoster,
  cabeceras: ReadonlyMap<number, string>,
  ahora: string,
): ReadonlyMap<string, AnchorProvider> {
  const reloj = (): string => ahora;
  const fuente =
    cabeceras.size === 0
      ? NO_HEADERS
      : staticHeaders([...cabeceras].map(([altura, hex]) => [altura, fromHex(hex)] as const));

  const ots = new OpenTimestampsProvider({ headers: fuente, clock: reloj });
  const git = new SignedGitProvider({
    allowedSigners: confianza.gitSigners,
    signingKeyOffHost: confianza.gitSigningKeyOffHost,
    forges: confianza.forges,
    clock: reloj,
  });
  const correo = new WitnessEmailProvider({
    witnesses: confianza.witnesses,
    minDistinctDomains: confianza.minDistinctDomains,
    clock: reloj,
  });

  return new Map<string, AnchorProvider>([
    [ots.meta.id, ots],
    [git.meta.id, git],
    [correo.meta.id, correo],
  ]);
}

async function leerCabecerasBitcoin(source: ExportSource): Promise<ReadonlyMap<number, string>> {
  const bytes = await source.read(BITCOIN_HEADERS_FILE);
  if (bytes === undefined) return new Map();
  try {
    return parseBitcoinHeaders(BITCOIN_HEADERS_FILE, decodeText(BITCOIN_HEADERS_FILE, bytes));
  } catch {
    return new Map();
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Reimplementación independiente de §6.4 y §6.2
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * `checkpoint_hash = SHA256(0x04 ‖ JCS({treeSize, rootHash, headsRoot, prevCheckpoint?, issuedAt}))`.
 *
 * Ojo con la regla del primer sello: si no hay anterior, la clave `prevCheckpoint` se **omite**, no
 * se emite vacía ni con ceros. Un objeto de cuatro claves para el primero, cinco para los demás.
 */
export async function hashDeCheckpoint(checkpoint: {
  readonly treeSize: number;
  readonly rootHash: string;
  readonly headsRoot: string;
  readonly prevCheckpoint?: string;
  readonly issuedAt: string;
}): Promise<Uint8Array> {
  const preimagen: JsonObject = {
    treeSize: checkpoint.treeSize,
    rootHash: checkpoint.rootHash,
    headsRoot: checkpoint.headsRoot,
    ...(checkpoint.prevCheckpoint === undefined
      ? {}
      : { prevCheckpoint: checkpoint.prevCheckpoint }),
    issuedAt: checkpoint.issuedAt,
  };
  return sha256(concatBytes(Uint8Array.of(DOMAIN.checkpoint), canonicalizeToBytes(preimagen)));
}

/**
 * Raíz del censo de cabezas sobre las entradas `aggregateId(16B) ‖ seq(int64 BE) ‖ headHash(32B)`,
 * ordenadas por identificador. Se recalcula **sobre el prefijo** de registros que el sello cubre, no
 * sobre el estado final: así se comprueba el censo de CADA sello, no sólo el del último.
 */
export async function raizDeCabezas(prefijo: readonly ExportedEvent[]): Promise<Uint8Array> {
  const cabezas = new Map<string, { seq: number; hash: string }>();
  for (const registro of prefijo) {
    cabezas.set(registro.event.aggregateId, {
      seq: registro.event.seq,
      hash: registro.hashes.eventHash,
    });
  }
  const entradas = [...cabezas]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([aggregateId, cabeza]) => {
      const seq = new Uint8Array(8);
      new DataView(seq.buffer).setBigInt64(0, BigInt(cabeza.seq), false);
      return concatBytes(fromHex(aggregateId), seq, fromHex(cabeza.hash));
    });
  return (await MerkleTree.build(entradas)).root();
}

// ═════════════════════════════════════════════════════════════════════════════════════════════

function leerEvento(linea: string, index: number): ExportedEvent['event'] {
  const ruta = `${EVENTS_FILE}:${String(index + 1)}`;
  // `parseCanonical` exige que el texto sea EXACTAMENTE su propia forma canónica.
  let valor: unknown;
  try {
    valor = JSON.parse(linea);
  } catch {
    throw new ExportFormatError(ruta, 'no es JSON');
  }
  const recanonizado = canonicalizeToBytes(valor);
  if (new TextDecoder().decode(recanonizado) !== linea) {
    throw new ExportFormatError(
      ruta,
      'el texto no está en forma canónica JCS (orden de claves, espacios, escapes o duplicados)',
    );
  }
  assertEvento(valor, ruta);
  return valor;
}

function assertEvento(valor: unknown, ruta: string): asserts valor is ExportedEvent['event'] {
  // Se reutiliza el validador de `@koinonia/crypto`, que es el mismo que aplica el servidor al
  // escribir. Reimplementarlo aquí no añadiría independencia: el formato del evento ES la spec, y
  // dos lecturas distintas del mismo formato serían dos formatos.
  try {
    assertCanonicalEvent(valor);
  } catch (error) {
    throw new ExportFormatError(ruta, descripcion(error));
  }
}

function descripcion(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
