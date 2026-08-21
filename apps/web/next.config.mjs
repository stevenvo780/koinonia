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
    ];
  },
};

export default config;
