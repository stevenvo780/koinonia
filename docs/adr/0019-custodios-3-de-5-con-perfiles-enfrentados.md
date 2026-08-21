# ADR-0019: Custodios 3-de-5 con perfiles enfrentados, rotación anual y sustitución por re-reparto

- **Estado:** Propuesto
- **Fecha:** 2026-08-21
- **Contexto de origen:** `11-privacidad-y-voto-secreto.md` §2.3 (**ADR-125 propuesto**). Aplica sólo si se ejecuta ADR-0018.

## Contexto

Con urna cifrada, el secreto depende de que la clave privada **nunca se reconstruya en un solo lugar**. Se reparte con Shamir k-de-n y al cierre cada custodio aporta un descifrado parcial. Si alguien tuviera la clave completa podría abrir la urna a mitad de la votación.

La pregunta difícil no es criptográfica: es **quiénes son esos custodios en un instituto de 300 personas**. No cinco amigos del administrador, ni cinco del mismo grupo político, ni cinco que se gradúen el mismo semestre.

## Decisión

**n = 5, k = 3**, con composición obligatoriamente heterogénea y estructuralmente enfrentada: (1) un representante estudiantil electo del año en curso; (2) un representante de la corriente que **perdió** la última elección; (3) un profesor no directivo; (4) alguien del personal administrativo; (5) la persona que administra el VPS —que aporta capacidad técnica pero **nunca** llega a 3 sola.

**Ceremonia de generación** de ~40 minutos, presencial, con acta firmada y video: convocatoria pública 7 días antes con los cinco nombres y observadores admitidos; portátil sin red arrancado desde un USB en vivo verificado por hash por dos personas distintas; cinco USB nuevos abiertos delante de todos; lectura en voz alta de la huella de la clave pública; frase de paso de seis palabras sacada al azar de una lista Diceware impresa —**no la inventa cada quien**, la gente inventa frases malas—; **prueba de recuperación inmediata** con tres custodios sobre una elección de juguete antes de terminar; destrucción del USB de arranque ante los presentes y publicación de `TrusteeSetEstablished`.

**Rotación anual obligatoria** en la primera semana del semestre, haya o no bajas: una ceremonia que sólo se hace en emergencias es una que nadie sabe ejecutar. La sustitución es por **re-reparto** (juntar k=3 y generar cinco partes nuevas), **nunca** entregando la parte de quien se fue: una parte copiada no se des-copia, y el re-reparto invalida la anterior porque cambia el polinomio.

Si se pierden 3 partes, la urna de una elección abierta **es irrecuperable**: se anula y se repite. Eso va en el reglamento **antes**, no improvisado después.

## Alternativas consideradas

- **Clave única en el servidor.** Anula el secreto por completo.
- **Clave de rescate del administrador.** Lo convierte en el punto único de fallo político del Instituto.
- **k = 2.** La colusión sería fácil. **k = 4:** la elección se bloquea en el primer viaje de campo.
- **Implementar Shamir a mano en TypeScript.** Las bibliotecas JS varían mucho en calidad, pocas son de tiempo constante y casi ninguna autentica las partes, así que un custodio podría entregar una parte falsa sin ser detectado —eso lo resuelve el *secret sharing* verificable de Feldman/Pedersen. Se usa el modo de umbral que ya trae Belenios.

## Consecuencias

- Abrir la urna antes de tiempo exige coludir a tres personas con intereses estructuralmente opuestos.
- La rotación anual convierte la ceremonia en rutina conocida y no en un evento excepcional que se ejecuta mal.
- La prueba de recuperación inmediata detecta el fallo el mismo día, no en octubre.

## Consecuencias negativas aceptadas

- **La elección depende de que tres personas aparezcan el día del escrutinio.** Hay que agendar el cierre con esa restricción, y aceptar que un escrutinio puede retrasarse por razones humanas.
- Es el eslabón más débil de la etapa 2 y **no tiene solución técnica**: depende de que humanos hagan bien una tarea aburrida una vez al año. Se mitiga con guion, ensayo y observadores; se rompe con una ceremonia hecha con prisa antes de un parcial.
- El requisito de perfiles enfrentados puede ser imposible de satisfacer en un semestre concreto (no hay «corriente perdedora» identificable, no hay personal administrativo dispuesto). Hay que declarar qué se hace en ese caso antes de que ocurra.
- La rotación anual, en una comunidad con ~20 % de graduación anual, implica formar custodios nuevos constantemente.
