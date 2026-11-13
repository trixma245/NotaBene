// Onglet « Quiz » : QCM corrigés tout de suite + questions ouvertes avec correction à dévoiler.
import { h, add } from '../util.js';

export default {
  id: 'quiz',
  label: 'Quiz',
  has: c => !!(c.quiz?.mcq?.length || c.quiz?.open?.length),
  render(panel, c, ctx) {
    if (ctx.player) ctx.player.onTime = null;
    const q = c.quiz;
    if (!q || (!q.mcq?.length && !q.open?.length)) {
      add(panel, h('div', { class: 'empty' }, 'Pas encore de quiz.'));
      return;
    }
    let answered = 0, good = 0;
    const score = h('div', { class: 'banner info hidden' });
    const updateScore = () => {
      score.classList.toggle('hidden', !answered);
      score.textContent = answered === q.mcq.length
        ? `Score : ${good} / ${q.mcq.length} ${good === q.mcq.length ? '🎉' : good >= q.mcq.length / 2 ? '👍' : '— relis la fiche et recommence !'}`
        : `${good} bonne(s) réponse(s) sur ${answered}`;
    };

    const mcq = (q.mcq || []).map((item, i) => {
      const explain = h('div', { class: 'explain hidden' }, item.explanation);
      const choices = item.choices.map((ch, k) => h('button', { class: 'btn choice', onclick: () => {
        if (box.dataset.done) return;
        box.dataset.done = '1';
        answered++;
        if (k === item.answer) good++;
        choices.forEach((b, j) => { if (j === item.answer) b.classList.add('ok'); else if (j === k) b.classList.add('ko'); b.disabled = j !== k && j !== item.answer; });
        explain.classList.remove('hidden');
        updateScore();
      } }, ch));
      const box = h('div', { class: 'q card' }, h('div', { class: 'q-title' }, `${i + 1}. ${item.question}`), choices, explain);
      return box;
    });

    const open = (q.open || []).map((item, i) => {
      const ans = h('div', { class: 'explain hidden', style: 'white-space:pre-wrap' }, item.answer);
      const btn = h('button', { class: 'btn sm', onclick: () => { ans.classList.toggle('hidden'); btn.textContent = ans.classList.contains('hidden') ? 'Voir la correction' : 'Cacher la correction'; } }, 'Voir la correction');
      return h('div', { class: 'q card' },
        h('div', { class: 'q-title' }, `${i + 1}. ${item.question}`),
        h('textarea', { rows: 3, placeholder: 'Ta réponse (pour toi, rien n\'est envoyé)…' }),
        h('div', { style: 'margin-top:8px' }, btn), ans);
    });

    add(panel, 
      mcq.length ? h('h2', { style: 'margin-top:4px' }, `QCM (${mcq.length})`) : null, ...mcq, score,
      mcq.length ? h('button', { class: 'btn block', onclick: () => ctx.setTab('quiz') }, '↺ Recommencer le QCM') : null,
      open.length ? h('h2', null, `Questions ouvertes (${open.length})`) : null, ...open);
  },
};
