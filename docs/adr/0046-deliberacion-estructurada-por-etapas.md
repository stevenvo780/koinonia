# ADR-0046: Deliberación estructurada por etapas, con aportes tipados en grafo y autoría diferida

- **Estado:** Aceptado
- **Fecha:** 2026-08-22
- **Contexto de origen:** `PRODUCT.md` §4 (pantalla «Deliberaciones»); `GOVERNANCE.md` §3;
  `THREAT_MODEL.md` adversario nº 3 (el curioso interno); `03-deliberativa-sistemas-antipatrones.md`
  §1.4; ADR-0001, ADR-0004, ADR-0007, ADR-0035, ADR-0037, ADR-0041 y ADR-0045.

## Contexto

El principio 3 del proyecto —separar deliberación, decisión y ejecución— ya está implementado en el
lado de la decisión y en el de la ejecución. La deliberación, que es la parte que ese principio dice
proteger, no existía como agregado: un hilo cronológico sin tipos ni ventanas habría reproducido el
foro que `03-deliberativa-sistemas-antipatrones.md` describe como el antipatrón central, donde el
objeto de interacción es el autor y no el problema.

Hay dos fallas que un hilo plano garantiza y que ninguna moderación posterior repara:

- **El marco lo fija quien escribe primero.** Si la primera persona publica una posición cerrada, las
  siguientes discuten esa posición en lugar del problema. Cuando la discusión llega a la votación,
  las alternativas que nunca se formularon ya no existen.
- **Quien tiene menos estatus no escribe.** En un colectivo de unas 300 personas que se conocen, la
  primera perspectiva firmada por alguien con autoridad reconocida desplaza a las demás antes de que
  se escriban. El efecto no es de contenido: es de orden y de firma.

ADR-0035 ya resolvió la forma general del problema para los espacios: **las fases no son etiquetas de
interfaz, son ventanas de escritura**. Falta aplicarla dentro de una discusión concreta, y con el
detalle que exige la segunda falla: ocultar la autoría durante la etapa en que se recogen las
perspectivas.

Ocultar autoría en un registro público tiene una restricción dura. El evento del ledger es legible
por cualquiera que exporte el historial; un campo que la interfaz «no pinta» no oculta nada. Lo único
que oculta un dato es que el dato no esté. Y ADR-0001 prohíbe dependencias de runtime en
`packages/domain`, lo que descarta cualquier construcción que necesite aritmética de curva elíptica.

## Decisión

Un agregado nuevo, `packages/domain/src/deliberation/`, con cuatro piezas: etapas como ventanas,
aportes tipados en grafo, corrección por sustitución y autoría diferida por compromiso.

### Las etapas son ventanas de escritura, no rótulos

```text
preguntas_aclaratorias ─▶ perspectivas ─▶ perspectivas_revelando ─▶ construccion_alternativas
                                                                              │
        listo_para_decidir ◀── enmiendas ◀── objeciones ◀──────────────────────┘
```

`listo_para_decidir` es terminal: volver a deliberar exige otra deliberación, no un rebobinado
(`state-machine.ts`, `TERMINAL_STAGE`).

Cada etapa declara qué tipos de aporte admite y rechaza todos los demás. **Dos etapas admiten
ninguno** —`perspectivas_revelando` y `listo_para_decidir`—, y esas dos filas vacías de la matriz son
tan normativas como las llenas: la primera existe para destapar autorías y la segunda para no
escribir más.

La ventana se evalúa contra el instante, que entra como dato (`meta.at`), **no contra el hecho de que
alguien haya pulsado el botón de avanzar de etapa**. Un aporte que llega con `now >= closesAt` falla
con `WRITE_WINDOW_CLOSED` aunque el evento de avance no se haya escrito todavía. Si el cierre
dependiera de una pulsación, la ventana duraría hasta que alguien se acordara.

**Un aporte tardío falla: no se encola, no se reubica en la etapa siguiente y no se guarda «para
después».** Reubicarlo sería peor que perderlo: una perspectiva escrita a ciegas que reaparece en la
etapa de objeciones ya se escribió sabiendo cosas que sus vecinas no sabían, y contamina justo la
propiedad que la etapa protegía.

### Los aportes son un grafo tipado, no una lista

Seis tipos: `posicion`, `razon`, `evidencia`, `supuesto`, `riesgo` y `alternativa`. Cada uno declara
su arista, y la arista es obligatoria:

| Tipo | Arista obligatoria |
|---|---|
| `razon` | sostiene o responde a una `posicion` concreta |
| `evidencia` | respalda una `razon`, nunca una opinión suelta |
| `supuesto` | se aplica a uno o más aportes; la lista no puede ir vacía |
| `riesgo` | es riesgo **de una alternativa** |
| `alternativa` | declara el problema que dice resolver y de qué posiciones sale, no vacío |

La regla que hace el trabajo estructural: **toda referencia apunta a un aporte con `seq`
estrictamente menor** (`graph.ts`, `assertReferences`). Una referencia hacia adelante se rechaza al
escribir. De ahí sale que el grafo sea **acíclico por construcción**, sin necesidad de recorrerlo: la
anterioridad temporal ya es un orden topológico. La comprobación de aciclicidad que se ejecuta sobre
el historial completo **no se apoya en `seq`** —si se apoyara sería una tautología— sino que recorre
el grafo de verdad, para que un log manipulado no pase por el hecho de estar bien numerado.

Discrepar de un aporte no se hace editándolo. **Corregir es otro evento con
`supersedesContributionId`, y el original permanece.** Es la misma decisión que el principio 5 del
proyecto toma para todo lo demás: nada se edita en su sitio, porque los cambios son precisamente lo
que explica el resultado.

### La autoría se oculta durante `perspectivas` y se destapa al cerrarla

El evento `ContributionSubmitted` de la etapa `perspectivas` **no lleva `authorId`**. Lleva

```text
authorCommitment = H(JCS({ domain: 'koinonia/deliberation-author/v1',
                           deliberationId, contributionId, authorId, nonce }))
```

y el `actor` del sobre encadenado es `'system'`. La apertura —el objeto canónico con el `authorId` y
el `nonce`— vive en el almacén de material privado de ADR-0045, **nunca en el ledger**.

Al cerrar la etapa, `ContributionAuthorRevealed` publica `authorId` y `nonce`, y el dominio
**recomputa el hash y lo compara**. Por eso la autoría no se puede falsificar después del hecho: quien
quisiera atribuirse una perspectiva ajena tendría que encontrar una segunda preimagen.

El campo `domain` no es decorativo. Sin él, el mismo `hashCanonical` de otro objeto con las mismas
claves valdría como compromiso de autoría; la separación de dominios existe para que un digest de un
propósito no sirva para otro.

### El seudónimo por deliberación

Un compromiso por aporte oculta la autoría, pero también impide contar. Sin nada más, una sola
persona podría inundar la etapa con veinte perspectivas y el dominio no podría notarlo sin destapar a
todo el mundo. Por eso cada aporte sellado lleva además

```text
authorPseudonym = H(JCS({ domain: 'koinonia/deliberation-pseudonym/v1',
                          deliberationId, authorId, deliberationNonce }))
```

con `deliberationNonce` secreto de 128 bits guardado en la bóveda. El seudónimo es **estable dentro de
una deliberación y no enlazable entre deliberaciones**: permite imponer un tope de aportes por persona
y por etapa (`maxContributionsPerAuthorPerStage`) y detectar inundación sin saber quién es nadie.

### El orden de presentación

Si todo el mundo lee los aportes en el mismo orden, el primero de la lista pesa más que el último por
el solo hecho de estar arriba. El orden se aleatoriza **por lectora**, de forma determinista y
recomputable: la semilla de presentación entra como dato en el evento que abre la etapa, de modo que
cualquiera puede rehacer el orden que vio cualquier otra persona y comprobar que no hubo dedo. Es una
permutación: nadie ve más ni menos aportes que nadie.

### La autorización vive en la matriz, no en la orden

Toda orden llama a `authorize` **antes** de construir el evento, con su propia acción de `access.ts`:
abrir y avanzar etapa son de facilitación o de garantías dentro del círculo; aportar exige membresía
del círculo; revelar es sólo de garantías. No hay ninguna variante «sin comprobar». `tech-admin` no
obtiene escritura en ninguna de ellas.

## El hueco declarado: esto no protege frente al administrador, y nunca podrá

**Este esquema no da anonimato frente a quien administra el sistema.** No es una limitación de la
implementación actual: es una imposibilidad de la construcción elegida, y se declara aquí en lugar de
dejarla implícita.

El administrador tiene la bóveda. Por lo tanto:

- conoce el `deliberationNonce`, así que **puede computar el seudónimo de cualquier persona** y
  deshacer la seudonimización de toda la etapa;
- tiene las aperturas, así que **conoce la autoría antes del destape**;
- y, lo más grave, **puede forjar un compromiso atribuyendo un aporte a un inocente**: nada en el
  esquema exige que la persona nombrada haya participado en su construcción.

Cerrar ese adversario exigiría una **firma asimétrica del propio usuario** —una clave que el servidor
no tenga—, y eso significa aritmética de curva elíptica, es decir una dependencia de runtime dentro de
`packages/domain`, que es exactamente lo que ADR-0001 prohíbe. La alternativa que se propuso en el
diseño —cifrado umbral con pruebas de conocimiento cero— tiene el mismo problema, multiplicado.

Lo que el esquema **sí** cierra es el **adversario nº 3 del modelo de amenaza —el curioso interno— y
la presión social entre pares**, que es el objetivo de producto real: que quien tiene menos estatus se
atreva a escribir. El compromiso protege frente a **quien lee el historial**, o sea frente al
Instituto entero, que es de quien hay que proteger la deliberación a ciegas.

Se declara el hueco en vez de fingir la garantía, **exactamente como hace C6 con el secreto del
voto**. Y la consecuencia de interfaz es vinculante: **la pantalla debe decirlo en castellano llano y
no puede sugerir anonimato frente a quien administra.** Prometer anonimato y entregar
seudonimización reversible por el administrador es peor que no ofrecer nada, porque induce a escribir
lo que no se habría escrito.

**El anonimato por estilometría es indefendible y no se intenta.** Con unas 300 personas que se
conocen, que se leen entre sí y que escriben en el mismo registro académico, el estilo identifica.
Ninguna decisión de este ADR pretende resistir a un lector atento que conoce a sus compañeros; la
protección es contra la firma visible y el orden de lectura, no contra el reconocimiento.

## Alternativas consideradas

- **Cifrado umbral y pruebas de conocimiento cero para la autoría.** Es lo que propuso el diseño
  original y es lo correcto en abstracto: cerraría al administrador. Rechazada porque exige
  aritmética de curva elíptica y por tanto dependencias de runtime en el dominio, contra ADR-0001. Se
  bajó a compromiso con nonce, que es lo que se puede construir con SHA-256 y canonicalización JCS.
- **Un `authorId` en el evento que la interfaz no muestra.** Rechazada: no oculta nada. El evento es
  público en el historial exportable; lo único que oculta un dato es que el dato no esté.
- **Hash desnudo del `authorId`.** Rechazada por R2 y ADR-0007: es una derivación de un identificador
  personal dentro del ledger, y sobre 300 personas el diccionario es inmediato. El compromiso lleva
  nonce y `contributionId`, y el seudónimo lleva un secreto de deliberación, precisamente para que no
  exista un valor estable y global por persona.
- **Encolar el aporte tardío y publicarlo en la etapa siguiente.** Rechazada: mueve un texto escrito
  sin información a un contexto donde ya la hay, y le da a su autor una ventaja que las demás
  personas no tuvieron. Perderlo es más honesto.
- **Editar el aporte propio.** Rechazada: destruye lo que explica la discusión. La corrección es un
  aporte nuevo que declara a cuál sustituye.
- **Aristas opcionales, con validación «recomendada».** Rechazada: una razón sin posición y una
  evidencia sin razón son exactamente el contenido que produce un hilo plano. Si la arista es
  opcional, el grafo degenera en lista en la primera semana.
- **Comprobar la aciclicidad sólo por `seq`.** Rechazada como única comprobación: sobre un log
  manipulado, comprobar el orden con el orden es una tautología. Se hace además el recorrido real.
- **Anonimato permanente, sin destape.** Rechazada: contradice ADR-0037 (respuesta y desenlace
  obligatorios) y hace irresponsable el aporte. La opacidad es temporal y su función es que la
  perspectiva se escriba, no que nadie responda por ella.

## Consecuencias

- Deliberar deja de ser un hilo y pasa a ser un expediente con estructura recuperable: se puede
  preguntar qué evidencia sostiene qué razón, y qué riesgos tiene cada alternativa, sin releer todo.
- La compuerta entre deliberar y decidir es ejecutable: `listo_para_decidir` es un estado del
  agregado, no una afirmación de la facilitación.
- La primera perspectiva deja de fijar el marco por ser la primera y por venir firmada.
- Una corrección no borra el error: el par original-sustituto es legible y es lo que permite estudiar
  cómo cambió la discusión.
- El dominio puede frenar la inundación sin desanonimizar a nadie durante la etapa.
- El grafo es acíclico por construcción y verificable por un tercero con sólo el log.

## Consecuencias negativas aceptadas

- **`perspectivas_revelando` puede atascarse.** No se sale de esa etapa mientras quede un aporte
  sellado sin revelar, y la apertura vive fuera del dominio. Si la apertura se pierde, la
  deliberación se queda ahí. Es el precio de que la autoría no se pueda falsificar: cualquier salida
  de emergencia sería una vía para cerrar la etapa dejando perspectivas cuya autoría nadie tendría
  que asumir nunca. Se declara como consecuencia conocida y no se tapa con una válvula.
- **La máquina estricta produce situaciones frustrantes y legítimas**, igual que en ADR-0035: alguien
  llega tarde con un aporte valioso y el sistema lo rechaza. Se acepta; la alternativa es que no haya
  etapas.
- **Seis tipos de aporte son seis decisiones que la persona tiene que tomar antes de escribir.** Es
  fricción real y va a reducir el volumen. El diseño apuesta a que reduce más el ruido que la señal;
  no hay medición todavía que lo respalde.
- **La protección de autoría es frente a pares, no frente a quien administra**, y esa asimetría hay
  que sostenerla en la interfaz cada vez que se muestre la etapa, no una sola vez en un texto legal.
- **La revisión adversarial independiente del esquema de seudónimo quedó sin completar.** Los
  intentos de esta sesión cayeron por timeout de transporte y **no se atribuye ningún resultado a
  ellos**. El esquema fue atacado con éxito por el propio agente que lo implementó —así apareció el
  párrafo del administrador de arriba—, pero eso no es revisión independiente. Queda como trabajo
  pendiente, y este ADR **no debe leerse como si ese escrutinio ya hubiera ocurrido**.
- No existe interfaz para nada de esto. La pantalla «Deliberaciones» de `PRODUCT.md` §4 sigue sin
  implementar, así que hoy el agregado sólo es alcanzable desde el dominio.

## Pruebas obligatorias

- matriz completa etapa × tipo de aporte, con las dos filas vacías comprobadas como vacías;
- transiciones legales e ilegales, y terminalidad de `listo_para_decidir`;
- ventana: aporte en `closesAt` exacto y después, con el evento de avance aún no escrito;
- aristas obligatorias ausentes, vacías y apuntando a un tipo equivocado;
- referencia hacia adelante y referencia a un `seq` igual: las dos rechazadas;
- aciclicidad comprobada por recorrido real sobre un log con `seq` manipulados;
- sustitución: el original permanece, la cadena de sustituciones es recorrible y no admite ciclos;
- compromiso de autoría: mismo autor y mismo contenido con nonces distintos dan compromisos
  distintos; revelar con `authorId` o `nonce` cambiados falla la recomputación;
- ausencia de `authorId` en el payload sellado, comprobada sobre el evento canónico, no sobre el tipo;
- seudónimo: estable dentro de la deliberación, distinto entre deliberaciones para la misma persona,
  y tope por etapa aplicado sin destapar autoría;
- orden de presentación: es una permutación, es determinista y es recomputable por un tercero;
- autorización directa: miembro del círculo, facilitación, garantías, miembro ajeno y `tech-admin`.

