# ADR-0017: Declaración de garantías obligatoria, generada desde la `GuaranteeMatrix`

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** `11-privacidad-y-voto-secreto.md` §2.5 (**ADR-122 propuesto**). Depende de ADR-0011.

## Contexto

El MVP tiene límites serios y nombrables: no protege contra coerción, y el administrador del servidor puede técnicamente ver quién votó qué (ADR-0010). Un sistema que oculta eso en un README es peor que uno sin garantías, porque produce confianza injustificada — y la confianza injustificada es exactamente lo que destruye una plataforma de gobernanza cuando se rompe.

## Decisión

**Ninguna elección puede abrirse sin declaración de garantías visible.** Pantalla completa antes del primer voto de cada elección, con un botón «Entiendo» que no se habilita durante 5 segundos, y enlace permanente junto a la urna.

El texto se **deriva de la `GuaranteeMatrix` del backend** (ADR-0011) y se sella en el ledger junto con la elección. Está escrito sin jerga, conforme a ADR-0041, y separa explícitamente **qué sí garantiza** de **qué no**:

- Qué sí: sólo vota quien podía votar y la lista se cerró antes; una persona, un voto; podés comprobar tu voto con tu código; cualquiera puede recontar; el resultado queda sellado fuera de este servidor; tu nombre no está en la lista de votos.
- Qué no: **no te protege si alguien te presiona** —tu código sirve también para que te exijan mostrarlo—; **quien administra el servidor podría técnicamente ver quién votó qué**; no te protege de un dispositivo infectado; no podés comprobar que la página que usás es la correcta; no impide que alguien apague el servidor.

Y el cierre: *«si el tema que se vota es delicado y creés que alguien podría presionarte, decilo en la asamblea: hay temas que deben votarse en papel».*

## Alternativas consideradas

- **Enlace a términos y condiciones.** Nadie los lee y no informan nada. Es cumplimiento formal, no informado.
- **Mostrarlo una sola vez al registrarse.** Las garantías dependen del backend y de la elección concreta; además, seis meses después nadie recuerda qué aceptó.
- **Redactar el texto a mano por elección.** Se desincroniza del backend real (ADR-0011) y ahí nace la mentira.

## Consecuencias

- La comunidad decide **con información real** si un tema debe votarse en la plataforma o en papel. Esa decisión es política y le corresponde a ella, no al equipo técnico.
- El texto no puede desviarse del comportamiento real del sistema: si cambia una garantía, cambia el tipo, cambia el texto y queda en el diff.
- Nombrar públicamente a la persona administradora forma parte del diseño: la confianza requerida es concreta y atribuible, no difusa.

## Consecuencias negativas aceptadas

- **Fricción deliberada al votar.** Cinco segundos de espera y una pantalla más bajarán la participación en algún margen. Se acepta a cambio de consentimiento informado real.
- Declarar los límites por escrito da munición a quien quiera desacreditar la plataforma («ellos mismos admiten que el admin puede ver los votos»). Se acepta: el argumento contrario —ocultarlo— es indefendible.
- El texto derivado automáticamente puede quedar rígido o poco natural; hay que revisarlo con gente real, no sólo generarlo.
