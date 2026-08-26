# ADR-0055: El cupo anti-spam no se gasta con un reintento — la idempotencia también protege el contador

- **Estado:** Aceptado
- **Fecha:** 2026-08-26 (el fichero; la decisión estaba **aplicada desde antes** — ver «Nota sobre la fecha»)
- **Contexto de origen:** hueco de trazabilidad detectado el 2026-08-25 durante la reauditoría de `docs/OBJETIVO.md`. El número «ADR-0055» estaba citado en `services/api/migrations/0013_rate_consumption_idempotencia.sql:2`, en `services/api/src/http/rate-limit.ts` (cabecera de `consume` y de `requestIdDeCuerpo`), en `tests/integration/http-cupo-idempotencia-adr55.test.ts`, en `README.md` y en `docs/HANDOFF.md` — y **el fichero no existía**. Toca ADR-0028 (cupos anti-spam sin dirección de red) y T-12 de `docs/THREAT_MODEL.md`.

> **Nota sobre la fecha y el estado.** Esto no decide nada nuevo: describe una decisión que ya está en el código, en una migración aplicada y en tres pruebas de integración. Se escribe ahora porque un número de ADR citado sin fichero es peor que no citarlo — quien lea el código encuentra una referencia a una decisión que no puede leer, y no tiene forma de saber si el razonamiento existió y se perdió o si nunca existió. Es **Aceptado** porque el código lo aplica, no porque nadie lo haya ratificado después.
>
> Hubo además una colisión de número: otra sesión escribió un `0055-voto-secreto-verificable.md` sin saber que el 55 ya estaba reclamado por el código. Se renumeró a **ADR-0056** —era trabajo sin commitear, no una decisión publicada— y este fichero ocupa el hueco que le correspondía.

## Contexto

El proyecto limita cuántas cosas puede escribir una persona por ventana de tiempo: tres propuestas por semana, veinte aportes por día, una objeción por proceso. Es la mitigación de T-12 (saturación) y está deliberadamente construida **sin usar la dirección de red** —el sujeto del cupo es un correo o un `MemberId`, nunca una IP (`rate-limit.ts:130`)—, lo que es coherente con no tener direcciones en ninguna parte del sistema.

Por otro lado, toda escritura lleva un `requestId`: una clave de idempotencia que el cliente genera y reenvía tal cual si tiene que reintentar. Existe por un motivo concreto y no hipotético: **Daniela lee esto en el bus, con datos móviles**. Una petición que sale, llega, se escribe y cuya respuesta se pierde en el camino de vuelta es un caso normal, no un caso raro. El `requestId` hace que reenviarla no escriba dos veces.

### El defecto

Los dos mecanismos existían y no se hablaban. El cupo se consumía **antes** de que la idempotencia dijera nada, así que un reintento con el mismo `requestId`:

1. no creaba nada nuevo —para eso está la idempotencia—, pero
2. **gastaba una unidad de cupo igual**.

Tres cortes de red seguidos y alguien se quedaba sin sus tres propuestas de la semana sin haber publicado ninguna. Y el reparto de ese castigo es exactamente el peor posible: **lo paga quien peor conexión tiene**, que es quien más usa el mecanismo de reintento y, en una universidad pública, con toda probabilidad quien menos margen tiene para insistir. Un límite anti-spam que en la práctica filtra por calidad de conexión no está limitando el spam.

## Decisión

**El consumo de cupo se vuelve idempotente por `requestId`, con la misma clave que ya protege la escritura.**

`identity.rate_consumption` (migración `0013`) marca que un `(request_id, ambito, sujeto, window_start)` ya consumió. La primera petición inserta y consume; la segunda choca contra la restricción `UNIQUE` y **no consume**. Se hace con `INSERT … ON CONFLICT DO NOTHING RETURNING 1` y se decide por `rowCount`, no leyendo antes y escribiendo después: entre una lectura y una escritura hay un hueco por el que dos peticiones simultáneas pasan las dos, y el caso de dos peticiones simultáneas con el mismo `requestId` es justo el que produce un reintento impaciente.

Tres consecuencias que la decisión fija a propósito:

- **Dos peticiones con `requestId` distinto cuentan dos veces.** El cupo sigue siendo un cupo.
- **Dos con el mismo `requestId` cuentan una.** La segunda devuelve `usados: 0`, que le dice a la capa de arriba que fue un reintento y no un intento nuevo.
- **Una petición sin `requestId` cuenta normalmente.** No se abre un camino para eludir el cupo omitiendo la clave: quien no la manda, no gana nada.

El `requestId` se acepta sólo si tiene forma de UUID (`rate-limit.ts`). No es cosmética: sin esa comprobación, una clave arbitrariamente larga o repetida sería una llave para no consumir cupo nunca.

### Lo que se descartó

- **Devolver el cupo cuando la escritura falla.** Exige saber que falló, y el caso que importa es justamente aquél en el que el cliente **no** se enteró de nada. Además abre un camino nuevo: provocar fallos a propósito para recuperar cupo.
- **No cobrar cupo hasta después de escribir.** Invierte el orden y deja el contador detrás de la escritura, que es donde no protege: una ráfaga entra entera antes de que el primer cobro ocurra.
- **Confiar en que el cliente no reintenta.** Es pedirle a la parte menos fiable del sistema que sostenga la garantía.

## Consecuencias

- Un reintento honesto ya no cuesta. La promesa del `requestId` —«reenviar es seguro»— pasa a valer también para el cupo, que era la mitad donde no valía.
- Una tabla más que purgar, con la misma cadencia que `identity.rate_bucket`.
- La ventana entra en la clave (`window_start`): el mismo `requestId` en una ventana posterior vuelve a consumir. Es lo correcto —una clave de idempotencia no debería servir de salvoconducto indefinido— y conviene saberlo al leer la tabla.

## Consecuencias negativas aceptadas

- **La tabla guarda `request_id` en claro**, a diferencia de `rate_bucket`, cuya clave es `sha256(pimienta ‖ ámbito ‖ sujeto)` y es ruido vista sola. El `sujeto` sí va en claro en esta tabla. Es una asimetría real con ADR-0028 y se acepta porque la fila vive lo que vive la ventana de cupo y se purga con ella; queda anotada acá para que quien endurezca esto después sepa que no fue un descuido.

## Cómo se comprueba

`tests/integration/http-cupo-idempotencia-adr55.test.ts`, contra PostgreSQL real:

- un reintento con el mismo `requestId` no consume cupo extra, en una secuencia de cuatro pasos;
- el cupo real sigue siendo tres propuestas por semana después del arreglo — es decir, que no se arregló el reintento a costa de desactivar el límite;
- **dos peticiones simultáneas con el mismo `requestId` consumen una sola vez**, que es el caso que un `SELECT` previo al `INSERT` habría dejado pasar.
