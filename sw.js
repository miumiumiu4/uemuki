const CACHE = 'uemuki-v14';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'live.js', 'config.js', 'data.js', 'vendor/supabase.js', 'manifest.json', 'privacy.html', 'icon.svg', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // サーバー（Supabase）とのやりとりは保存しない
  if (new URL(e.request.url).origin !== self.location.origin) return;
  // 毎回サーバーに新しい版がないか確かめる（古い画面が残らないように）
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => {
    const copy = r.clone();
    caches.open(CACHE).then(c => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request)));
});
