/**
 * Registro del service worker (ver `public/sw.js`).
 *
 * Este fichero es una convención nativa de Next.js: cualquier cosa en `instrumentation-client.ts`
 * en la raíz del proyecto se agrega al paquete del cliente y corre sola, sin que ninguna pantalla
 * la importe. Es la pieza que hacía falta para que el service worker se registrara sin tocar
 * `app/layout.tsx` — ese fichero es de otra integración de este mismo reparto de trabajo, y esta
 * convención deja el registro fuera de su camino sin invadirlo.
 *
 * Sólo en producción: en desarrollo, `/_next/static/*` no lleva nombre con huella de contenido
 * de la misma manera —el paquete cambia con cada guardado del código fuente— y un service worker
 * que lo guarde de todos modos serviría JavaScript viejo mientras se está programando, que es
 * exactamente el tipo de error que cuesta una tarde entender.
 */
export function register(): void {
  if (process.env.NODE_ENV !== 'production') return;
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;

  // Después de `load`: registrar antes no acelera nada (el service worker no participa en la
  // carga que ya está en curso) y si el registro tarda, no compite por el mismo hilo que está
  // pintando la primera pantalla.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Sin service worker, la aplicación sigue funcionando igual con conexión: no es un fallo
      // que alguien necesite ver, es la ausencia de una mejora. No hay pantalla que avisarle.
    });
  });
}

register();
