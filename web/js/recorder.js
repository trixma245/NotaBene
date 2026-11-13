// Enregistrement robuste.
// Principe : l'audio est écrit dans IndexedDB toutes les 30 secondes. Si l'appli plante,
// si la batterie meurt ou si la page se ferme, on perd au pire les 30 dernières secondes.
// Toutes les 5 minutes on commence une nouvelle « partie » (un fichier audio complet,
// lisible seul) : un long cours reste ainsi facile à relire et à transcrire, même sur
// un téléphone avec peu de mémoire.
import { db, saveCourse, partBlob, listCourses } from './db.js';
import { decode } from './audio.js';

export const PART_SEC = 300;   // durée d'une partie
const SLICE_MS = 30000;        // écriture sur le disque toutes les 30 s
const MIMES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm'];

/** Renvoie un message si l'enregistrement est impossible ici, sinon null. */
export function recorderSupport() {
  if (!window.isSecureContext) return "Le micro n'est disponible que sur une page sécurisée (https) ou sur localhost. Ouvre l'appli depuis son adresse GitHub Pages.";
  if (!navigator.mediaDevices?.getUserMedia) return "Ce navigateur ne permet pas d'utiliser le micro. Utilise Chrome (Android/PC) ou Safari récent (iPhone).";
  if (!window.MediaRecorder) return "Ce navigateur ne sait pas enregistrer (MediaRecorder absent). Mets-le à jour ou utilise Chrome.";
  return null;
}
export const pickMime = () => MIMES.find(m => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) || '';

export function extOf(mime = '', fileName = '') {
  const m = /\.([a-z0-9]{2,5})$/i.exec(fileName);
  if (m) return m[1].toLowerCase();
  if (/mp4|m4a|aac/.test(mime)) return 'm4a';
  if (/ogg|opus/.test(mime)) return 'ogg';
  if (/wav/.test(mime)) return 'wav';
  if (/mpeg|mp3/.test(mime)) return 'mp3';
  return 'webm';
}

export function micErrorMessage(e) {
  switch (e?.name) {
    case 'NotAllowedError': case 'SecurityError':
      return "Micro refusé. Autorise le micro pour NotaBene : touche le cadenas à gauche de l'adresse → Autorisations → Micro → Autoriser, puis réessaie.";
    case 'NotFoundError': case 'OverconstrainedError':
      return "Aucun micro trouvé sur cet appareil. Branche un micro ou vérifie qu'il n'est pas désactivé.";
    case 'NotReadableError': case 'AbortError':
      return "Le micro est déjà utilisé par une autre appli (appel, dictaphone, autre onglet). Ferme-la puis réessaie.";
    default:
      return "Impossible d'accéder au micro : " + (e?.message || e);
  }
}

export async function batteryInfo() {
  try {
    if (!navigator.getBattery) return null;
    const b = await navigator.getBattery();
    return { level: b.level, charging: b.charging };
  } catch { return null; }
}

export class Recorder extends EventTarget {
  constructor() {
    super();
    this.state = 'idle';     // idle | recording | paused | stopping
    this.level = -100;       // niveau instantané en dBFS
    this.low = false;        // vrai si la voix est trop faible depuis ~15 s
    this.gaps = [];          // coupures détectées (écran verrouillé, appli gelée...)
    this._pending = new Set();
  }
  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  get elapsed() { return this.baseDur + this.activeMs / 1000; }   // secondes enregistrées
  get bytes() { return this.memoryOnly ? this.memBytes : (this.course?.size || 0); }

  /**
   * @param {object} o  course : cours dans lequel écrire (créé ou repris)
   *                    micMode : 'brut' | 'ameliore' ; chain : chaîne Web Audio ; gain : ×
   *                    memoryOnly : garde l'audio en mémoire (test de captation)
   */
  async start({ course, micMode = 'brut', chain = false, gain = 1, memoryOnly = false }) {
    if (this.state !== 'idle') throw new Error('Un enregistrement est déjà en cours.');
    const bad = recorderSupport();
    if (bad) throw new Error(bad);
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false, noiseSuppression: false,
          autoGainControl: micMode === 'ameliore',   // « Amélioré » : le téléphone remonte le volume tout seul
          channelCount: 1,
        },
      });
    } catch (e) { throw new Error(micErrorMessage(e)); }

    this.course = course; this.memoryOnly = memoryOnly; this.memChunks = []; this.memBytes = 0;
    this.gaps = []; this.low = false; this._hist = [];
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.recStream = this.stream;
    this.gainNode = null;
    if (chain) {
      // Chaîne optionnelle pour remonter une voix lointaine dès l'enregistrement
      const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 80;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -35; comp.knee.value = 20; comp.ratio.value = 6; comp.attack.value = 0.005; comp.release.value = 0.25;
      this.gainNode = this.ctx.createGain(); this.gainNode.gain.value = gain;
      const dest = this.ctx.createMediaStreamDestination();
      src.connect(hp); hp.connect(comp); comp.connect(this.gainNode);
      this.gainNode.connect(dest); this.gainNode.connect(this.analyser);
      this.recStream = dest.stream;
    } else {
      src.connect(this.analyser);
    }

    this.mime = pickMime();
    this.baseDur = memoryOnly ? 0 : (course.duration || 0);
    this.partIndex = memoryOnly ? 0 : (course.parts || []).reduce((m, p) => Math.max(m, p.part + 1), 0);
    this.activeMs = 0;
    this._last = performance.now();
    if (!memoryOnly) {
      course.parts = course.parts || [];
      course.state = 'recording'; course.hasAudio = true;
      course.mime = course.mime || this.mime;
      await saveCourse(course, true);
    }
    try { this._startPart(); } catch (e) { this._cleanup(); throw new Error("L'enregistrement n'a pas pu démarrer : " + (e?.message || e)); }
    this.state = 'recording';
    this._timer = setInterval(() => this._tick(), 200);

    this._onVis = () => {
      if (document.visibilityState === 'visible' && this.state !== 'idle') {
        this._wake();
        if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', this._onVis);
    const track = this.stream.getAudioTracks()[0];
    track.addEventListener('ended', () => {
      if (this.state === 'recording' || this.state === 'paused') {
        this._emit('error', { message: "Le micro a été coupé (autre appli, casque débranché...). L'enregistrement fait jusqu'ici est sauvegardé.", fatal: true });
        this.stop().catch(() => {});
      }
    });
    track.addEventListener('mute', () => this._emit('gap', { reason: 'mute' }));
    this._wake();
    this._emit('start');
  }

  _startPart() {
    const opts = { audioBitsPerSecond: 64000 };
    if (this.mime) opts.mimeType = this.mime;
    const mr = new MediaRecorder(this.recStream, opts);
    const meta = { part: this.partIndex++, start: this.elapsed, dur: 0, size: 0, mime: mr.mimeType || this.mime };
    let seq = 0;
    if (!this.memoryOnly) this.course.parts.push(meta);
    this.curMeta = meta;
    this.partStartMs = this.activeMs;
    mr.ondataavailable = e => {
      if (!e.data || !e.data.size) return;
      const p = this._save(meta, seq++, e.data);
      this._pending.add(p);
      p.finally(() => this._pending.delete(p));
    };
    mr.onerror = e => this._emit('error', { message: "Erreur d'enregistrement : " + (e.error?.message || 'inconnue') });
    mr.start(SLICE_MS);
    this.mr = mr;
  }

  async _save(meta, seq, blob) {
    if (this.memoryOnly) { this.memChunks.push(blob); this.memBytes += blob.size; return; }
    try {
      await db.put('chunks', { courseId: this.course.id, part: meta.part, seq, blob });
      meta.size += blob.size;
      this.course.size = (this.course.size || 0) + blob.size;
      if (meta === this.curMeta && this.state !== 'idle') meta.dur = this.elapsed - meta.start;
      this.course.duration = Math.max(this.course.duration || 0, meta.start + meta.dur);
      await saveCourse(this.course, true);
      this._emit('saved', { part: meta.part, seq });
    } catch (e) {
      const full = e?.name === 'QuotaExceededError' || /quota/i.test(e?.message || '');
      this._emit('error', { message: full
        ? "Stockage plein ! Les dernières secondes n'ont pas pu être sauvegardées. Arrête l'enregistrement et libère de la place (Réglages → Stockage)."
        : "Problème d'écriture sur l'appareil : " + (e?.message || e) });
    }
  }

  _stopMR(mr) {
    return new Promise(res => {
      if (!mr || mr.state === 'inactive') return res();
      mr.addEventListener('stop', () => res(), { once: true });
      try { mr.stop(); } catch { res(); }
    });
  }

  /** Nouvelle partie toutes les 5 min : on démarre la suivante AVANT d'arrêter l'ancienne (aucun trou). */
  _rotate() {
    const old = this.mr, oldMeta = this.curMeta;
    oldMeta.dur = this.elapsed - oldMeta.start;
    try { this._startPart(); } catch { this.curMeta = oldMeta; this.mr = old; this.partStartMs = this.activeMs; return; }
    this._stopMR(old);
  }

  _tick() {
    const now = performance.now(), dt = now - this._last;
    this._last = now;
    if (this.state === 'recording') {
      this.activeMs += dt;
      if (dt > 4000) { // l'appli a été « gelée » : écran verrouillé, autre appli au premier plan...
        const gap = { at: this.elapsed, ms: dt };
        this.gaps.push(gap);
        this._emit('gap', gap);
      }
      if (!this.memoryOnly && this.activeMs - this.partStartMs >= PART_SEC * 1000) this._rotate();
    }
    // Vumètre
    try {
      const buf = this._buf || (this._buf = new Float32Array(this.analyser.fftSize));
      this.analyser.getFloatTimeDomainData(buf);
      let s = 0;
      for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
      this.level = 10 * Math.log10(s / buf.length + 1e-12);
    } catch { this.level = -100; }
    if (this.state === 'recording') {
      this._hist.push(this.level);
      if (this._hist.length > 75) this._hist.shift();   // ~15 s
      if (this._hist.length >= 50) {
        const sorted = [...this._hist].sort((a, b) => a - b);
        this.low = sorted[Math.floor(sorted.length * 0.9)] < -45;   // même les moments forts sont faibles
      }
    }
    this._emit('tick');
  }

  setGain(v) { if (this.gainNode) this.gainNode.gain.value = v; }

  pause() {
    if (this.state !== 'recording') return;
    try { this.mr.pause(); } catch {}
    this.state = 'paused';
    this._emit('state');
  }
  resume() {
    if (this.state !== 'paused') return;
    try { this.mr.resume(); } catch {}
    this._last = performance.now();
    this.state = 'recording';
    this._emit('state');
  }

  /** Arrête et sauvegarde. Renvoie le cours (ou un Blob en mode test). */
  async stop() {
    if (this.state === 'idle' || this.state === 'stopping') return null;
    this._tick();
    this.state = 'stopping';
    clearInterval(this._timer);
    this.curMeta.dur = this.elapsed - this.curMeta.start;
    await this._stopMR(this.mr);
    await Promise.allSettled([...this._pending]);
    this._cleanup();
    let result;
    if (this.memoryOnly) {
      result = new Blob(this.memChunks, { type: this.mime });
    } else {
      const c = this.course;
      c.parts = c.parts.filter(p => p.size > 0);
      c.duration = c.parts.reduce((m, p) => Math.max(m, p.start + p.dur), 0);
      c.state = 'ready';
      c.hasAudio = c.parts.length > 0;
      if (this.gaps.length) c.gaps = [...(c.gaps || []), ...this.gaps];
      await saveCourse(c);
      result = c;
    }
    this.state = 'idle';
    this._emit('stop', { result });
    return result;
  }

  _cleanup() {
    clearInterval(this._timer);
    document.removeEventListener('visibilitychange', this._onVis);
    try { this.stream?.getTracks().forEach(t => t.stop()); } catch {}
    try { this.ctx?.close(); } catch {}
    try { this.wl?.release(); } catch {}
    this.wl = null;
  }

  /** Empêche l'écran de s'éteindre (sinon le navigateur coupe le micro) */
  async _wake() {
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible') {
        this.wl = await navigator.wakeLock.request('screen');
      }
    } catch { /* refusé (batterie faible...) : on continue */ }
    this.wakeOk = !!this.wl && !this.wl.released;
  }
}

/** L'enregistreur unique de l'appli */
export const recorder = new Recorder();

/**
 * Au démarrage de l'appli : retrouve les enregistrements interrompus (plantage, batterie vide,
 * page fermée) et les remet en état. Renvoie la liste des cours récupérés.
 */
export async function recoverInterrupted() {
  const out = [];
  for (const c of await listCourses()) {
    if (c.state !== 'recording' || recorder.course?.id === c.id) continue;
    const rows = await db.chunks(c.id);
    const sizes = new Map();
    for (const r of rows) sizes.set(r.part, (sizes.get(r.part) || 0) + r.blob.size);
    c.parts = (c.parts || []).filter(p => sizes.has(p.part)).map(p => ({ ...p, size: sizes.get(p.part) }));
    for (const part of sizes.keys()) {      // partie dont la fiche n'a pas eu le temps d'être écrite
      if (!c.parts.some(p => p.part === part)) c.parts.push({ part, start: 0, dur: 0, size: sizes.get(part), mime: c.mime });
    }
    c.parts.sort((a, b) => a.part - b.part);
    c.size = [...sizes.values()].reduce((a, b) => a + b, 0);
    c.hasAudio = c.parts.length > 0;
    c.state = 'ready';
    c.recovered = true;
    await fixDurations(c, true);
    await saveCourse(c);
    out.push(c);
  }
  return out;
}

/**
 * Mesure la vraie durée des parties en les décodant (utile après un plantage : la durée
 * notée peut avoir jusqu'à 30 s de retard). onlyLast : ne vérifie que la dernière partie.
 */
export async function fixDurations(course, onlyLast = false) {
  const parts = course.parts || [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (onlyLast && i < parts.length - 1 && p.dur > 0) continue;
    try {
      const ab = await decode(await (await partBlob(course, p.part)).arrayBuffer());
      p.dur = ab.duration;
    } catch { /* partie illisible : on garde l'estimation */ }
  }
  let t = 0;
  for (const p of parts) { p.start = t; t += p.dur; }
  course.duration = t;
  return course;
}

/** Aperçu en direct (reconnaissance vocale du navigateur). Ce n'est PAS la transcription finale. */
export class LivePreview {
  static supported() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); }
  start(onText) {
    const SRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SRec) return false;
    this.active = true; this.final = '';
    const run = () => {
      if (!this.active) return;
      const r = new SRec();
      r.lang = 'fr-FR'; r.continuous = true; r.interimResults = true;
      r.onresult = e => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) this.final = (this.final + t + ' ').slice(-1500); else interim += t;
        }
        onText(this.final, interim, null);
      };
      r.onerror = e => {
        if (['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported'].includes(e.error)) {
          this.active = false;
          onText(this.final, '', e.error);
        }
      };
      r.onend = () => { if (this.active) setTimeout(run, 500); };   // redémarrage automatique
      try { r.start(); this.rec = r; } catch { setTimeout(run, 1500); }
    };
    run();
    return true;
  }
  stop() { this.active = false; try { this.rec?.stop(); } catch {} }
}
