# ADR-0039: Prohibición de tokens, voto ponderado por tenencia y reputación acumulada

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** `03-deliberativa-sistemas-antipatrones.md` §4 (lectura escéptica de las DAOs) y §2 (separación entre calidad del argumento y popularidad del autor); `01-decidim-loomio-polis.md` §2 (descarte de reacciones con peso decisorio).

## Contexto

El ecosistema DAO resolvió algo que vale robar —verificabilidad pública del proceso, reglas congeladas antes del hecho, resistencia a la captura administrativa— y lo envolvió en algo que hay que rechazar sin matices.

El argumento es corto: **si el poder es transferible, es comprable**, y 300 estudiantes con desigualdad económica real producen plutocracia en un semestre.

Hay una versión blanda del mismo problema, más difícil de ver porque parece justa: la reputación acumulada. El efecto Mateo estructural convierte el prestigio en peso deliberativo permanente y produce **una aristocracia de los antiguos**.

## Decisión

**Prohibido, sin excepciones y como restricción del modelo de datos:**

- Tokens de gobernanza en cualquier forma.
- Voto ponderado por tenencia, antigüedad monetizable o *stake*.
- Quórum comprable.
- Delegación con mercado secundario.
- Cualquier activo transferible que represente poder político.
- Contadores de reputación, seguidores, karma, puntos, insignias, rachas o niveles.
- Reacciones o emoji con cualquier peso decisorio. Pueden existir como señal social; **jamás** entran al conteo ni ordenan la deliberación.
- **La irreversibilidad como valor.** «El código es la ley» convierte cada bug en constitución; la historia de las DAOs es la de los forks de emergencia que probaron que la comunidad siempre fue soberana sobre el código.

**El peso base de voto es siempre 1** (spec 30 §A.2). El poder desigual sólo puede venir de **delegación explícita, caducable, revocable y con tope** (ADR-0029).

El ranking del contenido es por **consenso puente** (ADR-0038), no por votos totales. La experiencia entra como **evidencia adjunta y verificable**, no como estatus.

**Dónde sí sirve una ancla criptográfica sin criptomoneda:** semilla de sorteo con faro externo (ADR-0024), cadena de hashes con sellado de tiempo (ADR-0005) y firma del desenlace con clave ligada a la identidad institucional. La distinción operativa es tajante: **criptografía para probar hechos, jamás para asignar poder.** El poder lo asigna la pertenencia al Instituto, y esa lista la mantiene una secretaría, no un contrato.

## Alternativas consideradas

- **Reputación no transferible** («soulbound»). Sigue produciendo aristocracia de los antiguos y desincentiva la entrada de gente nueva, que es el flujo del que depende una comunidad con 20 % de graduación anual.
- **Peso por participación previa.** Premia a quien ya tiene tiempo libre y refuerza el bucle que se busca debilitar.
- **Reacciones con peso pequeño «para ordenar».** Ordenar la deliberación **es** poder decisorio, sólo que sin declararlo.
- **Operar sobre una cadena pública.** Comisiones, wallets, claves perdidas y una alfabetización cripto que excluiría a más gente de la que incluiría.

## Consecuencias

- La igualdad política es una **invariante del modelo de datos**, no una promesa de la interfaz: no existe endpoint que ordene miembros por mérito ni columna que acumule prestigio.
- Se elimina de raíz el incentivo a acumular y a performar participación.
- La comunidad conserva la soberanía sobre el código: un fallo se corrige, no se consagra.

## Consecuencias negativas aceptadas

- **Se pierde señal legítima.** Quien lleva tres años en bienestar **sí sabe más**, y el sistema no lo refleja automáticamente. La compensación —evidencia adjunta y verificable— exige trabajo de quien la aporta.
- Sin señales de reputación es más difícil para alguien nuevo saber a quién escuchar; la curva de orientación es más lenta.
- Sin gamificación, la participación depende íntegramente de la motivación intrínseca y de que decidir tenga consecuencias visibles (ADR-0037). No hay palanca barata de *engagement*, y no la habrá.
