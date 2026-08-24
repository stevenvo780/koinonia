/**
 * Service worker de Koinonía.
 *
 * ═══ Qué se guarda y qué no, y por qué ═══
 *
 * Esto es una plataforma de gobernanza: ver un dato viejo puede hacerle creer a alguien que una
 * votación sigue abierta cuando ya cerró, o que nadie objetó cuando sí lo hizo. Por eso la regla
 * acá es estricta y de una sola dirección:
 *
 *   - `/api/*` — **nunca se toca**. Ni se guarda una respuesta ni se sirve una guardada. Cada
 *     pedido a la API sigue yendo a la red, y si la red no está, falla como fallaría sin este
 *     fichero: la pantalla ya sabe decir «no pudimos hablar con el servidor» (ver `lib/api.ts`).
 *     Esto cubre también cualquier escritura (votar, comentar, abrir una decisión): sólo se
 *     intercepta `GET`, así que un `POST` sin conexión falla limpio, nunca finge un éxito.
 *   - La cáscara de la aplicación (el HTML de una pantalla ya visitada, `manifest.webmanifest`,
 *     el ícono) se guarda con **la red primero**: si hay conexión, siempre gana la versión nueva.
 *     Sólo se recurre a la guardada cuando la red de plano falla, y en ese caso la pantalla lo
 *     dice —ver `bannerSinConexion` más abajo— con la fecha de cuándo se guardó.
 *   - Los ficheros de `/_next/static/` sí van primero a lo guardado, sin preguntar: llevan un
 *     nombre con huella de su contenido (lo pone Next al construir), así que dos versiones
 *     distintas nunca comparten nombre y no hay forma de que lo guardado quede desactualizado.
 *
 * ═══ Lo que este fichero NO intenta hacer ═══
 *
 * No cachea las navegaciones internas de React (los pedidos que dispara `next/link` al cambiar
 * de pantalla sin recargar): esos no traen `mode: 'navigate'`, llevan un protocolo interno de
 * Next que puede cambiar de versión a versión, y no vale la pena perseguirlo para guardar la
 * cáscara dos veces. Quien está sin conexión y toca un enlace ve el error que React ya sabe
 * mostrar; quien **recarga** la pantalla (el caso real de abrir la aplicación de nuevo en el bus)
 * sí la recibe guardada, con su aviso.
 */

/* global self, caches, fetch, Response, Headers, URL */
// Esto corre en el ámbito global de un service worker, no en el de una página ni en el de Node:
// `self`, `caches`, `fetch`, `Response`, `Headers` y `URL` son globales reales de esa plataforma
// (no un descuido ni un invento), y como el fichero queda fuera del proyecto de TypeScript
// (público, sin compilar), ESLint no trae consigo el conjunto de globales del navegador para
// avisarle de esto por su cuenta.

const VERSION = 'koinonia-sw-3';
const CACHE_CASCARA = `${VERSION}-cascara`;
const CACHE_ESTATICOS = `${VERSION}-estaticos`;
const CABECERA_GUARDADO = 'x-koinonia-guardado-el';

/** Lo mínimo para que la aplicación abra sin red la primera vez que el service worker corre. */
const PRECARGA = ['/', '/manifest.webmanifest', '/icono.svg', '/offline.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_CASCARA);
      // Una por una y no `cache.addAll`: `addAll` aborta el precargado entero si una sola pieza
      // falla, y en una instalación sin red (posible: el navegador puede instalar el service
      // worker antes de que la primera pantalla termine de cargar) preferimos guardar las que sí
      // se pudieron a no guardar ninguna.
      await Promise.all(
        PRECARGA.map(async (ruta) => {
          try {
            const respuesta = await fetch(ruta, { cache: 'no-store' });
            if (respuesta.ok) await cache.put(ruta, marcarGuardado(respuesta));
          } catch {
            // Sin red en la instalación: se completa la próxima vez que alguien navegue con
            // conexión, vía la ruta de «la red primero» de más abajo.
          }
        }),
      );
      // No esperar al recargo de pestaña para tomar control: quien instala este service worker
      // por primera vez ya está mirando una pantalla, y sin esto el aviso de guardado nunca
      // llegaría a tiempo de servirle nada la próxima vez que pierda la señal en esa misma visita.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const nombres = await caches.keys();
      await Promise.all(
        nombres
          .filter(
            (nombre) =>
              nombre.startsWith('koinonia-sw-') &&
              nombre !== CACHE_CASCARA &&
              nombre !== CACHE_ESTATICOS,
          )
          .map((nombre) => caches.delete(nombre)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Copia una respuesta agregándole la fecha en que se está guardando, para poder decirla después. */
function marcarGuardado(respuesta) {
  const cabeceras = new Headers(respuesta.headers);
  cabeceras.set(CABECERA_GUARDADO, new Date().toISOString());
  return new Response(respuesta.body, {
    status: respuesta.status,
    statusText: respuesta.statusText,
    headers: cabeceras,
  });
}

/**
 * El aviso que se cose arriba de una pantalla guardada cuando no hay con qué pedir la nueva.
 *
 * Va en HTML crudo con estilo en línea a propósito: no depende de ninguna clase de
 * `globals.css`, así que sigue viéndose bien aunque ese fichero cambie de nombre de clase mañana.
 * Los colores son los mismos números que usa el resto de la aplicación para «atención»
 * (`--aviso-fondo`, `--atencion-borde`, `--atencion` en `globals.css`), copiados a mano porque un
 * service worker no puede leer una variable CSS de una hoja que todavía no llegó.
 */
function bannerSinConexion(guardadoIso) {
  const fecha = guardadoIso === null ? 'una visita anterior' : formatearFecha(guardadoIso);
  return (
    '<div role="status" style="position:sticky;top:0;z-index:2147483647;' +
    'background:#fbe9d0;color:#5c3d05;border-bottom:3px solid #b56a00;' +
    "padding:0.75rem 1rem;font:600 0.95rem/1.4 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;" +
    '">' +
    '⚠ Sin conexión: esto es la pantalla guardada de ' +
    escaparHtml(fecha) +
    ', no lo que hay ahora mismo. Ningún dato de una votación o una conversación se guarda para ' +
    'verse sin conexión — sólo esta cáscara. Volvé a cargar cuando tengas señal.' +
    '</div>'
  );
}

function formatearFecha(iso) {
  try {
    return new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return 'una visita anterior';
  }
}

function escaparHtml(texto) {
  return texto.replace(/[&<>"']/gu, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

/**
 * Inserta el aviso justo después de que abre `<body ...>` — y le quita los `<script>` al
 * documento antes de devolverlo.
 *
 * Lo segundo no es prudencia de más: es lo que hace que lo primero funcione. React hidrata todo
 * el documento (`hydrateRoot(document, ...)`, propio del App Router), y al hacerlo compara cada
 * hijo de `<body>` contra lo que esperaba renderizar; el `<div>` del aviso no está en esa lista,
 * así que React lo **borra** en cuanto termina de cargar el primer script — se probó insertando
 * el aviso sin tocar los scripts y desaparecía de la pantalla en cuanto la aplicación arrancaba,
 * silenciosamente, sin que nadie lo notara. Sin los scripts no hay quién hidrate, así que no hay
 * quién lo borre: la pantalla queda congelada tal como se guardó, con el aviso encima y para
 * siempre — que es exactamente lo correcto para una copia sin conexión, donde de todos modos
 * ningún `fetch` a `/api/*` iba a completarse.
 */
async function conAviso(respuestaCache) {
  const guardadoIso = respuestaCache.headers.get(CABECERA_GUARDADO);
  const html = (await respuestaCache.clone().text()).replace(
    /<script\b[^>]*>[\s\S]*?<\/script>/giu,
    '',
  );
  const inicioEtiqueta = html.indexOf('<body');
  const cierreEtiqueta = inicioEtiqueta === -1 ? -1 : html.indexOf('>', inicioEtiqueta);
  const marcado =
    cierreEtiqueta === -1
      ? bannerSinConexion(guardadoIso) + html
      : html.slice(0, cierreEtiqueta + 1) +
        bannerSinConexion(guardadoIso) +
        html.slice(cierreEtiqueta + 1);
  return new Response(marcado, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** `/_next/static/*`: nombre con huella de contenido, así que lo guardado nunca envejece. */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_ESTATICOS);
  const enCache = await cache.match(request);
  if (enCache) return enCache;
  const respuesta = await fetch(request);
  if (respuesta.ok) await cache.put(request, respuesta.clone());
  return respuesta;
}

/** El manifiesto y el ícono: la red primero, y si falla, lo último que se guardó. */
async function networkFirst(request) {
  const cache = await caches.open(CACHE_CASCARA);
  try {
    const respuesta = await fetch(request, { cache: 'no-store' });
    if (!respuesta.ok) return respuesta;
    const marcada = marcarGuardado(respuesta);
    await cache.put(request, marcada.clone());
    return marcada;
  } catch (error) {
    const enCache = await cache.match(request);
    if (enCache !== undefined) return enCache;
    throw error;
  }
}

/** Una pantalla completa (recargar, abrir un enlace guardado, escribir la dirección a mano). */
async function manejarNavegacion(request) {
  const cache = await caches.open(CACHE_CASCARA);
  try {
    const respuesta = await fetch(request, { cache: 'no-store' });
    if (!respuesta.ok) return respuesta;
    const marcada = marcarGuardado(respuesta);
    await cache.put(request, marcada.clone());
    return marcada; // llegó de la red: se sirve tal cual, sin aviso — es lo real.
  } catch {
    const enCache = await cache.match(request);
    if (enCache !== undefined) return conAviso(enCache);
    const generico = await cache.match('/offline.html');
    if (generico !== undefined) return generico;
    return new Response('Sin conexión, y esta pantalla nunca se guardó en este teléfono.', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Sólo `GET`: una escritura sin conexión tiene que fallar, nunca fingir que se guardó.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // La API decide su propia política de red (`cache: 'no-store'`, ver `lib/api.ts`): este
  // service worker no se mete en el camino, ni para bien ni para mal.
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(manejarNavegacion(request));
    return;
  }

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (
    url.pathname === '/manifest.webmanifest' ||
    url.pathname === '/icono.svg' ||
    url.pathname === '/offline.html'
  ) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Cualquier otra cosa (una imagen que no existe hoy, un recurso nuevo de un futuro despliegue)
  // se deja pasar sin opinar: mejor no interceptar que interceptar mal.
});
