# ADR-0012: Autenticación por enlace mágico al correo institucional, con `IdentityProviderAdapter` como puerto

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** decisión estructural del arquitecto; `21-normativa-udea.md` §4.1 y §7. **Corrige** `01-decidim-loomio-polis.md` §1, que daba por existente un SSO institucional.

## Contexto

El documento 01 descartaba todo el subsistema de verificación censal de Decidim con el argumento de que «tenemos SSO institucional». **No lo tenemos.** Integrarse con el directorio de la UdeA (LDAP, SSO, OAuth) exige autorización formal de la Universidad y, peor, crea una relación técnica que puede argumentarse como **corresponsabilidad de tratamiento** —lo que destruiría la base de licitud del art. 6 lit. c de la Ley 1581, que es el pilar jurídico del proyecto (`20-normativa-datos-colombia.md` §5.2, escenario B).

Verificar por **dominio de correo**, en cambio, no requiere permiso de nadie: es equivalente a comprobar que alguien controla una dirección.

## Decisión

**Enlace mágico al correo `@udea.edu.co`** como único método de autenticación del MVP: el usuario introduce su correo institucional, recibe un enlace de un solo uso con vencimiento corto, y con eso acredita a la vez su identidad y su pertenencia al Instituto. No se pide documento de identidad ni contraseña.

Detrás de un puerto **`IdentityProviderAdapter`**, con una sola implementación (`magic-link-email`), de modo que un eventual convenio con la Universidad —o un cambio de dominio institucional— sea un adaptador nuevo y no una reescritura.

Dos reglas que vienen del análisis institucional:

- El correo institucional **no se usa como canal para material sensible** ni como único factor de recuperación: la Universidad lo administra y puede desactivarlo al graduarse o retirarse. Se ofrece un **correo alternativo del titular** como segundo factor de recuperación desde el MVP.
- **No se asumen APIs de la UdeA que no existen.** Ningún componente puede depender de consultar el sistema académico institucional. El padrón se construye con lo que la organización estudiantil puede verificar por sí misma.

## Alternativas consideradas

- **SSO/LDAP institucional.** Requiere autorización formal, introduce dependencia de disponibilidad de un sistema ajeno y genera el riesgo de corresponsabilidad. Recomendación explícita del doc 21: no hacerlo en el MVP.
- **Usuario y contraseña propios.** Añade gestión de credenciales, recuperación, fuga de hashes y fatiga de contraseñas, y **no acredita pertenencia al Instituto**, que es lo único que aquí interesa.
- **Verificación por documento de identidad** (los handlers de Decidim). Recolecta un identificador fuerte que el proyecto prefiere no tener nunca, y que tras ADR-0006 ya no hace falta para nada.
- **Carga manual de padrón por la secretaría.** Sigue haciendo falta como criterio de elegibilidad, pero no sirve como autenticación: no prueba que quien entra es quien dice.

## Consecuencias

- Cero dependencias de sistemas de la Universidad, y con ello se preserva la independencia estructural que hace creíble la independencia de la gobernanza.
- No se recolecta documento de identidad: menos superficie de riesgo, un dato sensible menos que custodiar y que borrar.
- El puerto deja abierta la puerta a un convenio futuro sin comprometerse hoy.
- Coherente con ADR-0006: el `MemberId` es aleatorio, así que la autenticación sólo tiene que resolver «esta persona controla este correo», no «este correo produce este identificador».

## Consecuencias negativas aceptadas

- **Quien controla el correo controla la cuenta.** La Universidad tiene capacidad técnica sobre el buzón institucional: en un escenario adversarial extremo podría suplantar a un miembro. Se mitiga con el correo alternativo y con la visibilidad de todo acto en el ledger; no se elimina.
- El enlace mágico depende de la entrega de correo: un filtro antispam agresivo deja gente fuera el día de la votación. Hace falta monitorizar entregabilidad y ofrecer un canal de respaldo.
- Un correo institucional desactivado al graduarse deja a esa persona sin acceso a su propio histórico. El correo alternativo lo mitiga sólo si se registró antes.
- La cuenta es tan segura como el buzón: sin segundo factor real, un buzón comprometido es una identidad comprometida.
