/**
 * La capa de componentes que faltaba.
 *
 * `Aviso`, en `marco.tsx`, era el único primitivo real: todo lo demás lo escribía cada pantalla a
 * mano, y ocho pantallas lo hacían con un `<div>` distinto cada vez. Eso no es una biblioteca
 * genérica —no hay un `<Boton>` ni un `<Campo>` acá, que ya viven bien como clases sueltas—, son
 * las siete piezas concretas que el índice y el detalle de esta plataforma necesitan, y cada una
 * impone la forma correcta para que la pantalla que la usa no tenga que escribir una clase CSS a
 * mano ni decidir de nuevo un nivel de encabezado.
 *
 * No lleva `'use client'`: ninguna pieza usa estado ni efectos, así que puede vivir tanto en una
 * pantalla de cliente (como casi todas hoy) como en un futuro componente de servidor sin arrastrar
 * un límite de cliente que no hace falta.
 */

import Link from 'next/link';
import { Children, type ReactNode } from 'react';

import { Cargando } from './marco';
import { plazo } from '../lib/api';

/**
 * El ítem de un índice.
 *
 * Impone `h3` siempre. Doce sitios ya escriben `h3` a mano dentro de una `<section
 * aria-labelledby>` con su propio `h2` —ahí el título de cada tarjeta es la siguiente parada de la
 * jerarquía, y es el caso que se repite más—, pero otros cuatro (`/problemas`, `/deliberaciones`,
 * `/iniciativas`, `/circulos`) ponen hoy `<ul className="tarjetas">` DIRECTO bajo el `h1`, sin
 * `<section>` intermedia, y ahí escriben `h2` porque hoy sí es el nivel que toca sin saltarse uno.
 * Adoptar `<Tarjeta>` en esos cuatro exige envolver el listado en una `<section
 * aria-labelledby="…">` con su propio `<h2>` —p. ej. «Problemas abiertos»— para no convertir «h1 →
 * h2» en «h1 → h3» con un nivel saltado: no es un cambio cosmético, es lo que hace que imponer `h3`
 * siga siendo correcto también ahí.
 *
 * Uso: `<Tarjeta titulo={p.titulo} enlace={`/problemas/${p.id}`}><Meta>…</Meta></Tarjeta>`, como
 * hijo directo de `<ul className="tarjetas">` (o `<ol className="tarjetas">` si el orden importa).
 */
export function Tarjeta({
  titulo,
  enlace,
  children,
}: {
  readonly titulo: ReactNode;
  readonly enlace: string;
  readonly children?: ReactNode;
}): ReactNode {
  return (
    <li>
      <h3>
        <Link href={enlace}>{titulo}</Link>
      </h3>
      {children}
    </li>
  );
}

/** Las cinco variantes de `<Ficha>`. `en-curso` es la única que no es un semáforo de resultado. */
export type VarianteFicha = 'neutra' | 'bien' | 'mal' | 'atencion' | 'en-curso';

const SIMBOLO_FICHA: Readonly<Record<VarianteFicha, string>> = {
  neutra: '·',
  bien: '✓',
  mal: '✕',
  atencion: '!',
  'en-curso': '▸',
};

/**
 * La ficha de estado: «En deliberación», «Cerrada», «Te toca». Símbolo y palabra van siempre
 * juntos —el símbolo en un `<span aria-hidden>`, la palabra como texto de verdad—, así que ningún
 * estado depende sólo del color que trae la variante.
 *
 * El símbolo NO lleva un espacio de texto pegado («▸ »): `.ficha` es `display: inline-flex`, así
 * que ese `<span>` se vuelve un ítem de la fila —y por ser un ítem, no un texto suelto en medio de
 * un párrafo, el navegador lo trata como su propia línea y le recorta el espacio en blanco que
 * queda al final de ella. El resultado, medido, era «▸Recogiendo evidencia» pegado. El espacio lo
 * pone `.ficha` con `gap` (ver `globals.css`), que no depende de que sobreviva un carácter invisible
 * en medio del JSX.
 *
 * Uso: `<Ficha variante="en-curso">En deliberación</Ficha>`.
 *
 * La palabra va en su propio `<span>`, no suelta junto al del símbolo: sin ese borde, el texto
 * completo de la ficha es «✓Completada» —símbolo y palabra pegados, un único nodo de texto— y nada
 * en la página tiene *exactamente* «Completada» como contenido, que es precisamente lo que necesita
 * distinguir «la tarea quedó completada» de cualquier frase más larga que también contenga la
 * palabra. El `<span>` es anónimo para el diseño —mismo ítem de `inline-flex` que ya era el texto
 * suelto, mismo `gap`— y sólo le da un borde a la palabra para quien necesita señalarla con
 * precisión, sea una prueba o el navegador buscando en la página.
 */
export function Ficha({
  variante,
  children,
}: {
  readonly variante: VarianteFicha;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <span className={`ficha ${variante}`}>
      <span aria-hidden="true">{SIMBOLO_FICHA[variante]}</span>
      <span>{children}</span>
    </span>
  );
}

/**
 * La fila de metadatos: hoy se escribía a mano como `<p className="suave">{a} · {b}</p>`, con el
 * punto tecleado entre medias y ningún cuidado por dónde envuelve la línea en el teléfono. Acá cada
 * trozo es su propio elemento y el separador es un `::before` que viaja pegado al trozo que sigue
 * (ver `.meta-trozo` en `globals.css`), así que nunca queda un punto solo cerrando una línea.
 *
 * Uso: `<Meta>{plazo(d.cierraEn)}{`se manifestaron ${d.seManifestaron} de ${d.podianDecidir}`}</Meta>`.
 * Cada expresión entre llaves es un trozo distinto; con uno solo también funciona.
 */
export function Meta({ children }: { readonly children: ReactNode }): ReactNode {
  const trozos = Children.toArray(children);
  return (
    <p className="meta">
      {trozos.map((trozo, indice) => (
        // Índice como clave: los trozos son estáticos por render, no se reordenan ni se quitan.
        <span className="meta-trozo" key={indice}>
          {trozo}
        </span>
      ))}
    </p>
  );
}

type FranjaPlazo = {
  readonly valor: number;
  readonly unidad: string;
  readonly futuro: boolean;
  readonly escala: 'dias' | 'horas' | 'minutos';
};

/**
 * Repite el cálculo de `plazo()` (`lib/api.ts`) en vez de trocear su frase con una expresión
 * regular. El número que se dibuja grande tiene que salir del mismo cálculo, con las mismas
 * unidades, que la frase que lee un lector de pantalla; parsear texto ya redactado se rompe el día
 * que cambia la redacción, sin que ningún tipo avise.
 */
function franjaDe(ms: number, ahora: number): FranjaPlazo {
  const delta = ms - ahora;
  const futuro = delta >= 0;
  const abs = Math.abs(delta);
  const dias = Math.floor(abs / 86_400_000);
  const horas = Math.floor((abs % 86_400_000) / 3_600_000);
  const minutos = Math.floor((abs % 3_600_000) / 60_000);
  if (dias > 0) return { valor: dias, unidad: dias === 1 ? 'día' : 'días', futuro, escala: 'dias' };
  if (horas > 0) {
    return { valor: horas, unidad: horas === 1 ? 'hora' : 'horas', futuro, escala: 'horas' };
  }
  return {
    valor: minutos,
    unidad: minutos === 1 ? 'minuto' : 'minutos',
    futuro,
    escala: 'minutos',
  };
}

/**
 * El plazo como elemento gráfico: el número grande y la unidad debajo, no una frase corrida que
 * hay que leer entera para saber si urge. Cambia de tono a `atención` cuando falta menos de un
 * día —el color nunca es la única señal: el número ya pasó a decir «horas» o «minutos» en vez de
 * «días», así que el cambio de tono siempre viene acompañado de esa lectura—. La frase completa
 * («Cierra en 3 días») se sigue diciendo entera, pero sólo para quien usa lector de pantalla.
 *
 * ═══ El «atrás», que faltaba ═══
 *
 * Un plazo vencido y uno por vencer se dibujaban **idénticos**: los dos decían «3 DÍAS» y la única
 * diferencia era el color de la cifra (`.plazo.cerrado` la baja a tinta suave). Quien no distingue
 * ese matiz —o mira la pantalla al sol, o la tiene en escala de grises— leía «3 días» y no tenía
 * cómo saber si le quedan tres días o si se le pasaron hace tres. Es exactamente lo que prohíbe
 * WCAG 1.4.1, y en la pieza que decide si alguien llega a tiempo a votar.
 *
 * El arreglo es una palabra en la línea de la unidad —«3 / DÍAS ATRÁS»—, no un símbolo: un plazo
 * que venció no es ni un acierto ni un error, y cualquier ✓ o ✕ ahí estaría diciendo algo que no
 * pasó. El texto para lector de pantalla no cambia: ya decía «Cerró hace 3 días», que es la frase
 * completa, y ahora los dos sentidos cuentan lo mismo.
 *
 * `ahora` es un parámetro y no `Date.now()` interno para que quien ya calculó «ahora» una vez por
 * pantalla (para no desincronizar varios `<Plazo>` entre sí) pueda pasarlo.
 *
 * Uso: `<Plazo ms={decision.cierraEn} />`.
 */
export function Plazo({
  ms,
  ahora = Date.now(),
}: {
  readonly ms: number;
  readonly ahora?: number;
}): ReactNode {
  const franja = franjaDe(ms, ahora);
  const tono = !franja.futuro ? 'cerrado' : franja.escala === 'dias' ? undefined : 'urgente';
  return (
    <p className={tono === undefined ? 'plazo' : `plazo ${tono}`}>
      <span aria-hidden="true">
        <span className="plazo-numero">{franja.valor}</span>{' '}
        <span className="plazo-unidad">
          {franja.unidad}
          {franja.futuro ? '' : ' atrás'}
        </span>
      </span>
      <span className="solo-lectores">{plazo(ms, ahora)}</span>
    </p>
  );
}

/**
 * El estado vacío. PRODUCT.md §4 exige título, explicación y UNA salida; antes había cuatro cajas
 * distintas y ninguna se comprometía con esa forma —algunas sin título, alguna con dos enlaces
 * donde debía haber uno—. Acá `salida` es un solo enlace: si la pantalla que la usa tenía dos,
 * tiene que elegir cuál es el que realmente hace falta, que es justo la disciplina que pedía
 * PRODUCT.md.
 *
 * `role="status"` porque un estado vacío es información, no una alarma: se anuncia sin interrumpir.
 *
 * Uso:
 * ```
 * <Vacio titulo="No hay ninguna decisión abierta" salida={{ href: '/problemas', texto: 'Ver los problemas' }}>
 *   <p>Así debe ser la mayoría del tiempo.</p>
 * </Vacio>
 * ```
 */
export function Vacio({
  titulo,
  salida,
  children,
}: {
  readonly titulo: string;
  readonly salida: { readonly href: string; readonly texto: string };
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="vacio" role="status">
      <h3>{titulo}</h3>
      {children}
      <p>
        <Link className="boton secundario" href={salida.href}>
          {salida.texto}
        </Link>
      </p>
    </div>
  );
}

/**
 * La forma y la altura de la tarjeta real mientras carga. Comparte la clase `.tarjetas` a
 * propósito —no una imitación aproximada, la MISMA regla de borde, radio y relleno que usa
 * `<Tarjeta>`—, así que cuando la API contesta el contenido no salta ni empuja la página.
 *
 * Sigue anunciándose igual que `Cargando` (de `marco.tsx`) porque es literalmente ese componente,
 * puesto donde un lector de pantalla lo encuentra pero fuera de la vista: el esqueleto visual es
 * `aria-hidden`, y el anuncio de verdad es el `<Cargando>` envuelto en `.solo-lectores`. No son dos
 * mecanismos de aviso compitiendo, es uno solo con una presentación distinta para cada sentido.
 *
 * Uso: `{problemas === undefined ? <Esqueleto que="los problemas" /> : <ul className="tarjetas">…}`.
 */
export function Esqueleto({
  que,
  cuantos = 3,
}: {
  readonly que: string;
  readonly cuantos?: number;
}): ReactNode {
  return (
    <>
      <ul className="tarjetas esqueleto" aria-hidden="true">
        {Array.from({ length: cuantos }, (_valor, indice) => (
          // Sin identidad propia: son placeholders, el índice alcanza como clave.
          <li key={indice}>
            <div className="esqueleto-linea esqueleto-titulo" />
            {/* La píldora imita la forma de `<Ficha>»: casi toda tarjeta real trae una debajo del
                título, y sin ella el placeholder se veía más corto y más angosto que la tarjeta
                que reemplaza. */}
            <div className="esqueleto-linea esqueleto-pildora" />
            <div className="esqueleto-linea" />
          </li>
        ))}
      </ul>
      <div className="solo-lectores">
        <Cargando que={que} />
      </div>
    </>
  );
}

/**
 * Una barra de participación accesible: «se manifestaron 8 de 12», «faltan 3 para la participación
 * mínima». No existía ni una sola en las 23 pantallas; el número siempre está en texto además de en
 * la barra, así que no depende de leer un ancho en píxeles.
 *
 * Cuidado con lo que mide: es la participación de una decisión colectiva —cuántas de las personas
 * que podían decidir ya se manifestaron—, nunca la actividad de una persona. ADR-0040 prohíbe esa
 * segunda cosa incluso como adorno visual: `total` es siempre «cuántas personas podían», nunca «de
 * cuántas cosas hizo una persona», y quien llame a este componente con lo segundo lo está usando
 * mal aunque el tipo se lo permita.
 *
 * Uso: `<Medidor etiqueta="Se manifestaron" valor={8} total={12} />`, o con la segunda frase del
 * encargo: `<Medidor etiqueta="Participación" valor={9} total={12} descripcion="faltan 3 para la participación mínima" />`.
 */
export function Medidor({
  etiqueta,
  valor,
  total,
  descripcion,
}: {
  readonly etiqueta: string;
  readonly valor: number;
  readonly total: number;
  readonly descripcion?: string;
}): ReactNode {
  const porcentaje = total > 0 ? Math.min(100, Math.round((valor / total) * 100)) : 0;
  return (
    <div className="medidor">
      <p className="medidor-cifra">
        {etiqueta}:{' '}
        <strong>
          {valor} de {total}
        </strong>
        {descripcion !== undefined && <> — {descripcion}</>}
      </p>
      <div
        className="medidor-barra"
        role="progressbar"
        aria-label={etiqueta}
        aria-valuenow={valor}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuetext={`${String(valor)} de ${String(total)}`}
      >
        <div className="medidor-relleno" style={{ width: `${String(porcentaje)}%` }} />
      </div>
    </div>
  );
}
