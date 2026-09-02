/* SPACMAN · service worker
   Cambiá VERSION en cada deploy: el navegador solo actualiza si este archivo
   cambia byte a byte. */
const VERSION = '1.5.1';
const CACHE = 'spacman-' + VERSION;

/* Solo archivos propios. Nada de CDNs acá: si una sola URL falla,
   addAll aborta el install entero y el SW nuevo nunca llega a instalarse. */
const CORE = ['./', './index.html', './manifest.json', './icon-512.png'];

const ALIVE = new Set();

self.addEventListener('install', e => {
    e.waitUntil((async () => {
        const c = await caches.open(CACHE);
        /* uno por uno y tolerante a fallos: un 404 no debe romper el install */
        for (const u of CORE) { try { await c.add(u); } catch (err) {} }
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', e => {
    e.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
        await self.clients.claim();

        /* Avisar a las pestañas abiertas que hay versión nueva. */
        let wins = await self.clients.matchAll({ type: 'window' });
        wins.forEach(c => c.postMessage({ type: 'sw-updated', version: VERSION }));

        /* Las páginas de versiones viejas no escuchan ese mensaje y se
           quedarían con el HTML anterior hasta la próxima apertura:
           a esas las recargamos a mano. */
        await new Promise(r => setTimeout(r, 3000));
        wins = await self.clients.matchAll({ type: 'window' });
        for (const c of wins) {
            if (ALIVE.has(c.id)) continue;
            try { await c.navigate(c.url); } catch (err) {}
        }
    })());
});

self.addEventListener('message', e => {
    const d = e.data;
    if (d === 'skipWaiting') { self.skipWaiting(); return; }
    if (d && d.type === 'alive' && e.source) ALIVE.add(e.source.id);
    if (d && d.type === 'version' && e.source) e.source.postMessage({ type: 'version', version: VERSION });
});

self.addEventListener('fetch', e => {
    const req = e.request;
    if (req.method !== 'GET') return;

    const accept = req.headers.get('accept') || '';
    const isDoc = req.mode === 'navigate' || accept.includes('text/html');

    /* El HTML va a la red primero: así un deploy nuevo se ve en la
       primera apertura con conexión, no en la segunda. */
    if (isDoc) {
        e.respondWith((async () => {
            try {
                const fresh = await fetch(req.url, { cache: 'no-cache' });
                if (fresh && fresh.ok) {
                    const c = await caches.open(CACHE);
                    c.put('./index.html', fresh.clone());
                }
                return fresh;
            } catch (err) {
                const c = await caches.open(CACHE);
                return (await c.match(req)) || (await c.match('./index.html')) || Response.error();
            }
        })());
        return;
    }

    /* El resto: del cache al toque, y se refresca de fondo. */
    e.respondWith((async () => {
        const cached = await caches.match(req);
        const net = fetch(req).then(res => {
            if (res && res.ok && new URL(req.url).origin === self.location.origin) {
                caches.open(CACHE).then(c => c.put(req, res.clone())).catch(() => {});
            }
            return res;
        }).catch(() => cached);
        return cached || net;
    })());
});
