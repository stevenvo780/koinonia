# ADR-0037: Respuesta oficial y desenlace obligatorios, con autoría nominal, plazo y deuda pública

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** `01-decidim-loomio-polis.md` §1 (respuesta obligatoria de Decidim) y §2 (`outcome` de Loomio); `03-deliberativa-sistemas-antipatrones.md` §5.5 y §6.1.

## Contexto

La métrica maestra de salud democrática es la **tasa de cumplimiento de acuerdos**: mide si decidir sirve para algo. Por debajo de 0,5 sostenido, la plataforma es teatro y todo lo demás es decoración.

Los dos agujeros por los que se escapa son simétricos: propuestas que nunca reciben respuesta —mueren por silencio, y el silencio no deja rastro— y decisiones que se cierran sin que nadie escriba qué se decidió, de modo que seis meses después nadie sabe qué se acordó.

**El desenlace, no el hilo, es la unidad de memoria.**

## Decisión

Dos obligaciones, ambas con estado persistido y ambas medidas en público:

1. **Respuesta oficial obligatoria y fechada** sobre toda propuesta publicada, con el rol de quien responde. **El estado sin texto no se puede persistir**: `estado` sin `respuesta_texto` es inválido en el dominio, no en el formulario. `PropuestaPublicada` sin `PropuestaRespondida` en N días emite `RespuestaVencida { dias }`.
2. **Desenlace obligatorio con autoría nominal.** Al cerrar una decisión, una persona nombrada debe redactar qué se decidió y qué sigue, con fecha y responsables. La transición `abierta → pendiente_desenlace` la dispara el reloj; **la salida de `pendiente_desenlace` exige un desenlace persistido**. `DecisionCerrada` sin `DesenlaceRedactado` en 72 h emite `DesenlaceVencido`, y **la decisión queda inutilizable como precedente hasta que se redacte**.

El desenlace debe incluir qué se decidió, qué se descartó y por qué, qué supuestos quedaron sin verificar, y los **votos particulares** de quien discrepa (`03-...` §1.3.6).

**La deuda de respuesta y la deuda de cierre son métricas públicas del órgano**, en la portada, no recordatorios privados. La deuda drena por cumplir **o** por declarar el fracaso y cerrar; nunca por olvido, porque ahí se convierte en desconfianza.

Complemento obligatorio: ninguna decisión aprobada sin `Initiative` con **responsable nominal y fecha**.

## Alternativas consideradas

- **Estado sin texto** (aprobada / rechazada a secas). Es lo que hace todo el mundo y produce el «se decidió que no» sin razones, que es indistinguible de la arbitrariedad.
- **Desenlace opcional.** Lo opcional no se hace, y la memoria se pierde en el hilo.
- **Recordatorio privado en vez de deuda pública.** No cambia nada: la presión que funciona sin sanciones es la visibilidad.
- **Cierre automático con desenlace generado.** Un resumen automático no compromete a nadie y no es memoria: es relleno.

## Consecuencias

- Ninguna propuesta muere por silencio: o hay respuesta escrita, o hay deuda visible con nombre.
- La memoria institucional es recuperable, porque el desenlace es un artefacto corto e indexable, no 90 comentarios.
- Se cierra el bucle de aprendizaje: el desenlace es la entrada de la evaluación (ADR-0033) y de los `Learning`.
- «Ver el efecto» se acelera, que es la condición para que el bucle virtuoso de participación cierre (`03-...` §3.3).

## Consecuencias negativas aceptadas

- **Carga real sobre quien responde.** Con pocas manos, la deuda de respuesta será alta al principio y la métrica pública se verá mal. Es información correcta, aunque incómoda.
- La autoría nominal del desenlace expone a una persona a la crítica por una decisión colectiva.
- Bloquear el uso de una decisión como precedente hasta que haya desenlace puede paralizar trabajo dependiente.
- Un desenlace escrito con prisa para «quitar la deuda» es peor que ninguno, y la métrica no distingue calidad de cantidad.
