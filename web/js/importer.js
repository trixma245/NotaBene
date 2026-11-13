// Import : fichiers audio (dictaphone du téléphone...), résultats du transcripteur PC (.notabene.json),
// sauvegardes complètes (.json). Par le bouton de l'accueil, par glisser-déposer sur PC,
// ou par « Partager → NotaBene » depuis une autre appli sur Android.
import { h, toast, modal, humanError, fmtDur, norm, confirmBox } from './util.js';
import { db, newCourse, saveCourse, getCourse } from './db.js';
import { getSettings, setSettings, getSubjects } from './settings.js';
import { subjectSelect } from './views/common.js';

const AUDIO_EXT = /\.(m4a|mp3|wav|ogg|oga|opus|webm|weba|mp4|aac|flac|amr|3gp|3gpp|wma|mkv|mov)$/i;
const SLICE = 4 * 1024 * 1024;    // l'audio est rangé par tranches de 4 Mo
export const ACCEPT = 'audio/*,video/*,.m4a,.mp3,.wav,.ogg,.opus,.webm,.mp4,.aac,.flac,.amr,.3gp,.json';

const MIME_BY_EXT = { m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', webm: 'audio/webm', weba: 'audio/webm', flac: 'audio/flac', amr: 'audio/amr', '3gp': 'audio/3gpp', '3gpp': 'audio/3gpp' };
const guessMime = f => f.type || MIME_BY_EXT[(/\.([a-z0-9]+)$/i.exec(f.name)?.[1] || '').toLowerCase()] || '';

/** Durée d'un audio sans tout décoder (lecture des métadonnées). 0 si inconnue. */
export function probeDuration(blob) {
  return new Promise(res => {
    const a = new Audio(), url = URL.createObjectURL(blob);
    let done = false;
    const end = d => { if (done) return; done = true; URL.revokeObjectURL(url); a.removeAttribute('src'); res(isFinite(d) && d > 0 ? d : 0); };
    a.preload = 'metadata';
    a.onloadedmetadata = () => {
      if (a.duration === Infinity) {           // webm de Chrome : durée inconnue tant qu'on n'a pas tout lu
        a.ontimeupdate = () => { a.ontimeupdate = null; end(a.duration); };
        a.currentTime = 1e9;
      } else end(a.duration);
    };
    a.onerror = () => end(0);
    setTimeout(() => end(0), 20000);
    a.src = url;
  });
}

/** Demande la matière et le titre pour un fichier importé */
async function askInfo(file, dur) {
  let subjectId = getSettings().lastSubject || '';
  // Le nom du fichier contient le nom d'une matière ? (« Reseaux 12-03.m4a »)
  const n = norm(file.name);
  const guess = getSubjects().find(s => n.includes(norm(s.name)));
  if (guess) subjectId = guess.id;
  const auto = defaultTitle(file);
  const title = h('input', { type: 'text', value: auto });
  const body = h('div', null,
    h('p', { class: 'muted small' }, `${file.name}${dur ? ` · ${fmtDur(dur)}` : ''}`),
    h('label', { class: 'field' }, h('span', null, 'Matière'), subjectSelect(subjectId, v => { subjectId = v; })),
    h('label', { class: 'field' }, h('span', null, 'Titre'), title));
  const ok = await modal({ title: 'Importer un audio', body, buttons: [{ label: 'Annuler', value: false }, { label: 'Importer', value: true, kind: 'primary' }] });
  return ok ? { subjectId, title: title.value.trim() || auto, auto: !title.value.trim() || title.value.trim() === auto } : null;
}
const defaultTitle = f => f.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim().slice(0, 90) || 'Cours importé';

export async function importAudio(file, { ask = true } = {}) {
  if (!AUDIO_EXT.test(file.name) && !/^(audio|video)\//.test(file.type)) throw new Error(`« ${file.name} » n'est pas un fichier audio reconnu.`);
  const dur = await probeDuration(file);
  const info = ask ? await askInfo(file, dur) : { subjectId: getSettings().lastSubject || '', title: defaultTitle(file), auto: true };
  if (!info) return null;
  setSettings({ lastSubject: info.subjectId });
  const c = newCourse({ title: info.title, subjectId: info.subjectId, source: 'import' });
  c.autoTitle = info.auto;   // nom de fichier gardé tel quel : la fiche pourra proposer un vrai titre
  if (file.lastModified && file.lastModified < Date.now()) c.createdAt = file.lastModified;   // date de l'enregistrement
  c.fileName = file.name;
  c.mime = guessMime(file);
  c.state = 'importing';
  await saveCourse(c, true);
  try {
    for (let off = 0, seq = 0; off < file.size; off += SLICE, seq++) {
      await db.put('chunks', { courseId: c.id, part: 0, seq, blob: file.slice(off, off + SLICE, c.mime) });
    }
  } catch (e) {
    await db.delChunks(c.id).catch(() => {});
    await db.del('courses', c.id).catch(() => {});
    throw new Error(humanError(e));
  }
  Object.assign(c, { state: 'ready', hasAudio: true, size: file.size, duration: dur, parts: [{ part: 0, start: 0, dur, size: file.size, mime: c.mime }] });
  await saveCourse(c);
  return c;
}

/** Résultat du transcripteur PC (.notabene.json) */
async function importTranscription(data, fileName) {
  const segs = (data.segments || []).filter(s => s && typeof s.t === 'string' && isFinite(s.s)).map(s => ({ s: +s.s, e: +(s.e ?? s.s), t: s.t.trim() }));
  if (!segs.length) throw new Error(`« ${fileName} » ne contient aucun texte transcrit.`);
  const raw = { engine: data.engine || 'local', model: data.model || 'large-v3', approx: false, createdAt: data.createdAt || Date.now(), segments: segs };
  let c = data.courseId ? await getCourse(data.courseId) : null;
  if (c) {
    if (c.raw && !(await confirmBox(`« ${c.title} » a déjà une transcription. La remplacer par celle du PC ?`, { ok: 'Remplacer' }))) return null;
    c.raw = raw;
    if (!c.duration && data.duration) c.duration = data.duration;
  } else {
    const subj = data.subject && getSubjects().find(s => norm(s.name) === norm(data.subject));
    c = newCourse({ title: data.title || fileName.replace(/\.notabene\.json$|\.json$/i, ''), subjectId: subj?.id || '', source: 'local' });
    c.raw = raw;
    c.duration = data.duration || segs[segs.length - 1].e;
  }
  await saveCourse(c);
  return c;
}

/** Ouvre un ou plusieurs fichiers choisis / déposés / partagés */
export async function importFiles(files, { ask = true } = {}) {
  let last = null;
  for (const f of files) {
    try {
      if (/\.json$/i.test(f.name) || f.type === 'application/json') {
        let data;
        try { data = JSON.parse(await f.text()); } catch { throw new Error(`« ${f.name} » n'est pas un fichier NotaBene valide.`); }
        if (data?.notabene === 'backup') {
          const { restoreBackup } = await import('./backup.js');
          await restoreBackup(data);
          continue;
        }
        if (data?.notabene !== 'transcription') throw new Error(`« ${f.name} » n'est pas un fichier NotaBene (transcription ou sauvegarde).`);
        const c = await importTranscription(data, f.name);
        if (c) {
          toast(`Transcription importée dans « ${c.title} » ✓`, 'ok');
          last = c;
          const { autoStart } = await import('./pipeline.js');
          autoStart(c);
        }
      } else {
        const c = await importAudio(f, { ask });
        if (c) {
          toast(`« ${c.title} » importé ✓`, 'ok');
          last = c;
          const { autoStart } = await import('./pipeline.js');
          autoStart(c);
        }
      }
    } catch (e) {
      console.error(e);
      toast(e.message || humanError(e), 'err');
    }
  }
  if (last && files.length === 1) location.hash = `#/c/${last.id}`;
  return last;
}

/** Sélecteur de fichiers */
export function pickFiles() {
  const input = h('input', { type: 'file', accept: ACCEPT, multiple: true, style: 'display:none' });
  input.onchange = () => { const files = [...input.files]; input.remove(); if (files.length) importFiles(files); };
  document.body.append(input);
  input.click();
}

/** Glisser-déposer des fichiers n'importe où dans la fenêtre (PC) */
export function installDrop() {
  let overlay = null, depth = 0;
  const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
  const hide = () => { depth = 0; overlay?.remove(); overlay = null; };
  window.addEventListener('dragenter', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    if (!overlay) { overlay = h('div', { id: 'drop' }, '📥 Dépose ton audio ici'); document.body.append(overlay); }
  });
  window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', e => { if (hasFiles(e) && --depth <= 0) hide(); });
  window.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    hide();
    const files = [...e.dataTransfer.files];
    if (files.length) importFiles(files);
  });
}

/** Fichiers reçus par « Partager → NotaBene » (rangés par le service worker) */
export async function takeShared() {
  if (!('caches' in window)) return;
  const cache = await caches.open('nb-share');
  const reqs = await cache.keys();
  const files = [];
  for (const r of reqs) {
    const res = await cache.match(r);
    if (!res) continue;
    const blob = await res.blob();
    const name = decodeURIComponent(res.headers.get('x-name') || 'audio-partage.m4a');
    files.push(new File([blob], name, { type: blob.type, lastModified: +res.headers.get('x-time') || Date.now() }));
    await cache.delete(r);
  }
  if (files.length) await importFiles(files);
}

/** Bouton « Importer » de l'accueil */
export function homeBlock({ actions }) {
  actions?.append(h('button', { class: 'btn', onclick: pickFiles }, '📥 Importer un audio'));
}
