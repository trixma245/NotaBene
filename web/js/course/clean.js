// Onglet « Texte propre » : la transcription corrigée par Claude. Les [mm:ss] sont cliquables.
import { h, toast, add } from '../util.js';
import { renderMd } from '../markdown.js';

export default {
  id: 'clean',
  label: 'Texte propre',
  has: c => !!c.clean?.md,
  render(panel, c, ctx) {
    if (ctx.player) ctx.player.onTime = null;
    if (!c.clean?.md) {
      add(panel, h('div', { class: 'empty' }, c.raw ? 'Pas encore nettoyé par Claude.' : 'Il faut d\'abord transcrire le cours.'));
      return;
    }
    add(panel, 
      h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:6px' },
        h('span', { class: 'muted small' }, `Corrigé par ${c.clean.model} · touche un horodatage pour écouter`),
        h('button', { class: 'btn sm', onclick: () => navigator.clipboard?.writeText(c.clean.md).then(() => toast('Texte copié ✓')).catch(() => toast('Copie impossible ici.')) }, 'Copier')),
      h('div', { class: 'md', html: renderMd(c.clean.md) }));
  },
};
