# ADR-0049: La autoría de las perspectivas se protege con control de acceso por etapa, no con un compromiso criptográfico

- **Estado:** Aceptado
- **Fecha:** 2026-08-22
- **Sustituye parcialmente a:** ADR-0046 (sólo la parte de autoría sellada, seudónimo por
  deliberación y etapa `perspectivas_revelando`)
- **Contexto de origen:** ADR-0045 (propiedad del material privado y derecho de supresión), ADR-0046,
  ADR-0001 (dominio puro), ADR-0021 (seudonimización retroactiva por eventos); `GOVERNANCE.md` §7;
  `THREAT_MODEL.md` adversario nº 3.

## Contexto

ADR-0046 ocultó la autoría de la etapa `perspectivas` con un compromiso criptográfico: el evento
`ContributionSubmitted` llevaba `authorCommitment` y `authorPseudonym` pero **no** `authorId`, el
`actor` del sobre encadenado era `'system'`, y una etapa posterior —`perspectivas_revelando`—
destapaba la autoría publicando la apertura. Una revisión posterior encontró que ese esquema no se
puede integrar con el resto del sistema. Los cinco motivos, con su sitio exacto:

1. **Contradice ADR-0045 en el punto que ADR-0045 considera fundacional.**
   `services/api/src/http/private-material-store.ts:428` deriva el dueño de un material privado del
   `event.actor` de su evento de ledger, y marca `event.actor === 'system'` como
   `invalid-ledger-link`: «un compromiso privado no identifica a la persona que conserva su
   apertura». El dominio, en `packages/domain/src/deliberation/commands.ts`, **obliga** a lo
   contrario: un aporte sellado con `actor` distinto de `'system'` se rechaza con
   `SEALED_AUTHOR_LEAKED`. Es decir: la apertura del compromiso tiene que vivir en el almacén de
   material privado, y el almacén de material privado identifica a su dueño exactamente por el dato
   que el sellado existe para borrar. No es un hueco que falte tapar; es una incompatibilidad. Un
   almacén de material privado cuyo modelo de propiedad no funciona no es un almacén: es una tabla
   sin política de acceso.

2. **El `deliberationNonce` es un secreto por deliberación sin dueño natural.** El seudónimo de
   ADR-0046 es `H(domain, deliberationId, authorId, deliberationNonce)`, y ese nonce tiene que ser
   secreto y compartido por todas las personas que aportan. La tabla de material privado va cifrada
   con la clave del sujeto y tiene `ON DELETE CASCADE` sobre el miembro: colgarlo de quien facilita
   significa que su borrado —una baja, una supresión— destruye el seudónimo de **todas** las demás
   personas. No hay ningún sujeto del que colgarlo que no tenga ese problema, porque el secreto no
   es de nadie: es de la deliberación, y la deliberación no es un titular de datos.

3. **Una supresión legal congela la deliberación para siempre.** El derecho de supresión de ADR-0045
   es incondicional. Si alguien lo ejerce teniendo una perspectiva sin destapar, su apertura
   desaparece; sin la apertura no hay `ContributionAuthorRevealed` que pase la recomputación del
   compromiso; y sin revelar todos los aportes, `applyDeliberation` rechaza el avance con
   `UNREVEALED_AUTHORSHIP`. La deliberación se queda en `perspectivas_revelando` y
   `listo_para_decidir` es inalcanzable. ADR-0046 lo declaró como consecuencia aceptada sin advertir
   que el disparador no es un accidente operativo sino **el ejercicio de un derecho**.

4. **El sellado rompe un invariante duro del sistema: la autorización se revalida en el replay.**
   Todo agregado comprueba en el plegado que el acto lo hizo quien dice haberlo hecho. Con
   `actor: 'system'` no hay identidad que reconstruir, así que el replay no puede reejecutar
   `authorize` ni comprobar nada sobre el autor: sólo puede recomputar un hash. El compromiso ata el
   par (autor, aporte) a posteriori, pero no ata **que ese autor pudiera escribir ahí**.

5. **Nunca protegió del administrador, y eso ya estaba escrito.** El propio ADR-0046 declara que
   quien tiene la bóveda conoce el `deliberationNonce`, tiene las aperturas y **puede forjar un
   compromiso atribuyendo un aporte a un inocente**. La protección real era frente a los pares. El
   coste, en cambio, era íntegro: un almacén nuevo, un secreto sin dueño, una etapa más en la máquina
   de estados y un modo de fallo permanente.

Sumado: el mecanismo costaba **un almacén nuevo, un secreto sin dueño y un modo de fallo permanente
ante el ejercicio de un derecho legal**, a cambio de una garantía —anonimato frente a quien
administra— que por construcción nunca podía dar.

**Sobre el estado de la revisión.** La revisión adversarial independiente del esquema retirado
**nunca llegó a completarse**: los dos intentos cayeron por timeout de transporte y no se atribuye
ningún resultado a ellos. Esta decisión **no se toma porque el esquema haya suspendido una revisión
externa**, sino por análisis de coste frente a garantía sobre el código y los ADR existentes. Se deja
constancia para que nadie lea este documento como si aquel escrutinio hubiera ocurrido.

## Decisión

**Se retira el sellado criptográfico de la autoría y se sustituye por control de acceso a la autoría
con alcance de etapa.**

### El aporte se escribe con su autor, como cualquier otro evento

`ContributionSubmitted` lleva `authorId`, y el `actor` del sobre encadenado es esa misma persona en
**todas** las etapas. El plegado comprueba que coincidan (`NOT_THE_AUTHOR`), de modo que un historial
fabricado a mano que atribuya un aporte a otra persona no se pliega. Eso restituye el invariante del
punto 4: la autorización se revalida en el replay.

Desaparecen: `authorCommitment`, `authorPseudonym`, `authorship: {mode:'sealed'}` y su unión con
`{mode:'public'}`, `AuthorNonce`, `DeliberationNonce`, el evento `ContributionAuthorRevealed`, la
orden `revealContributionAuthor`, la acción `deliberation:reveal-authorship`, el error
`SEALED_AUTHOR_LEAKED` y la etapa `perspectivas_revelando`.

### La autoría se oculta con una regla de autorización

Una acción nueva, `deliberation:read-authorship`, vive en la tabla `RULES` de
`packages/domain/src/access.ts` como todas las demás. Su regla añade un único campo,
`deniedDuringStage: 'perspectivas'`, y `authorize` lo aplica igual que aplica `ownerOnly` o
`circleOnly`:

- mientras la etapa **vigente** de la deliberación sea `perspectivas`, se deniega con
  `STAGE_STILL_OPEN`;
- en cuanto la etapa avanza, se concede a cualquier miembro del círculo;
- si el recurso llega **sin etapa declarada**, se deniega con `STAGE_UNKNOWN` —fallar cerrado, igual
  que `OWNER_UNKNOWN` y `READERS_UNKNOWN`.

**La denegación no depende del rol.** Quien facilita y quien integra el Círculo de Garantías reciben
exactamente la misma negativa que un miembro raso, y la autora de la perspectiva tampoco se lee a sí
misma: si el dominio hiciera esa excepción, quien observara la respuesta sabría de quién es el
aporte.

La etapa **la deriva el dominio del historial plegado**, nunca la aporta quien llama:
`authorizeAuthorshipRead(state, actor)` y `readContributionAuthor(state, actor, id)` construyen el
`ResourceRef` a partir del estado. Si el llamante pudiera declarar la etapa, la regla se saltaría
escribiendo otro nombre en el cuerpo de la petición, que es exactamente la vía por la que se cuela la
escalada horizontal que `access.ts` existe para cerrar.

### El tope anti-inundación vuelve al dominio

Como el autor está en el evento, `maxContributionsPerAuthorPerStage` se comprueba directamente sobre
el `authorId`, en toda etapa y sin derivar nada. Es la detección de inundación que el sellado había
perdido: allí sólo se podía contar por un seudónimo que exigía un secreto sin dueño (motivo 2) para
producir exactamente este número.

### La máquina de estados

```text
preguntas_aclaratorias ─▶ perspectivas ─▶ construccion_alternativas
                                                     │
           listo_para_decidir ◀── enmiendas ◀── objeciones ◀───────┘
```

Salir de `perspectivas` no depende de ninguna condición externa al historial. No hay ningún estado
del que no se pueda salir salvo el terminal, que es terminal a propósito.

## Qué protege esto y qué NO

**Protege frente a los demás participantes.** La regla vive en el dominio, no en la interfaz ni en un
`preHandler`, así que **también protege frente a quien llama a la API saltándose la interfaz**: no
hay otra puerta de lectura de autoría en `packages/domain`. Eso cubre el objetivo de producto real
—que quien tiene menos estatus se atreva a escribir— y el adversario nº 3 del modelo de amenaza en su
versión de par curioso.

**No protege frente a quien administra el servidor.** El `authorId` está en la base de datos y en el
evento; quien lee la tabla lo ve, sin pasar por `authorize`. Se declara igual que hace C6 con el
secreto del voto, y con la misma consecuencia vinculante para la interfaz: **la pantalla tiene que
decirlo en castellano llano y no puede sugerir anonimato frente a quien administra.** El esquema
retirado tampoco lo protegía (motivo 5); lo que cambia no es la garantía, es el precio.

**Hay un segundo lector al que esta regla, por sí sola, no alcanza: quien exporta el ledger.**
`ledger:read` y `ledger:export` son `OPEN` en la matriz. Como el `authorId` ya está en el evento, una
exportación del historial durante `perspectivas` revela la autoría sin llegar a intentar la acción
denegada. Aquí sí hay una diferencia real con el esquema retirado, que ocultaba el dato en el propio
evento. **La consecuencia es vinculante y queda declarada como deuda de la capa de servicio**: la
exportación y la lectura de ledger deben omitir el `authorId` de los `ContributionSubmitted` cuya
deliberación siga en `perspectivas`, o restringirse mientras esa etapa esté vigente. Mientras eso no
se implemente en `services/`, la protección efectiva es la de la interfaz y la API de deliberación,
no la del historial exportable.

**No protege de la estilometría**, exactamente como declaraba ADR-0046: con unas 300 personas que se
conocen y escriben en el mismo registro, el estilo identifica. Ninguna decisión de este ADR pretende
resistir a un lector atento.

## Alternativas consideradas

- **Sostener el sellado y arreglar `private-material-store`.** Habría que darle al almacén un modelo
  de propiedad distinto del `event.actor` sólo para este caso. Rechazada: un almacén con una regla
  de propiedad general y una excepción es un almacén con una regla menos.
- **Colgar el `deliberationNonce` de quien facilita.** Rechazada por el motivo 2: su baja o su
  supresión destruye el seudónimo de todo el mundo.
- **Una válvula de escape para salir de `perspectivas_revelando` con aportes sin destapar.**
  Rechazada: es una vía para cerrar la etapa dejando perspectivas cuya autoría nadie asumiría nunca,
  que es justo lo que ADR-0046 quería impedir. El problema no era la falta de válvula: era la etapa.
- **Firma asimétrica del usuario, cifrado umbral o pruebas de conocimiento cero.** Cerrarían al
  administrador de verdad. Rechazadas por ADR-0001: exigen aritmética de curva elíptica y por tanto
  dependencias de runtime en `packages/domain`. Es la misma conclusión de ADR-0046 y no ha cambiado.
- **Dejar la autoría oculta sólo en la interfaz, sin regla de dominio.** Rechazada: es el antipatrón
  que ADR-0046 nombra con razón. Un campo que la interfaz no pinta no está oculto. La diferencia con
  lo que se decide aquí es que la regla vive en el dominio y no hay otra puerta.
- **Ocultar la autoría para siempre.** Rechazada por ADR-0037: la respuesta y el desenlace son
  obligatorios y un aporte del que nadie responde es irresponsable. La opacidad es temporal.

## Consecuencias

- **La supresión legal deja de congelar deliberaciones.** El `authorId` es un identificador opaco de
  128 bits en el ledger y su tratamiento es el de ADR-0021 —seudonimización retroactiva por
  eventos—, no el de un secreto cuya pérdida bloquea una máquina de estados.
- **Vuelve el tope por persona y etapa**, ahora en toda etapa y no sólo en `perspectivas`. Es una
  restricción más fuerte que la anterior: una persona no puede escribir más de
  `maxContributionsPerAuthorPerStage` aportes en ninguna ventana.
- **El plegado del agregado es síncrono**, como `applyProblem`, `applyProposal` y `applyInitiative`.
  Era asíncrono sólo porque recomputaba hashes de compromiso en cada revelación.
- **El agregado se exporta desde `@koinonia/domain`.** `src/index.ts` no reexportaba
  `./deliberation/index.js`, así que hasta ahora el agregado era inalcanzable para cualquier
  consumidor del paquete. Se añade el reexport y una prueba que importa por el especificador público
  para que no vuelva a perderse.
- **La matriz de autorización gana un concepto: el alcance temporal.** Es un campo (`deniedDuringStage`)
  y una comprobación, y hoy lo usa una sola acción. Un concepto nuevo en la matriz es una superficie
  nueva; se acepta porque la alternativa era una regla de deliberación viviendo fuera de la matriz.
- **Un historial escrito con el esquema anterior no se pliega.** Los eventos
  `ContributionAuthorRevealed` y la etapa `perspectivas_revelando` ya no existen en la unión de
  tipos. No hay migración porque no hay datos: la pantalla «Deliberaciones» de `PRODUCT.md` §4 sigue
  sin implementar y ningún servicio escribe este agregado.

## Consecuencias negativas aceptadas

- **La autoría está en la base de datos.** Cualquier acceso que no pase por `authorize` la ve. Es la
  pérdida real frente al esquema retirado y no se disimula.
- **La deuda del ledger exportable** descrita arriba es real mientras `services/` no la cierre.
- **Hay una ventana muerta**: entre `closesAt` de `perspectivas` y el evento `StageAdvanced` no se
  puede escribir —la ventana ya cerró sola— pero tampoco se puede leer la autoría, porque la etapa
  vigente sigue siendo `perspectivas`. Es deliberado: la regla se ata a la etapa, que es un hecho del
  historial, y no al reloj, que llevaría a que la autoría se destapara sola sin que nadie lo hiciera
  constar.
- **La revisión adversarial independiente del esquema retirado nunca se completó**, y esta decisión
  se toma por análisis de coste. Si alguien la completa y encuentra que el esquema sellado era
  salvable, la respuesta seguiría siendo la misma por los motivos 1, 2 y 3, que no dependen de su
  solidez criptográfica.

## Pruebas obligatorias

- con `perspectivas` vigente, `authorize` **deniega** leer la autoría; cerrada la etapa, la
  **concede**; y el intento se hace también desde un actor con rol de facilitación y desde garantías,
  para que quede claro que la regla es de etapa y no de jerarquía;
- sin etapa declarada en el recurso, se deniega (fallar cerrado);
- ninguna otra acción de la matriz tiene alcance temporal;
- un `ContributionSubmitted` cuyo `authorId` no coincide con el `actor` del sobre no se pliega;
- el tope por persona y etapa frena el aporte siguiente, no escribe nada y no le quita el turno a
  otra persona; y la etapa siguiente empieza de cero;
- salir de `perspectivas` no depende de ninguna condición externa al historial;
- todo lo que ADR-0046 exigía y sigue vivo: matriz etapa × tipo de aporte, transiciones legales e
  ilegales, terminalidad, ventana con el aporte en `closesAt` exacto, aristas obligatorias y con tipo
  de destino, referencia hacia adelante, aciclicidad por recorrido real, sustitución que conserva el
  original, orden de presentación como permutación determinista y recomputable, y `tech-admin` sin
  ninguna capacidad de escritura;
- el agregado es alcanzable importando desde `@koinonia/domain`.

## Pruebas retiradas

Treinta pruebas, todas del mecanismo retirado. Se listan una a una porque una prueba que desaparece
sin nota es una garantía que desaparece sin nota:

| Fichero | Retiradas | Qué probaban |
|---|---|---|
| `deliberation-authorship.test.ts` | 13 | las 5 del compromiso (`hashCanonical` de la apertura, separación de dominios, ausencia del `authorId` en el evento y en el historial, estado plegado sin autoría) y las 8 de la revelación (recomputación, `authorId` cambiado, nonce cambiado, una sola vez, fuera de etapa, aporte inexistente, nonce prohibido fuera de `perspectivas` y obligatorio dentro) |
| `deliberation-pseudonym.test.ts` | 5 | fichero completo: estabilidad del seudónimo, no enlace entre deliberaciones, no fuga en la serialización, tope por seudónimo y alteración de la apertura en la revelación |
| `deliberation-commands.test.ts` | 4 | quién destapa autorías, garantías destapando, no salir de `perspectivas_revelando` con aportes sin destapar, y avanzar una vez destapadas todas |
| `deliberation-state-machine.test.ts` | 1 | «la autoría sólo se sella en `perspectivas`» (`stageSealsAuthorship`) |
| `props/deliberation-invariants.test.ts` | 7 | INV-D5 (1, ausencia del `authorId` en el evento sellado), INV-D6 (3, el compromiso ata la autoría), INV-D7 (2, revelación única y a tiempo) e INV-D8 (1, no salir con aportes sin destapar) |

En su lugar entran 22 pruebas nuevas: la regla de etapa con todos los roles, la revalidación de
autoría en el replay, el tope anti-inundación por persona y por etapa, la ausencia de alcance
temporal en el resto de la matriz y la alcanzabilidad del agregado desde `@koinonia/domain`.
