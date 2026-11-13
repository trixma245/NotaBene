// Carte « étapes » d'un cours : ce qui est en cours (avec progression) ou ce qu'il reste à faire.
import { h, on, toast, confirmBox, put } from '../util.js';
import { getSettings, setSettings, getKeys, ENGINES } from '../settings.js';
import { getJob, progressOf, enqueue, cancel, retry, jobStatus, missingSteps, STEP_LABEL, AI_STEPS } from '../pipeline.js';
import { progressBar, banner } from '../views/common.js';

const KEY_NAMES = { groq: 'Groq', openai: 'OpenAI', anthropic: 'Anthropic' };
const settingsLink = () => h('a', { href: '#/settings' }, 'Ouvrir les réglages');

function stepChips(job) {
  return h('div', { class: 'row', style: 'gap:6px' }, job.steps.map((s, i) => h('span', {
    class: `chip ${i < job.idx ? 'ok' : i === job.idx ? (job.state === 'error' ? 'err' : 'warn') : ''}`,
  }, `${i < job.idx ? '✓ ' : ''}${STEP_LABEL[s]}`)));
}

export default {
  id: 'steps',

  step(course, ctx) {
    const el = h('div');
    let job = null, mounted = false;
    const bar = progressBar();

    const render = (prog = progressOf(course.id)) => {
      const c = ctx.course;
      const kids = [];
      if (job) {
        const running = job.state === 'running';
        kids.push(h('h3', { style: 'margin:0 0 8px' }, running ? '⚙️ Traitement en cours' : job.state === 'error' ? 'Traitement arrêté' : 'Traitement en attente'), stepChips(job));
        kids.push(h('p', { class: 'small', style: 'margin:8px 0 0' }, jobStatus(job, prog)));
        if (running) {
          bar.set(prog?.total ? prog.done / prog.total : null);
          kids.push(bar.el);
          if (prog?.dots?.length > 1) kids.push(h('div', { class: 'segdots', title: 'Morceaux de 5 min' }, prog.dots.map(d => h('i', { class: d }))));
          if (job.steps[job.idx] === 'transcribe') kids.push(h('p', { class: 'muted small', style: 'margin:0' }, 'Garde l\'appli ouverte. Si elle se ferme, ça reprendra où ça en était.'));
        }
        const btns = [];
        if (job.state === 'error') btns.push(h('button', { class: 'btn sm primary', onclick: () => retry(course.id) }, '↻ Réessayer'));
        if (job.needKey) btns.push(h('a', { class: 'btn sm', href: '#/settings' }, `🔑 Clé ${KEY_NAMES[job.needKey] || ''}`));
        btns.push(h('button', { class: 'btn sm ghost', onclick: async () => { if (await confirmBox('Arrêter ce traitement ? Ce qui est déjà fait est gardé.', { ok: 'Arrêter' })) cancel(course.id); } }, 'Arrêter'));
        kids.push(h('div', { class: 'row', style: 'margin-top:10px' }, btns));
      } else if (!c.raw) {
        if (!c.hasAudio) {
          if (c.state === 'importing') kids.push(h('p', { class: 'muted', style: 'margin:0' }, 'Import en cours…'));
        } else kids.push(...transcribeChoices(c));
      } else {
        const keys = getKeys();
        const todo = missingSteps(c, { withAi: true }).filter(s => s !== 'transcribe');
        if (todo.length) {
          if (keys.anthropic) {
            kids.push(h('button', { class: 'btn primary block', onclick: () => enqueue(c.id, todo) },
              todo.length === 3 ? '✨ Nettoyer, faire la fiche et le quiz' : `✨ Faire : ${todo.map(s => STEP_LABEL[s].toLowerCase()).join(', ')}`),
            h('p', { class: 'muted small', style: 'margin:6px 0 0' }, 'Avec Claude : corrige la transcription, puis rédige la fiche, le quiz et les cartes.'));
          } else {
            kids.push(h('p', { class: 'muted small', style: 'margin:0' }, '✨ Pour obtenir le texte propre, la fiche et le quiz, ajoute ta clé Anthropic. ', settingsLink()));
          }
        }
      }
      put(el, ...kids);
      el.closest('.card')?.classList.toggle('hidden', !kids.length);
    };

    function transcribeChoices(c) {
      const s = getSettings(), keys = getKeys();
      const engine = s.engine;
      const sel = h('select', { value: engine, onchange: e => { setSettings({ engine: e.target.value }); render(); } },
        Object.entries(ENGINES).map(([id, e]) => h('option', { value: id }, e.label)));
      const out = [h('label', { class: 'field', style: 'margin-top:0' }, h('span', null, 'Transcrire avec'), sel)];
      if (engine === 'local') {
        out.push(
          h('div', { class: 'btn-grid' },
            h('button', { class: 'btn', onclick: () => import('../exporter.js').then(m => m.exportForPc(c)) }, '💻 Exporter pour le PC'),
            h('button', { class: 'btn', onclick: () => import('../importer.js').then(m => m.pickFiles()) }, '📥 Importer le résultat')),
          h('p', { class: 'muted small', style: 'margin:6px 0 0' }, 'Sur ton PC : glisse le fichier .zip sur TRANSCRIRE.bat (dossier local-transcriber), puis importe ici le fichier .notabene.json obtenu.'));
      } else if (!keys[engine]) {
        out.push(banner('warn', `Pour transcrire avec ${ENGINES[engine].short}, ajoute ta clé dans les réglages. `, settingsLink()));
      } else {
        const ai = s.autoAi && keys.anthropic;
        out.push(h('button', { class: 'btn primary block', onclick: () => enqueue(c.id, ['transcribe', ...(ai ? missingSteps(c, { withAi: true }).filter(x => x !== 'transcribe') : [])]) },
          ai ? '📝 Transcrire, puis fiche et quiz' : '📝 Transcrire'));
        if (!navigator.onLine) out.push(h('p', { class: 'muted small', style: 'margin:6px 0 0' }, 'Hors ligne : la transcription démarrera quand le réseau reviendra.'));
      }
      return out;
    }

    getJob(course.id).then(j => { job = j || null; render(); });
    requestAnimationFrame(() => { mounted = true; });
    const off = on('job', d => {
      if (mounted && !el.isConnected) { off(); return; }
      if (d.courseId !== course.id) return;
      if ('job' in d) job = d.job || null;
      render(d.progress);
    });
    return el;
  },

  menu(course) {
    const keys = getKeys(), s = getSettings();
    const items = [];
    const redo = async (steps, msg) => {
      if (await confirmBox(msg, { ok: 'Refaire' })) { await enqueue(course.id, steps); toast('C\'est parti.'); }
    };
    if (course.raw && course.hasAudio && s.engine !== 'local' && keys[s.engine]) {
      items.push({ label: `🔄 Refaire la transcription (${ENGINES[s.engine].short})`, run: () => redo(['transcribe', ...(keys.anthropic ? AI_STEPS : [])], 'Refaire la transcription ? L\'ancienne sera remplacée (et la fiche refaite si ta clé Anthropic est là).') });
    }
    if (course.raw && keys.anthropic) {
      items.push({ label: '🔄 Refaire nettoyage, fiche et quiz', run: () => redo(AI_STEPS, 'Refaire le texte propre, la fiche et le quiz ? Ta progression sur les cartes est gardée.') });
      if (course.sheet) items.push({ label: '🔄 Refaire seulement la fiche', run: () => redo(['sheet'], 'Refaire la fiche ?') });
      if (course.quiz) items.push({ label: '🔄 Refaire le quiz et les cartes', run: () => redo(['train'], 'Refaire le quiz et les cartes ? Ta progression est gardée pour les cartes identiques.') });
    }
    return items;
  },
};
