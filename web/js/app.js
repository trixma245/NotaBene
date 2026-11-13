// Point d'entrée : navigation entre les écrans et démarrage de l'appli.
import { $, $$, h, toast, humanError } from './util.js';
import { openDb, askPersist } from './db.js';
import { applyTheme } from './settings.js';
import { recorder } from './recorder.js';

// [adresse, écran à charger, onglet de navigation à allumer]
const routes = [
  [/^\/?$/, () => import('./views/home.js'), 'home'],
  [/^\/rec(?:\/([^/]+))?$/, () => import('./views/record.js'), 'home'],
  [/^\/test$/, () => import('./views/test.js'), 'home'],
  [/^\/c\/([^/]+)(?:\/([\w-]+))?$/, () => import('./views/course.js'), 'subjects'],
  [/^\/subjects$/, () => import('./views/subjects.js'), 'subjects'],
  [/^\/s\/([^/]+)$/, () => import('./views/subjects.js'), 'subjects'],
  [/^\/search$/, () => import('./views/search.js'), 'search'],
  [/^\/review(?:\/([^/]+))?$/, () => import('./views/review.js'), 'review'],
  [/^\/settings$/, () => import('./views/settings.js'), 'settings'],
];

let cleanup = null, token = 0;

async function route() {
  const [path, query = ''] = (location.hash.slice(1) || '/').split('?');
  // Pendant un enregistrement on reste sur l'écran d'enregistrement (évite les fausses manœuvres)
  if (recorder.state !== 'idle' && !recorder.memoryOnly && !path.startsWith('/rec')) {
    location.replace('#/rec');
    toast("Enregistrement en cours : termine-le avant de changer d'écran.");
    return;
  }
  const my = ++token;
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  const view = $('#view');
  for (const [re, load, nav] of routes) {
    const m = re.exec(path);
    if (!m) continue;
    $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.nav === nav));
    document.body.classList.remove('no-nav');
    const root = h('div');
    try {
      const mod = await load();
      if (my !== token) return;
      view.replaceChildren(root);
      window.scrollTo(0, 0);
      const c = await mod.default(root, { params: m.slice(1).map(x => x && decodeURIComponent(x)), query: new URLSearchParams(query) });
      if (my !== token) { if (typeof c === 'function') c(); return; }
      cleanup = typeof c === 'function' ? c : null;
    } catch (e) {
      console.error(e);
      if (my !== token) return;
      const loadFail = /import|module|fetch/i.test(e?.message || '');
      view.replaceChildren(h('div', { class: 'card' },
        h('h2', null, loadFail ? 'Écran indisponible' : 'Oups, une erreur'),
        h('p', null, loadFail ? "Cet écran n'a pas pu être chargé. Si tu es hors ligne, ouvre l'appli une fois avec internet pour qu'elle se mette en mémoire." : humanError(e)),
        h('a', { class: 'btn primary', href: '#/' }, "Retour à l'accueil")));
    }
    return;
  }
  location.replace('#/');
}

function updateOnline() { $('#offline-bar').hidden = navigator.onLine; }

async function start() {
  applyTheme();
  updateOnline();
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
  window.addEventListener('hashchange', route);
  // Avertit avant de fermer la page pendant un enregistrement
  window.addEventListener('beforeunload', e => {
    if (recorder.state !== 'idle') { e.preventDefault(); e.returnValue = ''; }
  });
  try {
    await openDb();
  } catch (e) {
    $('#view').replaceChildren(h('div', { class: 'banner err' }, humanError(e)));
    return;
  }
  askPersist();
  await route();
}

start();
