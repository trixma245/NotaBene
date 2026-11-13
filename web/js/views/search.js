// Recherche dans tous les cours : titres, transcriptions, textes propres, fiches, quiz, cartes.
import { h, debounce, markText, snorm, fmtTime, fmtDate, add, put } from '../util.js';
import { listCourses } from '../db.js';
import { subjectName } from '../settings.js';
import { mdToText } from '../markdown.js';

let lastQuery = '';

/** Extrait autour de la position i du texte normalisé */
function snippet(text, i, len, width = 70) {
  const a = Math.max(0, i - width), b = Math.min(text.length, i + len + width);
  return (a ? '…' : '') + text.slice(a, b).replace(/\s+/g, ' ') + (b < text.length ? '…' : '');
}

/** Cherche q dans un cours. Renvoie [{ where, tab, t, text }] */
export function searchCourse(c, q, max = 4) {
  const nq = snorm(q).trim();
  if (!nq) return [];
  const hits = [];
  const inText = (text, where, tab, t = null) => {
    if (hits.length >= max || !text) return;
    const src = String(text).normalize('NFC');
    const i = snorm(src).indexOf(nq);
    if (i >= 0) hits.push({ where, tab, t, text: snippet(src, i, nq.length) });
  };
  for (const s of c.raw?.segments || []) { if (hits.length >= max) break; inText(s.t, 'Transcription', 'raw', s.s); }
  if (c.sheet?.md) inText(mdToText(c.sheet.md), 'Fiche', 'sheet');
  if (c.clean?.md) {
    // dans le texte propre, on retrouve l'horodatage du paragraphe
    for (const p of c.clean.md.split(/\n{2,}/)) {
      if (hits.length >= max) break;
      const m = /\[(\d{1,2}(?::\d{2}){1,2})\]/.exec(p);
      const t = m ? m[1].split(':').map(Number).reduce((a, n) => a * 60 + n, 0) : null;
      inText(mdToText(p).replace(/\[\d{1,2}(?::\d{2}){1,2}\]\s*/g, ''), 'Texte propre', 'clean', t);
    }
  }
  for (const k of c.cards || []) inText(`${k.front} — ${k.back}`, 'Carte', 'cards');
  for (const k of c.quiz?.mcq || []) inText(k.question, 'Quiz', 'quiz');
  return hits;
}

export default async function search(root) {
  const input = h('input', { type: 'search', placeholder: 'Un mot, une notion, une commande…', value: lastQuery, autofocus: true, 'aria-label': 'Rechercher' });
  const out = h('div');
  const courses = await listCourses();

  const run = () => {
    const q = lastQuery = input.value.trim();
    if (q.length < 2) {
      put(out, h('p', { class: 'muted small center', style: 'margin-top:20px' }, `Recherche dans ${courses.length} cours : transcriptions, fiches, quiz et cartes.`));
      return;
    }
    const results = [];
    for (const c of courses) {
      const titleHit = snorm(c.title).includes(snorm(q));
      const hits = searchCourse(c, q);
      if (titleHit || hits.length) results.push({ c, hits, titleHit });
    }
    results.sort((a, b) => (b.titleHit - a.titleHit) || (b.hits.length - a.hits.length));
    put(out, 
      h('p', { class: 'muted small' }, results.length ? `${results.length} cours trouvé(s)` : 'Rien trouvé. Essaie un autre mot (les accents ne comptent pas).'),
      ...results.map(({ c, hits }) => h('div', { class: 'card' },
        h('a', { href: `#/c/${c.id}`, style: 'color:inherit;text-decoration:none' },
          h('div', { class: 'item-title' }, ...markText(c.title, q)),
          h('div', { class: 'item-meta' }, `${subjectName(c.subjectId)} · ${fmtDate(c.createdAt)}`)),
        hits.map(x => h('a', {
          class: 'tline', style: 'color:inherit;text-decoration:none;display:flex',
          href: `#/c/${c.id}/${x.tab}${x.t != null ? `?t=${x.t}` : ''}`,
        },
        h('span', { class: 'ts' }, x.t != null ? fmtTime(x.t) : x.where),
        h('span', { class: 'small grow' }, ...markText(x.text, q)))))));
  };
  input.addEventListener('input', debounce(run, 220));
  add(root, h('h1', null, 'Recherche'), input, out);
  run();
  setTimeout(() => input.focus(), 50);
}
