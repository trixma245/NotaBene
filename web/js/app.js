// Point d'entrée : navigation entre les écrans et démarrage de l'appli.
import { $, $$, h, toast, humanError, on, debounce, put } from './util.js';
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
      put(view, root);
      window.scrollTo(0, 0);
      const c = await mod.default(root, { params: m.slice(1).map(x => x && decodeURIComponent(x)), query: new URLSearchParams(query) });
      if (my !== token) { if (typeof c === 'function') c(); return; }
      cleanup = typeof c === 'function' ? c : null;
    } catch (e) {
      console.error(e);
      if (my !== token) return;
      const loadFail = /import|module|fetch/i.test(e?.message || '');
      put(view, h('div', { class: 'card' },
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
  // Le reste se charge après l'affichage du premier écran
  import('./pipeline.js').then(m => m.init()).catch(e => console.error(e));
  import('./importer.js').then(m => {
    m.installDrop();
    if (new URLSearchParams(location.search).has('partage')) {
      history.replaceState(null, '', location.pathname + location.hash);
      m.takeShared().catch(e => toast(humanError(e), 'err'));
    }
  }).catch(e => console.error(e));
  import('./srs.js').then(m => { m.updateBadge(); on('course', debounce(m.updateBadge, 1500)); setInterval(m.updateBadge, 10 * 60000); });
  registerSW();
}

/** Mode hors ligne + mise à jour de l'appli quand une nouvelle version est publiée */
function registerSW() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  let wantUpdate = false;   // on ne recharge que si l'utilisateur a demandé la mise à jour
  navigator.serviceWorker.register('sw.js').then(reg => {
    const offer = w => {
      const btn = h('button', { class: 'btn sm', style: 'margin-left:10px', onclick: () => { wantUpdate = true; w.postMessage('skipWaiting'); } }, 'Mettre à jour');
      toast(h('span', null, 'Nouvelle version de NotaBene disponible.', btn), '', 30000);
    };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
    setInterval(() => reg.update().catch(() => {}), 60 * 60000);
  }).catch(e => console.warn('Service worker indisponible', e));
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded || !wantUpdate) return;   // première installation : rien à recharger
    reloaded = true;
    if (recorder.state === 'idle') location.reload();
    else toast('La mise à jour sera appliquée à la fin de l\'enregistrement.');
  });
}

start();
