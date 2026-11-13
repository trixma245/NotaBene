// Traitement audio dans le navigateur : décodage, passage en mono 16 kHz,
// normalisation du volume (filtre passe-haut optionnel), export WAV.
// 16 kHz mono est exactement ce qu'attend Whisper : inutile d'envoyer plus.

export const SR = 16000;

/** Décode un fichier audio (n'importe quel format lisible par le navigateur). */
export function decode(arrayBuffer) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) return Promise.reject(new Error("Ce navigateur ne sait pas décoder l'audio. Essaie avec Chrome."));
  let ctx;
  try { ctx = new OAC(1, 1, SR); } catch { ctx = new OAC(1, 1, 44100); } // vieux Safari : pas de 16 kHz
  return new Promise((res, rej) => {
    const fail = e => rej(new Error("Ce fichier audio n'a pas pu être lu (format non pris en charge ou fichier abîmé)." + (e?.message ? ` [${e.message}]` : '')));
    try {
      const p = ctx.decodeAudioData(arrayBuffer, res, fail);
      if (p && p.catch) p.catch(() => {});
    } catch (e) { fail(e); }
  });
}

/** Mesure du niveau : rms et crête en dBFS, p999 = crête « robuste » (ignore les clics). */
export function levelStats(x) {
  let sum = 0, peak = 0;
  const bins = new Uint32Array(2000);
  const step = x.length > 400000 ? 4 : 1;
  let n = 0;
  for (let i = 0; i < x.length; i += step) {
    const a = Math.abs(x[i]);
    sum += a * a; n++;
    if (a > peak) peak = a;
    bins[Math.min(1999, (a * 2000) | 0)]++;
  }
  let acc = 0, p999 = peak;
  const target = n * 0.999;
  for (let b = 0; b < 2000; b++) { acc += bins[b]; if (acc >= target) { p999 = (b + 1) / 2000; break; } }
  const dB = v => 20 * Math.log10(Math.max(v, 1e-7));
  return { rmsDb: dB(Math.sqrt(sum / Math.max(1, n))), peakDb: dB(peak), p999: Math.min(p999, Math.max(peak, 1e-7)), duration: x.length / SR };
}

/** Remonte le volume pour que la voix occupe toute la plage (jusqu'à ×100 pour un son très lointain). */
export function normalize(x, stats = levelStats(x)) {
  if (stats.p999 < 1e-5) return 1; // silence complet : rien à amplifier
  const g = Math.min(0.89 / stats.p999, 100);
  if (Math.abs(g - 1) < 0.02) return 1;
  for (let i = 0; i < x.length; i++) {
    const v = x[i] * g;
    x[i] = v > 1 ? 1 : v < -1 ? -1 : v;
  }
  return g;
}

/**
 * AudioBuffer -> échantillons mono 16 kHz, volume normalisé (gain simple, sans déformer le son).
 * Le passe-haut 80 Hz est optionnel : mesuré sur un cours lointain et bruité, tout filtrage
 * (passe-haut, débruitage) fait un peu PLUS d'erreurs avec Whisper que le son brut.
 * Renvoie aussi le niveau mesuré AVANT normalisation.
 */
export async function to16kMono(ab, { clean = true, highpass = false } = {}) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const len = Math.max(1, Math.round(ab.duration * SR));
  let x;
  try {
    const ctx = new OAC(1, len, SR);
    const src = ctx.createBufferSource();
    src.buffer = ab;
    let node = src;
    if (clean && highpass) {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 80; hp.Q.value = 0.707;
      node.connect(hp); node = hp;
    }
    node.connect(ctx.destination);
    src.start();
    x = (await ctx.startRendering()).getChannelData(0);
  } catch {
    x = naiveResample(ab); // secours si le navigateur refuse un contexte à 16 kHz
  }
  const stats = levelStats(x);
  if (clean) normalize(x, stats);
  return { samples: x, stats };
}

function naiveResample(ab) {
  const ratio = ab.sampleRate / SR, n = Math.floor(ab.length / ratio), out = new Float32Array(n);
  const chans = [];
  for (let c = 0; c < ab.numberOfChannels; c++) chans.push(ab.getChannelData(c));
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio), b = Math.min(ab.length, Math.floor((i + 1) * ratio) || a + 1);
    let s = 0;
    for (const ch of chans) for (let j = a; j < b; j++) s += ch[j];
    out[i] = s / (chans.length * Math.max(1, b - a));
  }
  return out;
}

/** Échantillons -> fichier WAV 16 bits mono */
export function encodeWav(samples, sampleRate = SR) {
  const n = samples.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
  const out = new Int16Array(buf, 44, n);
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    out[i] = s >= 1 ? 32767 : s <= -1 ? -32768 : Math.round(s * 32767);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/** Avis en clair sur un niveau sonore mesuré (sert au test de captation). */
export function verdict(stats) {
  const p = 20 * Math.log10(Math.max(stats.p999, 1e-7));
  if (p < -50) return { level: 'err', text: "Presque rien n'est capté. Dans cette position, la transcription sera très mauvaise : rapproche l'appareil ou sors-le du sac." };
  if (p < -34) return { level: 'warn', text: "Son faible. Ça peut marcher si la salle est calme, mais essaie une meilleure position (micro vers le prof, pas enfoui sous des affaires)." };
  if (p > -1.5 && stats.rmsDb > -12) return { level: 'warn', text: 'Son très fort, peut-être saturé. Éloigne un peu l\'appareil ou baisse le gain.' };
  return { level: 'ok', text: 'Bon niveau. Cette position devrait donner une transcription correcte.' };
}
