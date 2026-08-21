# Especificación formal 30 — DecisionEngine de Koinonía

> **Estado:** normativo. Este documento es el **contrato** contra el que se implementará
> `@koinonia/domain` y contra el que se escribirán los property-based tests (fast-check).
> Toda ambigüedad detectada aquí es un bug de esta especificación, no una libertad de la
> implementación.
>
> **Ámbito:** el `DecisionEngine` es una función pura
> `replay(events: readonly DecisionEvent[]) => DecisionState` más un escrutinio puro
> `tally(config, electorate, ballots, delegations, seed) => DecisionResult`.
> Sin I/O, sin reloj, sin `Math.random()`, sin dependencias de framework. El tiempo y la
> aleatoriedad entran **como datos** (instantes y semillas), nunca como efectos.
>
> **Versión:** 30.0.0 · **Fecha:** 2026-08-21 · **Zona horaria de referencia:** `America/Bogota` (UTC−05:00, sin DST).

---

## 0. Preámbulo

### 0.1 Principios de diseño

1. **Determinismo total.** Dado el mismo log de eventos, el resultado es idéntico *bit a bit*,
   en cualquier máquina, en cualquier momento, para siempre. Esto excluye: iteración sobre
   `Object.keys` sin ordenar, `Set`/`Map` con orden de inserción como fuente de verdad,
   `Array.prototype.sort` sin comparador total, aritmética de punto flotante en las decisiones
   de comparación, y cualquier lectura de reloj dentro del escrutinio.
2. **Auditabilidad por un humano no técnico.** Todo `DecisionResult` viaja con una `Proof`:
   una secuencia de pasos que un estudiante de filosofía puede leer y verificar a mano con la
   tabla de papeletas. Si un método no puede producir una prueba legible, no entra en la
   plataforma.
3. **Aritmética exacta.** Todas las comparaciones de umbral se hacen con **enteros** o con
   **fracciones exactas** (`{ num: bigint; den: bigint }`). Prohibido comparar `0.6666666`
   contra `2/3`. Las medias de puntuación se representan como fracción exacta y sólo se
   redondean **para mostrar**, nunca para decidir.
4. **El léxico técnico no se filtra a la interfaz.** El motor es riguroso; la UI habla castellano
   común.
5. **Fallar cerrado.** Ante entrada inválida el motor **rechaza el evento**; nunca "interpreta
   caritativamente" una papeleta malformada.

### 0.2 Vocabulario interno → visible

| Concepto interno | Cómo se nombra en la interfaz |
|---|---|
| Condorcet / matriz de pares | «comparación una contra una» |
| Método de Schulze / beatpath | «cadena de apoyos más fuerte» |
| Ciclo de Condorcet | «empate circular: A gana a B, B gana a C, C gana a A» |
| Majority Judgment (Balinski–Laraki) | «valoración por menciones» |
| Mención mediana | «la valoración típica» |
| IRV / voto alternativo | «rondas con eliminación» |
| Papeleta agotada | «papeleta sin opciones vivas» |
| Score voting | «puntuación de 0 a 5» |
| Consentimiento sociocrático | «¿alguien objeta?» |
| Quórum de participación | «participación mínima» |
| Supermayoría | «mayoría reforzada» |
| Electorado congelado | «quiénes podían votar» |
| Sorteo estratificado | «sorteo con representación de todos los grupos» |
| Índice de concentración (HHI) | «qué tan repartida está la voz» |

> **DECISIÓN 0.A:** la palabra «Condorcet» (y «Schulze», «Balinski», «IRV», «HHI») **no puede
> aparecer en ningún string de `@koinonia/contracts` destinado a la UI**. Se prohíbe por lint:
> una regla de ESLint con una lista negra de términos sobre los archivos `*.i18n.ts`.
> *Razón:* el objetivo político del proyecto es que 300 personas confíen en el resultado; la
> jerga produce sospecha de tecnocracia. El rigor va en el motor y en la `Proof`, no en el rótulo.

### 0.3 Notación

- `N` = tamaño del censo (`electorate.censusSize`).
- `C` = número de papeletas emitidas y válidas (*cast*), incluyendo abstenciones explícitas.
- `V` = número de papeletas **computables** para el umbral (según `abstentionPolicy`).
- `W(x)` = peso de voto efectivo del miembro `x` en el escrutinio (1 + delegaciones recibidas, tras cap).
- `m` = número de opciones/candidaturas. `k` = número de menciones (grados).
- Fracciones exactas: `p/q` con `q > 0`, comparadas por multiplicación cruzada.

---

# PARTE A — MODELO DE DOMINIO

## A.1 Tipos base y marcas nominales

```ts
// packages/domain/src/kernel/brands.ts
declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

/** Identificador seudónimo estable de una persona. NO es la cédula ni el correo. */
export type MemberId   = Brand<string, 'MemberId'>;
export type CircleId   = Brand<string, 'CircleId'>;
export type TopicId    = Brand<string, 'TopicId'>;   // etiqueta temática de delegación
export type DecisionId = Brand<string, 'DecisionId'>;
export type ProposalId = Brand<string, 'ProposalId'>;
export type OptionId   = Brand<string, 'OptionId'>;
export type BallotId   = Brand<string, 'BallotId'>;
export type EventId    = Brand<string, 'EventId'>;

/** SHA-256 en hex minúscula, 64 caracteres. */
export type Hash = Brand<string, 'Hash'>;

/** Milisegundos desde epoch UTC. Asignado SIEMPRE por el servidor, nunca por el cliente. */
export type Instant = Brand<number, 'Instant'>;

/** Fracción exacta no negativa. Invariante: den > 0n. */
export interface Fraction { readonly num: bigint; readonly den: bigint; }

/** Compara a ⋛ b sin punto flotante. Devuelve -1 | 0 | 1. */
export function cmpFraction(a: Fraction, b: Fraction): -1 | 0 | 1 {
  const l = a.num * b.den, r = b.num * a.den;
  return l < r ? -1 : l > r ? 1 : 0;
}
```

> **DECISIÓN A.0:** `MemberId` es un **valor aleatorio de 128 bits** generado con CSPRNG
> (`crypto.randomBytes(16)`, base32) en el alta, **sin ninguna relación derivable** con el
> documento de identidad, el correo ni ningún otro dato personal. Se genera y se guarda en el
> PII Vault antes de emitir cualquier evento; el motor **nunca** ve datos personales.
> *Razón:* permite publicar el padrón y el log completo sin violar la Ley 1581 de 2012 (habeas
> data, Colombia), y hace que la auditoría ciudadana sea posible sin ser una filtración.
>
> > **Corregido por resolución R1 del arquitecto (2026-08-21):** la redacción anterior definía
> > `MemberId = base32(truncate128(HMAC-SHA256(claveInstitucional, documento)))` y queda
> > **ANULADA**. Un identificador derivado es re-derivable por cualquiera que posea el dato de
> > origen (la clave institucional más la lista de documentos), lo que vuelve ficticio el borrado
> > y permite confirmar pertenencia por diccionario sobre un espacio de ~300 personas. Ver
> > `docs/adr/0006-memberid-aleatorio-de-128-bits.md` y `docs/research/00-contradicciones-resueltas.md`.
> > El HMAC sobre el documento sobrevive únicamente como `enrollmentTag` **dentro del PII Vault**,
> > para detectar altas duplicadas, y se borra con el registro; nunca sale de la bóveda.

### A.1.1 Canonicalización y hashing

Todo hash de esta especificación es:

```ts
hash(x) = sha256Hex( utf8( jcs( x ) ) )   // jcs = JSON Canonicalization Scheme, RFC 8785
```

Reglas adicionales obligatorias **antes** de aplicar JCS:
1. Toda colección que represente un conjunto se serializa como **arreglo ordenado
   ascendentemente por su clave**, con comparación **byte a byte del UTF-8** (`<` sobre code
   points), no `localeCompare`.
2. Ningún campo `undefined`; ausencia se representa omitiendo la clave.
3. Ningún `number` con parte fraccionaria en estructuras hasheadas; las fracciones van como
   `{ num: "2", den: "3" }` (bigint serializado como string decimal).

> **DECISIÓN A.0.b:** se prohíbe `localeCompare` en todo `packages/domain`. Regla de lint.
> *Razón:* `localeCompare` depende de ICU y de la locale del proceso ⇒ el hash del padrón podría
> diferir entre el servidor y el verificador independiente. Es un fallo de reproducibilidad
> silencioso y catastrófico.

## A.2 `Electorate` — el padrón congelado

```ts
export type StratumKey   = Brand<string, 'StratumKey'>;   // p.ej. 'semestre', 'jornada', 'genero'
export type StratumValue = Brand<string, 'StratumValue'>;

export interface EligibleMember {
  readonly memberId: MemberId;
  /** Peso base. SIEMPRE 1. El poder desigual sólo puede venir de delegación explícita. */
  readonly baseWeight: 1;
  /** Círculos a los que pertenece en el instante de congelación. Ordenado. */
  readonly circles: readonly CircleId[];
  /** Atributos para sorteo estratificado y para quórum por círculo. Claves ordenadas. */
  readonly strata: Readonly<Record<StratumKey, StratumValue>>;
}

export interface Electorate {
  readonly snapshotId: Hash;              // == rollHash, sirve de identidad
  /** Instante EXACTO de congelación. Coincide con DecisionOpened.occurredAt. */
  readonly frozenAt: Instant;
  /** Ordenada ascendentemente por memberId (orden byte a byte). Sin duplicados. */
  readonly members: readonly EligibleMember[];
  readonly censusSize: number;            // === members.length
  /** hash({ frozenAt, registryVersion, members }) */
  readonly rollHash: Hash;
  /** Versión monotónica del registro institucional de matrícula del que se derivó. */
  readonly registryVersion: number;
  /** Criterio legible: "matriculados activos del Instituto de Filosofía al 2026-08-21". */
  readonly criterion: string;
}
```

### A.2.1 Quién entra y quién sale

> **DECISIÓN A.1 — El padrón se congela en la transición `Draft → Open` y es inmutable.**
> Quien se matricula **después** del instante `frozenAt` **no vota** en esa decisión, aunque la
> ventana siga abierta.
>
> *Razón (tres, independientes):*
> (a) **Denominadores estables.** Quórum, supermayoría sobre censo y el cap de concentración se
> definen sobre `N`. Con un `N` móvil, «2/3 del censo» deja de ser una proposición con valor de
> verdad hasta que cierra la votación, y peor: un mismo conjunto de votos puede pasar y luego
> fallar. La reproducibilidad exige `N` fijo.
> (b) **Anti-manipulación.** Un padrón abierto durante la votación permite el ataque clásico de
> *ballot stuffing* administrativo: matricular aliados cuando ya se conoce el marcador parcial.
> (c) **Auditoría.** Publicamos `rollHash` al abrir; cualquiera puede verificar que el conteo se
> hizo sobre exactamente ese conjunto.
>
> *Mitigación del costo:* la injusticia de excluir a un recién llegado se compensa con
> **ventanas cortas** (72 h por defecto) y con `Decision.recurrence` para decisiones periódicas.

> **DECISIÓN A.2 — Quien se retira, es dado de baja o pierde la matrícula después de haber
> votado: su voto CUENTA, y además sigue contando en el denominador `N`.**
>
> *Razón:*
> (a) La papeleta fue emitida por alguien que **era** elegible en el instante de emitirla; la
> legitimidad de un acto se juzga por las condiciones en el momento del acto (*tempus regit
> actum*).
> (b) Si el retiro borrara votos, el resultado dependería de hechos posteriores al cierre del
> padrón ⇒ se rompe la reproducibilidad y el resultado deja de ser una función del log.
> (c) **Ataque de deserción:** una minoría que va perdiendo podría retirarse en masa para tumbar
> el quórum o para vaciar el numerador. Este ataque es real en asambleas estudiantiles y hay que
> cerrarlo por diseño.
>
> *Contraparte reconocida:* el caso «votó alguien que suplantó una identidad» o «un expulsado por
> fraude». Ese caso **no** se resuelve por la vía del retiro, sino con el evento excepcional
> `BallotVoided`, que exige (i) motivación escrita, (ii) firma de dos miembros del círculo de
> garantías, (iii) queda en el log como acto público y recurrible. Anular un voto es un acto
> político visible, no un efecto colateral de una baja administrativa.

> **DECISIÓN A.3 — Quien se retira SIN haber votado no vota, pero permanece en `N`.**
> Su ausencia se computa como no participación. *Razón:* misma razón (c) de A.2; sacarlo de `N`
> permitiría fabricar quórum reduciendo el denominador.

## A.3 `DecisionMethod` — unión discriminada

```ts
/** Qué se hace con las abstenciones explícitas al calcular el umbral. */
export type AbstentionPolicy =
  | 'exclude'   // abstención NO va al denominador del umbral (default)
  | 'include'   // abstención va al denominador ⇒ abstenerse equivale a votar NO
  | 'as-no';    // abstención se computa como voto negativo (raro; sólo por mandato estatutario)

export type ThresholdBase =
  | 'cast'      // sobre papeletas computables (V)
  | 'census'    // sobre el censo congelado (N)
  | 'present';  // sobre quienes participaron de la deliberación sincrónica (requiere registro)

export interface TieBreakPolicy {
  /** Cascada ordenada. Se evalúa en orden; el primero que discrimina, decide. */
  readonly cascade: readonly TieBreakRule[];
  /** Última instancia SIEMPRE presente e implícita: 'lexicographic-hash'. */
}

export type TieBreakRule =
  | 'more-first-preferences'   // más primeras preferencias
  | 'more-approvals'           // más aprobaciones
  | 'higher-median'            // mención mediana superior
  | 'fewer-rejections'         // menos menciones mínimas
  | 'pairwise-head-to-head'    // ganó el enfrentamiento directo entre las empatadas
  | 'earlier-proposal'         // la propuesta radicada primero (por seq del evento)
  | 'public-seed-lot'          // sorteo con semilla comprometida (commit–reveal)
  | 'lexicographic-hash';      // determinista final: menor hash(decisionId || optionId)

export interface GradeScale {
  /** De MEJOR a PEOR. Índice 0 = mejor. Longitud k ∈ [3, 7]. */
  readonly grades: readonly { readonly id: GradeId; readonly label: string }[];
}
export type GradeId = Brand<string, 'GradeId'>;

export type DecisionMethod =
  | { readonly kind: 'simple-majority';
      readonly abstentionPolicy: AbstentionPolicy;
      readonly base: ThresholdBase;               // normalmente 'cast'
      readonly tieBreak: TieBreakPolicy; }

  | { readonly kind: 'supermajority';
      readonly fraction: Fraction;                // 2/3, 3/4 …
      readonly strict: boolean;                   // true ⇒ '>' ; false ⇒ '≥'
      readonly base: ThresholdBase;
      readonly abstentionPolicy: AbstentionPolicy;
      readonly tieBreak: TieBreakPolicy; }

  | { readonly kind: 'unanimity';
      readonly base: Extract<ThresholdBase, 'cast' | 'census'>;
      readonly abstentionBlocks: boolean; }       // ¿la abstención rompe la unanimidad?

  | { readonly kind: 'sociocratic-consent';
      readonly maxRounds: number;                 // ≥1, default 3
      readonly admissibility: ObjectionAdmissibilityConfig;
      readonly silenceMeans: 'consent' | 'not-participating';
      readonly minEngagement: Fraction; }         // fracción del círculo que debe manifestarse

  | { readonly kind: 'score';
      readonly min: 0; readonly max: 5;
      readonly aggregator: 'mean' | 'median';
      readonly noOpinionPolicy: 'ignore' | 'as-zero';   // ver B.5
      readonly minCoverage: Fraction;             // cobertura mínima por opción
      readonly tieBreak: TieBreakPolicy; }

  | { readonly kind: 'irv';
      readonly exhaustedPolicy: 'reduce-quota' | 'fixed-quota';
      readonly eliminationTieBreak: TieBreakPolicy;
      readonly allowTruncation: boolean;
      readonly tieBreak: TieBreakPolicy; }

  | { readonly kind: 'majority-judgment';
      readonly scale: GradeScale;
      readonly missingGradePolicy: 'worst' | 'reject-ballot';
      readonly tieBreak: TieBreakPolicy; }        // sólo actúa TRAS el desempate B–L

  | { readonly kind: 'condorcet-schulze';
      readonly allowTruncation: boolean;
      readonly truncatedMeans: 'tied-last' | 'ranked-last';
      readonly tieBreak: TieBreakPolicy; }

  | { readonly kind: 'deliberative-sortition';
      readonly sampleSize: number;
      readonly strata: readonly StratumKey[];
      readonly allocation: 'proportional' | 'equal';
      readonly seedCommitment: Hash; };           // commit publicado ANTES de abrir
```

## A.4 `Ballot` — papeleta polimórfica

```ts
export type Score = 0 | 1 | 2 | 3 | 4 | 5;

export interface Objection {
  readonly objectionId: Brand<string, 'ObjectionId'>;
  /** Texto obligatorio. Mínimo 40 caracteres tras normalizar espacios. */
  readonly argument: string;
  /** Qué objetivo del círculo se daña. Obligatorio: ancla la objeción en el fin común. */
  readonly harmedAim: string;
  /** Propuesta de enmienda. Opcional pero fuertemente incentivada en la UI. */
  readonly proposedAmendment?: string;
  readonly raisedAtRound: number;
}

export type BallotPayload =
  /** Abstención EXPLÍCITA. Distinta del silencio (no emitir papeleta). */
  | { readonly kind: 'abstain' }

  /** Sí/No para mayoría, supermayoría, unanimidad. */
  | { readonly kind: 'binary'; readonly approve: boolean }

  /** Aprobación múltiple (varias opciones simultáneas). */
  | { readonly kind: 'approval'; readonly approved: readonly OptionId[] }

  /** Puntuación. `null` = "sin opinión" ≠ 0. Claves = TODAS las opciones vivas. */
  | { readonly kind: 'score'; readonly scores: Readonly<Record<OptionId, Score | null>> }

  /** Ranking. `order` sin repetidos. Puede ser parcial si allowTruncation. */
  | { readonly kind: 'ranking'; readonly order: readonly OptionId[] }

  /** Menciones verbales, una por opción. */
  | { readonly kind: 'grades'; readonly grades: Readonly<Record<OptionId, GradeId>> }

  /** Consentimiento sociocrático. */
  | { readonly kind: 'consent';
      readonly stance: 'consent' | 'concern' | 'object';
      /** Obligatorio ⟺ stance === 'object'. */
      readonly objection?: Objection };

export interface Ballot {
  readonly ballotId: BallotId;
  readonly decisionId: DecisionId;
  /** Autor. En modo 'secret-ballot' este campo está en la capa sellada, no en la de escrutinio. */
  readonly voter: MemberId;
  /** Ronda a la que pertenece (métodos multironda). Default 1. */
  readonly round: number;
  readonly payload: BallotPayload;
  /** Instante asignado por el servidor al aceptar el evento BallotCast. */
  readonly castAt: Instant;
  /** seq del evento BallotCast. Orden canónico total. */
  readonly seq: number;
  /** hash de la versión exacta de la propuesta que el votante tenía a la vista. */
  readonly proposalVersionHash: Hash;
}
```

> **DECISIÓN A.4 — La papeleta NO almacena el peso de voto.** El peso se resuelve durante el
> escrutinio, a partir del estado de delegaciones vigente **en el instante de cierre**.
> *Razón:* si el peso se congelara al emitir, una revocación posterior de delegación no tendría
> efecto sobre una papeleta ya emitida, contradiciendo «revocable en cualquier momento». Resolver
> al cierre hace que la revocación sea exacta y hace que el escrutinio sea una función pura del
> par (papeletas, grafo de delegación en `closeAt`).

> **DECISIÓN A.5 — Idempotencia por última papeleta.** Un miembro puede emitir varias papeletas
> mientras la decisión esté `Open`; **sólo cuenta la de mayor `seq`** para esa `(decisionId,
> voter, round)`. Las anteriores quedan en el log marcadas `superseded`.
> *Razón:* cambiar de opinión tras leer la deliberación es una virtud, no un fraude; y la regla
> «la última manda» es trivialmente auditable y hace que reintentos de red no dupliquen votos.
> *Consecuencia para tests:* `tally` debe ser invariante ante duplicados con distinto `seq`.

> **DECISIÓN A.6 — `proposalVersionHash` obligatorio en toda papeleta.** Si la propuesta se
> enmienda estando `Open` (sólo posible en `sociocratic-consent`), todas las papeletas cuyo
> `proposalVersionHash` no coincida con la versión vigente quedan **invalidadas para el
> escrutinio de la ronda nueva** y sus autores son notificados para revotar.
> *Razón:* consentir un texto es consentir *ese* texto. Arrastrar consentimientos a un texto
> enmendado es falsificar la voluntad. Es el fallo más común de las herramientas de consenso.

## A.5 `DecisionConfig` — configuración congelada

```ts
export type PrivacyMode =
  /** Voto nominal público en tiempo real. Rendición de cuentas máxima. */
  | 'public-roll-call'
  /** Papeletas selladas hasta el cierre; al cerrar se publica el detalle seudónimo. */
  | 'sealed-tally'
  /** Secreto perpetuo: sólo se publican agregados. Delegación PROHIBIDA (ver C.7). */
  | 'secret-ballot';

export interface QuorumConfig {
  /** Participación mínima: (papeletas emitidas incl. abstenciones) / N. */
  readonly participation: Fraction;
  /** Aprobación mínima sobre censo, independiente del umbral del método. Opcional. */
  readonly approvalOfCensus?: Fraction;
  /** Participación mínima exigida DENTRO de cada círculo listado. */
  readonly perCircle?: readonly { readonly circleId: CircleId; readonly min: Fraction }[];
  /** Qué hacer si no se alcanza. Ver PARTE D. */
  readonly onFailure: 'reject' | 'extend' | 'escalate';
  readonly maxExtensions: number;          // ≥0, default 1
  readonly extensionDuration: number;      // ms
}

export interface WindowConfig {
  readonly opensAt: Instant;
  readonly closesAt: Instant;              // exclusivo: válido ⟺ castAt < closesAt
  readonly timezone: 'America/Bogota';     // sólo para render; el motor usa Instant UTC
  readonly earlyClose: EarlyCloseConfig;
  /** Ventana de impugnación tras el cierre, antes de ratificar. ms. Default 72 h. */
  readonly challengeWindow: number;
}

export interface EarlyCloseConfig {
  readonly enabled: boolean;
  readonly mode: 'mathematically-irreversible' | 'full-turnout' | 'never';
}

export interface DecisionConfig {
  readonly decisionId: DecisionId;
  readonly proposalId: ProposalId;
  /** Hash de la versión EXACTA del texto sometido a decisión. */
  readonly proposalVersionHash: Hash;
  readonly circleId: CircleId;
  readonly topics: readonly TopicId[];      // para resolver delegaciones por tema
  readonly options: readonly OptionId[];    // ordenada; ≥1
  readonly electorate: Electorate;
  readonly method: DecisionMethod;
  readonly quorum: QuorumConfig;
  readonly window: WindowConfig;
  readonly privacy: PrivacyMode;
  readonly delegation: DelegationConfig;    // ver PARTE C
  /** Commit de la semilla pública (sorteo/desempates). Publicado ANTES de opensAt. */
  readonly seedCommitment: Hash;
  /** hash de TODO lo anterior. Identidad criptográfica de las reglas del juego. */
  readonly configHash: Hash;
  /** Versión del motor. Cambiar el algoritmo obliga a subir esto. */
  readonly engineVersion: string;           // semver, p.ej. "30.0.0"
}
```

> **DECISIÓN A.7 — `configHash` incluye `engineVersion`.** Un cambio de algoritmo produce un
> `configHash` distinto ⇒ una decisión abierta bajo el motor 30.0.0 se re-escruta siempre con
> 30.0.0, aunque el servidor ya corra 31.x. El binario debe conservar los escrutadores
> históricos en `packages/domain/src/tally/vNN/`.
> *Razón:* «las reglas no se cambian a mitad del partido» es un principio de legitimidad, y
> además es la única forma de que la reproducibilidad histórica sobreviva a un refactor.

## A.6 `DecisionResult` — resultado con su demostración

```ts
export type Outcome =
  | { readonly kind: 'approved';  readonly option?: OptionId }
  | { readonly kind: 'rejected';  readonly reason: 'threshold-not-met' | 'objections-pending' }
  | { readonly kind: 'no-quorum'; readonly achieved: Fraction; readonly required: Fraction }
  | { readonly kind: 'winner';    readonly option: OptionId; readonly tieBroken: boolean }
  | { readonly kind: 'tie-unresolved'; readonly options: readonly OptionId[] }  // sólo si falla toda la cascada (imposible por diseño; ver B.0)
  | { readonly kind: 'sample';    readonly selected: readonly MemberId[] }
  | { readonly kind: 'needs-new-round'; readonly nextRound: number };

/** Un paso de la demostración. Debe ser renderizable como una frase en español. */
export interface ProofStep {
  readonly id: string;                       // 'S1', 'S2'…
  readonly claim: string;                    // "Se emitieron 187 papeletas de 300 posibles."
  readonly evidence: Readonly<Record<string, string | number>>;
  /** Referencias a eventos que sustentan el paso, por seq. */
  readonly supportingSeqs: readonly number[];
}

export interface Proof {
  readonly steps: readonly ProofStep[];
  /** Tablas intermedias legibles: matriz de pares, rondas de IRV, histograma de menciones… */
  readonly tables: readonly ProofTable[];
  /** Narrativa de 1 párrafo, generada por plantilla determinista, sin jerga. */
  readonly narrative: string;
}

export interface ProofTable {
  readonly title: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly (string | number))[][];
}

export interface DecisionResult {
  readonly decisionId: DecisionId;
  readonly configHash: Hash;
  readonly rollHash: Hash;
  readonly engineVersion: string;
  readonly computedFromSeq: number;          // último seq incluido
  readonly outcome: Outcome;
  readonly turnout: { readonly cast: number; readonly census: number; readonly fraction: Fraction };
  readonly weights: { readonly totalWeight: number; readonly hhi: Fraction; readonly gini: Fraction };
  readonly quorumCheck: { readonly passed: boolean; readonly detail: Readonly<Record<string, boolean>> };
  readonly proof: Proof;
  /** hash del resultado completo salvo este campo. Se ancla en el evento ResultComputed. */
  readonly resultHash: Hash;
}
```

> **DECISIÓN A.8 — El resultado es un dato derivado, no una fuente de verdad.** `ResultComputed`
> almacena `resultHash`, y cualquier auditor puede recomputar desde los eventos y comparar. Si
> difiere, el sistema entra en `Annulled` automático por «inconsistencia de escrutinio».
> *Razón:* separa «lo que pasó» (eventos) de «lo que concluimos» (resultado), y convierte un bug
> de escrutinio en una alarma en vez de en un fraude silencioso.

## A.7 Eventos

```ts
export interface EventEnvelope<T> {
  readonly eventId: EventId;
  readonly decisionId: DecisionId;
  /** Monotónico, denso (1,2,3…), único por decisión. Orden canónico de replay. */
  readonly seq: number;
  readonly occurredAt: Instant;              // reloj del SERVIDOR
  readonly actor: MemberId | 'system';
  readonly payload: T;
  readonly prevHash: Hash;                   // hash del evento seq-1, o 64 ceros si seq===1
  readonly hash: Hash;                       // hash({eventId,decisionId,seq,occurredAt,actor,payload,prevHash})
}

export type DecisionEventPayload =
  | { readonly type: 'DecisionDrafted';   readonly draft: DraftConfig }
  | { readonly type: 'DecisionOpened';    readonly config: DecisionConfig }
  | { readonly type: 'BallotCast';        readonly ballot: Ballot }
  | { readonly type: 'BallotVoided';      readonly ballotId: BallotId; readonly motivation: string; readonly signers: readonly MemberId[] }
  | { readonly type: 'DelegationGranted'; readonly delegation: Delegation }
  | { readonly type: 'DelegationRevoked'; readonly delegationId: DelegationId; readonly at: Instant }
  | { readonly type: 'ObjectionRaised';   readonly objection: Objection; readonly by: MemberId }
  | { readonly type: 'ObjectionAdmitted'; readonly objectionId: string; readonly panel: readonly MemberId[]; readonly votes: number }
  | { readonly type: 'ObjectionDismissed';readonly objectionId: string; readonly panel: readonly MemberId[]; readonly motivation: string }
  | { readonly type: 'ObjectionIntegrated'; readonly objectionId: string; readonly newProposalVersionHash: Hash }
  | { readonly type: 'ObjectionWithdrawn'; readonly objectionId: string }
  | { readonly type: 'RoundOpened';       readonly round: number; readonly proposalVersionHash: Hash }
  | { readonly type: 'WindowExtended';    readonly newClosesAt: Instant; readonly reason: 'quorum' }
  | { readonly type: 'SeedRevealed';      readonly seed: string; readonly commitment: Hash }
  | { readonly type: 'DecisionClosed';    readonly at: Instant; readonly cause: 'window' | 'early-irreversible' | 'full-turnout' | 'manual' }
  | { readonly type: 'ResultComputed';    readonly resultHash: Hash; readonly outcomeKind: Outcome['kind'] }
  | { readonly type: 'DecisionRatified' }
  | { readonly type: 'DecisionRejected';  readonly reason: string }
  | { readonly type: 'DecisionAnnulled';  readonly motivation: string; readonly signers: readonly MemberId[] };
```

> **DECISIÓN A.9 — El orden canónico de replay es por `seq`, NUNCA por `occurredAt`.**
> *Razón:* dos eventos pueden compartir milisegundo. Un orden por timestamp no es total ⇒ el
> escrutinio dejaría de ser determinista exactamente en el caso más litigioso (dos votos en el
> instante del cierre). `seq` es asignado por el store con exclusión mutua (columna
> `UNIQUE(decision_id, seq)` + escritura optimista con reintento).

> **DECISIÓN A.10 — `occurredAt` es el reloj del servidor, y es el único válido para la ventana.**
> El cliente puede enviar su `clientAt`, que se guarda como metadato informativo y **no** tiene
> efecto jurídico. *Razón:* el reloj del cliente es controlado por el atacante.

## A.8 Máquina de estados

```
                 ┌──────────┐
                 │  Draft   │
                 └────┬─────┘
        open()        │            discard()
   ┌──────────────────┼──────────────────────────┐
   ▼                  │                          ▼
┌──────┐              │                    ┌──────────┐
│ Open │──────────────┘                    │ Annulled │◄────────┐
└──┬───┘                                   └──────────┘         │
   │ close(window | early | manual)             ▲               │
   ▼                                            │ annul()       │ annul()
┌────────┐                                      │               │
│ Closed │──────────────────────────────────────┘               │
└──┬──┬──┘                                                      │
   │  │ ratify()  (auto tras challengeWindow, si outcome favorable y sin impugnación admitida)
   │  ▼                                                         │
   │ ┌───────────┐                                              │
   │ │ Ratified  │──────────────────────────────────────────────┘
   │ └───────────┘
   │ reject()  (umbral no alcanzado | quórum fallido con onFailure='reject' | objeción pendiente tras maxRounds)
   ▼
┌───────────┐
│ Rejected  │
└───────────┘
```

### A.8.1 Transiciones legales

| Desde | Evento | Hacia | Precondiciones |
|---|---|---|---|
| `Draft` | `DecisionOpened` | `Open` | config válida ∧ `censusSize ≥ 1` ∧ `opensAt ≤ now < closesAt` ∧ `seedCommitment` publicado ∧ `options.length ≥ 1` |
| `Draft` | `DecisionAnnulled` | `Annulled` | actor con permiso de autoría |
| `Open` | `BallotCast` | `Open` | ver D.3 |
| `Open` | `DelegationGranted/Revoked` | `Open` | ver PARTE C |
| `Open` | `ObjectionRaised/…` | `Open` | método `sociocratic-consent` |
| `Open` | `RoundOpened` | `Open` | `round ≤ maxRounds` ∧ hubo `ObjectionIntegrated` |
| `Open` | `WindowExtended` | `Open` | `extensionsUsed < maxExtensions` ∧ evento emitido **antes** de `closesAt` |
| `Open` | `DecisionClosed` | `Closed` | `now ≥ closesAt` ∨ cierre anticipado válido (D.4) ∨ cierre manual con 2 firmas |
| `Open` | `DecisionAnnulled` | `Annulled` | vicio grave motivado + 2 firmas del círculo de garantías |
| `Closed` | `SeedRevealed` | `Closed` | `sha256(seed) === seedCommitment` |
| `Closed` | `ResultComputed` | `Closed` | semilla revelada si el método o el desempate la requiere |
| `Closed` | `DecisionRatified` | `Ratified` | `now ≥ closedAt + challengeWindow` ∧ outcome ∈ {approved, winner, sample} ∧ sin impugnación admitida |
| `Closed` | `DecisionRejected` | `Rejected` | outcome ∈ {rejected, no-quorum(reject), objections-pending} |
| `Closed` | `DecisionAnnulled` | `Annulled` | impugnación admitida ∨ `resultHash` recomputado ≠ almacenado |

### A.8.2 Transiciones PROHIBIDAS (deben lanzar `IllegalTransitionError`)

1. `Closed → Open` (reapertura). **Nunca.** Se crea una **nueva** decisión con
   `supersedes: DecisionId`. *Razón:* reabrir una urna cuyo marcador ya se conoce destruye el
   secreto del voto y permite el ataque de «votación hasta que gane mi lado».
2. `Ratified | Rejected | Annulled → *` (todos terminales). Corregir un error exige una nueva
   decisión que derogue la anterior.
3. `Draft → Closed`, `Draft → Ratified`, `Open → Ratified` (saltarse el escrutinio).
4. `BallotCast` en `Draft`, `Closed`, `Ratified`, `Rejected`, `Annulled`.
5. `WindowExtended` con `newClosesAt ≤ closesAt` (retroceder el cierre) o emitido después de
   `closesAt` (resucitar una urna cerrada).
6. `DecisionOpened` dos veces (padrón recongelado).
7. `ObjectionRaised` con `round > maxRounds`.
8. `SeedRevealed` cuyo `sha256(seed) ≠ seedCommitment` ⇒ además dispara `Annulled` automático.
9. Cualquier evento con `prevHash ≠ hash(evento seq-1)` ⇒ log corrupto, la decisión entra en
   cuarentena y no puede ratificarse.

> **DECISIÓN A.11 — La prórroga por quórum NO es un cambio de estado, es un evento dentro de
> `Open`.** *Razón:* modelarla como estado (`Extended`) duplicaría todas las transiciones de
> `Open` y no aporta información; el número de prórrogas usadas es un contador derivable del log.


---

# PARTE B — MÉTODOS DE ESCRUTINIO

## B.0 Marco común

### B.0.1 Pesos y papeletas efectivas

Antes de aplicar cualquier método, el escrutinio produce el conjunto de **papeletas efectivas**:

```ts
export interface EffectiveBallot {
  readonly voter: MemberId;          // emisor real
  readonly payload: BallotPayload;
  readonly weight: number;           // entero ≥ 1, resultado de PARTE C
  readonly seq: number;              // para desempates estables
  readonly onBehalfOf: readonly MemberId[];  // delegantes representados, ordenado
}

/** Precondiciones verificadas antes de cualquier método (fallar cerrado). */
function precheck(cfg: DecisionConfig, bs: readonly EffectiveBallot[]): void {
  assert(bs.every(b => Number.isInteger(b.weight) && b.weight >= 1));
  assert(new Set(bs.map(b => b.voter)).size === bs.length);          // 1 papeleta por votante
  assert(bs.every(b => cfg.electorate.members.some(m => m.memberId === b.voter)));
  assert(sum(bs.map(b => b.weight)) <= cfg.electorate.censusSize);   // INV-21
}
```

> **DECISIÓN B.0.a — Todos los pesos son enteros.** La delegación transfiere unidades enteras de
> voto; el cap de concentración (C.5) nunca produce fracciones. *Razón:* la aritmética entera es
> exacta, hasheable y explicable («Marta votó por 7 personas»). Los pesos fraccionarios producen
> resultados imposibles de verificar a mano y errores de redondeo que cambian ganadores.

### B.0.2 Desempate determinista: la cascada

Todo método termina con `breakTie(candidatos empatados, contexto)`. La cascada se evalúa en
orden; la **última regla es siempre `lexicographic-hash`**, que es un orden total estricto sobre
`OptionId` ⇒ **la cascada nunca puede fallar**. El outcome `tie-unresolved` sólo puede aparecer
si la implementación está rota (y hay un invariante que lo prohíbe: INV-13).

```ts
function lexicographicHashOrder(decisionId: DecisionId, opts: readonly OptionId[]): readonly OptionId[] {
  return [...opts]
    .map(o => ({ o, h: sha256Hex(`${decisionId}|${o}`) }))
    .sort((a, b) => a.h < b.h ? -1 : a.h > b.h ? 1 : 0)   // comparación byte a byte
    .map(x => x.o);
}
```

> **DECISIÓN B.0.b — El desempate final es `hash(decisionId || optionId)`, no el orden de
> registro ni el alfabético.** *Razón:* el orden alfabético premia sistemáticamente a
> «Asamblea…» sobre «Zoología…» a lo largo de cientos de decisiones; el orden de registro premia
> a quien madruga a radicar. El hash con `decisionId` es imparcial *a lo largo del tiempo*
> (cada decisión permuta distinto) y es verificable por cualquiera con `sha256sum`. Y es
> determinista, que es la propiedad no negociable.

### B.0.3 Sorteo verificable: commit–reveal con faro externo

Cuando la cascada llega a `public-seed-lot` (o el método es `deliberative-sortition`):

```
seed = sha256( seedAdmin || "|" || beaconValue )
```

- `seedAdmin`: 32 bytes aleatorios generados por la administración. Se publica
  `seedCommitment = sha256(seedAdmin)` **antes** de `opensAt` (va dentro de `configHash`).
- `beaconValue`: valor de una fuente pública de aleatoriedad **posterior al cierre**, anunciada
  de antemano en la config (p.ej. el hash del bloque de Bitcoin de altura `H`, con `H` estimado
  para caer después de `closesAt`; alternativa: pulso del NIST Randomness Beacon en un instante
  anunciado).
- `SeedRevealed` publica `seedAdmin` y `beaconValue`; cualquiera verifica
  `sha256(seedAdmin) === seedCommitment`.

> **DECISIÓN B.0.c — La semilla es SIEMPRE compuesta (`seedAdmin` + faro externo posterior).**
> *Razón:* el commit–reveal simple no basta. Como el padrón y las opciones son públicos, quien
> genera `seedAdmin` puede **moler** (grinding) millones de candidatas offline y comprometerse a
> la que le produce el sorteo que le conviene. Al mezclar con un valor imposible de conocer en
> el instante del commit e imposible de manipular por la administración, el grinding se vuelve
> inútil. Sin esta mezcla, «sorteo verificable» es teatro criptográfico.

### B.0.4 Umbral genérico (unifica B.1 y B.2)

```ts
export interface ThresholdInput {
  readonly approve: number;      // peso total a favor
  readonly reject: number;       // peso total en contra
  readonly abstain: number;      // peso total en abstención EXPLÍCITA
  readonly census: number;       // N
}

export function thresholdDenominator(i: ThresholdInput, p: AbstentionPolicy, base: ThresholdBase): bigint {
  if (base === 'census') return BigInt(i.census);
  switch (p) {
    case 'exclude': return BigInt(i.approve + i.reject);
    case 'include':
    case 'as-no':   return BigInt(i.approve + i.reject + i.abstain);
  }
}

export function passesThreshold(i: ThresholdInput, f: Fraction, strict: boolean,
                                p: AbstentionPolicy, base: ThresholdBase): boolean {
  const den = thresholdDenominator(i, p, base);
  if (den === 0n) return false;                        // sin votos computables NO se aprueba nada
  const num = BigInt(i.approve);
  const c = cmpFraction({ num, den }, f);
  return strict ? c > 0 : c >= 0;
}
```

> **DECISIÓN B.0.d — `den === 0` ⇒ NO aprueba.** «Cero de cero» no es unanimidad, es ausencia de
> decisión. Es la trampa clásica de los motores de consenso (`0/0 = NaN`, o peor, `true` por
> vacuidad).

---

## B.1 Mayoría simple

### Definición matemática

Sea `A` el peso a favor, `R` en contra, `Ab` abstención explícita, `S` silencio (no emitió).
Con `abstentionPolicy = 'exclude'` y `base = 'cast'`:

```
Aprueba ⟺ A / (A + R) > 1/2 ⟺ A > R
```

Con `'include'`: `A / (A + R + Ab) > 1/2`. Con `'as-no'`: `A / (A + R + Ab) > 1/2` **y**
`R` efectivo pasa a ser `R + Ab` (idéntico numéricamente al anterior, pero cambia la narrativa
de la `Proof`, que debe decir «las abstenciones se contaron como votos en contra»).

`S` (silencio) **jamás** entra en el denominador del umbral; sólo entra en el **quórum** (PARTE D).

### El punto que siempre se malentiende

Censo `N = 300`. Resultado: `A = 100`, `R = 60`, `Ab = 40`, `S = 100`.

| Política | Denominador | Cociente | ¿Aprueba? |
|---|---|---|---|
| `exclude` | 160 | 100/160 = 62.5 % | **Sí** |
| `include` | 200 | 100/200 = 50.0 % | **No** (se exige `>` estricto) |
| `as-no` | 200 | 100/200 = 50.0 % | **No** |
| `base:'census'` | 300 | 100/300 = 33.3 % | **No** |

Cuatro respuestas distintas para la misma urna. Por eso:

> **DECISIÓN B.1.a — `abstentionPolicy` y `base` son campos OBLIGATORIOS y sin default en el
> tipo; la UI muestra la frase resultante en el momento de configurar la decisión y la repite
> en la papeleta.** Frase generada: «Se aprueba si hay más síes que noes. Las abstenciones no
> cuentan para este cálculo, pero sí cuentan para la participación mínima.»
> *Razón:* la disputa post-electoral en asambleas estudiantiles es casi siempre sobre el
> denominador, no sobre los votos. Fijarlo antes y mostrarlo en la papeleta elimina la disputa.

> **DECISIÓN B.1.b — El default institucional de Koinonía es `exclude` + `base:'cast'` + `strict:true`.**
> *Razón:* abstenerse debe significar «no participo en esta decisión», no «voto no encubierto».
> Si abstenerse equivaliera a rechazar, la abstención se convertiría en la herramienta de
> obstrucción más barata que existe. Quien quiere bloquear, que vote no y ponga la cara.

> **DECISIÓN B.1.c — «Mayoría simple» y «mayoría absoluta» son configuraciones del MISMO
> escrutador.** «Mayoría absoluta» = `supermajority { fraction: 1/2, strict: true, base: 'census' }`.
> *Razón:* un solo código, un solo conjunto de tests, cero divergencia semántica.

### Algoritmo

```ts
function tallySimpleMajority(cfg, bs: readonly EffectiveBallot[]): { input: ThresholdInput; passed: boolean } {
  let approve = 0, reject = 0, abstain = 0;
  for (const b of bs) {
    if (b.payload.kind === 'abstain') abstain += b.weight;
    else if (b.payload.kind === 'binary') (b.payload.approve ? approve += b.weight : reject += b.weight);
    else throw new InvalidBallotForMethod(b);
  }
  const input = { approve, reject, abstain, census: cfg.electorate.censusSize };
  const m = cfg.method as Extract<DecisionMethod, {kind:'simple-majority'}>;
  return { input, passed: passesThreshold(input, {num:1n,den:2n}, true, m.abstentionPolicy, m.base) };
}
```

- **Complejidad:** `O(C)` tiempo, `O(1)` espacio.
- **Desempate:** `A === R` con `strict:true` ⇒ **rechazo**, no empate. No hay sorteo.
  *Razón:* el statu quo gana los empates; cambiar el estado de cosas exige una mayoría positiva.
- **Patología conocida:** con 3+ opciones binarizadas por separado se cae en la **paradoja de
  Anscombe** y en la **inconsistencia doctrinal** (mayorías sobre premisas incompatibles con la
  mayoría sobre la conclusión). Por eso `simple-majority` sólo admite `options.length === 1`
  (propuesta sí/no); para 3+ opciones el motor **rechaza la configuración**.
- **Uso real:** aprobar el acta de la asamblea anterior; fijar la fecha del coloquio; avalar el
  informe semestral de la representación estudiantil.

---

## B.2 Supermayoría (2/3, 3/4)

### Definición matemática

`Aprueba ⟺ A / D ▷ f`, con `D` según `base` y `▷ ∈ {>, ≥}` según `strict`.

```
base 'cast'   : D = A + R (+Ab según policy)   — 2/3 de los que votaron
base 'census' : D = N                          — 2/3 de TODOS los matriculados
base 'present': D = |asistentes registrados|   — 2/3 de los presentes en la sesión
```

Con `N = 300`, `A = 140`, `R = 60`, `Ab = 0`, `f = 2/3`, `strict = false`:
- `base:'cast'` → `140/200 = 70 % ≥ 66.6 %` ⇒ **aprueba**.
- `base:'census'` → `140/300 = 46.6 %` ⇒ **no aprueba**.

Diferencia enorme. La supermayoría sobre censo es, en la práctica, un **derecho de veto por
inasistencia**: quien quiere bloquear no tiene que hacer nada.

> **DECISIÓN B.2.a — `base:'census'` sólo se permite para: (i) reformar el reglamento del
> estamento estudiantil, (ii) revocar el mandato de un representante, (iii) disolver un círculo.
> Para todo lo demás el motor rechaza `base:'census'` en tiempo de configuración.**
> *Razón:* es el freno adecuado para actos constituyentes (donde la inercia debe pesar) y es
> veneno para la gestión ordinaria (donde produce parálisis y desmoraliza a quien sí participa).

> **DECISIÓN B.2.b — `base:'present'` exige un registro de asistencia con evento propio
> (`AttendanceRecorded`) cerrado ANTES de abrir la votación.** *Razón:* si el conjunto «presentes»
> se determina después, es manipulable; y sin congelarlo el denominador vuelve a ser móvil.

- **Complejidad:** `O(C)`.
- **Desempate:** exactamente en el umbral (`A/D === f`): decide `strict`.
  **DECISIÓN B.2.c:** `strict` por defecto es `false` para supermayorías (`≥`), a diferencia de
  la mayoría simple. *Razón:* con `2/3` y `D = 300`, `A = 200` es exactamente dos tercios y sería
  perverso rechazar «200 de 300» por un `>` estricto. La mayoría simple usa `>` porque `1/2`
  exacto es un empate real; `2/3` exacto no es un empate, es el umbral cumplido.
- **Patología conocida:** *supermajority hold-up*. Un grupo del 34 % obtiene poder de agenda
  desproporcionado y puede extraer concesiones. Mitigación: `challengeWindow` + obligación de
  motivar el voto negativo en decisiones con `base:'census'` (campo opcional, visible).
- **Uso real:** reforma del reglamento estudiantil (2/3 sobre censo); revocatoria de representante
  (3/4 sobre votos emitidos con quórum del 50 %); cambio del método de decisión de un círculo.

---

## B.3 Consentimiento sociocrático

### Definición

**No se cuentan votos a favor.** La propuesta pasa si, al cerrar la ronda, **no existe ninguna
objeción admitida y no integrada**.

```
Pasa(ronda r) ⟺ |{ o ∈ Objeciones : estado(o) = 'admitida' ∧ ¬integrada(o) }| = 0
                 ∧ engagement ≥ minEngagement
```

donde `engagement = (peso que se manifestó explícitamente: consent | concern | object) / |círculo|`.

### Qué hace VÁLIDA a una objeción

Una objeción es admisible si y sólo si supera las **tres preguntas de admisibilidad**, que la
persona objetante debe responder por escrito en el formulario:

1. **¿Qué objetivo del círculo se ve dañado?** (`harmedAim`, obligatorio, debe referenciar un
   objetivo declarado del círculo). Una objeción es una alegación de **daño al fin común**, no
   una expresión de preferencia.
2. **¿Por qué el daño es del círculo y no sólo tuyo?** («no me gusta», «prefiero otra cosa»,
   «me parece feo» ⇒ inadmisible. «Esto nos deja sin sala en el semestre siguiente» ⇒ admisible).
3. **¿Qué tendría que cambiar para que ya no objetes?** (`proposedAmendment`). Puede ser
   «no lo sé», pero la ausencia de todo intento es un indicador de objeción no argumentada.

```ts
export interface ObjectionAdmissibilityConfig {
  /** Tamaño del panel de admisibilidad. Impar. Default 3. */
  readonly panelSize: number;
  /** Fracción del panel necesaria para DESESTIMAR. Default 2/3. */
  readonly dismissThreshold: Fraction;
  /** El panel se sortea con la semilla pública entre miembros del círculo, excluyendo
   *  a quien objeta y a quien propuso. */
  readonly panelSelection: 'sortition';
  /** Plazo para que el panel se pronuncie. Vencido el plazo sin pronunciamiento ⇒ ADMITIDA. */
  readonly panelDeadline: number;   // ms
}
```

> **DECISIÓN B.3.a — Presunción de validez de la objeción.** Toda objeción nace **admitida**.
> Sólo puede ser desestimada por un **panel de 3 personas sorteadas del propio círculo** (con la
> semilla pública de B.0.3), por 2/3, con motivación escrita publicada. Si el panel no se
> pronuncia dentro de `panelDeadline`, la objeción **queda admitida**.
> *Razón:* la alternativa —que el facilitador califique— concentra en una sola persona el poder
> de anular disensos, que es exactamente el poder que la sociocracia dice distribuir; y en un
> instituto de filosofía, donde el prestigio académico es asimétrico, sería capturado en un
> semestre. La presunción de validez + panel sorteado + silencio administrativo **a favor del
> objetante** pone la carga de la prueba en quien quiere silenciar, no en quien disiente.
> *Contraparte reconocida:* abre la puerta a la objeción obstruccionista. Se mitiga con: el
> límite de rondas (B.3.c), la publicidad del argumento (quien obstruye lo hace con nombre y
> texto), y la posibilidad de escalar al método `supermajority` (B.3.d).

> **DECISIÓN B.3.b — «Integrar una objeción» tiene una definición operativa estricta:** existe
> un evento `ObjectionIntegrated` que (i) referencia la objeción, (ii) contiene un
> `newProposalVersionHash` ≠ al anterior, y (iii) está **firmado por quien objetó**, declarando
> que la enmienda atiende su objeción. Sin la firma del objetante, no hay integración: hay
> *modificación unilateral*, que no extingue la objeción.
> *Razón:* sin (iii), «integrar» degenera en «cambiarle una coma y declarar resuelto», que es el
> abuso documentado más frecuente en implementaciones de sociocracia.
> *Válvula de escape:* si el objetante no responde en `panelDeadline` tras la enmienda, se
> considera **retirada tácita** de la objeción (evento `ObjectionWithdrawn` por `system`), para
> que el ausentismo no bloquee indefinidamente.

### Ciclo objeción → enmienda → nueva ronda

```
RoundOpened(r, hash_r)
  ├─ papeletas 'consent' | 'concern' | 'object'
  ├─ para cada 'object': ObjectionRaised → [panel] → ObjectionAdmitted | ObjectionDismissed
  ├─ si hay admitidas:
  │     ├─ si r = maxRounds  → outcome: rejected('objections-pending')   [FIN]
  │     └─ si r < maxRounds  → enmienda → ObjectionIntegrated(hash_{r+1})
  │                            → RoundOpened(r+1)  [las papeletas de la ronda r NO se arrastran]
  └─ si no hay admitidas y engagement ≥ minEngagement → outcome: approved
```

> **DECISIÓN B.3.c — `maxRounds` por defecto = 3, tope duro = 5.** Agotadas las rondas sin
> resolver, el resultado es `rejected(reason:'objections-pending')` y la propuesta vuelve al
> círculo. *Razón:* la deliberación sin límite no converge por virtud, converge por agotamiento,
> y el agotamiento favorece sistemáticamente a quien tiene más tiempo libre — que en una
> facultad no es una distribución neutral. Tres rondas es suficiente para una enmienda seria y
> una de ajuste.

> **DECISIÓN B.3.d — Escalamiento explícito, no automático.** Tras `rejected('objections-pending')`
> el círculo **puede** abrir una nueva decisión sobre el mismo `proposalId` con método
> `supermajority(2/3, cast)`, dejando constancia (`supersedes`) de que se agotó el consentimiento.
> No es automático. *Razón:* si el escalamiento fuera automático, objetar sería inútil y el
> consentimiento sería decorativo; si fuera imposible, cualquiera tendría veto permanente.
> Hacerlo posible pero **costoso y visible** es el equilibrio correcto.

> **DECISIÓN B.3.e — `silenceMeans` por defecto = `'not-participating'`, NO `'consent'`.**
> El silencio no consiente; por eso existe `minEngagement` (default 1/2 del círculo).
> *Razón:* «quien calla otorga» convierte la apatía en aprobación y permite pasar decisiones con
> 2 personas despiertas de 30. En un círculo pequeño, exigir manifestación explícita de la mitad
> es viable.

- **Complejidad:** `O(C + |objeciones| · panelSize)`.
- **Desempate:** no aplica (no hay conteo comparativo). El único borde es la votación del panel:
  panel impar + umbral 2/3 ⇒ `2 de 3`. Si el panel empata por ausencia, gana la admisión (B.3.a).
- **Patología conocida:** (i) **veto del más terco**; (ii) **falsa unanimidad** por presión
  social (la gente consiente para no quedar como el obstruccionista); (iii) captura por
  facilitación. Mitigaciones: opción `concern` (registra reserva sin bloquear, y queda en el
  acta), objeciones publicadas con argumento, panel sorteado.
- **Uso real:** decisiones operativas de círculos pequeños: comité editorial de la revista del
  Instituto, definición del temario del seminario permanente, uso del presupuesto de un evento.
  **No** usar para elegir personas ni para repartir recursos escasos entre facciones.

---

## B.4 Consenso puro (unanimidad)

### Definición

```
Aprueba ⟺ R = 0 ∧ (abstentionBlocks ? Ab = 0 : true) ∧ A = D
```
con `D = A + R + Ab` (`base:'cast'`) o `D = N` (`base:'census'`, unanimidad del censo entero).

```ts
function tallyUnanimity(cfg, bs): boolean {
  const { approve, reject, abstain } = countBinary(bs);
  const m = cfg.method as Extract<DecisionMethod, {kind:'unanimity'}>;
  if (reject > 0) return false;
  if (m.abstentionBlocks && abstain > 0) return false;
  const den = m.base === 'census' ? cfg.electorate.censusSize : approve + reject + abstain;
  return den > 0 && approve === den;      // nunca 0/0
}
```

- **Complejidad:** `O(C)`.
- **Desempate:** inexistente.
- **Patología conocida:** poder de veto individual ⇒ (i) la última persona en votar tiene poder
  dictatorial de facto; (ii) presión conformista brutal; (iii) `base:'census'` con `N=300`
  significa que la decisión depende del estudiante que se fue de intercambio y no revisa el
  correo. Además es **no monótona en participación**: aumentar la participación sólo puede
  empeorar el resultado.

> **DECISIÓN B.4.a — `unanimity` está DESHABILITADA por defecto y requiere una decisión previa
> del círculo (con método `supermajority`) que la autorice para un caso concreto.** La UI muestra
> una advertencia explícita del poder de veto individual.
> *Razón:* la unanimidad no es «el consenso llevado a su forma más pura», es un método distinto
> con una patología severa. El consentimiento sociocrático (B.3) logra casi todo lo que la gente
> quiere de la unanimidad sin el veto de preferencia, porque exige *argumentar daño*. La
> unanimidad sólo es apropiada cuando la decisión **compromete personalmente a cada miembro**:
> firmar un comunicado público en nombre de todos, asumir una obligación solidaria, ceder
> derechos de autor colectivos. Ahí el veto individual no es una patología: es la protección
> correcta.

---

## B.5 Puntuación 0–5 (score voting)

### Definición matemática

Cada votante `v` asigna a cada opción `o` un valor `s(v,o) ∈ {0,…,5} ∪ {⊥}` (`⊥` = «sin opinión»).
Sea `Vo = { v : s(v,o) ≠ ⊥ }` (votantes con opinión sobre `o`) y `W(Vo) = Σ_{v∈Vo} w(v)`.

- **Media (exacta, como fracción):** `mean(o) = ( Σ_{v∈Vo} w(v)·s(v,o) ) / W(Vo)`
- **Mediana ponderada:** el valor `s*` tal que `Σ_{s < s*} w ≤ W(Vo)/2` y `Σ_{s > s*} w ≤ W(Vo)/2`,
  tomando el **mediano inferior** en caso de bloque par (misma convención que B.7).

### `⊥` («sin opinión») ≠ `0`

Un `0` es un juicio: «esta opción me parece pésima». Un `⊥` es una abstención informativa: «no
conozco esta propuesta, no me pronuncio». Tratarlos igual produce dos distorsiones opuestas:

- Si `⊥ ≡ 0`: las opciones **poco conocidas** se hunden mecánicamente. Una propuesta excelente
  presentada por alguien de primer semestre pierde contra una mediocre de alguien conocido, no
  por peor, sino por menos leída. Es un sesgo de notoriedad puro.
- Si `⊥` se ignora sin más: una opción calificada por **3 personas entusiastas** con `5,5,5`
  gana (media 5.0) a otra calificada por 200 con media 4.6. Es un sesgo de nicho.

> **DECISIÓN B.5.a — `⊥` se ignora en el numerador y en el denominador, PERO se exige
> `minCoverage`: `W(Vo) / W(total) ≥ minCoverage` (default 1/2). Una opción que no alcanza la
> cobertura mínima NO es descartada: se reporta aparte como «no suficientemente valorada» y no
> puede ganar.** *Razón:* corrige simultáneamente los dos sesgos. Descartarla en silencio sería
> injusto con quien la propuso; dejarla ganar con 3 votos sería un fraude estadístico. Reportarla
> visiblemente crea el incentivo correcto: si querés que gane, hacé que la lean.

> **DECISIÓN B.5.b — El agregador por defecto es `median`, no `mean`.** *Razón:* voto estratégico.
> Con la media, la estrategia óptima es siempre **exagerar** (`5` a mi favorita, `0` a todo lo
> demás), lo que degrada el score voting a voto de aprobación con pasos extra, y castiga a quien
> puntúa con honestidad y matiz — precisamente lo que una comunidad filosófica valoraría. La
> mediana ponderada es robusta: mover mi puntuación de `3` a `5` no mueve la mediana salvo que yo
> esté en el punto medio; el retorno del exceso estratégico es casi nulo. Costo aceptado: la
> mediana descarta información de intensidad y produce más empates (resueltos por B.5.c).

> **DECISIÓN B.5.c — Desempate de `median`:** cascada `['higher-mean', 'fewer-zeros',
> 'more-fives', 'lexicographic-hash']`, con `higher-mean` calculado como fracción exacta.
> *Razón:* usar la media **sólo como desempate** recupera la información de intensidad sin
> exponerla a la manipulación (para explotarla habría que provocar primero un empate exacto de
> medianas ponderadas, lo que requiere conocimiento imposible del resto de las papeletas).

```ts
function weightedMedian(pairs: readonly { value: number; weight: number }[]): number {
  const sorted = [...pairs].sort((a, b) => a.value - b.value);   // ascendente 0→5
  const total = sorted.reduce((s, p) => s + p.weight, 0);
  const target = Math.floor(total / 2);        // mediano INFERIOR, igual que B.7
  let acc = 0;
  for (const p of sorted) { acc += p.weight; if (acc > target) return p.value; }
  return sorted[sorted.length - 1]!.value;     // inalcanzable si total > 0
}
```

- **Complejidad:** `O(C·m)` para leer, `O(m · C log C)` para las medianas (o `O(m·C)` con
  *counting sort* sobre 6 cubetas — preferido, y necesario para el determinismo).
- **Patología conocida:** además del estratégico, el **efecto de escala** (dos personas usan
  «3» con significados distintos: no hay comparabilidad interpersonal de utilidades — objeción
  clásica de Arrow y de Sen). Mitigación parcial: anclar los números con etiquetas verbales fijas
  en la UI; si la comparabilidad importa mucho, usar B.7 (menciones), que asume comparabilidad
  **ordinal** de un lenguaje común y no cardinal de números.
- **Uso real:** priorizar los 12 temas candidatos del ciclo de conferencias del semestre; repartir
  el presupuesto entre líneas de trabajo; escoger los 5 textos del seminario abierto.

---

## B.6 Rondas con eliminación (IRV / ranked choice)

### Definición

Papeletas = órdenes estrictos parciales sobre `options`. En cada ronda se cuenta la primera
preferencia **viva** de cada papeleta; si alguna opción supera la cuota, gana; si no, se elimina
la de menor apoyo y se transfieren sus papeletas a la siguiente preferencia viva. Una papeleta
sin preferencias vivas está **agotada** y sale del conteo.

```ts
function tallyIRV(cfg, bs: readonly EffectiveBallot[]): IrvResult {
  const m = cfg.method as Extract<DecisionMethod, {kind:'irv'}>;
  let alive = new Set(cfg.options);
  const rounds: IrvRound[] = [];
  const initialTotal = bs.reduce((s, b) => s + b.weight, 0);

  while (alive.size > 1) {
    const counts = new Map<OptionId, number>([...alive].map(o => [o, 0]));
    let live = 0, exhausted = 0;
    for (const b of bs) {
      const order = (b.payload as Extract<BallotPayload,{kind:'ranking'}>).order;
      const top = order.find(o => alive.has(o));
      if (top === undefined) { exhausted += b.weight; continue; }
      counts.set(top, counts.get(top)! + b.weight);
      live += b.weight;
    }
    const quotaBase = m.exhaustedPolicy === 'reduce-quota' ? live : initialTotal;
    const winner = [...counts].find(([, c]) => 2 * c > quotaBase);   // > 50 % estricto
    rounds.push({ counts: sortedCounts(counts), live, exhausted, quotaBase });
    if (winner) return { winner: winner[0], rounds };

    const min = Math.min(...counts.values());
    const losers = [...counts].filter(([, c]) => c === min).map(([o]) => o);
    const eliminated = losers.length === 1 ? losers[0]!
                     : breakTie(losers, m.eliminationTieBreak, ctx).worst;   // ver nota
    alive = new Set([...alive].filter(o => o !== eliminated));
    rounds.push({ eliminated });
  }
  return { winner: [...alive][0]!, rounds };
}
```

> **DECISIÓN B.6.a — `exhaustedPolicy` por defecto = `'reduce-quota'`** (la mayoría se calcula
> sobre las papeletas **vivas** de la ronda, no sobre el total inicial). *Razón:* con
> `fixed-quota` y muchas papeletas truncadas, ninguna opción alcanza jamás el 50 % del total
> inicial y el método degenera en «gana la última que quede en pie», sin mayoría real y sin que
> nadie entienda por qué. Con `reduce-quota` la `Proof` puede decir con honestidad: «de las 140
> papeletas que aún expresaban una preferencia, 78 apoyaban X». Costo: el ganador puede tener
> menos del 50 % del electorado inicial, y la `Proof` **debe declararlo explícitamente**.

> **DECISIÓN B.6.b — El desempate de ELIMINACIÓN usa su propia cascada, distinta a la del
> ganador,** y su regla natural es `['fewer-first-preferences-in-previous-rounds' (Borda-like
> hacia atrás), 'pairwise-head-to-head', 'lexicographic-hash']`. *Razón:* eliminar es una
> operación distinta de ganar; usar el mismo criterio invertido produce comportamientos raros.
> Y como el desempate de eliminación puede cambiar el ganador final, debe ser **auditable y
> declarado antes**, nunca sorteado en caliente.

### No monotonicidad — ejemplo numérico concreto

**Elección 1** (100 votantes, 3 opciones A, B, C):

| Papeletas | Orden |
|---|---|
| 35 | A > C > B |
| 33 | B > A > C |
| 32 | C > B > A |

Ronda 1: A = 35, B = 33, C = 32. Nadie llega a 51. Se elimina **C** (32).
Las 32 papeletas `C > B > A` pasan a **B**. Ronda 2: **B = 65**, A = 35. **Gana B.**

**Elección 2**: 4 votantes del grupo `A > C > B` cambian de opinión y **suben a B al primer
lugar** (pasan a `B > A > C`). Nadie más cambia; el orden relativo entre A y C se conserva en esas
papeletas. Es una mejora **estrictamente a favor de B**, la ganadora.

| Papeletas | Orden |
|---|---|
| 31 | A > C > B |
| 37 | B > A > C |
| 32 | C > B > A |

Ronda 1: B = 37, C = 32, A = 31. Se elimina **A** (31).
Las 31 papeletas `A > C > B` pasan a **C**. Ronda 2: **C = 63**, B = 37. **Gana C.**

**B ganaba; 4 personas la subieron al primer puesto; B perdió.** No es un bug del conteo: es una
propiedad estructural de la eliminación secuencial. Subir a B le quitó primeras preferencias a A,
A cayó por debajo de C, y A —que era la rival débil de B— fue eliminada, liberando su caudal hacia
C, que es la rival fuerte de B. El método no es monótono.

> **DECISIÓN B.6.c — La `Proof` de IRV incluye SIEMPRE la advertencia:** «En este método, en
> casos poco frecuentes, apoyar más a una opción puede perjudicarla. Por eso no se usa para
> decisiones importantes.» Y **`irv` está vetado para elegir personas y para reformas
> estatutarias** (sólo `majority-judgment` o `condorcet-schulze`).
> *Razón:* la no monotonicidad no se puede parchear, sólo declarar. Y en un instituto de
> filosofía, ocultarla sería más costoso políticamente que admitirla.

- **Complejidad:** `O(m · C · m) = O(C·m²)` en el peor caso (hasta `m−1` rondas, cada una `O(C·m)`
  al buscar la primera preferencia viva). Con `m ≤ 20` y `C ≤ 300` es irrelevante.
- **Patologías:** no monotonicidad (arriba); **paradoja del no votante** (abstenerse puede
  producir un resultado mejor para vos que votar sinceramente); dependencia del orden de
  eliminación en empates; falla el criterio de Condorcet (puede perder el ganador de Condorcet).
- **Uso real:** escoger **una** franja horaria para el congreso entre 6 candidatas; escoger la
  sede de una jornada. Cosas donde la comunidad ya tiene la intuición de «segunda vuelta» y donde
  el costo de una patología rara es bajo.

---

## B.7 Valoración por menciones (Majority Judgment, Balinski–Laraki)

### Definición

Escala verbal común, ordenada de mejor a peor, `k = 5`:

`0 Excelente > 1 Bueno > 2 Aceptable > 3 Insuficiente > 4 Rechazar`

Cada votante asigna **una mención a cada opción** (juicio absoluto, no comparativo). Para cada
opción se calcula su **mención mayoritaria** `α(o)` = **mediano inferior** (*lower middlemost*)
del multiconjunto ponderado de menciones recibidas. Gana la de mejor `α`; los empates se
resuelven por el procedimiento de B–L.

**Mediano inferior, formalmente.** Ordenadas las `W` menciones de mejor a peor
`g_0 ≤ g_1 ≤ … ≤ g_{W−1}` (índices de grado, `0` = mejor), la mención mayoritaria es
`α = g_{⌊W/2⌋}`.
Verificación: `W = 2` con `{Excelente, Rechazar}` ⇒ `α = g_1 = Rechazar`. Correcto: es la
convención **pesimista** de B–L (la peor de las dos centrales), la única que satisface
«al menos la mitad la considera al menos `α`».

### El desempate exacto (donde todo el mundo se equivoca)

**Definición normativa (eliminación sucesiva de la mediana):** para comparar dos opciones con la
misma mención mayoritaria, se **retira una** ocurrencia de esa mención a **cada una** y se
recalculan las medianas; se repite hasta que difieran o hasta agotar los multiconjuntos.

```ts
type GradeIdx = number;   // 0 = mejor … k-1 = peor

/** counts[i] = peso total que otorgó el grado i. Suma = W (idéntica para ambas opciones). */
export function majorityGrade(counts: readonly number[]): GradeIdx {
  const W = counts.reduce((a, b) => a + b, 0);
  if (W === 0) throw new InvariantViolation('MJ sobre multiconjunto vacío');
  const target = Math.floor(W / 2);      // posición del mediano INFERIOR (0-indexada)
  let acc = 0;
  for (let i = 0; i < counts.length; i++) {
    acc += counts[i]!;
    if (acc > target) return i;          // '>' porque target es índice, no cardinal
  }
  /* istanbul ignore next */ throw new InvariantViolation('unreachable');
}

/** Orden de MAJORITY JUDGMENT. -1 ⇒ a mejor que b. Orden total estricto salvo multiconjuntos idénticos. */
export function mjCompare(a: readonly number[], b: readonly number[]): -1 | 0 | 1 {
  const A = [...a], B = [...b];
  let wa = A.reduce((x, y) => x + y, 0);
  const wb = B.reduce((x, y) => x + y, 0);
  if (wa !== wb) throw new InvariantViolation('MJ exige igual peso total por opción');

  while (wa > 0) {
    const ga = majorityGrade(A);
    const gb = majorityGrade(B);
    if (ga !== gb) return ga < gb ? -1 : 1;   // menor índice = mejor mención
    A[ga]! -= 1;                               // retira UNA ocurrencia de la mediana a cada una
    B[gb]! -= 1;
    wa -= 1;
  }
  return 0;                                    // multiconjuntos idénticos
}
```

**Los cuatro errores clásicos, y por qué este código no los comete:**

1. **Usar el mediano superior** (o el promedio de los dos centrales) con `W` par. Rompe la
   propiedad definitoria de la mención mayoritaria y produce resultados distintos en urnas
   pequeñas —justo las nuestras—. Aquí: `⌊W/2⌋` con acumulado `> target`.
2. **Retirar la mediana sólo a una de las dos opciones.** Hay que retirarla **a ambas** en cada
   paso, si no, la comparación deja de ser simétrica y `mjCompare(a,b) ≠ −mjCompare(b,a)`.
3. **Retirar TODAS las ocurrencias de la mediana de golpe.** Es la simplificación más extendida
   y es **incorrecta**: cambia el resultado. Se retira **una por paso**.
4. **Usar el atajo del *majority gauge*** `(α, p, q)` como si fuera la definición.
   `p` = peso con mención estrictamente mejor que `α`, `q` = estrictamente peor; la regla
   «si `p > q` entonces `α+`, si `p < q` entonces `α−`; entre dos `α+` gana el mayor `p`, entre
   dos `α−` gana el menor `q`» **coincide con la definición en electorados grandes, pero no
   siempre en electorados pequeños**. Con `C ≤ 300` y `k ≤ 7`, la eliminación sucesiva cuesta
   ≤ 300 iteraciones de `O(k)`: no hay ninguna razón para el atajo.

> **DECISIÓN B.7.a — La definición normativa es la eliminación sucesiva de una ocurrencia de la
> mediana a ambas opciones. El *majority gauge* NO se implementa, ni siquiera como camino
> rápido.** *Razón:* dos implementaciones del mismo criterio son dos oportunidades de divergir;
> el ahorro es de microsegundos sobre un `N` de 300.

> **DECISIÓN B.7.b — `missingGradePolicy` por defecto = `'reject-ballot'`:** la papeleta debe
> calificar **todas** las opciones o es inválida (la UI no deja enviarla incompleta).
> *Razón:* garantiza `W` idéntico para todas las opciones, que es la precondición de `mjCompare`.
> La alternativa `'worst'` (lo omitido cuenta como «Rechazar») preserva `W` pero castiga la
> ignorancia como si fuera condena, y penaliza a las opciones menos conocidas.

- **Complejidad:** construir los histogramas `O(C·m)`; ordenar las `m` opciones con `mjCompare`
  cuesta `O(m log m · W · k)` en el peor caso; con `m ≤ 20`, `W ≤ 300`, `k = 5`: trivial.
- **Desempate posterior:** si `mjCompare` devuelve `0` (histogramas idénticos), se aplica la
  cascada `['more-excellent', 'fewer-reject', 'lexicographic-hash']`.
- **Patología conocida:** falla la **independencia de alternativas irrelevantes** en casos
  construidos (aunque mucho menos que Borda o IRV); es susceptible a la manipulación
  «todo Rechazar salvo mi favorita», pero —y esto es clave— esa manipulación tiene **retorno
  decreciente**: sólo mueve la mediana si el manipulador está en el punto medio. Y es
  socialmente costosa: en un grupo pequeño, calificar «Rechazar» a todo queda registrado en el
  histograma público y se lee como mala fe.

### Por qué es probablemente EL MEJOR método para este instituto

1. **Es un juicio, no una comparación.** Se le pide a cada persona lo que sabe hacer y puede
   defender: evaluar cada propuesta **en sus propios términos** («esta candidatura me parece
   Aceptable»). No exige construir un orden total sobre 12 opciones —una tarea cognitivamente
   costosa que la gente resuelve al azar a partir de la cuarta posición—.
2. **El resultado se enuncia en lenguaje natural.** «La propuesta ganadora recibió la valoración
   típica *Buena*; la segunda, *Aceptable*». Un estudiante de primer semestre entiende eso
   sin saber qué es una mediana. Compárese con «ganó por camino más fuerte 143 contra 128».
3. **Es robusto al voto estratégico** por la razón de B.5.b: la mediana no se mueve con el
   exceso individual. En un grupo de 300 donde todos se conocen y hay facciones, esto importa
   mucho más que la eficiencia teórica.
4. **Produce información, no sólo un ganador.** El histograma completo de menciones por opción
   es material deliberativo de primer orden: revela polarización (muchos «Excelente» y muchos
   «Rechazar») frente a tibieza general (todo «Aceptable»), dos situaciones que cualquier
   método de un solo número confunde. Para una comunidad que quiere **discutir**, no sólo
   decidir, es la salida más rica.
5. **Evita el problema de comparabilidad cardinal** de B.5: las menciones son un lenguaje común
   ordinal y compartido, no una escala numérica que cada quien interpreta a su manera. Es
   exactamente la objeción que un filósofo le haría al score voting, y MJ la responde.
6. **Su patología es rara y explicable**; la de IRV es estructural y contraintuitiva; la de
   Condorcet (el ciclo) exige explicar por qué no hay ganador, que es la peor conversación
   posible en una asamblea.

> **DECISIÓN B.7.c — `majority-judgment` es el método POR DEFECTO de Koinonía para toda decisión
> con 2 o más opciones sustantivas, y el único permitido para elegir personas.**

- **Uso real:** elección de representantes estudiantiles ante el Consejo de Facultad; selección
  entre propuestas de línea editorial de la revista; evaluación de candidaturas a organizar el
  congreso.

---

## B.8 Comparación una contra una (Condorcet + Schulze)

### Definición

Papeletas = órdenes (posiblemente parciales) sobre `options`. Matriz de enfrentamientos:

```
d[X][Y] = Σ { w(v) : v prefiere X a Y }
```

**Ganador de Condorcet:** `X` tal que `d[X][Y] > d[Y][X]` para toda `Y ≠ X`. Puede no existir.

**Paradoja del ciclo (Condorcet, 1785):** con 3 votantes y 3 opciones,

| votantes | orden |
|---|---|
| 1 | A > B > C |
| 1 | B > C > A |
| 1 | C > A > B |

`d[A][B] = 2 > d[B][A] = 1`; `d[B][C] = 2 > d[C][B] = 1`; `d[C][A] = 2 > d[A][C] = 1`.
A gana a B, B gana a C, C gana a A. **No hay ganador de Condorcet.** La preferencia colectiva
mayoritaria es **intransitiva** aunque cada preferencia individual sea perfectamente transitiva.
Esto no es un error de los votantes ni del sistema: es una propiedad de la agregación
(y el germen del teorema de Arrow). Un método serio debe **tener una regla para este caso**, no
fallar.

### Schulze (camino más fuerte / beatpath)

La **fuerza de un camino** `X = C₀, C₁, …, Cₙ = Y` es `min_i d[Cᵢ][Cᵢ₊₁]`.
`p[X][Y]` = la fuerza del camino **más fuerte** de `X` a `Y` (máximo de los mínimos).
Gana `E` tal que `p[E][X] ≥ p[X][E]` para toda `X ≠ E`. Schulze demuestra que ese conjunto
(el *Schulze set*) es **siempre no vacío**, y que si existe ganador de Condorcet, es el único
elemento del conjunto.

```ts
export function schulze(options: readonly OptionId[], d: number[][]): {
  p: number[][]; winners: readonly OptionId[]; ranking: readonly OptionId[];
} {
  const n = options.length;
  const p: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));

  // 1) inicialización: sólo cuentan las victorias por pares
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      if (i !== j) p[i]![j] = d[i]![j]! > d[j]![i]! ? d[i]![j]! : 0;

  // 2) camino más fuerte (variante Floyd–Warshall max-min). ORDEN DE BUCLES CRÍTICO:
  //    el pivote 'i' va en el bucle EXTERNO. Con el pivote adentro el resultado es incorrecto.
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      for (let k = 0; k < n; k++) {
        if (k === i || k === j) continue;
        const via = Math.min(p[j]![i]!, p[i]![k]!);
        if (via > p[j]![k]!) p[j]![k] = via;
      }
    }

  // 3) ganadores
  const winners = options.filter((_, i) =>
    options.every((_, j) => i === j || p[i]![j]! >= p[j]![i]!));

  // 4) orden total: 'X ≻ Y ⟺ p[X][Y] > p[Y][X]' es transitivo (Schulze). Empates: cascada.
  const ranking = [...options].sort((x, y) => {
    const i = options.indexOf(x), j = options.indexOf(y);
    if (p[i]![j]! !== p[j]![i]!) return p[i]![j]! > p[j]![i]! ? -1 : 1;
    return lexRank(x) - lexRank(y);
  });
  return { p, winners, ranking };
}
```

> **DECISIÓN B.8.a — El pivote va en el bucle EXTERNO** (`for i { for j { for k } } }`), como en
> la especificación de Schulze. Es el error de implementación más frecuente: con el pivote en el
> bucle interno se obtiene una relajación incompleta y `p` queda subestimada, cambiando ganadores
> en grafos densos. Hay un test dedicado (INV-31) que compara contra una búsqueda exhaustiva de
> caminos por fuerza bruta sobre `m ≤ 6`.

**Papeletas truncadas.**
> **DECISIÓN B.8.b — `truncatedMeans: 'tied-last'`:** las opciones no rankeadas se consideran
> **empatadas en el último lugar** entre sí y **peores** que todas las rankeadas. Es decir, si
> `X` está rankeada y `Y` no, la papeleta cuenta `X > Y`; si ni `X` ni `Y` están rankeadas, no
> aporta a `d[X][Y]` ni a `d[Y][X]`. *Razón:* `'ranked-last'` (asumir un orden arbitrario entre
> las omitidas) inventa preferencias que el votante no expresó; `'tied-last'` es la
> interpretación mínima y honesta del silencio.

- **Complejidad:** matriz `O(C·m²)`; Schulze `O(m³)`. Con `m = 20`: 8 000 operaciones.
- **Desempate:** si `|winners| > 1`, cascada
  `['more-pairwise-wins', 'higher-min-margin', 'public-seed-lot', 'lexicographic-hash']`.
- **Patologías:** (i) el ciclo, que exige explicar en la `Proof` por qué ganó quien ganó —
  y la explicación de beatpath es genuinamente difícil de contar en una asamblea; (ii) falla la
  independencia de alternativas irrelevantes (como todo método ordinal, por Arrow); (iii) exige
  al votante producir un orden total, tarea costosa a partir de ~7 opciones.
- **Uso real:** ordenar la **agenda completa** del semestre (donde importa el ranking entero, no
  sólo el ganador); elegir el texto del seminario colectivo entre 8 candidatos cuando la
  comunidad quiere ver explícitamente los enfrentamientos directos. La `Proof` publica la matriz
  de pares completa, que es un objeto deliberativo excelente («fijate que tu favorito pierde
  contra todos menos contra uno»).

---

## B.9 Sorteo deliberativo estratificado

### Definición

Dado el padrón congelado, un tamaño `n`, y unos estratos (p.ej. `semestre × jornada`), se
selecciona una muestra de `n` personas que **respeta las proporciones** de cada estrato, de forma
**determinista dada la semilla** y por tanto verificable por cualquiera.

### Algoritmo

```ts
/** PASO 1 — cuotas por estrato: método de Hamilton (mayores restos), con desempate por hash. */
function quotas(strataSizes: ReadonlyMap<string, number>, N: number, n: number, seed: string)
  : ReadonlyMap<string, number> {
  const keys = [...strataSizes.keys()].sort();                    // orden canónico
  const exact = keys.map(k => ({ k, q: (strataSizes.get(k)! * n) / N }));
  const base  = exact.map(e => ({ ...e, floor: Math.floor(e.q), rem: e.q - Math.floor(e.q) }));
  let assigned = base.reduce((s, e) => s + e.floor, 0);
  const order = [...base].sort((a, b) =>
      b.rem !== a.rem ? (b.rem > a.rem ? 1 : -1)
    : cmpHex(hmac(seed, `rem|${a.k}`), hmac(seed, `rem|${b.k}`)));  // desempate verificable
  const out = new Map(base.map(e => [e.k, e.floor]));
  for (const e of order) { if (assigned >= n) break; out.set(e.k, out.get(e.k)! + 1); assigned++; }
  return out;
}

/** PASO 2 — selección dentro de cada estrato: orden por hash con clave = semilla. */
function sampleStratum(members: readonly MemberId[], q: number, seed: string, stratum: string)
  : readonly MemberId[] {
  return [...members]
    .map(id => ({ id, t: hmacSha256Hex(seed, `${stratum}|${id}`) }))   // "ticket" verificable
    .sort((a, b) => a.t < b.t ? -1 : a.t > b.t ? 1 : (a.id < b.id ? -1 : 1))
    .slice(0, q)
    .map(x => x.id)
    .sort();                                                          // salida canónica
}

export function stratifiedSortition(e: Electorate, cfg, seed: string): readonly MemberId[] {
  const key = (m: EligibleMember) => cfg.strata.map(k => `${k}=${m.strata[k] ?? '∅'}`).join('|');
  const groups = groupBySorted(e.members, key);
  const sizes  = new Map([...groups].map(([k, v]) => [k, v.length]));
  const qs     = quotas(sizes, e.censusSize, cfg.sampleSize, seed);
  return [...groups].flatMap(([k, v]) => sampleStratum(v.map(m => m.memberId), qs.get(k) ?? 0, seed, k)).sort();
}
```

> **DECISIÓN B.9.a — La selección se implementa como «ordenar por ticket HMAC y tomar los
> primeros q», no como un Fisher–Yates sembrado.** *Razón:* el ticket es **verificable
> individualmente**: cualquier persona puede calcular `hmac(seed, "estrato|suID")` con un
> comando de una línea y comprobar su propia posición, sin reimplementar el barajador ni confiar
> en el orden interno de nuestras estructuras. Un Fisher–Yates sembrado obliga a reproducir el
> algoritmo **exacto** (y su orden de recorrido) para verificar: es correcto pero no auditable
> por un no programador.

> **DECISIÓN B.9.b — Si un estrato tiene menos miembros que su cuota, el faltante se redistribuye
> a los demás estratos por el mismo criterio de mayores restos, y el hecho se declara en la
> `Proof`.** *Razón:* fallar silenciosamente produciría muestras de tamaño menor al anunciado.

> **DECISIÓN B.9.c — Se publican también los **suplentes**: los siguientes `⌈n/3⌉` tickets de
> cada estrato, en orden.** Si alguien declina, entra el siguiente por ticket, sin nuevo sorteo.
> *Razón:* rehacer el sorteo ante cada declinación reabre la puerta a la manipulación por
> declinaciones estratégicas.

- **Complejidad:** `O(N log N)` por el ordenamiento de tickets; `O(N)` de HMAC.
- **Desempate:** ticket idéntico ⇒ `memberId` ascendente (probabilidad ≈ 2⁻²⁵⁶, pero el código
  no puede tener ramas indefinidas).
- **Patología conocida:** (i) **legitimidad percibida**: «me tocó a mí y no a vos» exige que el
  procedimiento sea verificable o se lee como dedazo — de ahí B.0.3 y B.9.a; (ii) los estratos
  mal elegidos **fabrican** la representatividad que dicen medir; (iii) la muestra pequeña tiene
  varianza alta en atributos no estratificados.
- **Uso real:** conformar el comité de 12 personas que redacta la reforma del reglamento
  estudiantil, con representación garantizada por semestre y por jornada (diurna/nocturna), de
  modo que no lo copen los de octavo semestre de la diurna, que son quienes siempre pueden ir.


---

# PARTE C — DEMOCRACIA LÍQUIDA

> Es la parte más peligrosa del sistema. Una delegación mal modelada no produce un error visible:
> produce un resultado **plausible y falso**, con votos que nadie emitió y poder que nadie
> confirió. Todo lo que sigue es normativo hasta el detalle del signo de comparación.

## C.1 Tipos

```ts
export type DelegationId = Brand<string, 'DelegationId'>;

/** Ámbito de la delegación. La especificidad crece hacia abajo. */
export type DelegationScope =
  | { readonly kind: 'global' }                                 // especificidad 0
  | { readonly kind: 'circle'; readonly circleId: CircleId }     // especificidad 1
  | { readonly kind: 'topic';  readonly topicId: TopicId };      // especificidad 2

export interface Delegation {
  readonly delegationId: DelegationId;
  readonly delegator: MemberId;
  readonly delegate: MemberId;
  readonly scope: DelegationScope;
  readonly grantedAt: Instant;
  /** Vigencia máxima. Obligatoria. */
  readonly expiresAt: Instant;
  /** Instante EXACTO de revocación, si la hubo. */
  readonly revokedAt?: Instant;
  readonly grantedSeq: number;     // seq del evento DelegationGranted (orden canónico)
}

export interface DelegationConfig {
  readonly enabled: boolean;
  /** Profundidad máxima de la cadena, en ARISTAS. Default 4. */
  readonly maxDepth: number;
  /** Tope de poder por delegado, como fracción del CENSO. Default 1/10. */
  readonly cap: Fraction;
  /** Qué se hace con el excedente. Ver C.5. */
  readonly overflowPolicy: 'return-to-delegator';
  /** Vigencia máxima permitida al conceder, en ms. Default 1 semestre (≈ 180 días). */
  readonly maxValidity: number;
  /** Antelación con la que se avisa que tu cadena está rota, en ms. Default 24 h. */
  readonly brokenChainNotice: number;
  /** Ventana de última palabra: ver C.7.d. Default 0 (visible desde que el delegado vota). */
  readonly lastWordWindow: number;
}
```

> **DECISIÓN C.1.a — `expiresAt` es OBLIGATORIO y acotado por `maxValidity` (un semestre).**
> No existe la delegación perpetua. *Razón:* las delegaciones perpetuas se acumulan por inercia:
> la gente delega una vez en primer semestre y el poder queda congelado durante cinco años en
> personas que quizá ya ni están. La caducidad obliga a **reafirmar** el mandato, que es el acto
> político relevante. Coste aceptado: fricción semestral; se mitiga con un recordatorio y
> renovación de un clic (pero renovación **explícita**, jamás automática).

> **DECISIÓN C.1.b — Una sola delegación activa por `(delegator, scope)`.** Conceder una nueva
> para el mismo ámbito emite automáticamente `DelegationRevoked` de la anterior, con
> `revokedAt = grantedAt` de la nueva. *Razón:* evita el problema de resolver entre dos
> delegaciones simultáneas del mismo ámbito, que no tiene solución no arbitraria.

## C.2 Vigencia y resolución de ámbito

Una delegación `d` está **activa en el instante `t` para la decisión `D`** ⟺

```
d.grantedAt  <  t                                   (estrictamente anterior)
∧ (d.revokedAt === undefined ∨ t < d.revokedAt)     (la revocación es INMEDIATA)
∧ t < d.expiresAt
∧ matches(d.scope, D)
```

con

```
matches({kind:'topic', topicId}, D)  ⟺ D.topics.includes(topicId)
matches({kind:'circle', circleId},D) ⟺ D.circleId === circleId
matches({kind:'global'}, D)          ⟺ true
```

**Selección entre varias activas:** gana la de **mayor especificidad**; a igual especificidad
(sólo posible entre dos `topic` distintos que ambos casen con `D.topics`), gana la de **mayor
`grantedSeq`** (la más reciente).

> **DECISIÓN C.2.a — Especificidad primero, recencia después.** *Razón:* delegar «filosofía
> política» a Ana y «todo lo demás» a Beto expresa una intención clara que la recencia sola
> destruiría. Y a igual especificidad, la voluntad más reciente prevalece sobre la más antigua,
> que es el principio general de los actos revocables.

> **DECISIÓN C.2.b — El instante de resolución `t` es `closedAt`** (el instante real de cierre,
> sea por ventana o anticipado), no `closesAt` programado ni el instante de emisión de la
> papeleta. *Razón:* es lo que hace que «revocable en cualquier momento» sea literalmente
> verdadero: mientras la urna esté abierta, tu revocación tiene efecto, incluso si tu delegado ya
> votó. Un solo instante de resolución para todo el escrutinio también garantiza que el grafo de
> delegación sea **uno solo**, no uno por papeleta (lo que produciría incoherencias del tipo «A
> delegó en B según la papeleta 1 y no según la papeleta 2»).

## C.3 Orden de resolución exacto

`resolveWeights` es la función que produce las `EffectiveBallot[]` de B.0.1. Su orden es
**normativo**:

```ts
export function resolveWeights(
  cfg: DecisionConfig,
  lastBallotByVoter: ReadonlyMap<MemberId, Ballot>,   // ya aplicada la regla "última manda" (A.5)
  delegations: readonly Delegation[],
  closedAt: Instant,
): ResolvedWeights {

  const census = new Set(cfg.electorate.members.map(m => m.memberId));
  const dg = cfg.delegation;

  // ---- PASO 1: papeletas directas. El voto directo SIEMPRE gana. -------------------------
  //  Nadie que haya votado directo delega jamás, aunque tenga delegación vigente.
  const direct = new Map<MemberId, Ballot>();
  for (const [voter, b] of sortedByKey(lastBallotByVoter)) {
    if (!census.has(voter)) continue;                      // INV-02: inelegible nunca cuenta
    if (b.round !== cfg.currentRound) continue;            // ronda vigente
    if (b.proposalVersionHash !== cfg.proposalVersionHash) continue;   // A.6
    if (b.castAt >= closedAt) continue;                    // D.3: cierre exclusivo
    direct.set(voter, b);
  }

  // ---- PASO 2: grafo de delegación efectivo en `closedAt` --------------------------------
  const edge = new Map<MemberId, MemberId>();              // delegator -> delegate
  for (const m of cfg.electorate.members) {                // recorrido en orden canónico
    if (direct.has(m.memberId)) continue;                  // regla de oro: votó ⇒ no delega
    const active = delegations
      .filter(d => d.delegator === m.memberId && isActive(d, closedAt, cfg))
      .sort(bySpecificityThenSeqDesc);
    const chosen = active[0];
    if (!chosen) continue;
    if (!census.has(chosen.delegate)) continue;            // delegado fuera del padrón ⇒ arista muerta
    edge.set(m.memberId, chosen.delegate);
  }

  // ---- PASO 3: recorrido de cadenas -----------------------------------------------------
  const assignedTo = new Map<MemberId, MemberId>();        // delegante -> votante terminal
  const unassigned  = new Map<MemberId, UnassignedReason>();

  for (const m of cfg.electorate.members) {                // orden canónico ⇒ determinismo
    const start = m.memberId;
    if (direct.has(start)) { assignedTo.set(start, start); continue; }
    if (!edge.has(start))  { unassigned.set(start, 'no-delegation'); continue; }

    const seen = new Set<MemberId>([start]);
    let cur = start, hops = 0, outcome: UnassignedReason | MemberId = 'unknown';

    for (;;) {
      const next = edge.get(cur);
      if (next === undefined) { outcome = direct.has(cur) ? cur : 'chain-dead-end'; break; }
      hops++;
      if (hops > dg.maxDepth) { outcome = 'depth-exceeded'; break; }
      if (seen.has(next))     { outcome = 'cycle'; break; }
      seen.add(next);
      cur = next;
      if (direct.has(cur))    { outcome = cur; break; }     // terminal: votó directo
    }

    if (typeof outcome === 'string' && !isMemberId(outcome)) unassigned.set(start, outcome);
    else assignedTo.set(start, outcome as MemberId);
  }

  // ---- PASO 4: agregación de pesos -------------------------------------------------------
  //  peso(v) = 1 (propio) + |{ d : assignedTo(d) = v, d ≠ v }|
  // ---- PASO 5: tope de concentración (C.5), determinista, LIFO por grantedSeq -------------
  // ---- PASO 6: construcción de EffectiveBallot[] en orden canónico por voter --------------
  …
}
```

### C.3.1 Las cinco reglas de oro del orden

1. **El voto directo gana siempre.** Se evalúa **antes** que cualquier delegación, para el propio
   votante y para cualquier nodo intermedio de la cadena. Un nodo que votó directo es siempre
   **terminal**: absorbe la cadena y no la reenvía.
2. **El voto directo gana incluso si es posterior al del delegado.** Si Beto (delegado) votó el
   lunes y Ana (delegante) vota directo el miércoles, al cierre el peso de Ana está en la papeleta
   de Ana, y el peso de Beto baja en 1. No hace falta revocar la delegación: **votar es revocar
   de hecho para esta decisión** (la delegación sigue vigente para las siguientes).
3. **El voto directo gana incluso si es anterior a la delegación.** Si Ana vota el lunes y delega
   el martes, su voto directo sigue mandando en esta decisión (la delegación aplicará a las
   siguientes). *Razón:* el PASO 1 no mira instantes relativos; mira si existe papeleta directa
   válida. Es la regla más simple de explicar y la que menos sorpresas produce.
4. **Revocar sin votar no es abstenerse:** el peso queda sin asignar (`no-delegation`), cuenta
   como silencio, y **no** suma a la participación.
5. **Si el delegado terminal se abstuvo explícitamente**, todos sus delegantes se abstienen con
   él (su peso entra en `Ab`, no en el silencio). *Razón:* la abstención explícita es un acto de
   voluntad del mandatario dentro del mandato recibido.

> **DECISIÓN C.3.a — Delegar DURANTE la ventana a alguien que ya votó es válido y adhiere a esa
> papeleta.** *Razón:* la delegación es un mandato **por tema**, no sobre una papeleta concreta;
> prohibirlo obligaría a congelar el grafo al abrir, lo que contradice la revocabilidad
> permanente. La UI advierte: «Marta ya emitió su voto en esta decisión; al delegar en ella, tu
> voto se sumará al suyo.» (En `sealed-tally` la advertencia dice además cómo votó, por C.7.d.)

## C.4 Ciclos y profundidad

### C.4.1 Ciclos: prevención completa + red de seguridad

**Teorema operativo:** si el grafo de delegación no tiene ciclos y sólo se modifica añadiendo
aristas de una en una, entonces **todo ciclo nuevo contiene la arista recién añadida**. Por tanto,
rechazar en el momento de conceder toda arista `A → B` tal que `B` ya alcanza a `A` es una
prevención **completa**: nunca puede existir un ciclo.

```ts
/** Se ejecuta al procesar DelegationGranted. Rechaza el evento si crearía un ciclo. */
function wouldCreateCycle(g: DelegationGraphByScope, d: Delegation): boolean {
  // Para cada ámbito efectivo tocado por d (topic(s) o círculo o global),
  // ¿es `d.delegator` alcanzable desde `d.delegate`?
  for (const scopeKey of effectiveScopeKeys(d.scope)) {
    let cur: MemberId | undefined = d.delegate, hops = 0;
    const seen = new Set<MemberId>();
    while (cur !== undefined && hops++ <= MAX_SCAN) {
      if (cur === d.delegator) return true;
      if (seen.has(cur)) break;                 // ciclo preexistente (no debería ocurrir)
      seen.add(cur);
      cur = g.edgeFor(cur, scopeKey);
    }
  }
  return false;
}
```

> **DECISIÓN C.4.a — Los ciclos se PREVIENEN al conceder (el evento `DelegationGranted` se
> rechaza con un mensaje explícito: «Beto ya delega en vos para este tema; si delegás en Beto,
> ninguno de los dos votaría»), y ADEMÁS se detectan en el escrutinio como red de seguridad.**

> **DECISIÓN C.4.b — Si pese a todo se detecta un ciclo en el escrutinio, TODOS los miembros del
> ciclo y todos los que desembocan en él quedan SIN ASIGNAR (silencio), se emite una alarma
> `IntegrityAlert` y el hecho se declara en la `Proof`.** No se rompe el ciclo por ninguna
> heurística.
> *Razón, contra las dos alternativas:*
> - *Romper la arista «más nueva» o «la última recorrida»* y depositar el peso en algún nodo:
>   el resultado depende de **por dónde empezó el recorrido**, es decir, del orden de iteración.
>   Eso viola la neutralidad (dos miembros simétricos reciben trato distinto por su posición en
>   una lista) y viola el determinismo salvo que se fije un orden arbitrario, que sería arbitrario
>   *también políticamente*.
> - *Repartir el peso del ciclo entre sus miembros* («asamblea de delegados»): fabrica una
>   preferencia que nadie expresó; en un ciclo A→B→C→A nadie quiso votar, todos quisieron que
>   otro votara. La única lectura fiel de esa configuración es: **no hay voluntad expresada**.
> El silencio es la interpretación honesta y es la única neutral.

### C.4.2 Profundidad

> **DECISIÓN C.4.c — `maxDepth = 4` aristas. Al excederse, el peso del delegante original queda
> SIN ASIGNAR (silencio); NO se deposita en el último nodo válido.**
> *Razón:*
> (a) Depositarlo en el 4.º nodo entrega poder a alguien que el delegante **no eligió** y que
> probablemente no conoce; el consentimiento se diluye exactamente donde ya era más débil.
> (b) Con 4 aristas, la pregunta «¿quién votó por mí?» todavía tiene respuesta trazable en la
> interfaz («vos → Ana → Beto → Clara → **Diego**»). A partir de ahí, el mandato es una ficción.
> (c) El límite no es sólo cognitivo, es de **poder**: las cadenas largas son el mecanismo por el
> cual unos pocos nodos acumulan la mayoría del peso sin que nadie lo haya decidido.
> *Mitigación obligatoria del costo:* ver C.4.3. Truncar sin avisar sería inaceptable.

### C.4.3 Aviso de cadena rota (obligatorio)

En `closesAt − brokenChainNotice` (default 24 h) el sistema emite `ChainBrokenNotice` a todo
miembro cuyo peso quedaría **sin asignar** por `no-delegation`, `chain-dead-end`,
`depth-exceeded`, `cycle`, `delegado-fuera-del-padrón`, o **delegado-que-aún-no-ha-votado**, con
un solo mensaje: «Tu voto no se está contando en *(título)*. Podés votar directamente hasta
*(fecha)*.» Es un requisito funcional, no una cortesía: sin él, las decisiones C.4.c y C.5
convierten un tecnicismo en desafiliación silenciosa.

## C.5 Tope de concentración

`capWeight = ⌊ cap.num × N / cap.den ⌋`, con `N = censusSize` y `cap` default `1/10` ⇒ 30 de 300.

> **DECISIÓN C.5.a — El tope se calcula sobre el CENSO, no sobre el peso efectivamente
> ejercido.** *Razón:* un tope sobre el peso ejercido es **autorreferencial** (el peso ejercido
> depende de a quién se recorta, y a quién se recorta depende del peso ejercido): exige un punto
> fijo, cuya existencia y unicidad habría que demostrar, y cuyo valor nadie puede conocer antes
> del cierre. El tope sobre censo es fijo, público desde el primer día y explicable en una frase:
> «nadie puede llevar más de 30 votos».

### C.5.1 Las tres políticas para el excedente

| Política | Qué hace | Efecto perverso |
|---|---|---|
| **(a) Descartar** | El delegado se queda con `capWeight`; el excedente se evapora. | **Desafiliación silenciosa y carrera por delegar.** Hay que elegir *a quién* se recorta, lo que crea una prioridad implícita; si es por antigüedad, incentiva delegar el primer día (*delegation rush*); si es aleatoria, el votante no puede saber si su voto contará. Y el excedente desaparece sin que nadie lo sepa. |
| **(b) Devolver al delegante** | El excedente vuelve al delegante, que queda **sin voto ejercido** y puede votar directo si se entera a tiempo. | Mismo riesgo de desafiliación que (a) **si no hay aviso**, pero es **recuperable**: el delegante conserva la capacidad de actuar. Requiere obligatoriamente el aviso de C.4.3. Coste: reduce la participación efectiva. |
| **(c) Prorratear** | El excedente pasa al siguiente delegado de la cadena, o se reparte entre otros delegados. | **El peor.** (i) Transfiere poder a personas que el delegante no eligió (mismo vicio que C.4.c pero peor, porque es masivo). (ii) Habilita el **ataque de desbordamiento**: saturo deliberadamente al delegado popular del bando contrario con delegaciones falsas o irrelevantes para que su excedente se derrame hacia un segundo delegado que yo controlo. (iii) Puede **cascadear** (el receptor también supera el tope) y exige una recursión con su propio criterio de terminación: complejidad y no determinismo evitables. |

> **DECISIÓN C.5.b — Se adopta (b) `return-to-delegator`, con dos refuerzos que son la verdadera
> solución:**
> 1. **Aplicación EX ANTE.** El tope se verifica **al conceder**: si Marta ya representa a 30
>    personas (contando cadenas transitivas proyectadas), el sistema **rechaza** nuevas
>    delegaciones hacia ella con un mensaje claro. Nadie se entera en el cierre. El recorte en el
>    escrutinio es sólo una red de seguridad para los casos en que el grafo cambió después
>    (revocaciones intermedias, cadenas que se reconectan).
> 2. **Orden de devolución LIFO por `grantedSeq`** (se devuelven primero las delegaciones **más
>    recientes**). *Razón:* la delegación marginal que empujó por encima del tope es la que se
>    devuelve, que es exactamente la que recibió la advertencia al concederse; FIFO castigaría a
>    quien delegó hace meses y confió, lo cual es arbitrario y además incentiva delegar tarde.
> El peso devuelto **no cuenta como participación** para el quórum, y la `Proof` declara
> literalmente: «Se devolvieron 4 votos por tope de concentración; esas 4 personas fueron
> avisadas el (fecha) y no votaron directamente.»

> **DECISIÓN C.5.c — Superar el umbral de concentración NUNCA invalida una decisión; sólo la
> marca.** *Razón:* si la concentración excesiva anulara el resultado, existiría el ataque
> trivial de **fabricar concentración en el bando contrario** (delegar masivamente en el delegado
> rival) para tumbar decisiones que se van a perder. La transparencia es la defensa correcta; la
> invalidación automática es un arma.

## C.6 Índice de concentración

Sea `w₁ ≥ w₂ ≥ … ≥ w_n` la distribución de pesos de los **votantes efectivos** (los que emitieron
papeleta), con `W = Σ wᵢ`.

**Herfindahl–Hirschman (indicador principal):**

```
HHI  = Σᵢ (wᵢ / W)²                        ∈ [1/n, 1]
HHI* = (HHI − 1/n) / (1 − 1/n)             ∈ [0, 1]   (normalizado; 0 = perfectamente repartido)
```

**Gini (secundario):**

```
G = ( 2 · Σᵢ i·w₍ᵢ₎ ) / ( n · W ) − (n + 1) / n        con w₍₁₎ ≤ … ≤ w₍ₙ₎ (ASCENDENTE), i = 1…n
```

**CR1 (el número que ve la gente):** `w₁ / N` — «la persona con más votos delegados representa al
X % de la comunidad».

```ts
export function hhi(weights: readonly number[]): Fraction {
  const W = BigInt(weights.reduce((a, b) => a + b, 0));
  if (W === 0n) return { num: 0n, den: 1n };
  const num = weights.reduce((a, w) => a + BigInt(w) * BigInt(w), 0n);
  return reduceFraction({ num, den: W * W });         // exacto, sin flotantes
}

export function gini(weights: readonly number[]): Fraction {
  const n = BigInt(weights.length);
  if (n === 0n) return { num: 0n, den: 1n };
  const sorted = [...weights].sort((a, b) => a - b);   // ASCENDENTE
  const W = BigInt(sorted.reduce((a, b) => a + b, 0));
  if (W === 0n) return { num: 0n, den: 1n };
  let s = 0n;
  sorted.forEach((w, idx) => { s += BigInt(idx + 1) * BigInt(w); });
  // G = 2s/(nW) − (n+1)/n = (2s − (n+1)W) / (nW)
  return reduceFraction({ num: 2n * s - (n + 1n) * W, den: n * W });
}
```

> **DECISIÓN C.6.a — El indicador normativo es `HHI*`; Gini se calcula y se publica pero no
> dispara nada; CR1 es el que se muestra en la interfaz.** *Razón:* Gini mide desigualdad global
> y es sorprendentemente **insensible** a nuestro riesgo real: una distribución con 299 personas
> a peso 1 y una a peso 30 tiene un Gini modesto, mientras que el peligro (una sola persona
> decidiendo por 30) es máximo. HHI eleva al cuadrado y por tanto reacciona a la concentración en
> pocas manos, que es exactamente lo que queremos vigilar. Y CR1 es el único de los tres que un
> humano interpreta sin explicación.
> **Umbral de alarma:** `HHI* ≥ 0.15` ∨ `CR1 ≥ 1/20` ⇒ la `Proof` incluye el bloque
> «Concentración alta» con la lista de los 5 mayores delegados y sus pesos. Sin efecto jurídico
> (C.5.c).

## C.7 Delegación y voto secreto — el problema difícil

### C.7.1 Enunciado honesto de la imposibilidad

Se quieren tres cosas a la vez:

- **(S) Secreto:** nadie puede saber cómo votó una persona concreta.
- **(R) Rendición de cuentas:** el delegante puede verificar que su poder se ejerció, y **en qué
  sentido**.
- **(D) Delegación con peso:** el delegado emite una papeleta que vale por varios.

**(S) ∧ (R) ∧ (D) es imposible.** Prueba informal: por (D), el peso del delegante está dentro de
la papeleta del delegado. Por (R), el delegante aprende el sentido de esa papeleta. Luego el
delegante conoce el voto del delegado, violando (S) para el delegado. Y no es un secreto «casi
mantenido»: en un instituto de 300 personas, un delegado con 15 delegantes tiene su voto conocido
por 15 personas, es decir, es público. Ninguna criptografía arregla esto, porque no es un
problema de ocultación: es que la información *tiene* que fluir para que (R) se cumpla.

### C.7.2 El argumento decisivo, que casi nadie hace

Hay un problema **anterior y peor**. El voto secreto no existe para la comodidad del votante:
existe para hacer **imposible la coacción y la compra de votos**, y lo logra por una vía muy
concreta: haciendo que el votante **no pueda demostrarle a un tercero cómo votó**
(*receipt-freeness*). Un comprador no paga por algo que no puede verificar.

**La delegación destruye esa propiedad por construcción.** Un coaccionador no necesita saber cómo
votaste: le basta con exigirte que **delegues en él**. Y eso sí es perfectamente verificable —
el propio delegado ve su lista de delegantes—. La delegación reintroduce, por la puerta de al
lado, exactamente el canal de coacción que el voto secreto cierra. En un contexto con asimetrías
reales de poder (un docente, un líder de grupo, alguien que gestiona monitorías), no es una
hipótesis exótica.

### C.7.3 Reglas

> **DECISIÓN C.7.a — En `privacy: 'secret-ballot'` la delegación está PROHIBIDA. No «inerte»,
> no «desaconsejada»: `enabled && privacy === 'secret-ballot'` es una configuración INVÁLIDA y
> `DecisionOpened` se rechaza.**
> *Razón:* C.7.2. Un voto secreto con delegación es un voto secreto con una puerta trasera
> pública y verificable; ofrece la apariencia de protección sin la protección. Es peor que no
> tener secreto, porque induce a la gente a confiar. Las decisiones que de verdad necesitan
> secreto —elegir personas, evaluar a un docente, denunciar— son precisamente aquellas donde la
> coacción es plausible, es decir, donde la delegación es más peligrosa.

> **DECISIÓN C.7.b — En `sealed-tally` con delegación habilitada, la papeleta del DELEGADO es
> pública y nominal desde el cierre**, aunque las papeletas de quienes votaron sólo por sí mismos
> se publiquen bajo seudónimo. El registro de delegaciones (quién delega en quién, por tema) es
> **público** mientras esté vigente.
> *Razón:* es la única regla coherente con (R), y es exactamente el principio parlamentario: el
> ciudadano vota en secreto, el representante vota **en acta**. Aceptar un mandato es aceptar la
> publicidad; quien no quiera exponerse, que no acepte delegaciones. Y hace visible el registro
> de delegaciones, que es el dato con el que la comunidad puede detectar concentraciones y
> presiones.

> **DECISIÓN C.7.c — Recibo de ejercicio con prueba de inclusión.** Al cierre, cada delegante
> recibe: `ballotId` del delegado, sentido del voto, peso ejercido y una **prueba de inclusión de
> Merkle** de su `memberId` en el conjunto `onBehalfOf` de esa papeleta, verificable contra la
> raíz publicada en `ResultComputed`. Así el delegante comprueba —sin confiar en el servidor—
> que su voto fue **contado una vez, ahí, y no en otro lado**.

> **DECISIÓN C.7.d — Ventana de última palabra: la papeleta del delegado se revela a SUS
> delegantes en el instante en que la emite, no al cierre.** Los delegantes pueden entonces votar
> directo (lo que revoca de hecho, regla C.3.1-2).
> *Trade-off asumido, explícitamente:* esto **filtra información parcial** antes del cierre en un
> modo que se llama «sellado». Se acepta porque (i) el delegado ya puede anunciar públicamente su
> voto y no podemos —ni deberíamos— impedirlo; (ii) por C.7.b ese voto será público en pocas
> horas de todos modos, así que la fuga adicional es marginal; y (iii) la alternativa —enterarte
> al cierre de que tu delegado votó lo contrario de lo que esperabas, sin poder hacer nada— es
> un cheque en blanco, y un mandato sin capacidad de corrección no es representación, es cesión.
> El sello protege el **agregado** (nadie ve el marcador global), no las declaraciones
> individuales.

> **DECISIÓN C.7.e — En `public-roll-call` no hay nada que resolver:** todo es público, incluidas
> las delegaciones. Es el modo por defecto para decisiones de gestión ordinaria.


---

# PARTE D — QUÓRUM, UMBRAL Y VENTANAS

## D.1 Quórum: las tres fórmulas

Sea `N` el censo congelado, y sea `E` el conjunto de miembros **representados** en el escrutinio
(es decir, aquellos cuyo peso quedó asignado a alguna papeleta: votantes directos + delegantes
cuya cadena terminó en una papeleta emitida, incluidas las de abstención explícita).
Como cada miembro aporta exactamente 1 y los pesos son enteros (B.0.a):

```
W_ejercido = |E| = Σ_{papeletas} peso
```

### D.1.1 Quórum de participación

```
P = |E| / N                 Cumple ⟺ P ≥ quorum.participation      (comparación exacta de fracciones)
```

> **DECISIÓN D.1.a — Delegar es participar.** Un miembro cuya cadena terminó en una papeleta
> emitida cuenta en `E`, aunque no haya tocado la aplicación durante la votación. Si su delegado
> **no** votó, **no** cuenta. *Razón:* la delegación es un acto político deliberado y verificable;
> negarle valor de participación equivale a decir que sólo cuenta quien vota a mano, lo que
> vacía de sentido al mecanismo. Y la condición «su delegado sí votó» impide inflar el quórum con
> delegaciones inertes.

> **DECISIÓN D.1.b — `minDirectParticipation` (opcional, sin default).** Fracción mínima de `N`
> que debe haber votado **directamente**. Se exige para reformas estatutarias y elección de
> personas. *Razón:* evita que una decisión constituyente se apruebe con 12 personas votando por
> 280. La delegación es legítima para la gestión; para lo constituyente, la comunidad debe
> aparecer con su propia mano.

### D.1.2 Quórum de aprobación

```
Aq = A / N                  Cumple ⟺ Aq ≥ quorum.approvalOfCensus
```
Es un **piso absoluto de apoyo** independiente del umbral del método: «no basta con ganar la
votación, hay que tener al menos el X % del instituto detrás».

> **DECISIÓN D.1.c — Si `method.base === 'census'`, `approvalOfCensus` es redundante y la
> validación de configuración lo RECHAZA** (en vez de aplicarlo dos veces). *Razón:* dos frenos
> idénticos con nombres distintos producen mensajes de error incomprensibles («no alcanzó el
> umbral» vs «no alcanzó el quórum de aprobación» para el mismo hecho).

### D.1.3 Quórum por círculo

Para cada `{ circleId: c, min: q_c }`, sea `M_c = { m ∈ padrón : c ∈ m.circles }`:

```
P_c = |E ∩ M_c| / |M_c|     Cumple ⟺ P_c ≥ q_c   (y si |M_c| = 0 ⇒ NO cumple)
```

> **DECISIÓN D.1.d — La participación se atribuye al miembro REPRESENTADO, no al autor de la
> papeleta.** Si Ana (círculo *Estética*) delega en Beto (círculo *Lógica*), la participación de
> Ana cuenta para *Estética*. *Razón:* el quórum por círculo mide **qué parte del círculo está
> representada en la decisión**, no cuántas papeletas firmó gente del círculo. La atribución al
> autor permitiría que un círculo entero «participe» porque su delegado de otro círculo votó, o
> lo contrario: que un círculo cuyos miembros delegaron todos hacia afuera aparezca ausente.

> **DECISIÓN D.1.e — Todos los quórums son condiciones de VALIDEZ, y se evalúan ANTES del
> escrutinio.** Si alguno falla, el `outcome` es `no-quorum` y **el resultado del método no se
> publica** (sólo la participación). *Razón:* publicar «habría ganado X pero no hubo quórum»
> crea una legitimidad paralela de facto y presión para «respetar la voluntad expresada»,
> vaciando el quórum de sentido. El escrutinio se computa igual (queda en el log, recomputable),
> pero no se muestra.

## D.2 Quórum no alcanzado: máquina de estados

```
                        tick(closesAt)
                             │
                   ┌─────────┴──────────┐
                   │ ¿quórum cumplido?  │
                   └───┬───────────┬────┘
                    sí │           │ no
                       ▼           ▼
              DecisionClosed   ┌────────────────────────────┐
                               │ onFailure                  │
                               ├────────────────────────────┤
    'reject'   → DecisionClosed(cause:'window') → ResultComputed(no-quorum) → DecisionRejected
    'extend'   → si extensionsUsed < maxExtensions:
                     WindowExtended(newClosesAt = closesAt + extensionDuration)  [sigue Open]
                 si no:  → DecisionClosed → ResultComputed(no-quorum) → DecisionRejected
    'escalate' → DecisionClosed → ResultComputed(no-quorum) → DecisionRejected
                 ∧ se crea una NUEVA decisión en Draft en el círculo superior,
                   con `escalatedFrom = decisionId` (no es un estado de esta decisión)
```

> **PRECISIÓN de A.8.1 — El tick de cierre es ATÓMICO y emite EXACTAMENTE UNO de
> `{WindowExtended, DecisionClosed}`.** Ambos pueden llevar `occurredAt === closesAt`. La
> serialización por `seq` en el store garantiza que no puedan coexistir: el segundo en llegar
> encuentra el estado ya cambiado y es rechazado. *Razón:* si la prórroga tuviera que emitirse
> estrictamente antes de `closesAt`, habría que evaluar el quórum antes del cierre, es decir,
> **antes de que llegaran los últimos votos**, que es justo cuando se decide el quórum.

> **DECISIÓN D.2.a — `maxExtensions` por defecto = 1, tope duro = 2.** *Razón:* prorrogar
> indefinidamente hasta alcanzar el quórum equivale a **no tener quórum**: convierte un requisito
> de legitimidad en una molestia administrativa. Una prórroga es una segunda convocatoria
> razonable; la tercera es terquedad.

> **DECISIÓN D.2.b — La prórroga NO reabre el padrón** (A.1 sigue rigiendo: el padrón se congeló
> al abrir) **y NO invalida las papeletas ya emitidas.** *Razón:* si prorrogar recongelara el
> padrón, prorrogar sería una forma encubierta de cambiar el electorado a la vista del marcador.

> **DECISIÓN D.2.c — `escalate` NUNCA convierte automáticamente la decisión en aprobada.** Crea
> un borrador en el círculo superior, que decidirá con su propio método. *Razón:* la falta de
> quórum es ausencia de mandato; convertirla en mandato de otro órgano por vía automática sería
> premiar la desmovilización.

## D.3 Ventanas temporales y el milisegundo del cierre

### D.3.1 Representación del tiempo

- Todo instante se almacena como `Instant` = **milisegundos desde epoch UTC**.
- `America/Bogota` es UTC−05:00 y **no tiene horario de verano** desde 1993. Aun así:

> **DECISIÓN D.3.a — La hora local se convierte a `Instant` UNA VEZ, al configurar la decisión, y
> se congela dentro de `configHash`. El motor jamás consulta una base de datos de husos
> horarios.** *Razón:* las reglas IANA cambian (Colombia ha discutido reintroducir DST en crisis
> energéticas); si guardáramos «viernes 6:00 p.m. hora de Bogotá» y la regla cambiara, el cierre
> de una decisión abierta se desplazaría una hora. Un `Instant` congelado es inmune. La zona se
> guarda **sólo para renderizar** («cierra el viernes 26 a las 6:00 p.m.»).

### D.3.2 La regla del cierre: exclusiva y sin gracia

> **DECISIÓN D.3.b — `closesAt` es EXCLUSIVO. Una papeleta es válida ⟺ `castAt < closesAt`
> (estrictamente menor). Una papeleta con `castAt === closesAt` es RECHAZADA.**
> *Razón:* la ventana es el intervalo semiabierto `[opensAt, closesAt)`. Intervalos semiabiertos
> componen sin solapamiento ni hueco (el cierre de una ronda es exactamente la apertura de la
> siguiente) y eliminan la pregunta «¿el instante del cierre pertenece a antes o a después?».
> Simétricamente, `opensAt` es **inclusivo**: válida ⟺ `castAt ≥ opensAt`.

> **DECISIÓN D.3.c — `castAt` lo asigna el SERVIDOR, en el punto de serialización, es decir, en
> la misma transacción que asigna `seq`.** No es la hora del cliente, ni la de llegada del HTTP,
> ni la de un balanceador. *Razón:* cualquier otro punto obliga a confiar en un reloj ajeno al
> punto de serialización, y produce el escenario en el que dos réplicas discrepan sobre si un
> voto entró. Con `castAt` asignado junto a `seq`, el orden temporal y el orden causal son el
> mismo orden, por construcción.

> **DECISIÓN D.3.d — NO hay período de gracia.** *Razón:* toda gracia es simplemente otro
> `closesAt` desplazado, con su propio milisegundo límite; no resuelve el problema, lo mueve y lo
> vuelve menos visible. La frontera debe ser una, nítida y anunciada.
> *Mitigaciones (de producto, no de motor):* cuenta regresiva visible desde 5 minutos antes; aviso
> a las 24 h y a la 1 h a quienes no han votado; y la advertencia explícita de que un envío
> iniciado antes del cierre puede ser rechazado si el servidor lo serializa después.

> **DECISIÓN D.3.e — Empates de `castAt` se resuelven por `seq` ascendente.** Dado que `castAt` y
> `seq` se asignan juntos, el orden es total y consistente. Ninguna regla de escrutinio de la
> PARTE B depende del orden de llegada salvo el desempate estable (INV-22/INV-23).

## D.4 Cierre anticipado por resultado matemáticamente irreversible

### D.4.1 Cómo se calcula

Sea `movibles` = miembros del padrón que **no** han emitido papeleta directa. Cada uno puede
mover su peso 1 a cualquier casilla (incluso sacándolo de donde hoy está por delegación). Sean
`mY`, `mN`, `mA`, `mU` los movibles cuyo peso hoy cuenta como sí, no, abstención y sin asignar.

```
Peor caso para la aprobación (todos los movibles votan NO):
    A⁻ = A − mY          R⁺ = R + mY + mA + mU          Ab⁻ = Ab − mA
Mejor caso para la aprobación (todos los movibles votan SÍ):
    A⁺ = A + mN + mA + mU  R⁻ = R − mN                  Ab⁻ = Ab − mA
```

```ts
export function irreversibility(cfg, s: LiveTally): 'approved' | 'rejected' | 'open' {
  const m = cfg.method;
  if (m.kind !== 'simple-majority' && m.kind !== 'supermajority' && m.kind !== 'unanimity')
    return 'open';                                   // D.4.b

  // (1) el quórum sólo puede CRECER ⇒ el peor caso de quórum es el estado actual
  if (!quorumMet(cfg, s)) return 'open';             // aún reversible por el lado del quórum

  const worst = { approve: s.A - s.mY, reject: s.R + s.mY + s.mA + s.mU,
                  abstain: s.Ab - s.mA, census: cfg.electorate.censusSize };
  const best  = { approve: s.A + s.mN + s.mA + s.mU, reject: s.R - s.mN,
                  abstain: s.Ab - s.mA, census: cfg.electorate.censusSize };

  if (passes(cfg, worst)) return 'approved';         // gana en TODA continuación posible
  if (!passes(cfg, best)) return 'rejected';         // pierde en TODA continuación posible
  return 'open';
}
```

**Monotonicidad que hace correcta esta cota:** con `base:'cast'`, `A/(A+R)` decrece al añadir
`R` y al mover un `A` a `R`; con `base:'census'` el denominador es constante y sólo importa `A⁻`.
Por tanto el mínimo del cociente se alcanza en la continuación «todos los movibles votan NO», y
el máximo en «todos votan SÍ». No hay continuaciones intermedias fuera de ese rango. ∎

### D.4.2 El trade-off, analizado

Cerrar antes **revela información**, y de tres maneras distintas:

1. **Revelación directa del sentido.** «Cerró antes porque ya era irreversible» dice que la
   opción ganadora ganó. En `sealed-tally`, eso es exactamente lo que el sello prometía ocultar
   hasta el final.
2. **Revelación por temporización (canal lateral).** Peor y más sutil: quien conoce la regla
   puede **acotar el marcador** a partir del *instante* del cierre. Si cerró cuando quedaban 40
   movibles, entonces la ventaja era de al menos 40; cuanto antes cierre, mayor la goleada. Un
   observador atento extrae una estimación bastante fina del margen sin ver una sola papeleta.
3. **Revelación por no-cierre.** La ausencia de cierre anticipado también informa: «sigue
   abierta, luego está reñida». Este canal existe **aunque nadie cierre nunca**, mientras la
   regla esté activa.

Contra estos costos, los beneficios reales: se ahorra tiempo de la comunidad, se evita la
frustración de votar «cuando ya no sirve», y se libera la agenda. Y un costo adicional que no es
informativo sino político: **cerrar antes le quita a la minoría la posibilidad de dejar
constancia**. En una comunidad filosófica, el registro del disenso tiene valor propio,
independiente de su efecto sobre el resultado.

> **DECISIÓN D.4.a — `earlyClose` está DESHABILITADO por defecto.**
> **DECISIÓN D.4.b — Cuando se habilita, sólo se permite en estas combinaciones:**
>
> | `privacy` | modo permitido | justificación |
> |---|---|---|
> | `public-roll-call` | `mathematically-irreversible` | el marcador ya es público en tiempo real ⇒ los canales 1 y 2 no revelan nada nuevo. |
> | `sealed-tally` | **sólo** `full-turnout` | «votaron los 300» no revela el sentido ni el margen. |
> | `secret-ballot` | **sólo** `full-turnout` | ídem. |
>
> Y sólo para métodos de umbral (`simple-majority`, `supermajority`, `unanimity`); para métodos
> ordinales o graduados la irreversibilidad exige explorar el espacio de continuaciones (costoso
> y frágil) y el canal lateral es mucho más rico.

> **DECISIÓN D.4.c — Piso de deliberación: el cierre anticipado nunca puede ocurrir antes de
> `opensAt + 24 h`, aunque el resultado sea irreversible desde el minuto tres.** *Razón:* protege
> el valor deliberativo y el registro del disenso; y evita que una decisión se resuelva entre las
> 10 y las 11 de la noche por quienes estaban conectados.

> **DECISIÓN D.4.d — El cierre anticipado se registra con `cause` explícita y la `Proof` declara
> cuántas personas no alcanzaron a votar.** Frase obligatoria: «Se cerró antes de tiempo porque
> el resultado ya no podía cambiar. 112 personas no habían votado.»


---

# PARTE E — INVARIANTES PARA PROPERTY-BASED TESTING

> Estos invariantes son **el contrato ejecutable**. Cada uno debe existir como un
> `test.prop` de fast-check en `packages/domain/test/props/`. Un invariante que no se puede
> escribir es una especificación mal hecha; un invariante que falla es un bug del motor, nunca
> «una interpretación distinta».

## E.0 Catálogo de generadores

| Generador | Produce |
|---|---|
| `arbMemberId` | `MemberId` único (base32, 26 chars) |
| `arbElectorate(n?)` | `Electorate` con `n ∈ [1, 300]` miembros, ordenado, `rollHash` bien formado |
| `arbStrata` | mapa `StratumKey → StratumValue` con 2–4 claves, 2–6 valores cada una |
| `arbMethod` | cualquier variante de `DecisionMethod` con parámetros válidos |
| `arbThresholdMethod` | sólo `simple-majority` \| `supermajority` \| `unanimity` |
| `arbMonotoneMethod` | métodos monótonos: umbral, `approval`, `score`, `majority-judgment`, `condorcet-schulze` |
| `arbConfig(electorate, method)` | `DecisionConfig` coherente (ventana, quórum, privacidad, delegación) |
| `arbBallot(method, options)` | `BallotPayload` **válido** para ese método |
| `arbInvalidBallot(method, options)` | payload malformado: opción inexistente, ranking con repetidos, score fuera de `[0,5]`, `grades` incompleto, `consent:'object'` sin `Objection`, `castAt` fuera de ventana, votante fuera del padrón |
| `arbEventLog(config)` | secuencia de eventos **legal** (respeta la máquina de estados), con `seq` denso y `prevHash` encadenado |
| `arbAcyclicDelegationGraph(members, depth)` | grafo de delegación sin ciclos, profundidad ≤ `depth` |
| `arbDelegationOps` | intercalado de `Granted`/`Revoked` con instantes dentro y fuera de la ventana |
| `arbPermutation(k)` | permutación de `0…k−1` |
| `arbGradeProfile(m, k, W)` | matriz de menciones: `W` votantes × `m` opciones sobre `k` grados |
| `arbRankingProfile(m, C)` | `C` órdenes (totales o truncados) sobre `m` opciones |
| `arbScoreProfile(m, C)` | `C` vectores de `Score \| null` |
| `arbSeed` | par `(seedAdmin, beaconValue)` con su `commitment` |
| `arbClockNow` | instante arbitrario, usado **sólo** para probar que el escrutinio no lo lee |

`numRuns` mínimo en CI: 1 000 (10 000 nocturno). La semilla de fast-check se **fija** en CI y el
contraejemplo minimizado se persiste en `test/props/__counterexamples__/`.

---

## E.1 Elegibilidad y padrón

**INV-01 — Un voto inválido nunca cambia el resultado.**
- *Formal:* `∀ L, b : ¬valid(b, cfg) ⇒ tally(cfg, L ⧺ [b]) ≡ tally(cfg, L)` (igualdad de `outcome`, `turnout` y `resultHash` salvo `computedFromSeq`).
- *Generadores:* `arbConfig`, `arbEventLog`, `arbInvalidBallot`.
- *Fallo ingenuo:* validar en el borde HTTP y no en el dominio; o «interpretar caritativamente» (un score `7` truncado a `5`, un ranking con repetidos deduplicado). Cualquier normalización silenciosa convierte basura en voto.

**INV-02 — Un inelegible nunca cuenta.**
- *Formal:* `∀ b : b.voter ∉ electorate.members ⇒ b ∉ effectiveBallots ∧ W(b.voter) = 0`.
- *Generadores:* `arbElectorate`, `arbMemberId` (fuera del padrón), `arbBallot`.
- *Fallo ingenuo:* filtrar por «existe en la tabla `members`» (registro actual) en vez de por el **snapshot congelado**.

**INV-03 — Quien se matricula después de abrir no vota.**
- *Formal:* `∀ m : m.enrolledAt ≥ electorate.frozenAt ⇒ m ∉ electorate.members ∧ ballots(m) rechazadas`.
- *Generadores:* `arbElectorate`, `arbEventLog` con `MemberEnrolled` intercalado tras `DecisionOpened`.
- *Fallo ingenuo:* recalcular el padrón al cerrar «para tenerlo actualizado» — el error más natural y más grave.

**INV-04 — Quien votó y luego se retiró: su voto cuenta y sigue en el denominador.**
- *Formal:* `∀ m ∈ electorate, b = ballot(m) : withdraw(m) en t > b.castAt ⇒ b ∈ effectiveBallots ∧ censusSize invariante`.
- *Generadores:* `arbEventLog` con `MemberWithdrawn` tras `BallotCast`.
- *Fallo ingenuo:* hacer `JOIN` contra el registro vivo de matriculados al escrutar; el voto desaparece y el resultado deja de ser reproducible mañana.

**INV-05 — El conteo siempre corresponde al electorado congelado.**
- *Formal:* `result.rollHash === cfg.electorate.rollHash ∧ ∀ b ∈ effectiveBallots : b.voter ∈ members(rollHash)`.
- *Generadores:* `arbConfig`, `arbEventLog`.
- *Fallo ingenuo:* pasar el electorado por referencia mutable y que otro proceso lo modifique entre abrir y escrutar.

**INV-06 — El padrón está bien formado.**
- *Formal:* `censusSize === members.length ∧ ∀i<j: members[i].memberId < members[j].memberId ∧ ∀m: m.baseWeight === 1`.
- *Generadores:* `arbElectorate`.
- *Fallo ingenuo:* construir el snapshot desde un `Set` y confiar en el orden de inserción ⇒ `rollHash` distinto en cada máquina.

---

## E.2 Papeletas

**INV-07 — Idempotencia sobre la última papeleta.**
- *Formal:* `∀ m, ∀ B = [b₁…b_k] papeletas de m con seq crecientes : tally(L ⧺ B) ≡ tally(L ⧺ [b_k])`.
- *Generadores:* `arbBallot` repetido `k ∈ [1, 10]` veces para el mismo votante.
- *Fallo ingenuo:* `INSERT` sin `UPSERT`, o agregar sumando todas las papeletas del votante (peso 3 para quien votó 3 veces).

**INV-08 — Votar dos veces no produce dos votos válidos.**
- *Formal:* `|{ b ∈ effectiveBallots : b.voter = m }| ≤ 1` para todo `m`.
- *Generadores:* `arbEventLog` con `BallotCast` duplicados (mismo contenido y distinto contenido).
- *Fallo ingenuo:* deduplicar por `ballotId` en vez de por `voter`: dos papeletas distintas del mismo votante pasan el filtro.

**INV-09 — Una papeleta sobre una versión obsoleta de la propuesta no cuenta en la ronda nueva.**
- *Formal:* `b.proposalVersionHash ≠ cfg.proposalVersionHash ⇒ b ∉ effectiveBallots`.
- *Generadores:* `arbEventLog` con `ObjectionIntegrated` + `RoundOpened` intercalados.
- *Fallo ingenuo:* arrastrar los consentimientos de la ronda anterior «porque ya habían dicho que sí»: falsifica la voluntad sobre un texto que nadie leyó.

**INV-10 — Una papeleta fuera de la ventana no cuenta.**
- *Formal:* `b ∈ effectiveBallots ⇒ opensAt ≤ b.castAt < closedAt`.
- *Generadores:* `arbInstant` a −1 ms, 0 ms y +1 ms de cada extremo (casos frontera explícitos, no sólo aleatorios).
- *Fallo ingenuo:* usar `<=` en el cierre (acepta el voto del milisegundo exacto) o comparar con `closesAt` programado en vez de `closedAt` real tras una prórroga.

**INV-11 — La abstención explícita nunca suma al numerador.**
- *Formal:* `∀ L : approve(L ⧺ [abstain(m)]) === approve(L)`; y con `abstentionPolicy='exclude'`, tampoco al denominador.
- *Generadores:* `arbThresholdMethod × AbstentionPolicy`, `arbEventLog`.
- *Fallo ingenuo:* modelar la papeleta como `boolean` con `null`, y que `null` caiga en el `else` del `if (approve)` sumando a `reject`.

**INV-12 — Una papeleta de tipo incompatible se rechaza, no se convierte.**
- *Formal:* `kind(b.payload) ∉ acceptedKinds(method) ⇒ throw InvalidBallotForMethod`.
- *Generadores:* producto cartesiano `arbMethod × arbBallot(otroMétodo)`.
- *Fallo ingenuo:* convertir un `ranking` a `approval` tomando el primero, o un `score ≥ 3` a `approve: true`. Inventa una preferencia.

---

## E.3 Determinismo, orden y reproducibilidad

**INV-13 — El desempate SIEMPRE resuelve.**
- *Formal:* `∀ cfg, L : tally(cfg, L).outcome.kind ≠ 'tie-unresolved'`.
- *Generadores:* perfiles construidos adversarialmente para forzar empates exactos (`arbGradeProfile` simétrico, `arbRankingProfile` con ciclos perfectos, `arbScoreProfile` idéntico).
- *Fallo ingenuo:* olvidar `lexicographic-hash` al final de la cascada, o devolver `null` y que la capa superior lo pinte como «empate» — que en producción significa parálisis institucional.

**INV-14 — Reproducibilidad bit a bit desde los eventos.**
- *Formal:* `∀ L : hash(tally(cfg, L)) === hash(tally(cfg, L))` ejecutado en dos procesos, dos locales (`en-US`, `es-CO`), dos husos horarios (`UTC`, `America/Bogota`) y dos órdenes de `Object.keys`.
- *Generadores:* `arbEventLog`, más un *wrapper* que altera `process.env.TZ` y `LANG`.
- *Fallo ingenuo:* `localeCompare`, `toLocaleDateString`, `JSON.stringify` sobre objetos con claves en orden de inserción, `Intl` en cualquier lugar del dominio.

**INV-15 — El escrutinio no lee el reloj.**
- *Formal:* `∀ now₁, now₂ : tally(cfg, L, now₁) ≡ tally(cfg, L, now₂)`.
- *Generadores:* `arbClockNow` × 2, con `Date.now` parcheado a valores extremos (0, 2^42).
- *Fallo ingenuo:* usar `Date.now()` para decidir si una delegación está vigente en vez de `closedAt`. Es un bug que sólo aparece cuando se recomputa un resultado histórico — es decir, en la auditoría.

**INV-16 — Conmutatividad del escrutinio.**
- *Formal:* `∀ π ∈ Permutaciones(L_ballots) : outcome(tally(cfg, reseq(π(L)))) === outcome(tally(cfg, L))`, donde `reseq` reasigna `seq` conservando la relación «última papeleta por votante».
- *Generadores:* `arbEventLog`, `arbPermutation`.
- *Fallo ingenuo:* estructuras acumuladoras dependientes del orden (un `Map` que se recorre con orden de inserción para desempatar), o `Array.sort` con comparador no total que en V8 no es estable para arreglos > 10 elementos.

**INV-17 — El desempate es estable bajo permutación.**
- *Formal:* si `tally(L).tieBroken === true`, entonces `∀π : winner(tally(reseq(π(L)))) === winner(tally(L))`.
- *Generadores:* perfiles con empate forzado + `arbPermutation`.
- *Fallo ingenuo:* desempatar por «la primera opción encontrada» al recorrer un mapa; el resultado cambia con el orden de llegada de los votos, que es exactamente lo que un atacante controla.

**INV-18 — Ninguna comparación de umbral usa punto flotante.**
- *Formal:* verificación estática + dinámica: `∀ comparación : |A·den − f.num·D| se evalúa en bigint`; test que construye `A/D` con valores donde `Number` pierde precisión (`A = 2^53+1`) y comprueba el signo correcto.
- *Generadores:* `arbFraction` con numeradores > 2^53.
- *Fallo ingenuo:* `A / D >= 2/3` con `0.6666666666666666 < 2/3` ⇒ rechaza un resultado que cumplía exactamente el umbral. Con `N = 300` es raro; con pesos y fracciones compuestas, no.

**INV-19 — La cadena de hashes del log es consistente.**
- *Formal:* `∀ i > 1 : L[i].prevHash === L[i−1].hash ∧ L[1].prevHash === "0"×64 ∧ L[i].seq === i`.
- *Generadores:* `arbEventLog` y mutaciones adversariales (borrar, insertar, reordenar un evento).
- *Fallo ingenuo:* calcular el hash sobre el objeto con campos opcionales `undefined` ⇒ dos serializaciones distintas del mismo evento.

**INV-20 — `resultHash` recomputado coincide con el almacenado.**
- *Formal:* `∀ L cerrado : recompute(L).resultHash === event('ResultComputed', L).resultHash`.
- *Generadores:* `arbEventLog` completo hasta `Closed`.
- *Fallo ingenuo:* incluir en el hash campos no deterministas (`computedAt`, tiempos de ejecución, orden de un `Set`).

---

## E.4 Pesos y delegación

**INV-21 — La suma de pesos nunca excede el censo.**
- *Formal:* `Σ_{b ∈ effectiveBallots} b.weight ≤ censusSize`.
- *Generadores:* `arbAcyclicDelegationGraph`, `arbDelegationOps`, `arbEventLog`.
- *Fallo ingenuo:* contar al delegante en la papeleta del delegado **y además** dejarle su propio peso; o contar el peso en cada nodo intermedio de la cadena (A→B→C suma A en B y en C).

**INV-22 — Cada miembro contribuye a lo sumo a una papeleta.**
- *Formal:* los conjuntos `{b.voter} ∪ b.onBehalfOf` de las papeletas efectivas son **disjuntos dos a dos**, y su unión ⊆ padrón.
- *Generadores:* ídem INV-21.
- *Fallo ingenuo:* delegaciones solapadas por ámbito (`topic` y `global` a distintas personas) resueltas sumando ambas en vez de escogiendo la más específica.

**INV-23 — El voto directo anula la delegación, sin importar el orden temporal.**
- *Formal:* `∀ m con ballot directo b : W(m) ≥ 1 ∧ m ∉ onBehalfOf(b') ∀ b' ≠ b`, para toda intercalación de `DelegationGranted`, `BallotCast(delegado)` y `BallotCast(m)`.
- *Generadores:* `arbDelegationOps` × `arbPermutation` sobre los 3! órdenes relevantes.
- *Fallo ingenuo:* resolver delegaciones **antes** que las papeletas directas, o «congelar» el peso del delegado cuando emite (entonces el voto directo posterior duplica el peso del delegante: se cuenta en ambas).

**INV-24 — Una delegación revocada deja de aplicar desde el instante exacto de la revocación.**
- *Formal:* `d.revokedAt ≤ closedAt ⇒ d ∉ grafoEfectivo`; y `∀ ε > 0 : revocación en closedAt − ε ⇒ no aplica; revocación en closedAt + ε ⇒ sí aplica`.
- *Generadores:* `arbDelegationOps` con `revokedAt ∈ {closedAt−1, closedAt, closedAt+1}` (frontera explícita).
- *Fallo ingenuo:* cachear el grafo de delegación al abrir la decisión (rendimiento) y no invalidarlo; o usar `<=` donde va `<` en `t < d.revokedAt`.

**INV-25 — El grafo resuelto no contiene ciclos.**
- *Formal:* `∀ m : la secuencia m → edge(m) → edge²(m) … no repite nodo antes de terminar`.
- *Generadores:* `arbDelegationGraph` **con** ciclos inyectados (para probar la red de seguridad) y `wouldCreateCycle` sobre secuencias de concesiones (para probar la prevención).
- *Fallo ingenuo:* recorrido recursivo sin conjunto `seen` ⇒ *stack overflow* en producción, que además es un ataque de denegación de servicio trivial (A→B, B→A).

**INV-26 — Ninguna cadena efectiva excede `maxDepth`, y al excederse el peso NO se deposita.**
- *Formal:* `assignedTo(m) = v ⇒ dist(m, v) ≤ maxDepth`; y `dist(m, ·) > maxDepth ⇒ m ∉ ⋃ onBehalfOf`.
- *Generadores:* cadenas de longitud `maxDepth − 1`, `maxDepth`, `maxDepth + 1`, `maxDepth + 5`.
- *Fallo ingenuo:* «cortar y depositar en el último nodo alcanzado», que entrega poder a alguien no elegido; o contar nodos en vez de aristas (error de ±1 sistemático).

**INV-27 — Ningún peso supera el tope de concentración.**
- *Formal:* `∀ b ∈ effectiveBallots : b.weight ≤ ⌊cap.num · N / cap.den⌋`.
- *Generadores:* grafos en estrella (todos delegan en uno) y en escoba (estrella + cadena).
- *Fallo ingenuo:* aplicar el tope sólo a las delegaciones **directas** y no al peso transitivo total.

**INV-28 — La devolución por tope es determinista y LIFO.**
- *Formal:* `∀ π : devueltos(reseq(π(L))) === devueltos(L)`, y `devueltos` son exactamente las delegaciones de mayor `grantedSeq` hacia ese delegado.
- *Generadores:* estrella saturada + `arbPermutation` del orden de eventos.
- *Fallo ingenuo:* recortar recorriendo un `Map` (orden de inserción) ⇒ a quién se le quita el voto depende del orden de llegada de eventos no relacionados.

**INV-29 — Una delegación expirada no aplica.**
- *Formal:* `d.expiresAt ≤ closedAt ⇒ d ∉ grafoEfectivo`.
- *Generadores:* `expiresAt` en `{closedAt−1, closedAt, closedAt+1}`.
- *Fallo ingenuo:* comparar `expiresAt` contra `opensAt` (la delegación estaba viva al abrir, luego «vale»).

**INV-30 — Una delegación fuera de ámbito no aplica; la más específica gana.**
- *Formal:* si `m` tiene activas `d_topic`, `d_circle`, `d_global` que casan con `D`, entonces `edge(m) === d_topic.delegate`.
- *Generadores:* combinaciones de las 3 especificidades × decisiones con y sin ese `topic`.
- *Fallo ingenuo:* aplicar la más reciente en vez de la más específica; o casar `topic` por igualdad con `D.topics[0]` en lugar de por pertenencia al conjunto.

**INV-31 — Los índices de concentración están en rango y son exactos.**
- *Formal:* `1/n ≤ HHI ≤ 1`, `0 ≤ HHI* ≤ 1`, `0 ≤ Gini < 1`; y `distribución uniforme ⇒ HHI* = 0 ∧ Gini = 0`; `un solo votante con todo el peso ⇒ HHI = 1`.
- *Generadores:* distribuciones uniforme, degenerada, y `arbAcyclicDelegationGraph`.
- *Fallo ingenuo:* Gini con el arreglo ordenado **descendente** (da negativo), o dividir entre `n²·μ` con `μ` en punto flotante.

**INV-32 — Delegación y voto secreto son incompatibles por configuración.**
- *Formal:* `cfg.privacy === 'secret-ballot' ∧ cfg.delegation.enabled ⇒ DecisionOpened rechazado`.
- *Generadores:* `arbConfig` con el producto `PrivacyMode × {enabled: bool}`.
- *Fallo ingenuo:* «desactivar la delegación en silencio» para esa decisión: el usuario cree que su delegado vota por él y su voto simplemente no existe.

**INV-33 — Participación = personas representadas.**
- *Formal:* `|E| === Σ b.weight === |{votantes directos}| + |{delegantes con cadena terminada en papeleta}|`.
- *Generadores:* grafos mixtos con cadenas rotas, ciclos y topes.
- *Fallo ingenuo:* contar papeletas (`C`) en vez de peso (`W`) para el quórum: 12 papeletas con peso 280 darían 4 % de participación.

---

## E.5 Máquina de estados e inmutabilidad

**INV-34 — Ninguna transición ilegal se acepta.**
- *Formal:* `∀ (s, e) ∉ TransicionesLegales : apply(s, e) lanza IllegalTransitionError ∧ estado inalterado`.
- *Generadores:* producto cartesiano completo `Estado × TipoEvento` (6 × 17 = 102 casos, exhaustivo, no aleatorio) + `arbEventLog` con un evento ilegal inyectado en posición aleatoria.
- *Fallo ingenuo:* un `switch` sobre el tipo de evento sin mirar el estado; o un `default:` que ignora en silencio.

**INV-35 — Una propuesta cerrada no muta.**
- *Formal:* `∀ L, ∀ e posterior a DecisionClosed : proposalVersionHash, electorate.rollHash, configHash, effectiveBallots son idénticos antes y después`.
- *Generadores:* `arbEventLog` cerrado + eventos posteriores arbitrarios.
- *Fallo ingenuo:* permitir `ObjectionIntegrated` o `BallotCast` tras el cierre porque «la ronda seguía abierta en otra tabla».

**INV-36 — Los estados terminales son absorbentes.**
- *Formal:* `s ∈ {Ratified, Rejected, Annulled} ⇒ ∀ e : apply(s, e) lanza ∧ s' = s`.
- *Generadores:* ídem INV-34 restringido a terminales.
- *Fallo ingenuo:* permitir `Annulled → Ratified` «para corregir un error»; toda corrección debe ser una decisión nueva.

**INV-37 — No hay reapertura.**
- *Formal:* `¬∃ L : estado(L) recorre … Closed … Open …`.
- *Generadores:* `arbEventLog` + `DecisionOpened` inyectado tras `DecisionClosed`.
- *Fallo ingenuo:* modelar la prórroga como `Closed → Open` en vez de como evento dentro de `Open`.

**INV-38 — La prórroga sólo aumenta `closesAt` y está acotada.**
- *Formal:* `∀ WindowExtended : newClosesAt > closesAt_actual ∧ |{WindowExtended ∈ L}| ≤ maxExtensions`, y el tick de cierre emite **exactamente uno** de `{WindowExtended, DecisionClosed}`.
- *Generadores:* `arbEventLog` con quórum insuficiente y `maxExtensions ∈ {0, 1, 2}`.
- *Fallo ingenuo:* un cron que emite prórroga y cierre en la misma ventana de tiempo sin serializar ⇒ decisión cerrada y prorrogada a la vez.

**INV-39 — Sin quórum no se publica el resultado del método.**
- *Formal:* `outcome.kind === 'no-quorum' ⇒ result.proof no contiene ganador, conteos por opción ni matriz de pares`.
- *Generadores:* `arbConfig` con `participation` alto y `arbEventLog` de baja participación.
- *Fallo ingenuo:* calcular todo y filtrar en la UI ⇒ el dato viaja en la API y se filtra.

---

## E.6 Propiedades de los métodos

**INV-40 — Monotonía en los métodos monótonos.**
- *Formal:* sea `w = winner(P)`. Si `P'` se obtiene de `P` mejorando (sólo) la posición/puntuación/mención de `w` en una papeleta, entonces `winner(P') = w`. Aplica a: umbral, `approval`, `score`, `majority-judgment`, `condorcet-schulze`.
- *Generadores:* `arbMonotoneMethod`, `arbGradeProfile`/`arbScoreProfile`/`arbRankingProfile`, más una transformación `raise(w, ballot)`.
- *Fallo ingenuo:* implementar el desempate de forma que «mejorar» cambie el orden de recorrido y con él el ganador. **Nota:** si el resultado cambia sólo por desempate, el test debe exigir `winner(P') = w` igualmente, porque `w` ya no está empatado.

**INV-41 — Añadir la papeleta de un elegible nuevo no invierte el resultado (métodos monótonos).**
- *Formal:* `w = winner(P)`; si `b` es una papeleta que sitúa a `w` en primer lugar, entonces `winner(P ∪ {b}) = w`.
- *Generadores:* ídem INV-40.
- *Fallo ingenuo:* denominadores que se recalculan mal al crecer `C` (p.ej. cuota fija en un método que debía usar cuota reducida).

**INV-42 — IRV está EXCLUIDO de INV-40 e INV-41, y la exclusión se prueba.**
- *Formal:* el test de monotonía filtra `method.kind !== 'irv'`; y existe un test **positivo** que verifica el contraejemplo de B.6: `winner(P) = B ∧ winner(raise(B, 4 papeletas)) = C`.
- *Generadores:* perfil fijo de B.6 (no aleatorio) + búsqueda aleatoria de contraejemplos con `arbRankingProfile(3, 30)` que debe encontrar **al menos uno** en 10 000 corridas.
- *Fallo ingenuo:* incluir IRV en el test de monotonía, ver que falla, y «arreglar» el motor hasta que pase — introduciendo un bug real para satisfacer una propiedad que IRV no tiene. Documentarlo aquí evita ese desastre.

**INV-43 — Si existe ganador de Condorcet, gana con Schulze.**
- *Formal:* `(∃x : ∀y≠x, d[x][y] > d[y][x]) ⇒ schulze(P).winners === [x]`.
- *Generadores:* `arbRankingProfile(m ∈ [2,6], C ∈ [1,50])`, filtrando los perfiles con ganador de Condorcet (y también generándolos por construcción para no depender del filtrado).
- *Fallo ingenuo:* el orden de bucles de Floyd–Warshall con el pivote adentro (B.8.a).

**INV-44 — Schulze siempre produce al menos un ganador.**
- *Formal:* `∀ P : |schulze(P).winners| ≥ 1`.
- *Generadores:* `arbRankingProfile` incluyendo ciclos perfectos y perfiles vacíos por opción.
- *Fallo ingenuo:* inicializar `p[i][j] = d[i][j]` (sin la condición `d[i][j] > d[j][i]`), lo que rompe el teorema.

**INV-45 — `p[][]` coincide con la fuerza de camino calculada por fuerza bruta.**
- *Formal:* para `m ≤ 6`, `p[x][y] === max sobre todos los caminos simples x⇝y de min(aristas)`.
- *Generadores:* `arbRankingProfile(m ≤ 6)` + enumeración exhaustiva de caminos simples.
- *Fallo ingenuo:* el mismo de INV-43; este test lo detecta aunque exista ganador de Condorcet.

**INV-46 — La mención mayoritaria es invariante a permutaciones.**
- *Formal:* `∀ π : majorityGrade(π(menciones)) === majorityGrade(menciones)`.
- *Generadores:* `arbGradeProfile`, `arbPermutation`.
- *Fallo ingenuo:* calcular la mediana sobre el arreglo **sin ordenar**, o usar el índice `n/2` sin `floor` (con `n` impar da un índice fraccionario que JS convierte silenciosamente).

**INV-47 — `mjCompare` es un orden total estricto.**
- *Formal:* antisimetría `mjCompare(a,b) === −mjCompare(b,a)`; transitividad `mjCompare(a,b)<0 ∧ mjCompare(b,c)<0 ⇒ mjCompare(a,c)<0`; reflexividad `mjCompare(a,a)===0`.
- *Generadores:* tripletas de `arbGradeProfile` con igual `W`.
- *Fallo ingenuo:* retirar la mediana de una sola de las dos opciones (rompe antisimetría), o retirar **todas** las ocurrencias de la mediana de golpe (rompe transitividad y da resultados distintos a la definición).

**INV-48 — MJ: unanimidad de mención implica esa mención mayoritaria.**
- *Formal:* `∀ v : grade(v, o) = g ⇒ majorityGrade(o) = g`.
- *Generadores:* perfiles constantes.
- *Fallo ingenuo:* el error de ±1 en `⌊W/2⌋` sólo se ve en casos frontera; este test lo ancla trivialmente.

**INV-49 — MJ con `W` par usa el mediano INFERIOR.**
- *Formal:* `W = 2, menciones = {mejor, peor} ⇒ majorityGrade = peor`.
- *Generadores:* casos frontera explícitos `W ∈ {1,2,3,4}` × `k = 5`.
- *Fallo ingenuo:* usar el mediano superior o el promedio de los dos centrales (que ni siquiera es una mención).

**INV-50 — Score: «sin opinión» no equivale a 0.**
- *Formal:* `∃ P : median(P con ⊥) ≠ median(P con ⊥ ↦ 0)`; y `∀ P : W(V_o) cuenta sólo los ≠ ⊥`.
- *Generadores:* `arbScoreProfile` con densidad de `null` ∈ [0.1, 0.6].
- *Fallo ingenuo:* `score ?? 0` en el acumulador. Una línea, y hunde sistemáticamente a las propuestas menos conocidas.

**INV-51 — Score: robustez local de la mediana.**
- *Formal:* si un votante cambia su puntuación de `s` a `s'`, la nueva mediana `M'` cumple `min(M, s') ≤ M' ≤ max(M, s')`.
- *Generadores:* `arbScoreProfile` + mutación de un elemento.
- *Fallo ingenuo:* implementar la «mediana ponderada» como media de los dos centrales, que no cumple esta propiedad y además puede devolver `2.5`, que no es una puntuación.

**INV-52 — Umbral: `0/0` nunca aprueba.**
- *Formal:* `A = R = Ab = 0 ⇒ ¬passes` para todo método de umbral, incluida `unanimity`.
- *Generadores:* log sin ninguna papeleta.
- *Fallo ingenuo:* `approve === den` con `den = 0` da `true`: unanimidad vacía. También `NaN >= 2/3` es `false` por accidente, no por diseño.

**INV-53 — Consentimiento: pasa ⟺ cero objeciones admitidas no integradas.**
- *Formal:* `outcome = approved ⟺ |{o : admitida(o) ∧ ¬integrada(o)}| = 0 ∧ engagement ≥ minEngagement`.
- *Generadores:* `arbEventLog` de objeciones con todas las combinaciones de `Raised/Admitted/Dismissed/Integrated/Withdrawn`.
- *Fallo ingenuo:* contar votos «a favor» en algún lado; o considerar integrada una objeción sin la firma del objetante (B.3.b).

**INV-54 — Consentimiento: las rondas terminan.**
- *Formal:* `∀ L : |{RoundOpened ∈ L}| ≤ maxRounds`, y el proceso alcanza un estado terminal en tiempo finito.
- *Generadores:* `arbEventLog` con objeciones perpetuas.
- *Fallo ingenuo:* bucle `while (hayObjeciones)` sin contador: bloqueo institucional indefinido y, en el motor, un bucle infinito.

**INV-55 — Sorteo: tamaño y cuotas correctos.**
- *Formal:* `|muestra| = min(sampleSize, N)`; `∀ estrato e : |muestra ∩ e| = quota(e)` salvo redistribución declarada (B.9.b); `Σ quota = sampleSize`.
- *Generadores:* `arbElectorate × arbStrata × sampleSize ∈ [1, N]`, incluyendo estratos más pequeños que su cuota.
- *Fallo ingenuo:* redondear cada cuota por separado y obtener `Σ ≠ sampleSize` (error clásico de Hamilton mal implementado).

**INV-56 — Sorteo: determinismo por semilla y verificabilidad del ticket.**
- *Formal:* `sortition(e, cfg, s) === sortition(e, cfg, s)`; `s ≠ s' ⇒ P[muestras iguales]` despreciable; y `∀ m ∈ muestra : ticket(m) ≤ ticket(m')` para todo `m'` del mismo estrato fuera de la muestra.
- *Generadores:* `arbSeed × 2`, `arbElectorate`.
- *Fallo ingenuo:* usar `Math.random()`, o un Fisher–Yates sembrado cuyo orden de recorrido no está especificado (no reproducible entre versiones de la implementación).

**INV-57 — Commit–reveal: la semilla revelada corresponde al compromiso.**
- *Formal:* `SeedRevealed aceptado ⟺ sha256(seedAdmin) === cfg.seedCommitment`; si falla, la decisión pasa a `Annulled`.
- *Generadores:* `arbSeed` + semillas falsas.
- *Fallo ingenuo:* revelar la semilla antes del cierre, o generar la semilla en el momento del desempate (sin compromiso previo): «sorteo verificable» que nadie puede verificar.

**INV-58 — Cierre anticipado: es correcto (*soundness*).**
- *Formal:* si `irreversibility(cfg, s) = 'approved'`, entonces `∀ continuación c del log : outcome(tally(L ⧺ c)) = approved`. Simétrico para `'rejected'`.
- *Generadores:* estado parcial `arbLiveTally` + enumeración/muestreo de continuaciones `c` (con `N ≤ 12` se enumera exhaustivamente; con `N` mayor se muestrea).
- *Fallo ingenuo:* calcular los movibles como `N − papeletas` sin descontar el peso que esos movibles ya aportan por delegación ⇒ se declara irreversible algo que sí puede cambiar. Cerrar antes por error es irreparable.

**INV-59 — Cierre anticipado: respeta el piso de deliberación y el modo de privacidad.**
- *Formal:* `cause = 'early-irreversible' ⇒ closedAt ≥ opensAt + 24h ∧ privacy = 'public-roll-call' ∧ method ∈ métodos de umbral`.
- *Generadores:* `arbConfig` con el producto `PrivacyMode × EarlyCloseMode × arbMethod`.
- *Fallo ingenuo:* permitir cierre anticipado en `sealed-tally`, filtrando el sentido del resultado por el canal de temporización (D.4.2).

**INV-60 — El outcome es coherente con el estado final.**
- *Formal:* `estado = Ratified ⇒ outcome.kind ∈ {approved, winner, sample}`; `estado = Rejected ⇒ outcome.kind ∈ {rejected, no-quorum, tie-unresolved(imposible)}`.
- *Generadores:* `arbEventLog` completo.
- *Fallo ingenuo:* ratificar automáticamente por vencimiento del plazo de impugnación sin volver a mirar el `outcome`.

---

## E.7 Anti-invariantes: propiedades que NO se cumplen

Documentar esto es tan importante como los invariantes: evita que alguien «arregle» el motor para
satisfacer una propiedad que el método realmente no tiene.

| Anti-INV | Enunciado | Por qué NO se cumple |
|---|---|---|
| **A-01** | «IRV es monótono» | Falso por construcción (B.6). El test de monotonía **debe** excluir `irv`. |
| **A-02** | «IRV cumple el criterio de participación» | Falso: existe la *paradoja del no votante* — abstenerse puede darte un resultado mejor que votar sinceramente. |
| **A-03** | «La participación crece monótonamente mientras la decisión está abierta» | Falso: una revocación de delegación sin voto directo **reduce** `|E|`. Consecuencia práctica: el quórum puede dejar de cumplirse. Por eso D.2 evalúa el quórum **una sola vez**, en el tick de cierre. |
| **A-04** | «Todo método cumple independencia de alternativas irrelevantes» | Falso para todo método ordinal no dictatorial (Arrow). Aplica a Schulze, IRV y —en casos construidos— a MJ. |
| **A-05** | «Añadir una papeleta nunca cambia el ganador si esa papeleta pone al ganador último» | Falso en general; en umbral con `base:'cast'` sí lo cambia, y debe hacerlo. |
| **A-06** | «El escrutinio es asociativo por lotes» | Falso: `tally(L₁) ⊕ tally(L₂) ≠ tally(L₁ ⧺ L₂)` en MJ, IRV y Schulze. No se puede paralelizar por particiones ingenuas de papeletas. |
| **A-07** | «Si nadie objeta, hay consenso» | Falso operativamente: con `silenceMeans:'not-participating'` el silencio no consiente (B.3.e). |

---

## E.8 Resumen de conteo

- **60 invariantes** (`INV-01` … `INV-60`) y **7 anti-invariantes** (`A-01` … `A-07`).
- Cobertura mínima exigida en CI: 100 % de los invariantes ejecutándose, 0 fallos, `numRuns ≥ 1000`.
- Todo contraejemplo minimizado se congela como test de regresión determinista.

---

## Apéndice — Índice de decisiones normativas

| Id | Decisión |
|---|---|
| 0.A | Prohibida la jerga técnica en strings de UI (lint) |
| A.0 / A.0.b | `MemberId` aleatorio de 128 bits (CSPRNG), nunca derivado — corregido por R1; prohibido `localeCompare` |
| A.1 / A.2 / A.3 | Padrón congelado al abrir; el voto del retirado cuenta; el retirado permanece en `N` |
| A.4 / A.5 / A.6 | Peso resuelto al cierre; última papeleta manda; `proposalVersionHash` obligatorio |
| A.7 | `configHash` incluye `engineVersion`; escrutadores históricos conservados |
| A.8 | El resultado es derivado; discrepancia ⇒ `Annulled` |
| A.9 / A.10 | Replay por `seq`; `occurredAt` del servidor |
| A.11 | Prórroga = evento dentro de `Open` |
| B.0.a–d | Pesos enteros; desempate final por hash; semilla compuesta con faro externo; `0/0` no aprueba |
| B.1.a–c | `abstentionPolicy` y `base` obligatorios y visibles; default `exclude`+`cast`+estricto; mayoría absoluta = supermayoría 1/2 sobre censo |
| B.2.a–c | `census` sólo para actos constituyentes; `present` exige registro previo; supermayorías con `≥` |
| B.3.a–e | Presunción de validez de la objeción + panel sorteado; integración requiere firma del objetante; `maxRounds`=3; escalamiento explícito; el silencio no consiente |
| B.4.a | Unanimidad deshabilitada por defecto |
| B.5.a–c | `⊥` se ignora con `minCoverage`; agregador `median`; desempate por media exacta |
| B.6.a–c | Cuota reducida; desempate de eliminación propio; IRV vetado para personas y estatutos |
| B.7.a–c | Eliminación sucesiva (sin *gauge*); papeleta completa obligatoria; MJ es el método por defecto |
| B.8.a–b | Pivote de Floyd–Warshall en el bucle externo; truncadas = empatadas al final |
| B.9.a–c | Selección por ticket HMAC; redistribución de cuotas declarada; suplentes publicados |
| C.1.a–b | Delegación caduca (≤ 1 semestre); una activa por ámbito |
| C.2.a–b | Especificidad > recencia; resolución en `closedAt` |
| C.3.a | Delegar a quien ya votó es válido y adhiere |
| C.4.a–c | Ciclos prevenidos al conceder + silencio si aparecen; `maxDepth` = 4 con truncado a silencio; aviso obligatorio de cadena rota |
| C.5.a–c | Tope sobre censo; devolución al delegante (LIFO) + aplicación ex ante; la concentración marca pero no anula |
| C.6.a | `HHI*` normativo, Gini informativo, CR1 visible |
| C.7.a–e | Delegación prohibida con voto secreto; papeleta del delegado pública; recibo con prueba de Merkle; ventana de última palabra |
| D.1.a–e | Delegar es participar; `minDirectParticipation` para lo constituyente; atribución al representado; sin quórum no se publica el resultado |
| D.2.a–c | ≤ 1 prórroga; la prórroga no recongela el padrón; `escalate` no aprueba |
| D.3.a–e | Instante congelado (no husos vivos); cierre exclusivo; `castAt` en el punto de serialización; sin gracia; empates por `seq` |
| D.4.a–d | Cierre anticipado desactivado por defecto; sólo en `public-roll-call` + umbral, o `full-turnout`; piso de 24 h; declaración obligatoria en la `Proof` |

---

*Fin de la especificación 30. Cualquier cambio a este documento exige subir `engineVersion` y
conservar el escrutador anterior.*
