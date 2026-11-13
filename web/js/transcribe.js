// Transcription par les API (Groq ou OpenAI).
// 1. chaque partie de l'audio est décodée puis préparée dans le navigateur (mono 16 kHz,
//    volume normalisé ; pas de débruitage : mesuré, il fait plus d'erreurs avec Whisper) ;
// 2. elle est découpée en morceaux de 5 min (≈ 9,6 Mo en WAV, sous la limite de 25 Mo des API)
//    qui commencent 2 s avant la fin du précédent ;
// 3. chaque morceau est envoyé avec un « prompt » (matière + vocabulaire + fin du texte précédent) ;
// 4. les résultats sont gardés au fur et à mesure (reprise possible), puis recollés sans doublons.
import { getKeys, getSubject } from './settings.js';
import { partBlob, saveCourse, getCourse } from './db.js';
import { decode, to16kMono, encodeWav, levelStats, normalize, SR } from './audio.js';
import { mergeChunks, approxSegments } from './merge.js';
import { h, sleep, add, put } from './util.js';

export const SEG_SEC = 300;
export const OVL_SEC = 2;

/** Erreur d'une étape. retry : on peut réessayer plus tard ; waitMs : quand ; offline : attendre le réseau. */
export class StepError extends Error {
  constructor(message, { retry = false, waitMs = 0, offline = false, key = null, limit = false } = {}) {
    super(message);
    Object.assign(this, { retry, waitMs, offline, key, limit });
  }
}

/** Nombre de morceaux pour une partie de `dur` secondes (le dernier peut aller jusqu'à 5 min 20). */
export const planPart = dur => Math.max(1, Math.ceil((dur - 20) / SEG_SEC));

const ENGINE_KEY = { groq: 'groq', openai: 'openai' };
const NAMES = { groq: 'Groq', openai: 'OpenAI' };

/** Message d'erreur clair à partir d'une réponse HTTP d'une API de transcription. */
async function httpError(r, engine) {
  let detail = '';
  try { const j = await r.json(); detail = j?.error?.message || ''; } catch {}
  const n = NAMES[engine];
  if (r.status === 401 || r.status === 403) return new StepError(`Clé ${n} refusée. Vérifie-la dans Réglages (bouton « Tester la clé »).`, { key: engine });
  if (r.status === 413) return new StepError(`Morceau audio trop gros pour ${n}.`);
  if (r.status === 429) {
    const ra = parseFloat(r.headers.get('retry-after')) || 0;
    const wait = Math.min(15 * 60, Math.max(20, ra || 60)) * 1000;
    return new StepError(`Limite d'utilisation ${n} atteinte (offre gratuite). Reprise automatique dans ${Math.round(wait / 1000)} s.`, { retry: true, waitMs: wait, limit: true });
  }
  if (r.status >= 500) return new StepError(`${n} a un problème temporaire (${r.status}). Nouvel essai bientôt.`, { retry: true, waitMs: 30000 });
  return new StepError(`${n} a refusé ce morceau (${r.status}) : ${detail || 'erreur inconnue'}`);
}

async function post(url, key, fd, engine, signal) {
  let r;
  try {
    r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd, signal });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw new StepError('Connexion perdue pendant l\'envoi. Ça reprendra quand le réseau sera revenu.', { offline: true, retry: true, waitMs: 15000 });
  }
  if (!r.ok) throw await httpError(r, engine);
  return r.json();
}

/**
 * Envoie un WAV à l'API choisie. Renvoie { segments:[{s,e,t,nsp,lp,cr}], model, approx }.
 * dur : durée du WAV (sert à répartir le temps quand l'API ne donne pas d'horodatage).
 */
export async function transcribeWav(engine, wav, { prompt = '', dur = 0, signal } = {}) {
  const key = getKeys()[ENGINE_KEY[engine]];
  if (!key) throw new StepError(`Ajoute ta clé ${NAMES[engine] || engine} dans Réglages pour transcrire.`, { key: engine });
  if (!navigator.onLine) throw new StepError('Pas de réseau : la transcription reprendra toute seule quand internet reviendra.', { offline: true, retry: true });
  prompt = prompt.slice(-700);
  if (engine === 'groq') {
    const fd = new FormData();
    fd.append('file', wav, 'morceau.wav');
    fd.append('model', 'whisper-large-v3');
    fd.append('language', 'fr');
    fd.append('response_format', 'verbose_json');
    fd.append('temperature', '0');
    if (prompt) fd.append('prompt', prompt);
    const j = await post('https://api.groq.com/openai/v1/audio/transcriptions', key, fd, engine, signal);
    return {
      model: 'whisper-large-v3', approx: false,
      segments: (j.segments || []).map(s => ({ s: s.start, e: s.end, t: s.text, nsp: s.no_speech_prob, lp: s.avg_logprob, cr: s.compression_ratio })),
    };
  }
  if (engine === 'openai') {
    const fd = new FormData();
    fd.append('file', wav, 'morceau.wav');
    fd.append('model', 'gpt-4o-transcribe');
    fd.append('language', 'fr');
    fd.append('response_format', 'json');
    if (prompt) fd.append('prompt', prompt);
    try {
      const j = await post('https://api.openai.com/v1/audio/transcriptions', key, fd, engine, signal);
      // gpt-4o-transcribe ne donne pas l'horodatage : on le répartit sur les phrases
      return { model: 'gpt-4o-transcribe', approx: true, segments: approxSegments(j.text, dur) };
    } catch (e) {
      // Modèle indisponible pour ce compte : on se rabat sur whisper-1 (horodatages précis)
      if (!(e instanceof StepError) || e.retry || e.key || !/model|modèle|400|404/i.test(e.message)) throw e;
      fd.set('model', 'whisper-1');
      fd.set('response_format', 'verbose_json');
      fd.append('timestamp_granularities[]', 'segment');
      const j = await post('https://api.openai.com/v1/audio/transcriptions', key, fd, engine, signal);
      return {
        model: 'whisper-1', approx: false,
        segments: (j.segments || []).map(s => ({ s: s.start, e: s.end, t: s.text, nsp: s.no_speech_prob, lp: s.avg_logprob, cr: s.compression_ratio })),
      };
    }
  }
  throw new StepError('Moteur de transcription inconnu.');
}

/** Prompt Whisper : matière + vocabulaire + fin du texte précédent (pour la continuité). */
export function whisperPrompt(subjectId, prevText = '') {
  const s = getSubject(subjectId);
  let p = s ? `Cours de ${s.name}, en français.` : 'Cours en français.';
  if (s?.vocab) p += ` Vocabulaire : ${s.vocab.slice(0, 420)}.`;
  const tail = String(prevText || '').slice(-260);
  if (tail) p += ` ${tail.replace(/^\S*\s/, '')}`;
  return p;
}

/** Décode et nettoie une partie. Renvoie un Float32Array mono 16 kHz. */
async function partSamples(course, part) {
  let ab;
  try {
    ab = await decode(await (await partBlob(course, part)).arrayBuffer());
  } catch (e) {
    throw new StepError(e.message);
  }
  try {
    return (await to16kMono(ab, { clean: true })).samples;
  } catch {
    throw new StepError("Pas assez de mémoire pour préparer cet audio (fichier très long ?). Essaie sur PC, ou avec le transcripteur local.");
  }
}

const isSilent = x => levelStats(x).rmsDb < -60;

/**
 * Étape « transcription » de la file d'attente.
 * job.data.segs[`part-j`] = { start, ovl, done, segments, model, approx }
 * ctx = { engine, report({label, done, total, dots}), save(), signal }
 */
export async function transcribeCourse(courseId, job, ctx) {
  let course = await getCourse(courseId);
  if (!course) throw new StepError('Ce cours a été supprimé.');
  if (!course.hasAudio || !course.parts?.length) throw new StepError("Ce cours n'a pas d'audio sur cet appareil.");
  const engine = job.engine;
  const d = job.data || (job.data = {});
  const segs = d.segs || (d.segs = {});
  const parts = [...course.parts].sort((a, b) => a.part - b.part);
  const plan = d.plan || (d.plan = {});
  for (const p of parts) if (!plan[p.part]) plan[p.part] = planPart(p.dur || 0);

  const keys = () => parts.flatMap(p => Array.from({ length: plan[p.part] }, (_, j) => `${p.part}-${j}`));
  const report = (label, run = null) => {
    const all = keys();
    ctx.report({ label, done: all.filter(k => segs[k]?.done).length, total: all.length, dots: all.map(k => segs[k]?.done ? 'done' : k === run ? 'run' : '') });
  };

  let cache = { part: null, x: null };
  const getSamples = async part => {
    if (cache.part !== part) { cache = { part: null, x: null }; cache = { part, x: await partSamples(course, part) }; }
    return cache.x;
  };

  let start = 0;   // début de la partie dans le cours (recalculé avec les vraies durées)
  for (let pi = 0; pi < parts.length; pi++) {
    const p = parts[pi];
    const pStart = p.start ?? start;
    const pending = () => Array.from({ length: plan[p.part] }, (_, j) => `${p.part}-${j}`).filter(k => !segs[k]?.done);
    if (!pending().length) { start = pStart + (p.dur || 0); continue; }

    report(`Préparation de l'audio (partie ${pi + 1}/${parts.length})…`);
    const x = await getSamples(p.part);
    const dur = x.length / SR;
    // Avec la vraie durée, le découpage peut changer : on oublie les morceaux pas encore faits
    const n = planPart(dur);
    if (n !== plan[p.part]) {
      for (let j = 0; j < Math.max(n, plan[p.part]); j++) { const k = `${p.part}-${j}`; if (!segs[k]?.done || j >= n) delete segs[k]; }
      plan[p.part] = n;
    }
    // Les 2 dernières secondes de la partie précédente (pour ne pas couper un mot à la frontière)
    let carry = null;
    if (pi > 0 && !segs[`${p.part}-0`]?.done) {
      try {
        const prev = await partSamples(course, parts[pi - 1].part);
        carry = prev.subarray(Math.max(0, prev.length - OVL_SEC * SR)).slice();
      } catch { carry = null; }
    }

    for (let j = 0; j < n; j++) {
      const k = `${p.part}-${j}`;
      if (segs[k]?.done) continue;
      if (ctx.signal?.aborted) throw new DOMException('Annulé', 'AbortError');
      const a = j * SEG_SEC, b = j === n - 1 ? dur : (j + 1) * SEG_SEC;
      let slice, ovl;
      if (j === 0 && carry?.length) {
        slice = new Float32Array(carry.length + Math.round((b - a) * SR));
        slice.set(carry, 0);
        slice.set(x.subarray(0, Math.round(b * SR)), carry.length);
        ovl = carry.length / SR;
      } else {
        ovl = j === 0 ? 0 : OVL_SEC;
        slice = x.slice(Math.round((a - ovl) * SR), Math.round(b * SR));
      }
      const segStart = pStart + a - ovl;
      const all = keys(), idx = all.indexOf(k) + 1;
      report(`Transcription du morceau ${idx}/${all.length}…`, k);

      let res;
      if (isSilent(slice)) {
        res = { segments: [], model: '', approx: false };   // silence : inutile d'envoyer
      } else {
        normalize(slice);
        const prevKey = j > 0 ? `${p.part}-${j - 1}` : pi > 0 ? `${parts[pi - 1].part}-${plan[parts[pi - 1].part] - 1}` : null;
        const prevText = prevKey && segs[prevKey]?.segments ? segs[prevKey].segments.map(s => s.t).join(' ') : '';
        res = await transcribeWav(engine, encodeWav(slice), { prompt: whisperPrompt(course.subjectId, prevText), dur: slice.length / SR, signal: ctx.signal });
      }
      segs[k] = { start: +segStart.toFixed(2), ovl: +ovl.toFixed(2), done: true, segments: res.segments, model: res.model, approx: res.approx };
      await ctx.save();
    }
    start = pStart + dur;
  }

  // Recollage final, dans l'ordre des parties et des morceaux
  const chunks = keys().map(k => segs[k]).filter(Boolean);
  const merged = mergeChunks(chunks);
  const models = [...new Set(chunks.map(c => c.model).filter(Boolean))];
  course = await getCourse(courseId);
  if (!course) throw new StepError('Ce cours a été supprimé.');
  course.raw = {
    engine, model: models.join(' + ') || '—', approx: chunks.some(c => c.approx),
    createdAt: Date.now(), segments: merged,
  };
  await saveCourse(course);
  return course;
}

/** Bloc ajouté au test de captation : « Transcrire l'extrait » */
export function testBlock({ box, samples }) {
  if (!samples) return;
  const out = h('div');
  const btn = h('button', { class: 'btn block', onclick: async () => {
    btn.disabled = true; btn.textContent = 'Transcription de l\'extrait…';
    try {
      const { getSettings } = await import('./settings.js');
      const engine = getSettings().engine === 'openai' ? 'openai' : 'groq';
      const x = samples.slice();
      normalize(x);
      const r = await transcribeWav(engine, encodeWav(x), { prompt: 'Cours en français.', dur: x.length / SR });
      const text = r.segments.map(s => s.t).join(' ').trim();
      put(out, h('p', { class: 'small muted', style: 'margin:10px 0 4px' }, `Ce que ${NAMES[engine]} a compris :`),
        h('div', { class: 'live-box' }, text || h('i', null, '(rien de compréhensible)')));
    } catch (e) {
      put(out, h('div', { class: 'banner err' }, e.message));
    }
    btn.disabled = false; btn.textContent = 'Transcrire l\'extrait';
  } }, 'Transcrire l\'extrait');
  add(box, btn, out);
}
