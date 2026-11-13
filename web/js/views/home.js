// Accueil : gros bouton rouge, cours récents.
import { h, on, toast } from '../util.js';
import { listCourses } from '../db.js';
import { recorderSupport, recoverInterrupted } from '../recorder.js';
import { courseItem, banner } from './common.js';

let installEvent = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; });

export default async function home(root) {
  const recovered = await recoverInterrupted().catch(() => []);
  const support = recorderSupport();
  const listBox = h('div', { class: 'list' });
  const extras = h('div');            // emplacement pour les blocs ajoutés par d'autres modules

  root.append(
    h('div', { class: 'row' },
      h('div', { class: 'logo grow' }, h('img', { src: 'icons/icon-192.png', alt: '' }), h('h1', { style: 'margin:0' }, 'NotaBene')),
      installEvent && h('button', { class: 'btn sm', onclick: async e => { installEvent.prompt(); installEvent = null; e.target.remove(); } }, "⬇ Installer l'appli")),
    support && banner('err', support),
    recovered.map(c => banner('ok', `✅ Enregistrement récupéré après une fermeture imprévue : `, h('a', { href: `#/c/${c.id}` }, c.title), '. Rien n\'a été perdu (sauf les toutes dernières secondes).')),
    h('div', { class: 'rec-wrap' },
      h('button', { class: 'rec-btn', onclick: () => { location.hash = '#/rec'; }, 'aria-label': 'Enregistrer un cours' },
        h('span', { class: 'dot' }, '●'), 'Enregistrer'),
      h('p', { class: 'muted small center' }, 'Touche pour préparer l\'enregistrement d\'un cours')),
    h('div', { class: 'btn-grid', id: 'home-actions' },
      h('a', { class: 'btn', href: '#/test' }, '🎚️ Test de captation')),
    extras,
    h('h2', null, 'Cours récents'),
    listBox);

  async function refresh() {
    const courses = await listCourses();
    listBox.replaceChildren(...(courses.length
      ? [...courses.slice(0, 12).map(c => courseItem(c)),
        courses.length > 12 && h('a', { class: 'btn ghost block', href: '#/subjects' }, `Voir les ${courses.length} cours`)].filter(Boolean)
      : [h('div', { class: 'empty' }, 'Aucun cours pour l\'instant.', h('br'), 'Appuie sur le bouton rouge pour enregistrer ton premier cours.')]));
  }
  await refresh();

  // Les autres modules (import, file d'attente, révision...) ajoutent leurs blocs ici
  const cleanups = [];
  let alive = true;
  for (const load of HOME_BLOCKS) {
    load().then(m => {
      if (!alive) return;
      const c = m.homeBlock?.({ root, extras, actions: root.querySelector('#home-actions'), refresh });
      if (typeof c === 'function') cleanups.push(c);
    }).catch(e => console.error(e));
  }

  const off = on('course', refresh);
  return () => { alive = false; off(); cleanups.forEach(c => c()); };
}

const HOME_BLOCKS = [];
