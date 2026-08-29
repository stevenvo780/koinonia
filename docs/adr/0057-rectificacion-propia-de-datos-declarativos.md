# ADR-0057: Rectificación propia de datos declarativos, sin correo y con enumeraciones cerradas

- **Estado:** Aceptado
- **Fecha:** 2026-08-29
- **Contexto de origen:** Ley 1581 de 2012, art. 8 lit. a; `docs/research/20-normativa-datos-colombia.md` §1.3 (fila RL-12); hermana de ADR-0021 (supresión).

## Contexto

RL-12 pide autoservicio de rectificación para «programa, semestre, nombre de pila usado»: datos
declarativos, que la persona afirma de sí misma y que nadie más necesita verificar. Un primer intento
de implementarlo fue rechazado por una revisión independiente que lo ejecutó contra el `dist` real y
encontró tres agujeros, todos con causa en la forma de los datos, no en un detalle de código:

1. **`semestre` y `jornada` como texto libre de hasta 40 caracteres tumbaban `/metricas/salud` para
   siempre.** Los dos son claves de estrato de la métrica 3 (cobertura, C11 en
   `packages/metrics/src/cobertura.ts`). `sellar()` lanza `FugaDeIdentidadError` si cualquier
   identificador de miembro aparece, como subcadena, en la salida de una métrica; con texto libre,
   `POST /mi/rectificacion {campo:'semestre', valorNuevo:'<el propio MemberId>'}` — 32 caracteres,
   caben en 40 — hacía que `GET /metricas/salud` lanzara para siempre, sin ninguna pantalla desde la
   que deshacerlo. Y sin ninguna malicia, texto libre convierte «octavo», «8» y «s8» en tres estratos
   distintos y arruina el cruce semestre × jornada que pide PRODUCT §6.
2. **Rectificar el correo sin probar la posesión de la dirección nueva permitía apropiarse de una
   cuenta ajena.** `upsertMember` resuelve la sesión por `email_hash`; escribir el correo nuevo de una
   vez, antes de que su dueña real entrara por primera vez, dejaba que la próxima persona que pidiera
   un enlace mágico a esa dirección heredara la identidad de quien rectificó.
3. **Ninguna reautenticación ni revocación de sesiones al cambiar la credencial de acceso.** El correo
   es el único factor de autenticación que existe; cambiarlo sin las mismas garantías que ya exige la
   supresión (`requestOwnErasure`, sesión de menos de diez minutos) y sin cerrar las sesiones vivas
   (como ya hace `upsertMember` cuando cambia el nivel de privilegio, T-06) dejaba una sesión robada o
   prestada con la puerta abierta después del cambio.

El propio marco normativo del proyecto ya distinguía esto sin que el primer intento lo notara:
`docs/research/20-normativa-datos-colombia.md:31` nombra «programa, semestre, nombre de pila usado»
como los datos declarativos de RL-12 — el correo institucional **no está en esa lista**.

## Decisión

**Se ofrece el autoservicio sólo para `alias`, `semestre` y `jornada`. El correo institucional queda
fuera de este primer corte, explícitamente, hasta que exista la infraestructura que lo permita
corregir con seguridad.** Cumplir la letra completa del artículo abriendo un agujero de apropiación de
cuentas es peor que cumplirla en los tres campos que sí se pueden cerrar bien; la propia pantalla lo
dice, en vez de fingir que el correo no hace falta.

`solicitarRectificacion` (`packages/contracts/src/http.ts`) es una unión discriminada por `campo` con
tres miembros, no cuatro con uno pendiente comentado: añadir el correo más adelante significa agregar
un cuarto miembro a la unión, cuando exista (a) confirmación de que la dirección nueva es de quien la
pide —reusando el enlace de un solo uso ya existente, con otro propósito—, (b) una sesión recién
autenticada, y (c) revocación de toda sesión abierta al terminar.

`semestre` y `jornada` pasan a ser **enumeraciones cerradas** (`SEMESTRES`: `s1`…`s10`; `JORNADAS`:
`diurna`, `nocturna`), validadas con `z.enum` en el contrato y con un `CHECK` equivalente en
`identity.member` (`0014_rectificacion_datos_declarativos.sql`) como defensa en profundidad si la
validación de entrada alguna vez dejara de aplicarse. El rango de semestre —diez— sale de lo que ya
declara el propio corpus del proyecto: PRODUCT.md llega hasta noveno en sus perfiles y
`cobertura.ts` usa «décimo» como el estrato límite de su propio ejemplo.

`alias` sigue siendo texto libre (hasta 120 caracteres, sin caracteres de control — un `\u0000` en
medio del texto hacía que PostgreSQL rechazara la fila entera con un 500 genérico en vez de un
rechazo con mensaje), pero deja de ser único **por construcción**: hasta ahora era siempre la parte
local de un correo `UNIQUE` sobre un único dominio, y en cuanto pasa a ser lo que la persona escriba
esa garantía se rompe sola. `miembroCirculo` (la vista que alimenta la delegación de voto) es sólo
`{id, alias}`, así que sin una restricción explícita cualquiera podría escribir el alias exacto de
otra persona y recoger delegaciones dirigidas a ella. Se añade `identity_member_alias_lower_key`, un
índice único sin distinguir mayúsculas, y `upsertMember` lo maneja en los dos sentidos:

- **Rectificación sobre un alias ya tomado:** se traduce a `RECTIFICATION_ALIAS_IN_USE` (409), sin
  escribir nada a medias.
- **Una alta completamente nueva cuyo alias por defecto —la parte local del correo, que antes nunca
  podía colisionar con nada— choca, por coincidencia, con un alias que otra persona ya rectificó:**
  `upsertMember` reintenta con un sufijo al azar en vez de fallar. Antes de esta migración esa
  colisión era estructuralmente imposible; después de ella, dejar a alguien sin poder entrar por
  primera vez por una coincidencia que no eligió habría sido un agujero nuevo del mismo tamaño que
  los tres que motivan este ADR.

La reproducción entre red y reintento se endurece también: el evento `PIIRectificationApplied` no
llevaba, en el primer intento, ningún dato que permitiera distinguir un reintento legítimo de una
segunda intención bajo la misma clave de idempotencia pero con otro valor — la réplica sólo comparaba
sujeto y campo. Ahora el evento guarda `valueHash` (una huella SHA-256 del valor, con el campo como
separador de dominio — nunca el valor en sí, la misma disciplina que ya aplica `email_hash`), y la
réplica compara también esa huella: una clave reusada con otro valor es `IDEMPOTENCY_KEY_REUSED`
(409), no una repetición silenciosa de la primera.

`alias_declarado_en` (misma migración) hace que la rectificación del alias **dure**: sin esa marca,
`upsertMember` reescribía `alias` con lo que afirma el proveedor de identidad en cada `POST
/auth/enlace`, y la corrección se perdía en el siguiente intento de entrar.

## Alternativas consideradas

- **Ofrecer el correo con un `subjectId`-menos y una advertencia en pantalla.** Rechazada: una
  advertencia no sustituye una prueba de posesión; el ataque de apropiación de cuenta no necesita que
  nadie lea la advertencia.
- **`semestre`/`jornada` como texto libre con un validador de formato (regex).** Rechazada: cualquier
  regex suficientemente laxa para aceptar «s8» también acepta un identificador de 32 hexadecimales, y
  cualquiera suficientemente estricta para excluirlo es, en la práctica, una enumeración cerrada mal
  disfrazada de texto libre.
- **No tocar la unicidad del alias y aceptar el riesgo.** Rechazada: es exactamente el defecto
  bloqueante #4 de la revisión que motiva este ADR, y dejarlo abierto en la segunda vuelta habría sido
  peor que en la primera.
- **Índice único sin manejar la colisión en `upsertMember`.** Rechazada de camino: cierra la apropiación
  deliberada de alias pero abre un 500 nuevo, no adversarial, contra la primera alta de alguien que no
  eligió nada — el mismo patrón de daño que el defecto bloqueante #1 (un 500 sin salida) aplicado a un
  caso distinto.

## Consecuencias

- El derecho de rectificación (RL-12) queda cumplido para los tres campos que se pueden cerrar con
  seguridad hoy; el correo se agrega cuando exista la pieza de confirmación de posesión, no antes.
- `/metricas/salud` no puede volver a caer por un valor de estrato inventado: el contrato lo impide
  antes de tocar la base, y el `CHECK` de la migración lo impide incluso si el contrato fallara.
- El alias deja de heredar su unicidad del correo; la gana de forma explícita, con una regla propia y
  una prueba de la colisión en los dos sentidos (rectificación y alta nueva).
- El derecho de ACCESO del mismo artículo 8 (lit. f, «conocer» — RL-11, `GET /me/export`) sigue sin
  existir: esta pantalla corrige, no lee. Es un trabajo distinto, ya registrado en RL-11.
