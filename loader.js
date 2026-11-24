'use strict';
(() => {
const $ = id => document.getElementById(id);
const say = t => { $('s').textContent = t; console.log('crate: ' + t); };
const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('crate', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('k');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function kget() {
  const db = await idb();
  return new Promise(res => { const q = db.transaction('k').objectStore('k').get('key'); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); });
}
async function kput(k) {
  const db = await idb();
  return new Promise(res => { const t = db.transaction('k', 'readwrite'); t.objectStore('k').put(k, 'key'); t.oncomplete = () => res(); t.onerror = () => res(); });
}
async function derive(pass, meta) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: b64d(meta.s), iterations: meta.it }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
}
async function fetchBlob(name) {
  const r = await fetch('b/' + name + '.bin', { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return new Uint8Array(await r.arrayBuffer());
}
async function open(key, blob) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: blob.subarray(0, 12) }, key, blob.subarray(12)));
}
// null: wrong key. Throws when the index cannot be fetched (network, server mid-publish).
// An open site (meta.o) has no key: its blobs are the plain files.
async function readIndex(key, meta) {
  const blob = await fetchBlob(meta.i);
  if (meta.o) return JSON.parse(new TextDecoder().decode(blob));
  try { return JSON.parse(new TextDecoder().decode(await open(key, blob))); } catch (e) { return null; }
}
function retryLater(msg) {
  say(msg);
  const b = document.createElement('button');
  b.textContent = 'Retry';
  b.onclick = () => location.reload();
  $('ui').appendChild(b);
}
async function install(key, meta, index) {
  const name = 'crate-app-' + meta.v;
  await caches.delete(name);
  const cache = await caches.open(name);
  // Files whose blob is unchanged since the installed version are copied from its cache:
  // an update downloads only what changed.
  const haveV = localStorage.getItem('crate:v');
  let prev = {};
  try { prev = JSON.parse(localStorage.getItem('crate:index') || '{}'); } catch (e) {}
  const old = haveV && haveV !== meta.v && await caches.has('crate-app-' + haveV) ? await caches.open('crate-app-' + haveV) : null;
  const fetchTotal = index.reduce((a, f) => a + (old && prev[f.p] === f.b ? 0 : f.n), 0);
  const verb = old ? 'Updating ' : 'Installing ';
  let bytes = 0;
  let next = 0;
  async function worker() {
    while (next < index.length) {
      const f = index[next++];
      const req = new Request('app/' + f.p);
      if (old && prev[f.p] === f.b) {
        const r = await old.match(req);
        if (r) { await cache.put(req, r); continue; }
      }
      const blob = await fetchBlob(f.b);
      const plain = meta.o ? blob : await open(key, blob);
      await cache.put(req, new Response(plain, { headers: { 'Content-Type': f.t } }));
      bytes += f.n;
      say(verb + Math.floor(100 * bytes / Math.max(1, fetchTotal)) + '%');
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  for (const k of await caches.keys()) if (k.startsWith('crate-app-') && k !== name) await caches.delete(k);
  const map = {};
  for (const f of index) map[f.p] = f.b;
  localStorage.setItem('crate:index', JSON.stringify(map));
  localStorage.setItem('crate:v', meta.v);
}
async function main() {
  console.log('crate: start');
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('sw.js'); await Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(r, 3000))]); } catch (e) { console.log('crate: sw ' + e); }
  }
  console.log('crate: sw done');
  if (navigator.storage && navigator.storage.persist) { navigator.storage.persist().catch(() => {}); }
  console.log('crate: persist done');
  let meta = null;
  try { const r = await fetch('v.json?n=' + Date.now(), { cache: 'no-store' }); if (r.ok) meta = await r.json(); } catch (e) {}
  console.log('crate: meta ' + (meta ? meta.v : 'none'));
  const have = localStorage.getItem('crate:v');
  const haveCache = have ? await caches.has('crate-app-' + have) : false;
  if (haveCache && (!meta || meta.v === have)) { location.replace('app/index.html'); return; }
  if (!meta) { say(haveCache ? '' : 'Offline. Open once while online to install.'); return; }
  console.log('crate: have ' + have + ' ' + haveCache);
  let key = meta.o ? null : await kget();
  console.log('crate: key ' + !!key);
  let index = (key || meta.o) ? await readIndex(key, meta) : null;
  if (!index && window.__boxTestPass) {
    key = await derive(window.__boxTestPass, meta);
    index = await readIndex(key, meta);
    if (index) await kput(key);
  }
  if (!index) {
    key = null;
    $('f').style.display = 'flex';
    $('p').focus();
    await new Promise(res => {
      $('f').onsubmit = async ev => {
        ev.preventDefault();
        say('Checking...');
        const k = await derive($('p').value.trim(), meta);
        let ix = null;
        try { ix = await readIndex(k, meta); } catch (e) { say('Could not download (' + e.message + '). Try again.'); return; }
        if (!ix) { say('Wrong passphrase'); return; }
        key = k; index = ix; $('f').style.display = 'none'; res();
      };
    });
    await kput(key);
  }
  say('Installing...');
  try { await install(key, meta, index); } catch (e) {
    if (haveCache) { location.replace('app/index.html'); return; }
    retryLater('Install failed (' + e.message + ').');
    return;
  }
  location.replace('app/index.html');
}
main().catch(e => {
  const have = localStorage.getItem('crate:v');
  (have ? caches.has('crate-app-' + have) : Promise.resolve(false)).then(ok => {
    if (ok) location.replace('app/index.html');
    else retryLater('Could not download (' + e.message + ').');
  });
});
})();
