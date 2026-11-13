// Onglet « Cartes » : les cartes de révision du cours (révision espacée dans l'écran Réviser).
import { h, uid, promptBox, confirmBox, fmtDate, add } from '../util.js';
import { saveCourse } from '../db.js';
import { isDue } from '../srs.js';

export default {
  id: 'cards',
  label: 'Cartes',
  has: c => !!c.cards?.length,
  render(panel, c, ctx) {
    if (ctx.player) ctx.player.onTime = null;
    const cards = c.cards || [];
    const due = cards.filter(k => isDue(k)).length;
    const addCard = async () => {
      const front = await promptBox('Nouvelle carte — recto', '', { placeholder: 'Question ou terme' });
      if (!front?.trim()) return;
      const back = await promptBox('Verso (la réponse)', '', { multiline: true });
      if (!back?.trim()) return;
      c.cards = [...cards, { id: uid(), front: front.trim(), back: back.trim(), due: 0, ivl: 0, ease: 2.5, reps: 0, lapses: 0 }];
      await saveCourse(c);
    };
    add(panel, 
      h('div', { class: 'btn-grid' },
        h('a', { class: `btn ${due ? 'primary' : ''}`, href: `#/review/${c.id}` }, due ? `🧠 Réviser (${due})` : '🧠 Réviser quand même'),
        h('button', { class: 'btn', onclick: addCard }, '+ Ajouter une carte')),
      cards.length ? null : h('div', { class: 'empty' }, 'Pas encore de cartes. Elles sont créées avec le quiz, ou ajoute les tiennes.'),
      h('div', { class: 'list', style: 'margin-top:12px' }, cards.map(k => h('div', { class: 'item' },
        h('div', { class: 'grow' },
          h('div', { style: 'font-weight:600' }, k.front),
          h('div', { class: 'small', style: 'white-space:pre-wrap' }, k.back),
          h('div', { class: 'item-meta' }, k.reps ? `Prochaine révision : ${isDue(k) ? 'maintenant' : fmtDate(k.due)}` : 'Jamais révisée')),
        h('button', { class: 'btn sm ghost', 'aria-label': 'Supprimer la carte', onclick: async () => {
          if (await confirmBox(`Supprimer la carte « ${k.front} » ?`, { ok: 'Supprimer', danger: true })) {
            c.cards = cards.filter(x => x.id !== k.id);
            await saveCourse(c);
          }
        } }, '🗑️')))));
  },
};
