# ADR-0021: Seudonimización retroactiva con `PIIErasureRequested` / `PIIErased`

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** `11-privacidad-y-voto-secreto.md` §1.5 (**ADR-115 propuesto**) y `20-normativa-datos-colombia.md` §7.4.

## Contexto

Ana propuso «Asamblea permanente los jueves», se aprobó, la comunidad la ejecutó dos años, y hoy Ana ejerce su derecho de supresión. Borrar el evento destruiría la historia de una institución; negarlo violaría la ley. La salida es que **el hecho sobreviva y la persona desaparezca**.

Con la separación de almacenes (ADR-0008) esto es casi trivial: `ProposalSubmitted` nunca contuvo «Ana Gómez», contuvo `actor: MemberId("K7F2…")`.

## Decisión

**La supresión no altera ningún evento pasado.** Se ejecuta el borrado físico en la bóveda (ADR-0009) y se registran **dos eventos nuevos** en el ledger:

```ts
| { type: 'PIIErasureRequested'; subject: MemberId; requestedAt: Instant;
    legalBasis: 'ley-1581-art-8e' | 'revocatoria-consentimiento';
    claimRef: string }                       // radicado, sin PII
| { type: 'PIIErased'; subject: MemberId; executedAt: Instant;
    shredReportHash: Hash;                   // el informe vive en la bóveda
    displayPseudonym: string;                // 'Miembro retirado K7F2'
    backupsClearAt: Instant }                // cuándo expira la última copia
```

La resolución de identidad **falla en abierto** hacia un seudónimo estable de visualización: la interfaz muestra *«Autoría: Miembro retirado K7F2 · datos personales suprimidos el 14/03/2027»*. El evento no cambia **ni un byte**: `prevHash` verifica y la raíz Merkle anclada hace dos años sigue válida.

**Por qué esto no es reescribir la historia.** Reescribirla sería afirmar que la propuesta no existió, que la escribió otro, o cambiar su contenido. Nada de eso ocurre. Lo que se retira es el **vínculo entre un acto público y una identidad civil privada** —vínculo que nunca estuvo en el ledger y cuya permanencia la ley no exige. Es un acta de asamblea: el acuerdo sigue vigente aunque el archivo de afiliados se depure.

## Alternativas consideradas

- **Reescribir `actor` a `'anónimo'`.** Rompe la cadena de hashes y destruye la coherencia del debate: deja de saberse que dos intervenciones eran de la misma persona.
- **Ocultar o borrar la propuesta.** Expropia a la comunidad de una decisión que ejecutó durante dos años.
- **Negar la supresión invocando el deber estatutario de permanencia.** Ese límite protege el hecho institucional, no el nombre de la persona.
- **Seudónimo distinto por proceso.** Rompería la coherencia longitudinal del debate y es incompatible con ADR-0006 (contradicción C5).

## Consecuencias

- La historia **gana información en vez de perderla**: queda registrado que hubo una solicitud, cuándo, con qué base legal y cuándo se ejecutó. El SLA del art. 15 se vuelve auditable públicamente.
- El derecho de supresión se ejerce sin tocar la integridad criptográfica del registro.
- La interfaz necesita una ruta de fallo bien definida para todo `MemberId` no resoluble, y esa ruta es normal, no excepcional.

## Consecuencias negativas aceptadas

- **Un observador sabe que *alguien* se borró.** Es el dato mínimo que queda sobre esa persona: coste aceptado y declarado al titular por adelantado.
- El seudónimo de visualización deriva del `MemberId`, de modo que las intervenciones de la persona siguen agrupadas entre sí. Preserva la coherencia del debate y mantiene el enlace longitudinal, que en n≈300 puede re-identificar por inferencia.
- Anunciar el mecanismo **ex ante** es obligatorio: aplicar retroactivamente una técnica no anunciada es sorpresivo y debilita la defensa jurídica.
- Si tras la seudonimización el registro es inservible como memoria institucional, no había razón para conservarlo y hay que borrarlo entero. Esa evaluación es humana y nadie la va a querer hacer.
