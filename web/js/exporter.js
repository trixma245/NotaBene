// Exports d'un cours : Markdown, texte, impression/PDF de la fiche, audio, paquet pour le PC.
import { h, $, download, safeName, fmtDate, fmtDur, toast, add, addFirst } from './util.js';
import { partBlob } from './db.js';
import { getSubject, subjectName } from './settings.js';
import { extOf } from './recorder.js';
import { renderMd, mdToText } from './markdown.js';
import { rawToText } from './merge.js';
import { makeZip } from './zip.js';

const meta = c => [subjectName(c.subjectId), fmtDate(c.createdAt), c.duration ? fmtDur(c.duration) : null].filter(Boolean).join(' · ');

/** Tout le cours en Markdown */
export function courseMarkdown(c) {
  const out = [`# ${c.title}`, `_${meta(c)}_`];
  if (c.sheet?.md) out.push('---', c.sheet.md.replace(/^#\s+.+\n?/, '## Fiche de révision\n'));
  if (c.quiz?.mcq?.length || c.quiz?.open?.length) {
    out.push('---', '## Quiz');
    (c.quiz.mcq || []).forEach((q, i) => out.push(`**${i + 1}. ${q.question}**\n\n${q.choices.map((ch, k) => `- ${k === q.answer ? '✅' : '⬜'} ${ch}`).join('\n')}\n\n> ${q.explanation}`));
    (c.quiz.open || []).forEach((q, i) => out.push(`**Question ouverte ${i + 1}. ${q.question}**\n\n> ${q.answer.replace(/\n/g, '\n> ')}`));
  }
  if (c.cards?.length) out.push('---', '## Cartes de révision', c.cards.map(k => `- **${k.front}** — ${k.back}`).join('\n'));
  if (c.clean?.md) out.push('---', '## Texte du cours (nettoyé)', c.clean.md);
  else if (c.raw?.segments?.length) out.push('---', '## Transcription', rawToText(c.raw.segments));
  return out.join('\n\n') + '\n';
}

export function exportMd(c) {
  download(new Blob([courseMarkdown(c)], { type: 'text/markdown;charset=utf-8' }), `${safeName(c.title)}.md`);
}
export function exportTxt(c) {
  download(new Blob([mdToText(courseMarkdown(c))], { type: 'text/plain;charset=utf-8' }), `${safeName(c.title)}.txt`);
}

/** Impression propre de la fiche (ou « Enregistrer en PDF » dans la fenêtre d'impression) */
export function printSheet(c) {
  const box = $('#print');
  const md = c.sheet?.md || c.clean?.md || '';
  if (!md) { toast('Pas encore de fiche à imprimer.'); return; }
  box.innerHTML = '';
  add(box, h('div', { class: 'print-meta' }, `${meta(c)} · NotaBene`), h('div', { html: renderMd(md) }));
  if (!/^#\s/m.test(md)) addFirst(box, h('h1', null, c.title));
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); box.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => { window.print(); setTimeout(done, 1000); }, 50);
}

/** Audio du cours : un fichier, ou un .zip si l'enregistrement a plusieurs parties */
export async function downloadAudio(c) {
  const parts = [...(c.parts || [])].sort((a, b) => a.part - b.part);
  if (!parts.length) { toast('Pas d\'audio sur cet appareil.'); return; }
  if (parts.length === 1) {
    const b = await partBlob(c, parts[0].part);
    download(b, `${safeName(c.title)}.${extOf(b.type || parts[0].mime, c.fileName)}`);
    return;
  }
  toast('Préparation du fichier .zip…');
  const files = [];
  for (const [i, p] of parts.entries()) {
    const b = await partBlob(c, p.part);
    files.push({ name: `${safeName(c.title)} - partie ${String(i + 1).padStart(2, '0')}.${extOf(b.type || p.mime)}`, data: b });
  }
  download(await makeZip(files), `${safeName(c.title)} (audio).zip`);
}

/** Paquet pour le transcripteur du PC : l'audio + les infos du cours (matière, vocabulaire, id). */
export async function exportForPc(c) {
  const parts = [...(c.parts || [])].sort((a, b) => a.part - b.part);
  if (!parts.length) { toast('Pas d\'audio sur cet appareil.'); return; }
  toast('Préparation du fichier pour le PC…');
  const files = [], list = [];
  for (const [i, p] of parts.entries()) {
    const b = await partBlob(c, p.part);
    const name = `partie-${String(i + 1).padStart(2, '0')}.${extOf(b.type || p.mime, parts.length === 1 ? c.fileName : '')}`;
    files.push({ name, data: b });
    list.push({ file: name, start: p.start || 0, dur: p.dur || 0 });
  }
  const s = getSubject(c.subjectId);
  const manifest = { notabene: 'export-audio', version: 1, courseId: c.id, title: c.title, subject: s?.name || null, vocab: s?.vocab || '', parts: list };
  files.unshift({ name: 'notabene.json', data: JSON.stringify(manifest, null, 1) });
  download(await makeZip(files), `${safeName(c.title)}.notabene.zip`);
}
