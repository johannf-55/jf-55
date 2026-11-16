// Service worker : coquille de l'app en cache (hors ligne), réseau direct pour Microsoft.
const VERSION = 'v6';
const CACHE = `audit-energie-${VERSION}`;
const SHELL = ['./', 'index.html', 'style.css', 'config.js', 'manifest.webmanifest',
  'js/app.js', 'js/demo.js', 'js/model.js', 'js/db.js', 'js/sync-core.js', 'js/sharepoint.js', 'js/synoptic.js', 'js/export.js', 'js/xlsx.js', 'js/checklist.js', 'js/checklist-base.js', 'js/zip.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/logo-blanc.png', 'icons/logo-couleur.png', 'icons/symbole.png',
  'fonts/adventor-regular.woff2', 'fonts/adventor-bold.woff2'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // Microsoft, etc. : réseau direct
  // Navigation : réseau d'abord (pour récupérer les mises à jour), repli sur le cache hors ligne
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put('index.html', copy)); return r; })
      .catch(() => caches.match('index.html')));
    return;
  }
  // Fichiers statiques : cache d'abord, rafraîchi en arrière-plan
  e.respondWith(caches.match(req).then((hit) => {
    const net = fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});
