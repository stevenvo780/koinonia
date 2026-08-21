# ADR-0033: El acuerdo es una entidad separada de la decisión, con fecha de revisión y criterios de evaluación obligatorios

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** `02-sociocracia-ostrom.md` §1.6; `03-deliberativa-sistemas-antipatrones.md` §3.4 y §5.5 (decisiones que nunca se ejecutan).

## Contexto

El antipatrón número cinco de las plataformas participativas es «actas impecables, realidad idéntica». El corpus normativo de una organización se convierte en un cementerio: acuerdos vigentes que nadie recuerda, que nadie evalúa y que nadie deroga, porque derogar tiene coste político y olvidar no tiene ninguno.

La causa técnica es confundir dos cosas: **la decisión es el acto puntual; el acuerdo es la norma que queda vigente**. Tienen ciclos de vida distintos y modelarlos como una sola entidad hace imposible revisar lo segundo.

## Decisión

`Agreement` es una entidad de primera clase, separada de `Decision`, con campos obligatorios validados **en el dominio, no en el formulario**:

```ts
interface Agreement {
  agreementId; driverId; decisionId; circleId;
  ownerId;                       // quién convoca la revisión
  reviewAt: Instant;             // NOT NULL
  evaluationCriteria: readonly { // ≥1, definidos ANTES de acordar
    observable: string;          // qué se mira
    source: string;              // de dónde sale el dato
    successIf: string;           // umbral acordado de antemano
  }[];
  status: 'vigente' | 'en-revision' | 'enmendado' | 'derogado' | 'caducado';
}
```

**Regla dura:** una decisión que crea un acuerdo **no puede pasar a `Ratified`** si `reviewAt` o `evaluationCriteria` están vacíos. Es una invariante del motor.

**Sin renovación explícita el acuerdo pasa a `caducado`**: la inercia trabaja a favor de la limpieza y no de la acumulación. Cadencias por defecto: operativo un semestre, procedimental un año, constitutivo dos años con revisión intermedia. Toda revisión produce evento (`AgreementKept`, `AgreementAmended`, `AgreementRepealed`, `AgreementEscalated`) y **mantener también exige evidencia** contra los criterios.

Además: **ninguna propuesta nueva del mismo responsable se abre con una evaluación vencida** (`03-...` §3.4.1). Es la única presión que funciona sin sanciones.

## Alternativas consideradas

- **Acuerdo como estado de la decisión.** Impide revisar la norma sin reabrir el acto, y mezcla dos ciclos de vida.
- **Fecha de revisión opcional.** Se deja vacía siempre; lo opcional en un formulario es lo que no existe.
- **Criterios definidos en la revisión.** Es el modo normal en que un acuerdo fracasado se declara exitoso: se elige a posteriori la vara que uno pasa.
- **Caducidad manual.** Nadie deroga: derogar tiene coste político, olvidar no tiene ninguno.

## Consecuencias

- El corpus normativo tiene caducidad, y la deuda normativa (acuerdos vencidos sin revisar) es medible y atribuible **al círculo, nunca a una persona**.
- Los criterios fijados antes eliminan la evaluación retrospectiva sesgada.
- Baja el coste político de derogar: revisar es rutina calendarizada, no un ataque a quien lo propuso.
- Hace honesto el «suficientemente seguro para intentar» del consentimiento: sólo lo es si hay una fecha comprometida para mirar el resultado.

## Consecuencias negativas aceptadas

- **Fricción en el momento de acordar:** hay que redactar criterios observables antes de cerrar, justo cuando todo el mundo quiere terminar.
- Un acuerdo importante puede caducar por olvido y dejar un vacío normativo. La caducidad automática es deliberada, pero tendrá víctimas.
- Los criterios mal redactados producen evaluaciones que no significan nada y dan falsa sensación de rigor.
- Bloquear propuestas nuevas de quien tiene evaluaciones vencidas castiga precisamente a quien más hace, y puede leerse como sanción. Hay que vigilar que no se convierta en desincentivo a proponer.
