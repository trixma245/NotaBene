// Onglet « Transcription » : le texte brut, phrase par phrase. Toucher une ligne = écouter ce moment.
import { h, fmtTime, debounce, markText, snorm, toast, add } from '../util.js';
import { ENGINES } from '../settings.js';
import { rawToText } from '../merge.js';

export default {
  id: 'raw',
  label: 'Transcription',
  has: c => !!c.raw?.segments?.length,

  render(panel, c, ctx) {
    if (!c.raw) {
      add(panel, h('div', { class: 'empty' }, 'Pas encore de transcription.'));
      return;
    }
    const segs = c.raw.segments;
    if (!segs.length) {
      add(panel, h('div', { class: 'empty' }, 'La transcription est vide : aucun texte n\'a été reconnu (son trop faible ?).'));
      return;
    }
    const list = h('div');
    const lines = segs.map(s => h('div', { class: 'tline', 'data-t': s.s }, h('span', { class: 'ts' }, fmtTime(s.s)), h('span', { class: 'grow' }, s.t)));
    list.append(...lines);
    const filter = h('input', { type: 'search', placeholder: 'Chercher dans la transcription…' });
    const count = h('span', { class: 'muted small' });
    filter.addEventListener('input', debounce(() => {
      const q = filter.value.trim();
      let n = 0;
      lines.forEach((el, i) => {
        const hit = !q || snorm(segs[i].t).includes(snorm(q).trim());
        el.classList.toggle('hidden', !hit);
        if (hit) n++;
        el.lastChild.replaceChildren(...(q && hit ? markText(segs[i].t, q) : [segs[i].t]));
      });
      count.textContent = q ? `${n} ligne(s)` : '';
    }, 200));

    add(panel, 
      h('p', { class: 'muted small' },
        `${ENGINES[c.raw.engine]?.short || c.raw.engine} · ${c.raw.model}`,
        c.raw.approx ? ' · horodatage approximatif' : '',
        ' · Toucher une ligne pour l\'écouter.'),
      h('div', { class: 'row nowrap', style: 'margin-bottom:8px' },
        h('div', { class: 'grow' }, filter),
        h('button', { class: 'btn sm', onclick: () => navigator.clipboard?.writeText(rawToText(segs)).then(() => toast('Texte copié ✓')).catch(() => toast('Copie impossible ici.')) }, 'Copier')),
      count, list);

    // Ligne en cours de lecture surlignée
    let cur = -1;
    if (ctx.player) ctx.player.onTime = t => {
      if (!list.isConnected) return;
      let lo = 0, hi = segs.length - 1, k = -1;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (segs[m].s <= t + 0.05) { k = m; lo = m + 1; } else hi = m - 1; }
      if (k === cur) return;
      lines[cur]?.classList.remove('playing');
      cur = k;
      lines[cur]?.classList.add('playing');
    };
  },
};
