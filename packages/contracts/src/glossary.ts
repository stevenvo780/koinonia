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
