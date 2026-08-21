# ADR-0009: Borrado físico en el PII Vault; el borrado criptográfico se reserva a backups

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** resolución **R3** del arquitecto. Reduce el alcance del **ADR-112** propuesto en `11-privacidad-y-voto-secreto.md` §1.3 y fija la postura del proyecto sobre la zona gris de `20-normativa-datos-colombia.md` §7.3.

## Contexto

El corpus contenía una afirmación que no se sostiene: que la SIC acepta el borrado criptográfico como equivalente a la supresión física del dato personal. **No existe doctrina publicada de la SIC que lo respalde**, ni resolución, ni concepto, ni precedente. Tampoco hay opinión vinculante del EDPB que declare el crypto-shredding equivalente al art. 17 del RGPD. Lo más cercano —la CNIL sobre blockchain y RGPD— reconoce que borrar la clave es lo que más se aproxima al borrado en una cadena inmutable, pero **no afirma que satisfaga el art. 17**, y recomienda mantener los datos personales fuera de la cadena.

El riesgo de apostar a esa interpretación es asimétrico: si la SIC no la acepta, la sanción disponible para el tratamiento de datos sensibles es el **cierre inmediato y definitivo de la operación** (art. 23 lit. d, Ley 1581).

## Decisión

**Ante una solicitud de supresión se borra físicamente el registro del PII Vault:** `DELETE` real de todas las filas del sujeto, en claro o cifradas, más `VACUUM FULL` sobre las tablas afectadas. Ése es el acto de supresión.

**El borrado criptográfico se reserva a backups y réplicas**, donde el borrado físico es imposible: se sobrescribe con ceros la `wrappedDsk` del keystore para que el WAL registre una sobrescritura y no sólo un borrado lógico, y se declara al titular la fecha de expiración de la última copia que aún lo contiene.

El punto queda marcado en la documentación como **zona gris con la postura del proyecto explícita**: no afirmamos que el crypto-shredding equivalga a la supresión; afirmamos que **no necesitamos que equivalga**, porque en producción el dato se borra de verdad y el crypto-shredding sólo cubre lo que el `DELETE` no alcanza.

## Alternativas consideradas

- **Crypto-shredding como mecanismo principal** (ADR-112 tal como fue propuesto). Elegante y suficiente en lo técnico; jurídicamente es una apuesta sobre una interpretación no confirmada. Rechazada por R3.
- **Seudonimización irreversible como respuesta única** al art. 8 lit. e. Sigue dejando la fila en la base; ante la SIC habría que sostener que el titular ya no es «determinable», que es exactamente la discusión que no queremos tener.
- **Borrado físico también en backups**, restaurando y reescribiendo cada snapshot. Operativamente inviable para un equipo estudiantil y, hecho a medias, peor que no hacerlo.
- **Negar la supresión invocando el deber estatutario de permanencia** (`20-normativa-datos-colombia.md` §7.1). Ese límite existe y protege el **hecho institucional**; no protege el nombre de la persona, y usarlo para eso sería abusarlo.

## Consecuencias

- La defensa jurídica descansa en un hecho verificable —la fila ya no existe— y no en una interpretación doctrinal que nadie ha confirmado.
- Al titular se le declara la verdad completa: *«sus datos ya son irrecuperables en producción; las copias que aún los contienen se destruyen el DD/MM/AAAA»*. Eso es defendible; afirmar borrado instantáneo, no.
- El SLA de supresión efectiva es de 15 días hábiles (art. 15) **más** los 35 días de expiración de copias (ADR-0020), y hay que decirlo antes, no después.
- El ledger no participa en la supresión: no la necesita, porque no contiene datos personales (ADR-0007, ADR-0008).

## Consecuencias negativas aceptadas

- **`VACUUM FULL` toma bloqueo exclusivo** sobre las tablas afectadas: hay ventana de indisponibilidad de la bóveda en cada supresión. A 300 titulares es tolerable; se agenda.
- Se pierde la posibilidad de «des-borrar» ante un error de identificación del solicitante. Obliga a un procedimiento de verificación de identidad serio **antes** de ejecutar, no después.
- Queda una ventana de hasta 35 días en la que los datos son recuperables por quien tenga el backup **y** la clave maestra. Es el límite honesto del diseño y se declara al titular, no se disimula.
- Un `DELETE` real destruye también la evidencia de la autorización que el art. 17 lit. c obliga a conservar. Hay que resolverlo conservando el `consent_record` **despersonalizado** y el radicado de la solicitud, sin PII.
