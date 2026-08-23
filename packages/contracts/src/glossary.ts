/**
 * La **regla de oro** de la interfaz (PRODUCT §7 y ADR-0041), en forma ejecutable.
 *
 * > El usuario nunca debe necesitar entender blockchain, Merkle Trees, sociocracia, Condorcet ni
 * > Event Sourcing. El rigor va en el motor y en la demostración del resultado, nunca en el rótulo.
 *
 * Una regla de estilo que sólo vive en un documento se incumple en el tercer sprint. Aquí está el
 * léxico prohibido y su traducción, y `tests/e2e` recorre las pantallas del corte vertical
 * comprobando que ninguna de esas palabras aparece en el texto visible. La jerga produce sospecha de
 * tecnocracia, y el objetivo político del proyecto es que 300 personas confíen en el resultado.
 */

/**
 * Palabras que no pueden aparecer nunca en pantalla.
 *
 * Se comparan **sin acentos y en minúscula** contra el texto visible, así que «criptográfico» cae
 * por `cripto` y «hashing» por `hash`. No están «blockchain» y «hash» por prurito: están porque una
 * sola de ellas convierte una página que explica una garantía en una página que exige un curso.
 */
export const FORBIDDEN_UI_TERMS: readonly string[] = [
  'blockchain',
  'merkle',
  'hash',
  'event sourcing',
  'event-sourcing',
  'condorcet',
  'sociocracia',
  'sociocratico',
  'schulze',
  'beatpath',
  'cripto',
  'nonce',
  'append-only',
  'ledger',
  'quorum', // se dice «participación mínima»; «quórum» con tilde tampoco pasa el normalizado
  'supermayoria',
  'payload',
  'endpoint',
  'checksum',
  'sha-256',
  'sha256',
  // ── Vocabulario del motor de la deliberación (ADR-0046, ADR-0049) ──────────────────────────
  // Todos nombran cosas que la pantalla sí muestra, y por eso están: la tentación de escribirlos
  // es real. «Grafo» y «arista» tienen traducción obligatoria —«qué sostiene qué»— porque el dibujo
  // se enseña igual, sólo que dicho en palabras; «evento» y «seq» son la fontanería del historial y
  // no le importan a nadie que quiera aportar una idea.
  'commitment',
  'evento',
  'seq',
  'grafo',
  'arista',
];

/** Traducción tecnicismo → palabra humana (tabla de PRODUCT §7). */
export const GLOSSARY: Readonly<Record<string, string>> = {
  blockchain: 'el historial no se puede alterar',
  'cadena de hashes': 'el historial no se puede alterar',
  'merkle tree': 'comprobante',
  'prueba de inclusión': 'tu comprobante',
  hash: 'huella',
  'event sourcing': 'historial',
  'consentimiento sociocrático': '¿alguien objeta?',
  sociocracia: '¿alguien objeta?',
  condorcet: 'comparación una contra una',
  'majority judgment': 'valoración por menciones',
  'mención mediana': 'la valoración típica',
  supermayoría: 'mayoría reforzada',
  'quórum de participación': 'participación mínima',
  'electorado congelado': 'quiénes podían decidir aquí',
  padrón: 'quiénes podían decidir aquí',
  'sorteo estratificado': 'sorteo con representación de todos los grupos',
  minipúblico: 'comisión sorteada',
  hhi: 'qué tan repartida está la voz',
  'democracia líquida': 'prestarle tu voto a alguien',
  driver: 'el problema',
  círculo: 'quién decide esto',
  dominio: 'qué decide sin preguntarle a nadie',
  outcome: 'qué se decidió y qué sigue',
  accountability: 'qué se hizo con lo que se decidió',
  'commit-reveal': 'el número del sorteo se anunció sellado antes y se abrió después',
  // ── Deliberación ──────────────────────────────────────────────────────────────────────────
  'grafo de aportes': 'qué sostiene qué',
  arista: 'a qué responde',
  'agregado de deliberación': 'la conversación sobre este problema',
  evento: 'lo que quedó escrito',
  etapa: 'en qué va la conversación',
  'ventana de escritura': 'hasta cuándo se puede escribir',
  'aporte tipado': 'una postura, una razón, un dato, un riesgo o una salida',
  'orden de presentación': 'el orden en que te aparecen los aportes',
  'autoría sellada': 'todavía no se ve quién escribió cada cosa',
  'alcance de etapa': 'hasta que esta etapa cierre',
  supersede: 'corrige a',
};

/**
 * Normaliza para comparar: minúsculas y sin diacríticos.
 *
 * Sin quitar los acentos, «sociocrático» pasaría el filtro de `sociocratico` y la regla sería
 * decorativa.
 */
export function normalizeForGlossary(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase();
}

/** Términos prohibidos presentes en un texto. Vacío ⇒ el texto cumple la regla de oro. */
export function forbiddenTermsIn(text: string): readonly string[] {
  const haystack = normalizeForGlossary(text);
  return FORBIDDEN_UI_TERMS.filter((term) => haystack.includes(normalizeForGlossary(term)));
}

/**
 * Traducción de cada término prohibido a una palabra humana, para el saneador de abajo.
 *
 * No es `GLOSSARY`: esa tabla traduce *frases* completas de producto («quórum de participación» →
 * «participación mínima») y no cubre todo lo que hay en `FORBIDDEN_UI_TERMS` —«schulze», «nonce»,
 * «seq», «checksum»— porque esas nunca debieron llegar a una redacción de pantalla que alguien
 * escribe a mano. Pero sí aparecen en el detalle técnico de `/integridad`, ensamblado a partir de
 * mensajes internos (`WorkspacePersistenceError`, hallazgos de bóveda) que nombran la mecánica del
 * motor porque están pensados para quien depura, no para quien lee la pantalla. Esta tabla es la
 * red de seguridad para ese texto: uno por uno, cada término prohibido tiene aquí un reemplazo
 * honesto y corto.
 */
const REEMPLAZO_TECNICO: Readonly<Record<string, string>> = {
  blockchain: 'el historial no se puede alterar',
  merkle: 'comprobante',
  hash: 'huella',
  'event sourcing': 'historial',
  'event-sourcing': 'historial',
  condorcet: 'comparación una contra una',
  sociocracia: '¿alguien objeta?',
  sociocratico: '¿alguien objeta?',
  schulze: 'comparación una contra una',
  beatpath: 'comparación una contra una',
  cripto: 'de seguridad',
  nonce: 'valor de un solo uso',
  'append-only': 'que no se puede alterar',
  ledger: 'historial',
  quorum: 'participación mínima',
  supermayoria: 'mayoría reforzada',
  payload: 'contenido',
  endpoint: 'ruta',
  checksum: 'comprobante',
  'sha-256': 'huella',
  sha256: 'huella',
  commitment: 'comprobante',
  evento: 'lo que quedó escrito',
  seq: 'número de orden',
  grafo: 'qué sostiene qué',
  arista: 'a qué responde',
};

/**
 * Sanea un texto técnico interno para que pueda mostrarse: reemplaza cada término prohibido por su
 * traducción, sin desordenar el resto de la frase.
 *
 * Existe porque el detalle técnico de `/integridad` se arma con mensajes de error internos
 * (`WorkspacePersistenceError.message`, hallazgos de la bóveda) que nombran la mecánica del motor a
 * propósito —son para quien depura un fallo real, no para redactar una pantalla— y esos mensajes no
 * pasan por `mensajeDe`. Sin este paso, un fallo de integridad (raro, pero el único momento en que
 * ese texto se ve) mostraría «ledger» o «seq» en una pantalla pública.
 *
 * El truco de la implementación: `normalizeForGlossary` no cambia el largo del texto (sólo minúsculas
 * y sin diacríticos: la 'á' compuesta se descompone en 'a' + tilde y se queda en el mismo lugar), así
 * que un índice hallado en el texto normalizado es el mismo índice en el texto original. Eso permite
 * reemplazar sin tener que lidiar con mayúsculas o acentos en el patrón de búsqueda.
 */
export function sanearTextoTecnico(texto: string): string {
  // Términos largos primero: si «event sourcing» ya se reemplazó, que «evento»... en realidad no se
  // solapan en este vocabulario, pero ordenar así evita sorpresas si algún día se solapan.
  const terminos = [...FORBIDDEN_UI_TERMS].sort((a, b) => b.length - a.length);

  const sustituir = (fuente: string, guia: string): string => {
    let resultado = '';
    let cursor = 0;
    while (cursor < fuente.length) {
      let coincidencia: { termino: string; largo: number } | undefined;
      for (const termino of terminos) {
        const buscado = normalizeForGlossary(termino);
        if (guia.startsWith(buscado, cursor)) {
          coincidencia = { termino, largo: buscado.length };
          break;
        }
      }
      if (coincidencia === undefined) {
        // `charAt` y no `fuente[cursor]`: con `noUncheckedIndexedAccess` el indexado devuelve
        // `string | undefined`, y acá el cursor siempre está dentro del rango.
        resultado += fuente.charAt(cursor);
        cursor += 1;
      } else {
        resultado += REEMPLAZO_TECNICO[coincidencia.termino] ?? coincidencia.termino;
        cursor += coincidencia.largo;
      }
    }
    return resultado;
  };

  const normalizado = normalizeForGlossary(texto);

  // La correspondencia de índices entre el texto original y el normalizado es la suposición que
  // sostiene todo esto, y **no siempre se cumple**: vale para los acentos precompuestos que produce
  // cualquier teclado ('á' U+00E1 → 'a' + tilde → 'a', mismo largo), pero un texto que YA venga
  // descompuesto ('a' + U+0301, dos unidades) encoge al quitarle la tilde, y a partir de ahí cada
  // índice apunta un lugar más allá y el resultado sale cortado por la mitad. Es raro, y por eso es
  // exactamente la clase de fallo que aparece en producción y no en las pruebas.
  //
  // Si los largos no coinciden se renuncia a conservar mayúsculas y acentos y se sanea sobre el
  // texto normalizado, que sí está alineado consigo mismo. Se pierde un poco de forma; no se pierde
  // el sentido, y sobre todo no se devuelve un texto corrompido.
  return normalizado.length === texto.length
    ? sustituir(texto, normalizado)
    : sustituir(normalizado, normalizado);
}
