/**
 * `README-VERIFICACION.txt` — **la garantía de última instancia**.
 *
 * No es cortesía ni documentación. Es el artefacto que hace que el proyecto entero sea prescindible:
 * si Koinonía muere, si npm nos expulsa, si las forjas desaparecen y si este paquete deja de
 * existir, una persona con Python y una tarde tiene que poder reimplementar la verificación leyendo
 * este texto. Todo lo demás —la web, el CLI, este paquete— es conveniencia.
 *
 * Vive aquí, en el verificador, y no en el servidor, por una razón concreta: el texto y el programa
 * que lo implementa tienen que envejecer juntos. Si el algoritmo cambia y el texto se queda, el
 * texto pasa de ser una garantía a ser una trampa.
 */

export const README_VERIFICACION = `KOINONÍA — CÓMO COMPROBAR ESTE PAQUETE POR TU CUENTA
════════════════════════════════════════════════════════════════════════════════

Este fichero describe el procedimiento COMPLETO. Si algún día no existe el programa
\`@koinonia/verificar\`, ni esta plataforma, ni las personas que la hicieron, cualquiera
con un lenguaje de programación corriente debe poder reimplementarlo leyendo esto.

Sólo hace falta una función criptográfica: SHA-256.


1. QUÉ HAY EN EL PAQUETE
────────────────────────────────────────────────────────────────────────────────

  manifest.json           índice: versión, rango de registros y sha256 de cada fichero
  events.ndjson           un registro por línea, en JSON canónico, ordenados
  events.hashes.ndjson    para cada registro: su resumen, el del anterior y el de la espina
  heads.json              censo de expedientes con su estado final
  checkpoints.ndjson      los sellos periódicos, encadenados entre sí
  proofs/consistency/     pruebas de que cada sello sólo AÑADE al anterior
  anchors/               comprobantes de registro externo (Bitcoin, git firmado, correo)
  confianza.json          claves públicas de la veeduría y de los testigos
  README-VERIFICACION.txt este fichero

AVISO IMPORTANTE SOBRE manifest.json: los sha256 que contiene los calcula quien produce
el paquete. Sirven para detectar una descarga corrupta y NADA MÁS. Quien altere un
fichero recalculará su sha256. La protección real es la de los apartados 6 y 7.


2. JSON CANÓNICO (RFC 8785, «JCS»)
────────────────────────────────────────────────────────────────────────────────

Un mismo dato puede escribirse en JSON de infinitas maneras, y cada una produce un
resumen distinto. Por eso se fija UNA:

  a) las claves de cada objeto van ordenadas de menor a mayor comparando sus unidades
     de código UTF-16 (no es el orden del alfabeto de ningún idioma);
  b) no hay NI UN espacio ni salto de línea fuera de las cadenas de texto;
  c) los números son enteros, escritos sin ceros a la izquierda ni signo positivo;
  d) el texto se escapa igual que hace JSON.stringify de JavaScript;
  e) el resultado se codifica en UTF-8 sin marca de orden (BOM);
  f) no se admite el valor null: la ausencia se expresa OMITIENDO la clave.

Comprobación obligatoria: cada línea de events.ndjson tiene que ser IDÉNTICA, byte a
byte, al resultado de volver a escribirla siguiendo estas reglas. Si sólo es
«equivalente», el paquete está alterado. Este control detecta por sí solo una copia de
seguridad restaurada a través de un tipo de columna que reordena claves.


3. EL RESUMEN DE CADA REGISTRO
────────────────────────────────────────────────────────────────────────────────

  eventHash = SHA256( 0x02 ‖ prevHash ‖ JCS_utf8(registro) )

donde ‖ es concatenación de bytes, 0x02 es UN byte con valor 2 y prevHash son los 32
bytes del resumen del registro anterior del mismo expediente.

El byte 0x02 separa dominios: distingue un eslabón de cadena de una hoja de árbol (0x00)
y de un nodo interno (0x01). Sin esa separación, un mismo valor podría interpretarse
como dos cosas distintas, y ahí se cuela un ataque.

El primer registro de cada expediente usa como prevHash el resumen de la cabeza de la
espina en el momento de nacer (campo spineHash). El primer registro de la espina, y sólo
ése, usa 32 bytes a cero.

Comprobación: recalculá eventHash para cada registro y compará con events.hashes.ndjson.


4. LAS CADENAS Y LA NUMERACIÓN
────────────────────────────────────────────────────────────────────────────────

Dentro de cada expediente, el prevHash de cada registro tiene que ser el eventHash del
anterior, y el campo seq tiene que ir 0, 1, 2, … sin saltos.

Además, TODOS los registros llevan un número global (leafIndex) que va 0, 1, 2, … sin
saltos en el paquete entero. Dos comprobaciones distintas:

  · huecos INTERIORES: comparar la lista de leafIndex con 0..máximo;
  · cola CORTADA: comparar manifest.cursorNextLeafIndex con (máximo + 1).

La segunda es imprescindible. Si se borran los últimos k registros, no queda ningún
hueco y la historia parece continua. Lo único que lo delata es que el sistema anota
cuántos números llegó a repartir, y ese contador no baja.


5. LA ESPINA DORSAL
────────────────────────────────────────────────────────────────────────────────

Existe un expediente especial (manifest.spineAggregateId) donde queda anotado el
nacimiento de todos los demás, con eventos de tipo «AgregadoAbierto» cuyo contenido
incluye aggregateId y genesisHash.

Comprobación: para cada anotación, tiene que existir un registro con seq = 0, con ese
eventHash exacto y perteneciente a ese expediente. Y al revés: todo expediente con
registros tiene que tener su anotación.

Esto detecta la desaparición de un expediente ENTERO, que las cadenas por sí solas no
pueden ver: si se borra una propuesta completa, no queda ninguna cadena rota, porque la
cadena se fue con ella. Lo que queda es la anotación de nacimiento apuntando al vacío.
Y detecta lo mismo si el expediente se reescribe desde cero, porque su genesisHash
cambia.


6. LOS SELLOS PERIÓDICOS (árbol de Merkle, RFC 6962)
────────────────────────────────────────────────────────────────────────────────

  MTH({})   = SHA256("")
  MTH({d0}) = SHA256( 0x00 ‖ d0 )
  MTH(D[n]) = SHA256( 0x01 ‖ MTH(D[0:k]) ‖ MTH(D[k:n]) )
              con k = la mayor potencia de 2 ESTRICTAMENTE MENOR que n

Las entradas D son los eventHash en orden de leafIndex.

Dos avisos que no son de estilo:
  · los prefijos 0x00 y 0x01 son obligatorios. Sin ellos se puede exhibir un árbol de
    tamaño 2 con la misma raíz que uno de tamaño 4, negando dos registros, sin romper
    SHA-256;
  · el nodo impar ASCIENDE sin duplicarse. Duplicarlo (como hace Bitcoin) permite dos
    listas distintas con la misma raíz.

Cada sello de checkpoints.ndjson tiene:

  checkpointHash = SHA256( 0x04 ‖ JCS_utf8({ treeSize, rootHash, headsRoot,
                                             prevCheckpoint?, issuedAt }) )

REGLA DEL PRIMER SELLO: si no hay sello anterior, la clave prevCheckpoint se OMITE. No
se pone vacía ni con ceros. El primer sello tiene cuatro claves y los demás cinco.

Comprobaciones:
  a) recalcular checkpointHash y compararlo;
  b) prevCheckpoint de cada sello = checkpointHash del anterior;
  c) rootHash = MTH sobre los primeros treeSize eventHash;
  d) headsRoot = MTH sobre las entradas
        aggregateId(16 bytes) ‖ seq(entero de 64 bits, big-endian) ‖ headHash(32 bytes)
     del censo de expedientes tal como estaba tras los primeros treeSize registros,
     ordenadas por aggregateId.


7. CONTINUIDAD ENTRE SELLOS
────────────────────────────────────────────────────────────────────────────────

Entre dos sellos de tamaños m y n (m < n) se publica una prueba de consistencia RFC 6962
en proofs/consistency/m-n.json. Verificarla consiste en recomponer, con la misma lista de
nodos, DOS raíces: la del árbol de tamaño m y la del de tamaño n. Sólo si las dos salen
correctas la prueba vale.

Esto es lo que impide «publicar una raíz nueva coherente pero falsa»: si se cambió,
borró o reordenó cualquiera de los primeros m registros, no existe prueba posible.


8. LOS COMPROBANTES DE REGISTRO EXTERNO
────────────────────────────────────────────────────────────────────────────────

TODO lo anterior lo puede rehacer quien controle el servidor. Si reescribe la historia
entera y recalcula cadenas, sellos y pruebas, los apartados 2 a 7 dan verde. Lo único
que no puede rehacer es lo que ya salió de su máquina.

Un checkpoint se declara FIRME sólo si lo confirman DOS clases de independencia
DISTINTAS. Dos comprobantes de la misma clase no son dos testigos: comparten modo de
falla.

  (a) BITCOIN (OpenTimestamps). El fichero .ots demuestra, aplicando operaciones de
      concatenación y SHA-256, que SHA256(checkpointHash) participa en el cálculo de la
      raíz de Merkle de un bloque concreto. Se recorre el árbol del sello desde el
      resumen del fichero y se comprueba que el resultado sea la raíz de Merkle que
      figura en los bytes 36 a 68 de la cabecera de ese bloque. La cabecera son 80 bytes;
      su identificador visible es SHA256(SHA256(cabecera)) con los bytes al revés, y ése
      es el dato que hay que contrastar contra cualquier explorador de Bitcoin. El
      instante del bloque está en los bytes 68 a 72, como entero de 32 bits little-endian.

  (b) GIT FIRMADO. Un commit cuyo mensaje contiene la línea
        koinonia-checkpoint: <checkpointHash en 64 hex>
      firmado con una clave de confianza.json, empujado a dos forjas distintas. El
      identificador del commit es SHA1("commit " ‖ longitud ‖ 0x00 ‖ objeto). Lo que se
      firma es el objeto SIN la cabecera gpgsig. La firma sigue el formato SSHSIG de
      OpenSSH, con espacio de nombres «git».
      LA CLAVE PRIVADA NO VIVE EN EL SERVIDOR. Si viviera, este comprobante no probaría
      nada: quien reescribe la historia firmaría la versión falsa. Por eso confianza.json
      declara gitSigningKeyOffHost, y si es falso este comprobante NO CUENTA.

  (c) TESTIGOS POR CORREO. Personas de dominios de correo distintos acusan recibo del
      resumen y firman su acuse con su propia clave (espacio de nombres
      «koinonia-anclaje») sobre los bytes
        0x10 ‖ JCS_utf8({ address, checkpointHash, messageId, seenAt, witness })
      Cuenta el número de DOMINIOS distintos, no el de acuses. Un acuse sin firmar es
      informativo y no cuenta.

Si confianza.json viene dentro del paquete, las firmas se comprueban contra una lista que
proporcionó el propio verificado. Es como cotejar un carné contra la lista que trae el
carné. Conseguí esa lista por otro canal.


9. QUÉ SIGNIFICA CADA RESULTADO
────────────────────────────────────────────────────────────────────────────────

  VERDE  Las cuentas cuadran Y el resumen está registrado en dos sitios independientes
         fuera del servidor. Para cambiar la historia sin que se note habría que alterar
         todos esos sitios a la vez.

  ÁMBAR  Las cuentas cuadran y falta la confirmación externa. Lo ocurrido desde el último
         registro externo TODAVÍA NO ESTÁ PROTEGIDO. No prueba que algo esté mal.

  ROJO   Hay una diferencia. Guardá el paquete sin modificarlo y avisá a la veeduría.


10. LO QUE ESTE PROCEDIMIENTO NO PRUEBA
────────────────────────────────────────────────────────────────────────────────

Decirlo es parte del diseño: un sistema de integridad que se sobrevende produce
confianza falsa, que es peor que la desconfianza.

  · No prueba que lo registrado sea VERDAD. Prueba que no cambió después de escribirse.
    Un administrador puede insertar un voto perfectamente formado de alguien que nunca
    votó, y quedará anclado igual que los legítimos. Integridad no es autenticidad.
  · No protege la ventana que va desde el último sello anclado hasta ahora. Todo lo
    ocurrido en ese lapso puede reescribirse sin contradecir nada externo.
  · No detecta que el servidor le enseñe a cada persona una historia distinta. Eso sólo
    lo detecta comparar paquetes entre personas.
  · Las fechas internas (occurredAt) las pone el servidor y puede escribir las que quiera.
    Lo único con fecha demostrable es el anclaje.
  · Nada de esto sirve si nadie lo ejecuta. La criptografía no crea confianza: crea la
    POSIBILIDAD de verificar. Convertirla en práctica es un problema de la asamblea.
`;
