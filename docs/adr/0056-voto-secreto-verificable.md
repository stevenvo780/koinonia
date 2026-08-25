# ADR-0056: Voto secreto verificable — qué hay hoy, qué ofrecen Helios y Belenios, y qué cuesta sostenerlo en Koinonía

- **Estado:** Propuesto
- **Fecha:** 2026-08-25
- **Contexto de origen:** auditoría de `docs/OBJETIVO.md` (2026-08-25), sección `identidad-voto`: R3
  (secreto), R4 (verificabilidad individual) y R6 (resistencia a manipulación administrativa) en
  `NO CUMPLE`. Corrección de `docs/THREAT_MODEL.md` §3.4 (2026-08-24): la separación de esquemas
  `roll`/`urn` que ADR-0013 y ADR-0014 dan por Aceptada **no existe en las migraciones reales**.
  Depende de y actualiza ADR-0010, ADR-0011, ADR-0013, ADR-0014, ADR-0017, ADR-0018, ADR-0019,
  ADR-0030 y `docs/research/11-privacidad-y-voto-secreto.md` §2.

## Contexto

El pliego original es explícito en un punto: **no inventar criptografía de urna**. Cuando haga falta
evaluar el salto, la evaluación debe apoyarse en protocolos maduros —nombra Helios y Belenios—, nunca
en un esquema propio de ElGamal escrito para la ocasión. Ese mandato ya se cumplió una vez, en
ADR-0010 y ADR-0018, y en `docs/research/11-privacidad-y-voto-secreto.md` §2, que trae una tabla R1–R7
y una comparación Helios/Belenios razonablemente completa. Este ADR no repite ese trabajo desde cero:
lo verifica contra lo que el código hace **hoy**, lo actualiza con literatura de 2025–2026, y añade la
pregunta que ninguno de los documentos anteriores contestó con números: **¿qué cuesta sostener esto,
en concreto, para un colectivo de 300 estudiantes que rota una quinta parte cada año?**

La auditoría del 2026-08-25 encontró que la respuesta a esa pregunta importa más de lo que parecía,
porque **lo que el código entrega hoy es menos de lo que los ADR Aceptados prometen por escrito**, no
al mismo nivel: es una promesa de servidor, sin ningún mecanismo técnico detrás, para toda decisión
que la plataforma sí permite abrir.

### 1. Qué hay hoy de verdad — verificado línea por línea, no repetido de otro ADR

- **`PrivacyMode`** (`packages/domain/src/config.ts:205-211`) tiene tres valores:
  `public-roll-call`, `sealed-tally`, `secret-ballot`. La compuerta C6
  (`assertHardSecrecySupported`, `config.ts:598-600`) es así de simple:
  `if (privacy === 'secret-ballot') throw new HardSecrecyUnsupported(privacy)`. **No evalúa el
  asunto de la decisión** —no existe en todo el repositorio ninguna función `requiresHardSecrecy(subject)`
  ni clasificador equivalente (`grep` sobre `packages/domain/src` y `services/api/src` no encuentra
  nada con ese nombre—. La compuerta es más simple y más dura de lo que `THREAT_MODEL.md` §1.2 la
  describe: no filtra **qué asuntos** exigen secreto duro, bloquea **todo** intento de abrir con
  `secret-ballot`, sin excepción. El efecto práctico es el mismo que se venía declarando —ningún
  proceso con secreto perpetuo se abre nunca en la plataforma—, pero el mecanismo real es «se prohíbe
  el valor de configuración», no «se clasifica el asunto». La distinción importa porque significa que
  **hoy nadie decide, asunto por asunto, si algo exige secreto duro**: quien abre la decisión elige el
  modo, y sólo `secret-ballot` está bloqueado.
- Eso deja `sealed-tally` como el único modo con algo de privacidad que la plataforma permite abrir. Su
  propio comentario en el tipo dice: *"papeletas selladas hasta el cierre; al cerrar se publica el
  detalle seudónimo"*. **No hay ningún mecanismo que selle nada.** `Ballot` (`packages/domain/src/
  ballot.ts:92-96`) tiene `voter: MemberId` **obligatorio**, y viaja dentro del evento `BallotCast`,
  en la misma tabla única `governance.event` que todo lo demás. Se verificaron las migraciones reales
  (`services/api/migrations/*.sql`): los únicos esquemas que existen son `governance`, `identity` y
  `projection` — **no existe `roll` ni `urn`**, pese a que ADR-0013 («Prohibición estructural de
  vincular padrón y urna») y ADR-0014 («Sin marcas temporales; sellado por lotes») están en Estado
  **Aceptado**. Cada fila de `governance.event` lleva `recorded_at timestamptz DEFAULT
  clock_timestamp()` (`0001_governance_ledger.sql:99-101`) y un `leaf_index` secuencial. El ledger es
  legible sin autenticación (§5 de `THREAT_MODEL.md`, cruce 13, «por diseño»). Consecuencia sin
  adornos: **quien conoce el `MemberId` de una persona puede leer exactamente qué votó, desde el
  instante en que lo emite**, sin necesitar root ni acceso al vault. No hace falta esperar al cierre —
  el nombre «sealed» no corresponde a ningún comportamiento del sistema.
- El recibo/tracker que ADR-0010 diseñó por escrito —160 bits aleatorios, código legible tipo
  `K7F2-9QMX-3B`, tabla `(tracker, choice)` publicada al cierre para que cada quien verifique su voto
  y cualquiera recuente el resultado— **nunca se construyó**. No hay campo, tabla ni endpoint para
  esto en dominio, API ni web (`grep -rn 'tracker|voteReceipt'` no encuentra nada relacionado). El
  arreglo de coerción de T-10 del 2026-08-24 además quitó de la API el único campo (`miRespuesta`) que
  todavía se parecía a una confirmación del propio voto: hoy quien vota no recibe nada —ni un
  identificador de papeleta— que le permita comprobar después, contra el resultado publicado, que su
  voto quedó tal como lo emitió.
- El puerto `VotingBackend` y el tipo `GuaranteeMatrix` de ADR-0011 —la pieza que declara, como
  estructura de datos y no como texto suelto, qué garantiza cada backend— **no existen en el código**.
  `grep` sobre `GuaranteeMatrix`, `secrecyFrom`, `individualVerifiability`, `VotingBackend` en
  `packages/domain/src` no devuelve nada. Existen únicamente como prosa dentro del propio ADR-0011.
- La pantalla de declaración de garantías que ADR-0017 hace **obligatoria** —pantalla completa antes
  del primer voto, botón «Entiendo» que no se habilita durante 5 segundos, texto que dice
  explícitamente qué no garantiza (coerción, y que quien administra el servidor podría técnicamente
  ver quién votó qué)— tampoco existe. Lo único que ve hoy quien vota, en
  `apps/web/app/decisiones/[id]/page.tsx:239-242`, es un aviso breve **después** de confirmar: *«por
  tu propio secreto de voto, esta pantalla no repite cuál elegiste»*. No menciona al administrador, no
  menciona que no hay recibo, y no aparece antes de votar sino después.
- `packages/crypto/src/index.ts` trae exactamente lo que ADR-0003/0004 decidieron: JCS, SHA-256,
  cadenas de hash y árboles de Merkle de auditoría. **Cero ElGamal, cero mixnet, cero prueba de
  conocimiento cero.** No hay ninguna criptografía de urna, lo cual es correcto —es justo lo que el
  pliego pide no inventar— pero también significa que no hay ningún mecanismo técnico, hoy, que respalde
  la palabra «secreto» en pantalla.
- Lo único de esta lista que **sí** es real, probado y funciona exactamente como se documenta: **C6-GATE**
  bloquea `secret-ballot` de forma dura, sin bandera de configuración que lo desactive, y tiene prueba
  dedicada (`packages/domain/test/config.test.ts:56-70`).

**Conclusión de esta sección, sin adornos:** para toda decisión que hoy se abre en la plataforma con
algo de privacidad —es decir, `sealed-tally`, porque `secret-ballot` no se puede abrir nunca— el
«secreto del voto» es una promesa del administrador sin ningún mecanismo técnico detrás, ni siquiera
la separación intermedia que ADR-0010/0013/0014 prometieron por escrito y jamás se construyó. R3
(secreto verificable), R4 (verificabilidad individual) y R6 (resistencia a manipulación
administrativa) están, con razón, en `NO CUMPLE` en la auditoría del 2026-08-25.

### 2. Helios — revisado con literatura de 2025–2026, misma conclusión que ADR-0010/0018

Helios (Ben Adida, USENIX Security 2008) cifra con ElGamal exponencial homomórfico, prueba que cada
papeleta está bien formada y descifra por umbral de custodios. Da R2 (unicidad), R3 (secreto, con
custodios) y R5 (verificabilidad universal por pruebas de conocimiento cero públicas). R4 lo resuelve
con el **Benaloh challenge** (*cast-or-audit*): tras cifrar el voto, quien vota puede «auditar» —el
sistema revela la aleatoriedad usada y una herramienta independiente confirma que cifró lo elegido— o
«emitir»; como el cliente no sabe de antemano cuál elegirá, un cliente tramposo se detecta con
probabilidad creciente.

Su debilidad decisiva —la misma que ya señalaba ADR-0010— sigue confirmada por la literatura reciente:
la evaluación de sistemas E2E-verificables documenta que **un servidor deshonesto en Helios puede
inyectar papeletas por personas que no votaron**, y que la única defensa es que cada quien —incluido
quien se abstuvo— revise la urna pública buscando su propio nombre, algo que en la práctica casi nadie
hace. Ese es exactamente el riesgo que más nos importa: A2, el administrador voluntario del VPS. El
propio Ben Adida acota el uso de Helios a elecciones de **bajo riesgo de coerción** —da como ejemplos
clubes, sociedades científicas y gobierno estudiantil, que coincide con nuestro contexto— pero no
resuelve el ataque que más tememos. Hay además ataques de *replay* documentados por Cortier y Smyth
que rompen el secreto de la papeleta bajo ciertas condiciones de despliegue. Costo operativo: exige el
mismo problema humano de custodios que Belenios (ceremonia de generación, umbral, disponibilidad el
día del escrutinio), sin la ventaja de la autoridad de credenciales separada. No aporta nada que
Belenios no dé mejor para el riesgo que Koinonía más necesita cerrar. **Se reafirma la conclusión de
ADR-0018: descartada.**

### 3. Belenios — revisado con literatura de 2025–2026, con un hallazgo que cambia el cálculo de costo

Belenios (INRIA/CNRS/Université de Lorraine/Loria; desde diciembre de 2024 también mantenido por la
empresa VCAST, cofundada por su desarrollador principal) usa la misma base criptográfica que Helios,
pero añade la pieza que cierra nuestro riesgo principal: **una autoridad de credenciales distinta del
servidor de registro y votación**. Cada persona recibe una credencial privada por correo; el servidor
sólo conoce la clave pública de verificación correspondiente. Aunque el servidor esté comprometido, no
puede fabricar papeletas válidas por sí solo —el relleno de urna exige coludir al servidor **y** a la
autoridad de credenciales a la vez—. Es, en una frase, el mecanismo que convierte a R6 de «débil» (Helios)
a «fuerte» (Belenios), y es la razón por la que ADR-0018 ya lo señalaba como destino.

Roles necesarios, según la documentación oficial actual: un administrador de la elección, una
autoridad de credenciales, y trustees de descifrado por umbral —la propia guía de CNIL (regulador
francés de protección de datos, que Belenios cita como referencia) recomienda **3 trustees**, no 5, y
la plataforma permite fijar el umbral (p. ej. 2 de 3). El sistema permite revotar hasta el cierre y
sólo cuenta la última papeleta —protección moderada contra coerción, y coincide exactamente con el
patrón de idempotencia por última papeleta que Koinonía **ya implementa** para `BallotCast`
(DECISIÓN A.5, `packages/domain/src/ballot.ts`)—. Sin la variante de receipt-freeness, el propio FAQ
oficial admite la limitación sin rodeos: *"es fácil vender las credenciales y el usuario/contraseña"*.
Se confirmó además la advertencia que ya traía ADR-0018: **BeleniosRF y BeleniosVS son variantes
académicas** (publicadas en venues de investigación sobre *receipt-freeness* y seguridad frente a
dispositivo corrupto), y no aparecen como variantes con número de versión propio en los releases de
producción 3.1 (mayo 2025) ni 3.2 (abril 2026). No hay que asumir su disponibilidad, tal como ya
advertía ese ADR.

**El hallazgo que cambia el cálculo de costo para Koinonía:** Belenios ofrece un **servicio alojado y
gratuito** en `vote.belenios.org`, operado por el propio equipo, para elecciones de **hasta 2500
votantes** — casi diez veces el censo de Koinonía. ADR-0018 daba por sentado que adoptar Belenios
significaba, necesariamente, un segundo servicio en OCaml que "nadie del proyecto mantiene ni entiende
a fondo": eso sigue siendo cierto si se autoaloja, pero **no es la única vía**. Usando el servicio
gratuito, la Etapa 2 deja de exigir aprender a operar un stack ajeno y pasa a exigir, en cambio, sólo
capacidad **humana**:

- Nombrar una autoridad de credenciales real, **distinta** de quien administra el VPS de Koinonía. Si
  fuera la misma persona, el aislamiento de roles que hace fuerte a R6 se pierde en la práctica aunque
  el protocolo lo permita en el papel.
- Nombrar y ensayar al menos 3 custodios reales, disponibles el día del escrutinio, con la advertencia
  explícita de la propia documentación de Belenios: si se pierde una clave sin quórum suficiente para
  reconstruir, **la elección no se puede escrutar** — no hay forma de recuperarla.
- Resolver, **antes** de comprometerse, una pregunta legal y política que este ADR no puede cerrar:
  ¿pueden los datos de una elección de Koinonía —participación, y en algún grado el correo
  institucional usado para repartir credenciales— viajar a un servicio operado por un tercero en
  Francia (Inria/VCAST), bajo qué garantías frente a la Ley 1581 y la normativa de la UdeA? La licencia
  del software es libre (tipo CC BY-SA/AGPL según el componente); el servicio hospedado es un tercero
  con su propia jurisdicción, y eso es una decisión distinta de la licencia.
- Aceptar que, en la variante base, **sigue sin haber resistencia real a coerción** — R7 queda
  exactamente igual de abierto que hoy.

Frente a **autoalojar** Belenios en vez de usar el servicio gratuito: se gana control total y se evita
la pregunta de residencia de datos en un tercero, a cambio de sumar el coste real que ADR-0018 ya
señalaba como su principal consecuencia negativa —un segundo stack, en un lenguaje que el equipo no
opera, que hay que desplegar, actualizar y respaldar—. Los roles humanos (autoridad de credenciales,
custodios) son los mismos en ambos casos.

### 4. La pregunta que decide: ¿puede sostenerse con la capacidad real de Koinonía?

ADR-0019 ya diseñó, con detalle operativo serio, una ceremonia n=5/k=3 con perfiles estructuralmente
enfrentados, rotación anual obligatoria, y **ya reconoció por escrito, como consecuencia negativa
aceptada, que "es el eslabón más débil de la etapa 2 y no tiene solución técnica"**. Nada de lo
investigado para este ADR cambia ese diagnóstico — lo confirma. La documentación oficial de Belenios
recomienda hacer elecciones de prueba antes de la real precisamente porque la ceremonia de trustees
falla más en la práctica de lo que sugiere en el papel, y advierte sin matices que una clave perdida
sin quórum suficiente cancela el escrutinio.

Lo que sí cambia con el servicio alojado gratuito es el **tamaño** del compromiso: ya no hace falta
que alguien en Koinonía aprenda a operar un servicio OCaml — sólo hace falta sostener, año tras año,
un puñado de roles humanos (una autoridad de credenciales y al menos 3 custodios, no necesariamente 5)
para una tarea aburrida que sólo importa el día que algo sale mal. Es una carga menor que la que
ADR-0018 daba por descontada, pero sigue siendo real, y sigue dependiendo de la misma organización
estudiantil que rota una quinta parte cada año y que **hoy no tiene siquiera una dirección de
facilitación real en producción** (`docs/OBJETIVO.md`: el único miembro registrado es
`operador@udea.edu.co`, que no existe). Un esquema que necesita personas disponibles el día del
escrutinio no es viable si nadie puede garantizar hoy que exista una sola persona real ejerciendo el
rol más básico de la plataforma.

## Decisión

Este ADR queda en Estado **Propuesto**. No decide cuál opción se ejecuta — eso es una decisión de la
comunidad, no de una auditoría de código, tal como ya lo dejó dicho ADR-0018 para exactamente el mismo
tipo de pregunta. Lo que este ADR aporta es la comprobación de qué hay hoy, la evaluación actualizada
de Helios y Belenios que el pliego pidió, y el costo real, con roles y no con abstracciones, de cada
camino.

### Opciones

**Opción 1 — Cerrar la brecha de honestidad ahora, sin criptografía nueva.** Construir lo que
ADR-0010, ADR-0013, ADR-0014 y ADR-0017 ya decidieron en Estado Aceptado y nunca se construyó:
separación real de esquemas `roll`/`urn` sin clave foránea, papeleta sin marca de tiempo con sellado
por lotes barajados, recibo/tracker de 160 bits con `(tracker, choice)` publicado al cierre, y la
pantalla de declaración de garantías de ADR-0017. No exige adoptar Helios ni Belenios — es poner al
día decisiones ya tomadas. Cierra R4 (verificabilidad individual, la caída más reciente de la
auditoría) y restaura la protección intermedia contra A3 (el curioso interno, que hoy puede leer el
voto de cualquiera sin privilegios). **No cierra R3 ni R6**: el administrador sigue pudiendo, en
principio, correlacionar votante y voto — eso es exactamente lo que ADR-0010 ya aceptó por escrito.

**Opción 2 — Ampliar C6-GATE y corregir la pantalla mientras la Opción 1 no esté lista.** Reconocer en
la propia interfaz que `sealed-tally` no ofrece hoy ninguna protección real que `public-roll-call` no
dé, y decirlo antes de votar, no después. Es la respuesta que el pliego autoriza explícitamente como
legítima: declarar el límite con honestidad. No cierra ningún requisito; deja de prometer los que no
se cumplen.

**Opción 3 — Migrar a Belenios vía el servicio alojado gratuito** (revisión de la etapa 2 de
ADR-0018). Usar `vote.belenios.org` en vez de autoalojar el stack OCaml. Cierra R1, R6 y da R4/R5
reales. No cierra R7 sin BeleniosRF, que no está disponible en producción. Exige nombrar una autoridad
de credenciales distinta de quien administra el VPS, sostener ≥3 custodios reales con ceremonia
(ADR-0019 puede revisarse a la baja de n=5/k=3 hacia lo que la propia documentación de Belenios
recomienda), y una decisión legal/política previa sobre datos viajando a un tercero en Francia — que
este ADR no puede tomar por la comunidad.

**Opción 4 — Autoalojar Belenios.** Igual que la Opción 3 pero con el stack propio: resuelve la
pregunta de residencia de datos, suma el coste de mantenimiento que ADR-0018 ya señaló como su
principal consecuencia negativa.

**Opción 5 — Reafirmar Helios como descartada.** Revisada de nuevo con literatura 2025–2026: no
cambia la conclusión de ADR-0018. No aporta ventaja alguna sobre Belenios para el riesgo de Koinonía
(A2) y sí tiene una debilidad estructural (ballot stuffing del servidor) que Belenios resuelve.

**Opción 6 — No hacer nada más allá de lo ya aceptado, y declararlo así.** Legítima si la comunidad
concluye que ni la Opción 1 ni la 3 son sostenibles con la capacidad organizativa actual —hoy sin
siquiera una dirección de facilitación real—. Implica mantener C6-GATE como está, aplicar como mínimo
la Opción 2 para no seguir prometiendo de más, y aceptar por escrito que el voto en Koinonía, para todo
lo que no sea secreto duro, seguirá siendo una promesa del administrador sin mecanismo técnico, hasta
que exista capacidad real para sostener alguna de las otras opciones. **Es una respuesta legítima**, no
un fracaso: el pliego mismo lo autoriza cuando el costo es inasumible, y fingir lo contrario sería peor
que decirlo.

### Recomendación razonada (no vinculante)

**Opción 1 primero.** No es una decisión nueva: es ejecutar lo que ya está Aceptado y documentado con
detalle de esquema SQL en `docs/research/11-privacidad-y-voto-secreto.md` §2.4. Cierra la parte más
barata y más urgente —R4 es, según la propia auditoría, la caída más reciente y la que un recibo bien
diseñado evitaría—.

**Opción 2 en paralelo**, mientras la 1 no esté lista: cuesta una tarde de trabajo de interfaz y
detiene inmediatamente la promesa de más que hoy hace la pantalla.

**Opción 3 como destino de mediano plazo, condicionada**: sólo si la comunidad puede nombrar y
sostener, año tras año, una autoridad de credenciales y al menos tres custodios reales — y con la
pregunta legal de residencia de datos resuelta **antes** de comprometerse, no después de la primera
elección. Si esa capacidad organizativa no aparece, la Opción 6 es preferible a fingir que sí existe:
es exactamente el tipo de honestidad que ADR-0010 ya practicó una vez y que esta auditoría demuestra
que hay que sostener con hechos, no sólo con la primera declaración.

## Alternativas consideradas

- **Implementar ElGamal, mixnet o pruebas de conocimiento cero propias en TypeScript.** Descartada sin
  discusión: es exactamente lo que el pliego prohíbe, y la razón que dan ADR-0010/0018 sigue vigente —
  la criptografía de elecciones se ataca durante años antes de ser confiable.
- **Adoptar Helios.** Ver Opción 5 y §2: descartada, misma conclusión que ADR-0018, ahora con más
  evidencia (ballot stuffing documentado, replay attacks contra el secreto, acotación del propio autor
  a bajo riesgo de coerción).
- **Autoalojar Belenios desde el día uno, sin evaluar el servicio gratuito.** Hubiera sobreestimado el
  costo real de la Etapa 2 — que es precisamente el hallazgo que justifica revisar ADR-0018 en vez de
  repetirlo sin más.

## Consecuencias

- La comunidad decide con información verificada contra el código real, no contra lo que los ADR
  anteriores prometían por escrito y nunca se construyó — el mismo patrón de honestidad que ya obligó
  la corrección de `THREAT_MODEL.md` §3.4 del 2026-08-24.
- Cualquier opción que se elija deja explícito qué cierra y qué no cierra de R1–R7, en vez de una
  promesa genérica de «secreto».
- Si se ejecuta la Opción 1, ADR-0010/0013/0014/0017 dejan de estar en contradicción con el código sin
  necesidad de ningún ADR nuevo — sólo hace falta implementarlos.
- Si se ejecuta la Opción 3, ADR-0018 y ADR-0019 quedan revisados a la baja en su estimación de costo
  (sin stack OCaml propio necesario) pero no en su exigencia de roles humanos (autoridad de
  credenciales, custodios), que sigue siendo el eslabón más débil.

## Consecuencias negativas aceptadas

- **Este ADR no cierra ninguna de las cinco filas `NO CUMPLE` de `identidad-voto`.** No podía: el
  pliego pide evaluar, no implementar. Cerrarlas de verdad exige ejecutar alguna de las opciones
  anteriores, con presupuesto de ingeniería y de organización que este documento no asigna.
- Declarar honestamente que `sealed-tally` no ofrece hoy protección real (Opción 2) puede leerse como
  munición contra la confianza en la plataforma. Se acepta por la misma razón que ya aceptó ADR-0017:
  el argumento contrario —ocultarlo— es indefendible y ya produjo, una vez, la contradicción que esta
  auditoría encontró.
- La recomendación de este ADR no resuelve la pregunta legal de residencia de datos para la Opción 3;
  queda expresamente fuera de su alcance y sin resolver hasta que alguien con competencia jurídica la
  responda.
- Si la comunidad no puede sostener los roles humanos de ninguna de las opciones 1, 3 o 4, la Opción 6
  deja a Koinonía sin voto secreto verificable de forma indefinida para todo lo que no sea secreto
  duro (que ya se deriva a papel). Es una limitación real del proyecto, no un defecto oculto.
