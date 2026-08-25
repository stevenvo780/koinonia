import { type NextRequest, NextResponse } from 'next/server';

/**
 * La política de contenido, con un número de un solo uso por respuesta.
 *
 * ═══ Qué había antes y por qué no servía ═══
 *
 * La política vivía en el proxy (`infra/produccion/Caddyfile.fragmento-registro-y-cabeceras`) y en
 * modo **de sólo informe**: no bloqueaba nada. Estaba puesta así a propósito y documentado —«apps/web
 * no genera el número de un solo uso»— pero el resultado medido era el peor de los dos mundos: una
 * prueba de humo contra producción contó **nueve violaciones en cada carga**, todas registradas y
 * ninguna bloqueada. Una política que se incumple en cada visita no protege de nada, y encima no se
 * podía pasar a obligatoria sin dejar la aplicación en blanco.
 *
 * El número de un solo uso es lo que faltaba. Next.js, cuando encuentra uno en la cabecera de la
 * petición, se lo pone a **todos** los guiones que emite —los suyos incluidos, que son los que
 * disparaban las violaciones—. Así la política puede ser obligatoria sin `unsafe-inline`, que es
 * justamente la palabra que la volvería decorativa.
 *
 * ═══ Lo que cuesta ═══
 *
 * Un número distinto por respuesta significa que ninguna respuesta se puede reutilizar tal cual, así
 * que las pantallas dejan de servirse desde lo prehorneado y se arman en cada visita. Es el precio
 * de que la política sea real. Los ficheros de `/_next/static/` —que son casi todo el peso— quedan
 * fuera del filtro y se siguen sirviendo como antes, que es lo que le importa a quien lee esto en el
 * bus con datos móviles.
 *
 * ═══ Detalles que costaron una corrida ═══
 *
 * Esto corre en el entorno de borde de Next.js, no en Node: `Buffer` no existe ahí. Usarlo no falla
 * al compilar — falla al arrancar, con un `EvalError: Code generation from strings disallowed`
 * críptico y un 500 en TODAS las rutas. De ahí `crypto.getRandomValues` y `btoa`, que sí son del
 * entorno de borde.
 */
export function middleware(request: NextRequest): NextResponse {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const nonce = btoa(String.fromCharCode(...bytes));

  const politica = [
    "default-src 'none'",
    // `strict-dynamic` es lo que permite que los guiones que Next carga desde los suyos hereden el
    // permiso sin tener que enumerarlos: sin esto habría que ir listando cada trozo del paquete.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    // ── La única concesión, y está medida ──────────────────────────────────────────────────────
    // Un número de un solo uso vale para un `<style>`, pero **no** para un atributo `style="…"`, y
    // la interfaz tiene 72 repartidos por las pantallas (casi todos separaciones y rejillas que
    // deberían ser clases, más los anchos de las tarjetas de relleno, que sí son variables). Con
    // `style-src 'self'` a secas se contaron 54 violaciones en cinco pantallas.
    //
    // La distancia entre las dos concesiones no es de grado: `unsafe-inline` en guiones deja
    // ejecutar código, y es exactamente lo que esta política existe para impedir; en estilos deja
    // pintar. Se cede en lo segundo para poder ser estricto en lo primero, en vez de dejar la
    // política entera en modo de sólo informe —que es como estaba, incumplida en cada carga—.
    // Para cerrarla del todo hay que convertir esos 72 atributos en clases; queda anotado en
    // docs/OBJETIVO.md, no escondido acá.
    // Sin número en esta línea, y no es un olvido: la especificación dice que **un número anula
    // `unsafe-inline`**, así que poner los dos deja la concesión sin efecto y las 54 violaciones
    // intactas (el navegador lo avisa: «unsafe-inline is ignored if a hash or nonce is present»).
    // Tampoco hace falta: la hoja viaja como fichero enlazado y la interfaz no emite ni un
    // `<style>` — se contaron cero en el HTML servido.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    // La interfaz sólo habla con su propio origen: el proxy hacia la API vive en `app/api/[...ruta]`.
    "connect-src 'self'",
    "font-src 'self'",
    "form-action 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; ');

  const deLaPeticion = new Headers(request.headers);
  // Es esta cabecera, y no la de la respuesta, la que Next.js lee para sellar sus guiones.
  deLaPeticion.set('x-nonce', nonce);
  deLaPeticion.set('content-security-policy', politica);

  const respuesta = NextResponse.next({ request: { headers: deLaPeticion } });
  respuesta.headers.set('content-security-policy', politica);
  return respuesta;
}

export const config = {
  matcher: [
    {
      // Fuera lo estático con huella en el nombre: no lleva guiones en línea, no necesita número, y
      // dejarlo pasar por acá le costaría a cada visita el trabajo de armar una cabecera que no usa.
      source: '/((?!_next/static|_next/image|icono.svg|manifest.webmanifest|sw.js).*)',
    },
  ],
};
