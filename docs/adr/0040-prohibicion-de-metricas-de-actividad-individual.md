# ADR-0040: Prohibición de métricas de actividad individual; sanciones graduadas sobre la tarea, nunca sobre la persona

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** `02-sociocracia-ostrom.md`, principios 4 y 5 de Ostrom; `03-deliberativa-sistemas-antipatrones.md` §3.3 y §6.

## Contexto

El principio 4 de Ostrom pide monitoreo por los propios miembros. La lectura ingenua lleva directamente a un panel con mensajes por persona, sesiones, tiempo en línea y tareas cumplidas — es decir, a vigilancia. **Monitorear el recurso no es monitorear personas**, y confundirlo destruye exactamente la confianza que el monitoreo pretende construir.

En cuanto al incumplimiento de tareas, que es el fallo más frecuente y el más corrosivo: el supuesto de diseño es que **la mayoría de los incumplimientos son sobrecarga o bloqueo, no mala fe**. Un sistema que castiga avisar consigue que nadie avise, y se entera tarde.

## Decisión

**No se recolectan ni se exponen métricas de actividad individual** (mensajes, sesiones, tiempo en línea, tareas cumplidas ordenadas por persona). Es una **prohibición explícita del modelo de datos**: no existe endpoint que ordene miembros por cumplimiento.

Las métricas de cumplimiento son **del círculo y del tipo de tarea**. La serie individual sólo la ve la propia persona y su vínculo, y sólo para ofrecer apoyo.

Frente al incumplimiento, **escalera de siete escalones sobre la tarea, no sobre la persona**: `por-vencer` (recordatorio privado, no es sanción) → `atrasada` (marca en la tarea) → `consultada` (pregunta, no reproche: «sigo» / «necesito ayuda» / «no puedo») → `bloqueada` (**el reloj se detiene** y la causa se registra como driver) → `en-apoyo` → `reasignada` (devolución **sin culpa** al círculo) → `en-revisión-colectiva` (**el objeto es el acuerdo o la carga, no la persona**) → `dominio-suspendido`, excepcional, **nunca automático**, con consentimiento del círculo y apelable.

Reglas de dominio que impiden la deriva punitiva:

- **Declarar bloqueo o pedir ayuda detiene el reloj.** Si avisar castiga, nadie avisa.
- **Prescripción:** los atrasos caducan a los dos semestres.
- **Proporcionalidad:** la severidad depende de la criticidad de la tarea y de la reincidencia dentro de la ventana, **jamás del prestigio académico de las partes**.
- **El derecho de voz es inderogable.** Ninguna sanción, en ningún escalón, puede quitar a alguien la capacidad de deliberar, objetar o votar. **La sanción máxima es perder un dominio, no la ciudadanía.**

Las métricas que sí se publican son agregadas y de salud del sistema: cumplimiento de acuerdos, HHI de concentración de voz, cobertura del padrón **desagregada por estrato**, rotación del núcleo activo y razón deliberación/votación. Ninguna mide «engagement»: *las plataformas participativas mueren sanas de engagement y muertas de consecuencia*.

## Alternativas consideradas

- **Panel de actividad por persona «para detectar quién necesita apoyo».** La intención es buena y el artefacto es vigilancia; una vez existe, se usa para otra cosa.
- **Ranking de cumplimiento.** Motivación extrínseca que desplaza a la intrínseca y convierte el compromiso político en desempeño performativo.
- **Sanción automática por incumplimiento.** Castiga la sobrecarga como si fuera mala fe y garantiza que nadie declare un bloqueo.
- **Sin escalera, todo informal.** El incumplimiento se resuelve por presión social, que es peor, invisible y desigual.

## Consecuencias

- El monitoreo se dirige al **estado del recurso** —acuerdos, deuda, cobertura— y no a las personas.
- Avisar temprano es la conducta óptima, que es lo que un sistema con capacidad limitada necesita.
- La reasignación sin culpa hace que devolver una tarea sea barato, y por tanto ocurra a tiempo.
- Las métricas públicas se muestran **con su serie histórica**: el nivel importa menos que la dirección.

## Consecuencias negativas aceptadas

- **Se pierde capacidad de diagnóstico individual.** Detectar temprano a alguien sobrecargado depende de que su vínculo lo note, no de un panel.
- Alguien que incumple sistemáticamente sin declarar bloqueo puede sostener el patrón durante bastante tiempo antes de que la vía colectiva actúe.
- Sin métricas individuales es más difícil evaluar a candidatos para roles; las nominaciones se apoyan en juicio y argumento, no en datos.
- La prescripción a dos semestres borra información que a alguien le parecerá relevante.
