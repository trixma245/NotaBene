// Éléments d'interface réutilisés par plusieurs écrans.
import { h, fmtDur, fmtDate } from '../util.js';
import { getSubjects, subjectName } from '../settings.js';

/** Ligne de liste pour un cours, avec 5 pastilles : audio, transcription, nettoyage, fiche, entraînement */
export function courseItem(c, { extra } = {}) {
  const steps = [c.hasAudio, !!c.raw, !!c.clean, !!c.sheet, !!(c.quiz || c.cards)];
  const names = ['Audio', 'Transcription', 'Nettoyage', 'Fiche', 'Quiz et cartes'];
  return h('a', { class: 'item', href: `#/c/${c.id}` },
    h('div', { class: 'grow' },
      h('div', { class: 'item-title' }, c.title),
      h('div', { class: 'item-meta' }, [subjectName(c.subjectId), fmtDate(c.createdAt), c.duration ? fmtDur(c.duration) : null].filter(Boolean).join(' · ')),
      extra),
    c.state === 'recording' ? h('span', { class: 'chip warn' }, 'en cours') : null,
    h('div', { class: 'steps', title: steps.map((s, i) => `${names[i]} : ${s ? 'fait' : 'à faire'}`).join('\n') },
      steps.map(s => h('i', { class: s ? 'on' : '' }))));
}

/** Liste déroulante des matières */
export function subjectSelect(value, onchange, { none = 'Sans matière' } = {}) {
  return h('select', { value: value || '', onchange: e => onchange?.(e.target.value) },
    h('option', { value: '' }, `— ${none} —`),
    getSubjects().map(s => h('option', { value: s.id }, s.name)));
}

/** En-tête d'écran avec bouton retour */
export function head(title, backHref = '#/', ...right) {
  return h('div', { class: 'head' },
    h('a', { class: 'btn back ghost', href: backHref, 'aria-label': 'Retour' }, '←'),
    h('h1', null, title), right);
}

/** Bandeau d'information */
export const banner = (kind, ...kids) => h('div', { class: `banner ${kind}` }, kids);

/** Barre de progression. set(0..1) ou set(null) pour « en cours, durée inconnue » */
export function progressBar() {
  const fill = h('i');
  const el = h('div', { class: 'progress' }, fill);
  return { el, set(v) { el.classList.toggle('indet', v == null); fill.style.width = v == null ? '' : `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`; } };
}
