// Recollage des morceaux transcrits et petits traitements de texte (fonctions pures, testables).
// Chaque morceau d'audio envoyé à Whisper commence 2 s AVANT la fin du précédent : un mot coupé
// à la frontière est donc entendu en entier au moins une fois. Ici on retire les mots en double.
import { norm, fmtTime } from './util.js';

// Phrases que Whisper « invente » sur du silence ou du bruit (sous-titres de vidéos en ligne...)
const HALLU = /amara\.org|sous-titr|merci d'avoir regard|abonnez-vous|n'oubliez pas de vous abonner|like et abonne|à la prochaine vidéo|soustitreur|transcription par|www\.|\.com\b/i;

/** Retire les segments vides, inventés ou très probablement du silence. */
export function cleanWhisper(segs) {
  return (segs || []).filter(s => {
    const t = (s.t || '').trim();
    if (!t || /^[\s.,!?…-]*$/.test(t)) return false;
    if (HALLU.test(t)) return false;
    if (s.nsp != null && s.lp != null && s.nsp > 0.6 && s.lp < -1) return false;   // « pas de parole »
    if (s.cr != null && s.cr > 2.6 && t.length > 60) return false;                   // boucle de répétition
    return true;
  }).map(s => ({ s: +(+s.s).toFixed(2), e: +(+s.e).toFixed(2), t: s.t.trim() }));
}

const tokens = s => String(s || '').split(/\s+/).filter(Boolean);
const key = w => norm(w).replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Cherche les mots répétés entre la fin de `prevText` et le début de `nextText`.
 * Tolère un mot coupé (mal reconnu) à la fin du premier et au début du second.
 * Renvoie { dropPrev, dropNext } : nombre de mots à retirer à la fin de prev / au début de next.
 */
export function findOverlap(prevText, nextText, max = 16) {
  const pt = tokens(prevText), nt = tokens(nextText);
  const A = pt.map((w, i) => ({ k: key(w), i })).filter(x => x.k).slice(-max - 2);
  const B = nt.map((w, i) => ({ k: key(w), i })).filter(x => x.k).slice(0, max + 2);
  let best = null;
  for (let eA = 0; eA <= 2; eA++) {
    for (let sB = 0; sB <= 2; sB++) {
      const lim = Math.min(A.length - eA, B.length - sB, max);
      for (let k = lim; k >= 2; k--) {
        let ok = true;
        for (let j = 0; j < k && ok; j++) ok = A[A.length - eA - k + j].k === B[sB + j].k;
        if (!ok) continue;
        const score = k * 10 - eA - sB;
        if (!best || score > best.score) {
          best = {
            score,
            dropPrev: eA ? pt.length - A[A.length - eA].i : 0,
            dropNext: B[sB + k - 1].i + 1,
          };
        }
        break;
      }
    }
  }
  return best ? { dropPrev: best.dropPrev, dropNext: best.dropNext } : { dropPrev: 0, dropNext: 0 };
}

function dropTail(segs, n) {
  while (n > 0 && segs.length) {
    const s = segs[segs.length - 1], w = tokens(s.t);
    if (w.length <= n) { n -= w.length; segs.pop(); } else { s.t = w.slice(0, w.length - n).join(' '); n = 0; }
  }
}
function dropHead(segs, n) {
  while (n > 0 && segs.length) {
    const s = segs[0], w = tokens(s.t);
    if (w.length <= n) { n -= w.length; segs.shift(); } else { s.t = w.slice(n).join(' '); n = 0; }
  }
}

/**
 * chunks = [{ start, ovl, segments:[{s,e,t}] }] dans l'ordre. start = début du morceau dans le cours
 * (en secondes), ovl = durée du chevauchement au début du morceau, segments relatifs au morceau.
 * Renvoie la liste des segments du cours, temps absolus, sans doublons.
 */
export function mergeChunks(chunks) {
  const out = [];
  for (const ch of chunks) {
    const segs = cleanWhisper(ch.segments).map(s => ({ s: +(ch.start + s.s).toFixed(2), e: +(ch.start + s.e).toFixed(2), t: s.t }));
    if (!segs.length) continue;
    if (out.length && ch.ovl > 0) {
      // Les segments entièrement dans le chevauchement sont déjà dans le morceau précédent
      const ovlEnd = ch.start + ch.ovl;
      const lastEnd = out[out.length - 1].e;
      while (segs.length > 1 && segs[0].e <= ovlEnd - 0.2 && lastEnd >= segs[0].e - 0.5) segs.shift();
      const prevText = out.slice(-2).map(s => s.t).join(' ');
      const nextText = segs.slice(0, 2).map(s => s.t).join(' ');
      const { dropPrev, dropNext } = findOverlap(prevText, nextText);
      dropTail(out, dropPrev);
      dropHead(segs, dropNext);
      if (segs.length && out.length && segs[0].s < out[out.length - 1].e) segs[0].s = out[out.length - 1].e;
    }
    out.push(...segs.filter(s => s.t));
  }
  return out;
}

/**
 * Pour un moteur qui ne donne pas d'horodatage (gpt-4o-transcribe) : découpe le texte en phrases
 * et répartit le temps du morceau en proportion de leur longueur (approximatif, à ±quelques s).
 */
export function approxSegments(text, dur) {
  const parts = String(text || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?…])\s+/).filter(Boolean);
  const sentences = [];
  for (const p of parts) {
    const last = sentences[sentences.length - 1];
    if (last && last.length < 30) sentences[sentences.length - 1] = `${last} ${p}`;   // « Voilà. » collé à la suite
    else sentences.push(p);
  }
  const total = sentences.reduce((n, s) => n + s.length, 0) || 1;
  let t = 0;
  return sentences.map(s => {
    const d = dur * s.length / total;
    const seg = { s: +t.toFixed(2), e: +(t + d).toFixed(2), t: s };
    t += d;
    return seg;
  });
}

/** Regroupe les segments en paragraphes (pause > 2 s ou ~60 s de parole). */
export function paragraphs(segs, { pause = 2, span = 60 } = {}) {
  const out = [];
  let cur = null;
  for (const s of segs || []) {
    if (!cur || s.s - cur.e > pause || s.s - cur.s > span) { cur = { s: s.s, e: s.e, t: s.t }; out.push(cur); }
    else { cur.t += ' ' + s.t; cur.e = s.e; }
  }
  return out;
}

/** Transcription brute en texte : « [mm:ss] paragraphe » */
export const rawToText = segs => paragraphs(segs).map(p => `[${fmtTime(p.s)}] ${p.t}`).join('\n\n');

/** Nombre de mots */
export const wordCount = s => tokens(s).length;

// Mots qui signalent que le prof insiste (servent d'indices pour la fiche « Le prof a insisté »)
const EMPHASIS = /\b(retene[zr]|à retenir|retenez bien|important|essentiel|fondamental|à l'examen|en examen|au devoir|à l'interro|attention|faites attention|notez|notez bien|n'oubliez pas|je répète|je le répète|ça tombe|ça va tomber|par cœur|c'est la base|méfiez-vous|piège)\b/i;
export function emphasisHints(segs, max = 40) {
  const out = [];
  for (const s of segs || []) if (EMPHASIS.test(s.t)) out.push(`[${fmtTime(s.s)}] ${s.t}`);
  return out.slice(0, max);
}
