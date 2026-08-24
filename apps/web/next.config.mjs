/**
 * Configuración de Next.js.
 *
 * Sin optimizador de imágenes: la interfaz no sirve ni un mapa de bits. Daniela lee esto en el bus,
 * con datos móviles, y cada kilobyte que no mandamos es un kilobyte que no le cobran.
 */

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
  // El proxy hacia la API vive en `app/api/[...ruta]/route.ts` y no aquí: hace falta reenviar la
  // cookie de sesión y traducir errores de red a una frase, y una reescritura no puede hacer eso.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'x-content-type-options', value: 'nosniff' },
          { key: 'referrer-policy', value: 'no-referrer' },
          // Sin cámara, sin micrófono, sin ubicación. No los pedimos y lo declaramos.
          {
            key: 'permissions-policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
        ],
      },
      {
        // El propio script del service worker (`public/sw.js`) es lo único de este árbol que no
        // puede quedar en la caché HTTP del navegador con la política por omisión de `public/`:
        // si un CDN o el navegador lo sirvieran «viejo» por un rato, la actualización del service
        // worker —y con ella, cualquier arreglo a lo que decide guardar— tardaría en llegar. El
        // navegador igual lo revisa por su cuenta cada tanto; esta cabecera sólo evita que un
        // intermediario le mienta con una copia de ayer antes de esa revisión.
        source: '/sw.js',
        headers: [
          { key: 'cache-control', value: 'no-cache' },
          // Sin esta cabecera un service worker servido desde `/sw.js` sólo podría controlar ese
          // mismo camino; con ella controla toda la aplicación, que es lo que exige poder
          // responder a la navegación de cualquier pantalla sin conexión.
          { key: 'service-worker-allowed', value: '/' },
        ],
      },
    ];
  },
};

export default config;
