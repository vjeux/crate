'use strict';
const SHELL = 'crate-shell-1';
const SHELL_FILES = ['./', 'index.html', 'loader.js', 'manifest.webmanifest', 'icon.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return;
  const scope = new URL(self.registration.scope);
  const rel = url.pathname.slice(scope.pathname.length);
  if (rel === 'app/board.json') {
    // The leaderboard's address: the site's own board.json, never cached (a tunnel's URL changes
    // when it restarts and only board.json is republished); offline, the app's copy.
    e.respondWith((async () => {
      try {
        const r = await fetch(scope.pathname + 'board.json', { cache: 'no-store' });
        if (r.ok) return r;
      } catch (err) {}
      for (const k of (await caches.keys()).filter(k => k.startsWith('crate-app-'))) {
        const r = await (await caches.open(k)).match(scope.pathname + rel);
        if (r) return r;
      }
      return new Response('{}', { status: 404 });
    })());
    return;
  }
  if (rel.startsWith('app/')) {
    e.respondWith((async () => {
      const keys = (await caches.keys()).filter(k => k.startsWith('crate-app-'));
      for (const k of keys) {
        const r = await (await caches.open(k)).match(scope.pathname + rel);
        if (r && e.request.mode === 'navigate') {
          // no-store keeps the game page out of the back/forward cache: a frozen copy there
          // holds the save database open and blocks the next page's loads.
          const h = new Headers(r.headers);
          h.set('Cache-Control', 'no-store');
          return new Response(await r.blob(), { status: 200, headers: h });
        }
        if (r) return r;
      }
      return Response.redirect(scope.pathname, 302);
    })());
    return;
  }
  if (rel === 'v.json' || rel === 'board.json' || rel.startsWith('b/')) return;
  e.respondWith((async () => {
    const c = await caches.open(SHELL);
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => null);
    return hit || (await net) || new Response('offline', { status: 503 });
  })());
});
