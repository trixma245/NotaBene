// Répétition espacée simple (inspirée de SM-2) pour les cartes de révision.
// Chaque carte : { id, front, back, due (ms), ivl (jours), ease, reps, lapses }
import { listCourses } from './db.js';

const DAY = 86400000;
export const GRADES = [
  { g: 0, label: 'Raté', kind: 'danger' },
  { g: 1, label: 'Difficile', kind: '' },
  { g: 2, label: 'Bien', kind: 'primary' },
  { g: 3, label: 'Facile', kind: '' },
];

/** Calcule le nouvel état d'une carte après une réponse (0 raté, 1 difficile, 2 bien, 3 facile). */
export function schedule(card, g, now = Date.now()) {
  const c = { ease: 2.5, ivl: 0, reps: 0, lapses: 0, ...card };
  if (g === 0) {
    c.lapses++;
    c.reps = 0;
    c.ivl = 0;
    c.ease = Math.max(1.3, c.ease - 0.2);
    c.due = now + 10 * 60000;            // on la revoit dans 10 minutes
    return c;
  }
  c.reps++;
  if (c.reps === 1) c.ivl = g === 3 ? 4 : g === 2 ? 1 : 1;
  else if (c.reps === 2) c.ivl = g === 3 ? 7 : g === 2 ? 3 : 2;
  else c.ivl = Math.max(c.ivl + 1, Math.round(c.ivl * (g === 1 ? 1.2 : g === 2 ? c.ease : c.ease * 1.3)));
  if (g === 1) c.ease = Math.max(1.3, c.ease - 0.15);
  if (g === 3) c.ease += 0.15;
  c.due = now + c.ivl * DAY - 3600000;    // un peu avant, pour pouvoir réviser à la même heure
  return c;
}

/** « 10 min », « 1 j », « 3 sem. », « 2 mois » */
export function fmtIvl(card, g) {
  const n = schedule(card, g, 0);
  if (g === 0) return '10 min';
  const d = n.ivl;
  if (d < 14) return `${d} j`;
  if (d < 60) return `${Math.round(d / 7)} sem.`;
  return `${Math.round(d / 30)} mois`;
}

export const isDue = (c, now = Date.now()) => (c.due || 0) <= now;

/** Toutes les cartes à réviser maintenant : [{ course, card }] */
export async function dueCards(courseId = null) {
  const now = Date.now(), out = [];
  for (const course of await listCourses()) {
    if (courseId && course.id !== courseId) continue;
    for (const card of course.cards || []) if (isDue(card, now)) out.push({ course, card });
  }
  return out.sort((a, b) => (a.card.due || 0) - (b.card.due || 0));
}

/** Pastille du nombre de cartes à réviser sur l'onglet « Réviser » */
export async function updateBadge() {
  const b = document.getElementById('due-badge');
  if (!b) return;
  try {
    const n = (await dueCards()).length;
    b.hidden = !n;
    b.textContent = n > 99 ? '99+' : String(n);
  } catch { b.hidden = true; }
}
