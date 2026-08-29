-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 0014 — Rectificación propia de datos declarativos (Ley 1581, art. 8 lit. a). Tres piezas, una
-- por cada agujero que dejó abierto el primer intento de esta misma tarea.
--
-- 1. `alias_declarado_en` — para que la rectificación del alias DURE. `upsertMember`
--    (`identity.ts`) corre en cada `POST /auth/enlace` —cada intento de entrar, no sólo el
--    primero— y hasta hoy reescribía `alias` sin condición con lo que afirma el proveedor de
--    identidad (el MVP: la parte local del correo). Sin una marca de por medio, la persona
--    rectifica su alias y el siguiente enlace mágico se lo pisa en silencio: un derecho que se
--    otorga y se retira solo no es un derecho. `NULL` (todas las filas de hoy): `alias` sigue al
--    proveedor, como siempre. Con fecha: la persona ya lo declaró, y desde ese instante
--    `upsertMember` conserva lo declarado — el `CASE` exacto vive en `identity.ts`, esta columna
--    sólo guarda el hecho y su fecha.
--
-- 2. `identity_member_alias_lower_key` — el alias único, sin distinguir mayúsculas. Hasta ahora
--    `alias` era siempre la parte local de un correo `UNIQUE` sobre un único dominio
--    (`member_email_key`, `0005_identidad.sql`), así que era único POR CONSTRUCCIÓN: nadie tenía
--    que declararlo. En cuanto el alias deja de derivarse del correo y pasa a ser lo que la
--    persona escriba, esa garantía se rompe sola. Importa porque `miembroCirculo`
--    (`packages/contracts/src/http.ts`) es sólo `{id, alias}` —sin correo, sin roles— y es lo
--    único que ve quien elige a quién delegarle el voto (`podesDelegarEn`,
--    `apps/web/app/delegaciones/page.tsx`): sin esta restricción, cualquiera podría escribir el
--    alias EXACTO de otra persona y recoger delegaciones dirigidas a ella. `lower()` y no el valor
--    crudo, porque dos alias que sólo difieren en mayúsculas se leen igual en esa lista y el
--    riesgo de confundir a una persona con otra es el mismo. Todas las filas de hoy ya son
--    minúsculas —vienen de un correo normalizado a minúsculas antes de guardarse (`adapters.ts`,
--    `udeaIdentityAdapter`)— así que este índice se crea sin tener que tocar ningún dato
--    existente.
--
--    Esa restricción nueva podía, a su vez, romper la primera alta de alguien completamente
--    nuevo: si su alias por defecto —la parte local de su propio correo, que nunca antes pudo
--    colisionar con nada— coincide, por pura coincidencia, con un alias que otra persona ya
--    rectificó a mano, su alta fallaría contra este mismo índice antes de que esa persona haya
--    podido siquiera entrar una vez. `upsertMember` lo resuelve reintentando con un alias
--    desambiguado en vez de fallar (ver la cabecera de esa función): nadie se queda afuera de su
--    propia alta por una colisión que no eligió.
--
-- 3. `member_semestre_ck` / `member_jornada_ck` — enumeración cerrada, no texto libre. Los dos
--    son claves de estrato de una métrica PUBLICADA (`/metricas/salud`, C11 en
--    `packages/metrics/src/cobertura.ts`), y el primer intento de esta tarea las dejó como
--    `z.string().trim().min(1).max(40)`: cualquiera podía escribir su propio identificador de
--    miembro como «semestre» y tumbar esa métrica con `FugaDeIdentidadError` para siempre, sin
--    ninguna pantalla desde la que deshacerlo. El `CHECK` de abajo es el mismo candado que ya
--    aplica `packages/contracts/src/http.ts` (`SEMESTRES`, `JORNADAS`) del lado del servidor: si
--    algún día la ruta de entrada dejara de validar, la base sigue rechazando lo que no es uno de
--    estos valores. Las diez etiquetas de semestre y las dos de jornada son las mismas que usa
--    `udeaIdentityAdapter` (`adapters.ts`) para dar de alta a cualquier persona hoy —`'s1'` y
--    `'diurna'`—, así que este `CHECK` no rompe ninguna fila existente.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE identity.member
  ADD COLUMN IF NOT EXISTS alias_declarado_en timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS identity_member_alias_lower_key
  ON identity.member (lower(alias));

ALTER TABLE identity.member
  ADD CONSTRAINT member_semestre_ck CHECK (
    semestre IN ('s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10')
  );

ALTER TABLE identity.member
  ADD CONSTRAINT member_jornada_ck CHECK (jornada IN ('diurna', 'nocturna'));
