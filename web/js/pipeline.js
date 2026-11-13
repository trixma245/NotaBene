// File d'attente des traitements : transcription → nettoyage → fiche → quiz et cartes.
// Chaque traitement est enregistré dans IndexedDB (magasin « jobs ») : si l'appli se ferme,
// si le réseau tombe ou si une API limite les envois, ça reprend là où ça s'était arrêté.
import { db, getCourse } from './db.js';
import { emit, on, toast, h, humanError, add, addFirst, put } from './util.js';
import { getSettings, setSettings, getKeys, ENGINES } from './settings.js';
import { StepError } from './transcribe.js';
import { recorder } from './recorder.js';

export const STEP_LABEL = { transcribe: 'Transcription', clean: 'Nettoyage', sheet: 'Fiche', train: 'Quiz et cartes' };
export const AI_STEPS = ['clean', 'sheet', 'train'];

const RUN = {
  transcribe: (id, job, ctx) => import('./transcribe.js').then(m => m.transcribeCourse(id, job, ctx)),
  clean: (id, job, ctx) => import('./ai.js').then(m => m.cleanStep(id, job, ctx)),
  sheet: (id, job, ctx) => import('./ai.js').then(m => m.sheetStep(id, job, ctx)),
  train: (id, job, ctx) => import('./ai.js').then(m => m.trainStep(id, job, ctx)),
};

let running = null;        // { courseId, ctrl }
let busy = false, timer = null, wake = null;
const live = new Map();    // courseId -> dernière progression (non enregistrée)

export const getJob = id => db.get('jobs', id);
export const listJobs = async () => (await db.all('jobs')).sort((a, b) => a.createdAt - b.createdAt);
export const progressOf = id => live.get(id) || null;
export const isRunning = id => running?.courseId === id;

async function saveJob(job, silent = false) {
  job.updatedAt = Date.now();
  await db.put('jobs', job);
  if (!silent) emit('job', { courseId: job.courseId, job });
}

/** Ajoute (ou remplace) le traitement d'un cours. steps : ['transcribe', 'clean', ...] */
export async function enqueue(courseId, steps, { engine } = {}) {
  if (isRunning(courseId)) { toast('Un traitement est déjà en cours pour ce cours.'); return null; }
  const s = getSettings();
  const job = {
    courseId, steps, idx: 0, engine: engine || s.engine, state: 'waiting', error: null,
    retryAt: 0, tries: 0, data: {}, createdAt: Date.now(), updatedAt: Date.now(),
  };
  await saveJob(job);
  kick();
  return job;
}

export async function cancel(courseId) {
  if (isRunning(courseId)) running.ctrl.abort();
  await db.del('jobs', courseId);
  live.delete(courseId);
  emit('job', { courseId, job: null });
}

export async function retry(courseId) {
  const job = await getJob(courseId);
  if (!job) return;
  Object.assign(job, { state: 'waiting', retryAt: 0, tries: 0, error: null, needKey: null });
  await saveJob(job);
  kick();
}

/** Les traitements à lancer pour un cours, selon ce qui est déjà fait. */
export function missingSteps(course, { withAi = !!getKeys().anthropic } = {}) {
  const out = [];
  if (!course.raw) out.push('transcribe');
  if (withAi) {
    if (!course.clean) out.push('clean');
    if (!course.sheet) out.push('sheet');
    if (!course.quiz) out.push('train');
  }
  return out;
}

/**
 * Après un enregistrement ou un import : lance tout seul ce qui peut l'être, selon les réglages.
 * Renvoie true si quelque chose a été lancé.
 */
export async function autoStart(course) {
  const s = getSettings(), k = getKeys();
  const ai = s.autoAi && !!k.anthropic;
  const steps = [];
  if (!course.raw) {
    if (!s.autoTranscribe || s.engine === 'local' || !k[s.engine] || !course.hasAudio) return false;
    steps.push('transcribe');
  }
  if (ai) steps.push(...missingSteps(course, { withAi: true }).filter(x => x !== 'transcribe'));
  if (!steps.length) return false;
  await enqueue(course.id, steps);
  return true;
}

// ------------------------------------------------------------------ exécution
async function pickNext() {
  clearTimeout(timer);
  // Pas de traitement pendant un enregistrement : le téléphone doit garder toute sa mémoire pour le micro
  if (recorder.state !== 'idle' && !recorder.memoryOnly) { timer = setTimeout(kick, 30000); return null; }
  const now = Date.now();
  let soonest = Infinity;
  for (const j of await listJobs()) {
    if (j.state === 'error') continue;
    if (j.state === 'offline' && !navigator.onLine) continue;
    if (j.retryAt && j.retryAt > now) { soonest = Math.min(soonest, j.retryAt); continue; }
    return j;
  }
  if (soonest < Infinity) timer = setTimeout(kick, soonest - now + 300);
  return null;
}

export async function kick() {
  if (busy) return;
  busy = true;
  try {
    for (let job = await pickNext(); job; job = await pickNext()) await run(job);
  } catch (e) {
    console.error(e);
  } finally {
    busy = false;
  }
}

async function run(job) {
  const ctrl = new AbortController();
  running = { courseId: job.courseId, ctrl };
  Object.assign(job, { state: 'running', error: null, retryAt: 0 });
  await saveJob(job);
  holdWake();
  try {
    while (job.idx < job.steps.length) {
      const step = job.steps[job.idx];
      if (!(await getCourse(job.courseId))) { await db.del('jobs', job.courseId); return; }
      const ctx = {
        signal: ctrl.signal,
        report: p => { live.set(job.courseId, { step, ...p }); emit('job', { courseId: job.courseId, job, progress: live.get(job.courseId) }); },
        save: async () => { job.tries = 0; await saveJob(job, true); },
      };
      ctx.report({ label: `${STEP_LABEL[step]}…` });
      await RUN[step](job.courseId, job, ctx);
      job.idx++;
      job.tries = 0;
      await saveJob(job, true);
    }
    await db.del('jobs', job.courseId);
    const c = await getCourse(job.courseId);
    if (c) toast(h('span', null, '✅ ', h('a', { href: `#/c/${c.id}`, style: 'color:inherit' }, c.title), ' : ',
      job.steps.includes('train') ? 'fiche et quiz prêts.' : job.steps.includes('sheet') ? 'fiche prête.' : 'transcription terminée.'), 'ok', 7000);
  } catch (e) {
    if (e?.name === 'AbortError' || ctrl.signal.aborted) return;   // annulé par l'utilisateur
    if (e instanceof StepError) console.warn('Traitement arrêté :', e.message); else console.error(e);
    const se = e instanceof StepError ? e : new StepError(humanError(e));
    if (!se.limit) job.tries = (job.tries || 0) + 1;
    if (se.offline && !navigator.onLine) Object.assign(job, { state: 'offline', error: se.message });
    else if (se.retry && job.tries <= 5) Object.assign(job, { state: 'waiting', error: se.message, retryAt: Date.now() + (se.waitMs || 20000) * Math.max(1, job.tries) });
    else Object.assign(job, { state: 'error', error: se.message, needKey: se.key || null });
    if (await getCourse(job.courseId)) await saveJob(job, true);
  } finally {
    running = null;
    live.delete(job.courseId);
    releaseWake();
    emit('job', { courseId: job.courseId, job: await getJob(job.courseId) });
  }
}

// Garde l'écran allumé pendant un traitement (sinon le navigateur peut tout mettre en pause)
async function holdWake() {
  try { if ('wakeLock' in navigator && document.visibilityState === 'visible' && !wake) wake = await navigator.wakeLock.request('screen'); } catch {}
}
function releaseWake() { try { wake?.release(); } catch {} wake = null; }

/** Au démarrage de l'appli. */
export async function init() {
  for (const j of await listJobs()) {
    if (j.state === 'running') { j.state = 'waiting'; await saveJob(j, true); }
  }
  window.addEventListener('online', async () => {
    for (const j of await listJobs()) if (j.state === 'offline') { j.state = 'waiting'; j.retryAt = 0; await saveJob(j, true); }
    kick();
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { if (running) holdWake(); kick(); } });
  recorder.addEventListener('stop', () => setTimeout(kick, 1500));
  kick();
}

// ------------------------------------------------------------------ interface
/** Texte d'état d'un traitement */
export function jobStatus(job, prog) {
  if (!job) return '';
  const step = STEP_LABEL[job.steps[job.idx]] || '';
  if (job.state === 'running') return prog?.label || `${step}…`;
  if (job.state === 'offline') return `📴 En attente du réseau (${step.toLowerCase()}) : ça reprendra tout seul.`;
  if (job.state === 'error') return `❌ ${job.error || 'Erreur'}`;
  if (job.retryAt && job.retryAt > Date.now()) return `⏳ ${job.error || 'Nouvel essai bientôt'}`;
  return `⏳ En file d'attente : ${job.steps.slice(job.idx).map(s => STEP_LABEL[s].toLowerCase()).join(', ')}.`;
}

/** Bloc de l'accueil : les traitements en cours */
export function homeBlock({ extras }) {
  const box = h('div');
  add(extras, box);
  const render = async () => {
    const jobs = await listJobs();
    const rows = await Promise.all(jobs.map(async j => {
      const c = await getCourse(j.courseId);
      return c ? h('a', { class: 'item', href: `#/c/${c.id}` },
        h('div', { class: 'grow' }, h('div', { class: 'item-title' }, c.title),
          h('div', { class: 'item-meta' }, jobStatus(j, progressOf(j.courseId))))) : null;
    }));
    put(box, ...(rows.some(Boolean) ? [h('h2', null, 'En cours de traitement'), h('div', { class: 'list' }, rows.filter(Boolean))] : []));
  };
  render();
  let last = 0;
  const off = on('job', () => { const n = Date.now(); if (n - last > 700) { last = n; render(); } else setTimeout(render, 750); });
  return off;
}

/** Bloc des réglages : traitements automatiques */
export function settingsBlock({ extras }) {
  const s = getSettings();
  const check = (key, label, help) => h('label', { class: 'check' },
    h('input', { type: 'checkbox', checked: s[key], onchange: e => setSettings({ [key]: e.target.checked }) }),
    h('span', null, label, h('br'), h('span', { class: 'muted small' }, help)));
  addFirst(extras, h('div', { class: 'card' },
    h('h2', null, 'Automatique'),
    check('autoTranscribe', 'Transcrire tout seul après un enregistrement ou un import',
      `Avec le moteur choisi (${ENGINES[s.engine]?.short || s.engine}), dès qu'il y a du réseau. Pas avec « Local PC ».`),
    check('autoAi', 'Puis faire le nettoyage, la fiche et le quiz (Claude)',
      'Seulement si ta clé Anthropic est enregistrée.')));
}
