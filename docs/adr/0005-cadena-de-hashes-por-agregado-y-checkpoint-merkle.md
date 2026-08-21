# ADR-0005: Cadena de hashes por agregado más checkpoint Merkle global periódico

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** decisión estructural del arquitecto; `11-privacidad-y-voto-secreto.md` §1.1 y §2.4.c (raíz Merkle diaria, ancla externa); `03-deliberativa-sistemas-antipatrones.md` §4 (cadena de hashes + sellado de tiempo); `20-normativa-datos-colombia.md` §7.5 (la raíz publicada y su condición para no ser dato personal).

## Contexto

Hacen falta dos garantías distintas que la gente confunde:

1. **Que nadie reescribió el pasado del expediente** — una propiedad local, que se comprueba leyendo una decisión concreta y sus eventos.
2. **Que el servidor no reescribió el pasado entero y volvió a encadenarlo** — una propiedad global, que ninguna cadena interna puede dar: quien controla el servidor puede recomputar todos los `prevHash` en un segundo. Sólo la sirve un **testigo externo**.

Una única cadena global lineal sobre todos los eventos del sistema daría la propiedad 2 pero haría insoportable la 1: para verificar una decisión habría que descargar y recorrer todo el log del Instituto.

## Decisión

**Dos niveles.**

- **Nivel local — cadena por agregado.** Cada evento lleva `prevHash` apuntando al hash del evento anterior **del mismo agregado** (decisión, propuesta, iniciativa, círculo). Verificar una decisión exige sólo sus propios eventos: unas decenas, no el log entero.
- **Nivel global — checkpoint Merkle periódico.** Cada 24 horas se construye un árbol de Merkle sobre los hashes de los eventos del período, junto con la raíz del checkpoint anterior. Esa **raíz diaria** (32 bytes) se publica por un canal fuera del control del equipo técnico y se sella con OpenTimestamps o una TSA RFC 3161.

Sólo se publica la **raíz** más, a lo sumo, el número de hojas y el rango temporal. **No se publican las hojas ni el árbol completo**, y las pruebas de inclusión se entregan **al titular sobre su propio evento, bajo demanda** (`20-normativa-datos-colombia.md` §7.5): una prueba de inclusión revela la hoja.

## Alternativas consideradas

- **Sólo cadena global lineal.** Verificar una decisión obligaría a recorrer todo el log; el auditor no técnico no lo hará nunca.
- **Sólo cadena por agregado, sin ancla externa.** Cubre la manipulación accidental o de un tercero, no la del administrador — que es precisamente el adversario declarado del modelo (`11-privacidad-y-voto-secreto.md` §2.4, ADR-0010).
- **Anclar cada evento individualmente.** Coste y ruido innecesarios; la ventana de 24 h acota el daño a un día y basta a esta escala.
- **Publicar el árbol completo «por transparencia».** Es la trampa: destruye la defensa de que la raíz no es dato personal (§7.5) y convierte un valor pseudoaleatorio en un mapa de participación.

## Consecuencias

- Verificar una decisión concreta es barato y explicable a alguien sin formación técnica.
- Después de un anclaje, alterar un voto exige romper SHA-256 o falsificar el ancla externa; el equipo técnico deja de ser soberano sobre la historia.
- El ancla es publicable fuera de Colombia sin constituir transferencia internacional de datos personales, siempre que se sostenga la construcción de §7.5 (raíz sin preimagen enumerable) — lo que ADR-0007 refuerza al vaciar el ledger de derivaciones de datos personales.
- El anclaje del escrutinio debe ocurrir **antes** de publicar el resultado, o el control no vale nada (ADR-0016).

## Consecuencias negativas aceptadas

- Ventana de hasta 24 horas en la que una manipulación aún no está anclada. Reducirla es cuestión de configuración, no de diseño.
- El anclaje depende de un servicio externo que puede desaparecer; hay que llevar al menos dos destinos independientes y aceptar que el histórico previo a un cambio queda sellado por el servicio antiguo.
- Un evento con `prevHash` mal calculado rompe la cadena de su agregado de forma irreparable: no se puede corregir sin reescribir, y reescribir está prohibido. Se resuelve con un evento de corrección explícito, visible, nunca con una edición.
