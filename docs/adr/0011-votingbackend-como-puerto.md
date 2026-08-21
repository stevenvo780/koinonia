# ADR-0011: `VotingBackend` como puerto para migrar a Belenios sin romper el historial

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** decisión estructural del arquitecto; consolida el **ADR-123** propuesto en `11-privacidad-y-voto-secreto.md` §2.4 (etapa 2) junto con su `GuaranteeMatrix`.

## Contexto

Si el MVP vota con tracker seudónimo (ADR-0010) y en dos años migra a Belenios (ADR-0018), aparece un problema que no es técnico sino de honestidad: **una decisión de 2026 no tuvo las garantías de una de 2028**, y la interfaz no puede sugerir lo contrario. El fraude retórico a evitar es decir «siempre tuvimos voto secreto verificable».

El segundo problema es de acoplamiento: si el motor de decisiones llama directamente a las tablas de la urna, cambiar de backend obliga a tocar el dominio.

## Decisión

Un **puerto `VotingBackend`** en el dominio, con dos implementaciones (`'pseudonymous-tracker'` y `'belenios'`) y las operaciones `openElection`, `issueCredentials`, `castBallot`, `closeElection`, `tally` y `verify` —esta última **ejecutable por un tercero con sólo los artefactos públicos**.

Cada backend **declara sus garantías como estructura de datos**, no como texto: `GuaranteeMatrix` con `eligibility`, `uniqueness`, `secrecyFrom`, `individualVerifiability`, `universalVerifiability`, `adminTamperEvidence`, `coercionResistance` y `receiptFreeness`.

Al abrir cada elección se emite `VotingBackendDeclared { kind, version, guaranteesHash, paramsHash }`, donde `guaranteesHash = hash(jcs(GuaranteeMatrix))`. **La promesa hecha queda congelada en el ledger**, y de esa matriz se deriva el texto que se muestra al votante (ADR-0017).

`coercionResistance` y `receiptFreeness` están tipados como el literal `false`: **el compilador impide** ponerlos en `true` sin cambiar el tipo y sostener esa afirmación ante revisión.

## Alternativas consideradas

- **Texto de garantías escrito a mano en la plantilla.** Se desincroniza del backend real en la primera refactorización, y ahí nace la mentira. Es el modo normal en que un sistema honesto se vuelve deshonesto sin que nadie lo decida.
- **Acoplar el motor a la etapa 1** y reescribir cuando llegue la etapa 2. Convierte la migración en un proyecto de reescritura que nunca se hace.
- **Reverificar el histórico con la criptografía nueva** al migrar. Imposible: las papeletas de 2026 no están cifradas. Por eso el histórico se verifica con el verificador de su época, archivado y versionado.

## Consecuencias

- El ledger es común y la cadena de hashes es continua a través de la migración.
- La interfaz muestra, en cada decisión histórica, **la declaración vigente en su momento**.
- Cambiar una garantía obliga a cambiar código y queda en el diff, revisable.
- Un tercero puede escribir su propio verificador contra la interfaz `verify` sin acceso al servidor.

## Consecuencias negativas aceptadas

- El puerto añade una indirección que hoy sólo tiene una implementación real; es coste pagado por adelantado contra un futuro que puede no llegar.
- `GuaranteeMatrix` fija un vocabulario cerrado de garantías: uno nuevo que no encaje obligará a versionar el tipo y a decidir qué significa para las declaraciones ya selladas.
- Archivar y mantener ejecutable el verificador de la etapa 1 durante años es trabajo real de mantenimiento que nadie querrá hacer.
