// ========================================================================
// Caja roja — copia de la página en la tablet (service worker).
//
// Pedido por Julio (23/11/2026): que Caja roja abra aunque se recargue sin
// señal. Este archivo lo registra js/caja_roja/app.js con alcance
// '/caja_roja', así que SOLO actúa sobre la página de Caja roja; los demás
// módulos de la app no pasan por aquí.
//
// Qué guarda: la página, sus estilos, scripts, fuentes, iconos y logos (la
// lista de abajo). NO guarda datos: el maestro de referencias y los
// registros pendientes ya los guarda app.js en la tablet, y las llamadas a
// /api/... siempre van directo al servidor.
//
// Cómo responde: primero intenta traer el archivo del servidor (así las
// actualizaciones llegan apenas hay señal) y lo guarda; si no hay red, o el
// servidor tarda más de 4 segundos (señal mala), entrega la copia guardada.
//
// Si se agrega un archivo nuevo a Caja roja (otro .css/.js/imagen), hay que
// sumarlo a ARCHIVOS y subir VERSION (caja-roja-v2, v3...).
// ========================================================================

const VERSION = 'caja-roja-v1';
const ESPERA_RED_MS = 4000;

const ARCHIVOS = [
  '/caja_roja.html',
  '/css/comun.css',
  '/css/caja_roja.css',
  '/js/comun.js',
  '/js/caja_roja/app.js',
  '/favicon.png',
  '/fonts/rubik/rubik.css',
  '/fonts/rubik/rubik-latin-wght-normal.woff2',
  '/fonts/rubik/rubik-latin-ext-wght-normal.woff2',
  '/fonts/rubik/rubik-latin-wght-italic.woff2',
  '/fonts/rubik/rubik-latin-ext-wght-italic.woff2',
  '/css/vendor/fontawesome/css/all.min.css',
  '/css/vendor/fontawesome/webfonts/fa-solid-900.woff2',
  '/css/vendor/fontawesome/webfonts/fa-regular-400.woff2',
  '/css/vendor/fontawesome/webfonts/fa-brands-400.woff2',
  '/marca/logo-vertical.png',
  '/marca/logo-horizontal-ng.png',
  '/marca/logo-horizontal.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      // Uno por uno: si un archivo falla, los demás igual quedan guardados.
      .then((cache) => Promise.all(ARCHIVOS.map((url) =>
        cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(
        claves.filter((c) => c.startsWith('caja-roja-') && c !== VERSION).map((c) => caches.delete(c))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!ARCHIVOS.includes(url.pathname)) return; // /api/... y todo lo demás: normal
  event.respondWith(redPrimero(req, url.pathname));
});

function conLimite(promesa, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('sin respuesta del servidor')), ms);
    promesa.then((r) => { clearTimeout(t); resolve(r); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function redPrimero(req, clave) {
  const cache = await caches.open(VERSION);
  try {
    const resp = await conLimite(fetch(req), ESPERA_RED_MS);
    if (resp && resp.ok) {
      cache.put(clave, resp.clone()).catch(() => {});
      return resp;
    }
    // El servidor respondió con error (404/500): mejor la copia, si hay.
    return (await cache.match(clave)) || resp;
  } catch (e) {
    const guardada = await cache.match(clave);
    if (guardada) return guardada;
    throw e;
  }
}
