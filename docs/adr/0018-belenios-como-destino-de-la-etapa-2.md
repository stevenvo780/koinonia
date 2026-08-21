# ADR-0018: Belenios como destino de la etapa 2, no Helios

- **Estado:** Propuesto
- **Fecha:** 2026-08-21
- **Contexto de origen:** `11-privacidad-y-voto-secreto.md` §2.2 y §2.4 (**ADR-124 propuesto**).

## Contexto

Si Koinonía llega a adoptar criptografía de urna, la elección práctica está entre Helios (Ben Adida, USENIX Security 2008) y Belenios (INRIA / Loria). Comparten base criptográfica —ElGamal exponencial, conteo homomórfico, pruebas de papeleta bien formada, descifrado con umbral de custodios— y ambos declaran no ofrecer resistencia a coerción.

La diferencia decisiva para este proyecto está en la resistencia a la manipulación administrativa: en Helios **el servidor puede emitir votos por los abstencionistas** y nadie reclama, porque quien no votó no revisa la urna. En Belenios las credenciales las emite una autoridad **distinta** del registro, de modo que el relleno exige que registro y autoridad de credenciales sean deshonestos **a la vez**.

Ese es exactamente nuestro riesgo principal: el VPS lo administra un voluntario, y el agujero que Belenios cierra es la razón principal para migrar (ADR-0010).

## Decisión

Si Koinonía adopta criptografía de urna, el objetivo es **Belenios desplegado como servicio aparte**, integrado de forma **federada** a través del puerto `VotingBackend` (ADR-0011): Koinonía crea la elección, delega el acto de votar e importa la urna y las pruebas.

Estado **Propuesto**, no Aceptado: la decisión de migrar es de la comunidad, no del equipo técnico, y depende de capacidades organizativas (custodios, ADR-0019) que hoy no existen.

**Advertencia de verificación:** los datos sobre licencias, versiones y variantes (BeleniosRF, BeleniosVS) provienen de literatura publicada y **deben re-verificarse contra el repositorio oficial antes de comprometer un despliegue**. En particular, no debe asumirse disponibilidad de BeleniosRF.

## Alternativas consideradas

- **Helios.** No resuelve el relleno de urna por el servidor, que es precisamente el riesgo cuando el VPS lo administra un voluntario. Su propio paper acota el uso a elecciones de **bajo riesgo de coerción**.
- **Implementación propia de ElGamal en TypeScript.** Irresponsable: la criptografía de elecciones se ataca durante años antes de ser confiable.
- **Quedarse indefinidamente en la etapa 1.** Defendible mientras la comunidad acepte la confianza en el administrador; deja de serlo el día que se vote algo donde esa confianza esté en disputa.

## Consecuencias

- Verificabilidad **real** de la elegibilidad, no impuesta por nuestro servidor.
- Auditoría académica externa y miles de elecciones de rodaje, algo que Koinonía nunca podría costear.
- El histórico de la etapa 1 no se rompe: cada decisión conserva la declaración de garantías vigente en su momento (ADR-0011).

## Consecuencias negativas aceptadas

- **Dependencia de un stack OCaml ajeno al equipo.** Nadie del proyecto lo mantiene ni lo entiende a fondo; ante un fallo, la capacidad de respuesta es baja.
- Es una integración **federada**, no una biblioteca: hay un segundo servicio que desplegar, actualizar y respaldar.
- Licencia tipo AGPL sobre un servicio hospedado obliga a publicar modificaciones. Está alineado con el proyecto, pero hay que decidirlo a conciencia y no descubrirlo después.
- **Sigue sin haber resistencia a coerción** en la versión base: el votante puede probar su voto. Migrar mejora R1 y R6, no R7.
- La elección pasa a depender de que tres custodios aparezcan el día del escrutinio (ADR-0019).
