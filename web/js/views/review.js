// Révision des cartes (répétition espacée) : toutes les matières (#/review) ou un cours (#/review/:id).
import { h, on, add, put } from '../util.js';
import { getCourse, saveCourse, listCourses } from '../db.js';
import { subjectName } from '../settings.js';
import { dueCards, schedule, fmtIvl, GRADES, updateBadge } from '../srs.js';
import { head } from './common.js';
import { renderMd } from '../markdown.js';

export default async function review(root, { params }) {
  const courseId = params[0] || null;
  let queue = await dueCards(courseId);
  const course = courseId ? await getCourse(courseId) : null;
  // « Réviser quand même » : un cours sans carte due -> toutes ses cartes
  if (courseId && !queue.length && course?.cards?.length) queue = course.cards.map(card => ({ course, card }));
  const total = queue.length;
  let done = 0;

  const box = h('div');
  const counter = h('p', { class: 'muted small center' });
  add(root, courseId ? head(`Réviser — ${course?.title || ''}`, `#/c/${courseId}/cards`) : h('h1', null, 'Réviser'), counter, box);

  async function next() {
    counter.textContent = queue.length ? `${done} / ${total} · il en reste ${queue.length}` : '';
    if (!queue.length) {
      const all = (await listCourses()).reduce((n, c) => n + (c.cards?.length || 0), 0);
      put(box, h('div', { class: 'empty' },
        h('div', { style: 'font-size:2.4rem' }, done ? '🎉' : '😌'),
        done ? `Bravo ! ${done} carte(s) révisée(s).` : 'Rien à réviser pour l\'instant.',
        h('br'), all ? 'Reviens demain : les cartes reviennent au bon moment pour bien les retenir.' : 'Les cartes sont créées avec le quiz de chaque cours.'),
      courseId ? h('a', { class: 'btn block', href: `#/c/${courseId}` }, 'Retour au cours') : null);
      updateBadge();
      return;
    }
    const { course: c, card } = queue[0];
    const back = h('div', { class: 'back md hidden', html: renderMd(card.back) });
    const grades = h('div', { class: 'grades hidden' }, GRADES.map(g => h('button', { class: `btn ${g.kind}`, onclick: () => grade(g.g) },
      g.label, h('small', null, fmtIvl(card, g.g)))));
    const show = h('button', { class: 'btn primary big block', onclick: () => { back.classList.remove('hidden'); grades.classList.remove('hidden'); show.classList.add('hidden'); } }, 'Voir la réponse');
    put(box, 
      h('div', { class: 'flash' },
        h('div', { class: 'muted small', style: 'margin-bottom:10px' }, `${subjectName(c.subjectId)} · ${c.title}`),
        h('div', { style: 'font-weight:600' }, card.front), back),
      show, grades);

    async function grade(g) {
      queue.shift();
      done++;
      const fresh = await getCourse(c.id);
      if (fresh) {
        const i = (fresh.cards || []).findIndex(k => k.id === card.id);
        if (i >= 0) {
          fresh.cards[i] = schedule(fresh.cards[i], g);
          await saveCourse(fresh, true);
          if (g === 0) queue.push({ course: fresh, card: fresh.cards[i] });   // ratée : on la revoit à la fin
        }
      }
      next();
    }
  }
  next();
}

/** Bouton « Réviser » sur l'accueil quand des cartes attendent */
export function homeBlock({ actions }) {
  if (!actions) return;
  const btn = h('a', { class: 'btn hidden', href: '#/review' });
  add(actions, btn);
  const render = async () => {
    const n = (await dueCards()).length;
    btn.classList.toggle('hidden', !n);
    btn.textContent = `🧠 Réviser (${n})`;
  };
  render();
  return on('course', render);
}
