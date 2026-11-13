// Onglet « Fiche » : la fiche de révision, à imprimer ou exporter.
import { h, add } from '../util.js';
import { renderMd } from '../markdown.js';

export default {
  id: 'sheet',
  label: 'Fiche',
  has: c => !!c.sheet?.md,
  render(panel, c, ctx) {
    if (ctx.player) ctx.player.onTime = null;
    if (!c.sheet?.md) {
      add(panel, h('div', { class: 'empty' }, c.raw ? 'La fiche n\'est pas encore faite.' : 'Il faut d\'abord transcrire le cours.'));
      return;
    }
    const ex = () => import('../exporter.js');
    add(panel, 
      h('div', { class: 'row', style: 'margin-bottom:6px' },
        h('button', { class: 'btn sm', onclick: () => ex().then(m => m.printSheet(c)) }, '🖨️ Imprimer / PDF'),
        h('button', { class: 'btn sm', onclick: () => ex().then(m => m.exportMd(c)) }, '⬇ .md'),
        h('button', { class: 'btn sm', onclick: () => ex().then(m => m.exportTxt(c)) }, '⬇ .txt')),
      h('div', { class: 'md', html: renderMd(c.sheet.md) }),
      h('p', { class: 'muted small' }, `Rédigée par ${c.sheet.model} à partir du cours. Vérifie les points importants en réécoutant (horodatages cliquables).`));
  },
};
