# ADR-0042: Una entidad sin ánimo de lucro estudiantil es la Responsable del Tratamiento

- **Estado:** Propuesto
- **Fecha:** 2026-08-21
- **Contexto de origen:** `20-normativa-datos-colombia.md` §5 (escenarios A–D y recomendación estructurada); `21-normativa-udea.md` §4 (naturaleza jurídica de Koinonía).

## Contexto

Koinonía trata datos sensibles por su propia naturaleza —orientación política, art. 5 de la Ley 1581— y la sanción disponible para su tratamiento ilícito es el **cierre inmediato y definitivo de la operación** (art. 23 lit. d), además de multas «de carácter personal e institucional» de hasta 2.000 SMMLV. **El proyecto entero está bajo el régimen más severo de la ley.**

Quién sea el Responsable del Tratamiento no es una formalidad: determina la base de licitud disponible, quién responde con su patrimonio y quién controla los fines y medios de una plataforma cuyo propósito es, entre otros, ejercer contrapeso frente a la institución.

## Decisión

**Constituir una entidad sin ánimo de lucro (asociación) estudiantil** con objeto explícito de participación democrática y finalidad filosófica/política, y designarla formalmente en acta como **Responsable del Tratamiento**.

La razón jurídica principal es el **art. 6 lit. c** de la Ley 1581: el tratamiento de datos sensibles está permitido en las «actividades legítimas y con las debidas garantías por parte de una fundación, ONG, asociación o cualquier otro organismo sin ánimo de lucro cuya finalidad sea política, filosófica […] siempre que se refieran exclusivamente a sus miembros». **Koinonía es exactamente eso**, y ésta es la base de licitud más sólida disponible.

Medidas asociadas:

- Nombrar un **oficial de protección de datos** con correo público de contacto.
- Firmar **contratos de transmisión de datos** con cada Encargado (hosting, correo, almacenamiento).
- Mantener el vínculo con la Universidad como **convenio de colaboración**, nunca como subordinación jerárquica, para no desplazar la calidad de Responsable.
- **Infraestructura propia**, preferentemente en Colombia, contratada por la asociación: la independencia de la infraestructura es lo que hace creíble la independencia de la gobernanza.
- Aviso de no afiliación visible en el pie de toda página, y prohibición de usar escudo, logotipo, tipografía institucional o dominios que sugieran oficialidad.

Estado **Propuesto**: depende de trámites externos al equipo y de `VERIFICAR` pendientes sobre requisitos de constitución de ESAL.

## Alternativas consideradas

- **Escenario A — la UdeA como Responsable.** La institución adquiriría control sobre los fines y medios de una plataforma cuyo propósito es hacerle contrapeso: **riesgo de captura**. Además, el art. 6 lit. c **no** ampararía el tratamiento de sensibles, y la Universidad, como persona jurídica pública, quedaría obligada al RNBD y a la Ley 1712.
- **Escenario C — un estudiante persona natural.** El peor escenario: responde con su patrimonio hasta 2.000 SMMLV, y sin el art. 6 lit. c el tratamiento de sensibles cuelga únicamente de la autorización explícita, sin respaldo estructural.
- **Escenario D — colectivo de hecho.** Jurídicamente equivale a C, con responsabilidad personal y potencialmente solidaria de quienes deciden fines y medios.
- **Alojarse en infraestructura universitaria.** Datos en Colombia y costo cero, a cambio de ceder control efectivo: la Universidad puede suspender el servicio, acceder a los datos o ser vista como Responsable.

## Consecuencias

- Base de licitud sólida y estructural para tratar datos sensibles, no dependiente sólo del consentimiento.
- Se interpone una persona jurídica entre el proyecto y el patrimonio personal de quienes administran.
- Probablemente **no** obligada al RNBD, al no superar el umbral de 100.000 UVT del Decreto 090 de 2018.
- La independencia jurídica y la infraestructural se refuerzan mutuamente y hacen creíble la autonomía política.

## Consecuencias negativas aceptadas

- **Coste y trámite:** constitución, registro ante la Cámara de Comercio, contabilidad mínima, renovaciones y una junta que debe existir de verdad. Todo ello recae sobre estudiantes sin remuneración.
- **Continuidad:** una asociación cuyos miembros se gradúan cada pocos años necesita relevo formal en sus órganos, o queda acéfala con obligaciones legales vivas.
- La protección patrimonial que ofrece una ESAL frente a sanciones «de carácter personal» del art. 23 **no está confirmada**: es una de las preguntas abiertas para un abogado.
- La cláusula del propio art. 6 lit. c —«los datos no se podrán suministrar a terceros sin autorización del Titular»— **restringe la publicación externa** y refuerza que la raíz criptográfica publicada no pueda contener datos personales (ADR-0005, ADR-0007).
- Sin convenio con la Universidad, Koinonía no tiene acceso a datos institucionales y debe construir su padrón por sus propios medios (ADR-0012).
