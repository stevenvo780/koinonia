# ADR-0003: SHA-256 sobre BLAKE3, por disponibilidad en WebCrypto para verificación en cliente

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** decisión estructural del arquitecto; `30-decision-engine-spec.md` §A.1 (`Hash = SHA-256 hex minúscula`), §A.1.1 y §B.0.3; `11-privacidad-y-voto-secreto.md` §2.4.c (árbol de Merkle sobre las papeletas).

## Contexto

Toda la integridad de Koinonía descansa en una función de hash: el encadenamiento de eventos, el `rollHash` del padrón, el `configHash`, el árbol de Merkle del escrutinio, el `seedCommitment` del sorteo y el ancla externa. La elección no es de rendimiento —el volumen es ridículo a esta escala— sino de **quién puede verificar**.

BLAKE3 es más rápido, tiene mejores propiedades de paralelización y un árbol de Merkle nativo. Nada de eso importa aquí. Lo que importa es que la verificación independiente sea ejecutable por un estudiante con un navegador y sin instalar nada.

## Decisión

**SHA-256** como única función de hash del sistema, en hexadecimal minúscula de 64 caracteres.

La razón decisiva es `crypto.subtle.digest('SHA-256', ...)`: está en **WebCrypto**, disponible en todo navegador moderno sin dependencias, sin WASM, sin cadena de suministro que auditar. Un verificador independiente de Koinonía puede ser una página HTML estática de 200 líneas que cualquiera lee entera. Con BLAKE3 haría falta importar una biblioteca de terceros —y entonces el auditor tendría que confiar en esa biblioteca, que es justo lo que la verificación intenta evitar.

Argumento secundario: `sha256sum` está en cualquier Linux y macOS. Un auditor puede comprobar un ancla desde una terminal, sin programar.

## Alternativas consideradas

- **BLAKE3.** Más rápido y con árbol nativo, pero requiere WASM o binding nativo en el navegador. Rechazada: traslada al auditor el coste de confiar en una dependencia.
- **SHA-3 / Keccak.** Sin ventaja práctica aquí y con la misma penalización de disponibilidad que BLAKE3 en WebCrypto.
- **SHA-512/256.** Marginalmente más rápida en 64 bits y con resistencia a extensión de longitud; disponible en WebCrypto como `SHA-512` pero no truncada, lo que obligaría a truncar a mano y a explicar por qué. Complejidad sin beneficio.
- **Función configurable por despliegue.** Rechazada de plano: haría el hash del histórico dependiente de un parámetro, y dos instancias con configuración distinta producirían anclas incomparables.

## Consecuencias

- El verificador independiente es una página estática auditable de un vistazo.
- Se reutiliza el mismo primitivo en las seis funciones que lo necesitan; una sola cosa que aprender y una sola que romper.
- SHA-256 está sobradamente estudiada; su vida útil supera con holgura el horizonte del proyecto.

## Consecuencias negativas aceptadas

- Es más lenta que BLAKE3. Irrelevante con ~300 papeletas y decenas de miles de eventos, pero es una decisión que envejecerá mal si el volumen crece dos órdenes de magnitud.
- SHA-256 es vulnerable a extensión de longitud. No nos afecta porque siempre se hashea la salida de JCS sobre un objeto completo (ADR-0004) y nunca se usa `hash(secreto ‖ mensaje)` como MAC —donde se necesita autenticación se usa HMAC.
- Cambiar de función después exige subir `engineVersion`, conservar el escrutador anterior y mantener dos verificadores. Se acepta porque ese mecanismo ya existe (spec 30 §A.7).
