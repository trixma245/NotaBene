// Service worker : l'appli s'ouvre et enregistre même sans internet.
// ⚠️ Après une modification du code, change VERSION pour que les téléphones prennent la nouvelle version.
const VERSION = 'notabene-v1';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/icon.svg',
  'js/app.js', 'js/util.js', 'js/db.js', 'js/settings.js', 'js/keys.js', 'js/audio.js', 'js/recorder.js',
  'js/player.js', 'js/markdown.js', 'js/merge.js', 'js/transcribe.js', 'js/claude.js', 'js/ai.js',
  'js/pipeline.js', 'js/srs.js', 'js/zip.js', 'js/importer.js', 'js/exporter.js', 'js/backup.js',
  'js/views/common.js', 'js/views/home.js', 'js/views/record.js', 'js/views/test.js', 'js/views/course.js',
  'js/views/subjects.js', 'js/views/search.js', 'js/views/review.js', 'js/views/settings.js',
  'js/course/steps.js', 'js/course/sheet.js', 'js/course/quiz.js', 'js/course/cards.js',
  'js/course/clean.js', 'js/course/raw.js', 'js/course/more.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION && k !== 'nb-share') await caches.delete(k);
    await self.clients.claim();
  })());
});

// La page demande d'activer la nouvelle version (bouton « Mettre à jour »)
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);

  // « Partager → NotaBene » depuis une autre appli (Dictaphone...) : on range les fichiers, puis on ouvre l'appli
  if (req.method === 'POST' && url.origin === location.origin && url.pathname.endsWith('/partage')) {
    e.respondWith((async () => {
      try {
        const form = await req.formData();
        const cache = await caches.open('nb-share');
        let i = 0;
        for (const f of form.getAll('audio')) {
          if (!f || typeof f === 'string') continue;
          await cache.put(new Request(`partage/${Date.now()}-${i++}`), new Response(f, {
            headers: { 'content-type': f.type || 'application/octet-stream', 'x-name': encodeURIComponent(f.name || 'audio'), 'x-time': String(f.lastModified || Date.now()) },
          }));
        }
      } catch { /* on ouvre l'appli quand même */ }
      return Response.redirect('./?partage=1#/', 303);
    })());
    return;
  }

  // Les API (Groq, OpenAI, Anthropic) passent directement, sans cache
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    // Ouverture de l'appli : toujours la page principale en cache (marche hors ligne)
    if (req.mode === 'navigate') {
      const hit = await cache.match('index.html') || await cache.match('./');
      if (hit) return hit;
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch {
      return new Response('Hors ligne', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
  })());
});
