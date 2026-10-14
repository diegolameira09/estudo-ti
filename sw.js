const VERSAO = 'estudo-ti-v8';
const ARQUIVOS = [
"./",
"index.html",
"styles.css",
"app.js",
"cronograma.json",
"manifest.webmanifest",
"icons/icon-192.png",
"icons/icon-512.png",
"icons/icon-512-maskable.png",
"vendor/pdf.min.mjs",
"vendor/pdf.worker.min.mjs",
"vendor/standard_fonts/FoxitDingbats.pfb",
"vendor/standard_fonts/FoxitFixed.pfb",
"vendor/standard_fonts/FoxitFixedBold.pfb",
"vendor/standard_fonts/FoxitFixedBoldItalic.pfb",
"vendor/standard_fonts/FoxitFixedItalic.pfb",
"vendor/standard_fonts/FoxitSerif.pfb",
"vendor/standard_fonts/FoxitSerifBold.pfb",
"vendor/standard_fonts/FoxitSerifBoldItalic.pfb",
"vendor/standard_fonts/FoxitSerifItalic.pfb",
"vendor/standard_fonts/FoxitSymbol.pfb",
"vendor/standard_fonts/LiberationSans-Bold.ttf",
"vendor/standard_fonts/LiberationSans-BoldItalic.ttf",
"vendor/standard_fonts/LiberationSans-Italic.ttf",
"vendor/standard_fonts/LiberationSans-Regular.ttf"
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request).then(res => {
    if (res.ok && new URL(e.request.url).origin === location.origin) { const cp = res.clone(); caches.open(VERSAO).then(c => c.put(e.request, cp)); }
    return res;
  })));
});
