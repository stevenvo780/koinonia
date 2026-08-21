# ADR-0020: Retención de 35 días en backups con material de clave y re-shred obligatorio en toda restauración

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** `11-privacidad-y-voto-secreto.md` §1.3 (**ADR-113 propuesto**). Complementa ADR-0009.

## Contexto

Éste es el límite real del borrado, y no tiene solución criptográfica: si hoy alguien pide supresión y existe un backup de hace un mes con la `wrappedDsk` **y** la KEK de entonces, ese backup permite reconstruir sus datos. Destruir la clave hoy no alcanza el pasado.

Sólo caben mitigaciones operativas, y hay que declararlas como lo que son.

## Decisión

1. **Retención corta y dura:** **35 días** para bóveda y keystore, con destrucción automática y sin excepciones. El ledger, que no contiene PII (ADR-0007, ADR-0008), puede tener retención indefinida — ahí está el valor de la separación.
2. **Backups separados con custodios distintos:** el del keystore no comparte medio, proveedor ni credencial con el de datos. Restaurar exige a dos personas.
3. **Cola de supresión diferida:** un backup **nunca** se restaura sin pasar por `replayPendingErasures()`, que re-ejecuta los `shred` y los `DELETE` pendientes sobre el snapshot **antes de aceptar tráfico**.
4. **Declaración al titular:** *«sus datos ya son irrecuperables en producción; las copias que aún los contienen se destruyen el DD/MM/AAAA»*.

## Alternativas consideradas

- **Backups sin PII.** Imposible: la bóveda *es* PII.
- **Confiar en que nadie restaure un backup viejo.** No es un control, es una esperanza.
- **Retención larga «por si acaso».** Cada día extra es un día más de ventana de reidentificación para alguien que ya ejerció su derecho.
- **Cifrar los backups con una clave que se destruye a los 35 días.** Es lo mismo con más pasos, y traslada el problema a la custodia de esa clave.

## Consecuencias

- La ventana de recuperabilidad está acotada, es conocida y se comunica.
- El re-shred en la restauración impide el fallo más probable: recuperar un desastre y con él resucitar datos ya suprimidos, sin que nadie lo note.
- El SLA de supresión efectiva es **15 días hábiles + 35 días de expiración**, y hay que decirlo antes.

## Consecuencias negativas aceptadas

- **Se pierde la recuperación a largo plazo de la bóveda.** Un desastre descubierto a los 40 días es irreparable; la bóveda sólo es reconstruible desde el registro institucional y con nuevo consentimiento.
- El SLA real de supresión es de casi dos meses, lo que a un titular impaciente le parecerá —con razón— mucho. La única defensa es haberlo dicho antes.
- `replayPendingErasures()` es código crítico que se ejecuta exactamente cuando el equipo está en pánico por una restauración. Debe estar probado y ensayado, o será lo primero que alguien salte «por esta vez».
- Backups separados con custodios distintos duplican el procedimiento y el riesgo de que uno de los dos esté mal.
