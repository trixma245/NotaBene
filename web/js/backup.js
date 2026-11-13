// Sauvegarde / restauration complète en .json (pour passer du téléphone au PC, ou se protéger).
// Les clés API ne sont JAMAIS dans la sauvegarde.
import { h, toast, download, fmtSize, confirmBox, humanError, modal, add } from './util.js';
import { db, listCourses, getCourse } from './db.js';
import { exportPrefs, importPrefs } from './settings.js';

const toBase64 = blob => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1] || '');
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});
const fromBase64 = (b64, type) => fetch(`data:${type || 'application/octet-stream'};base64,${b64}`).then(r => r.blob());

/** Crée le fichier de sauvegarde. Le texte est assemblé par morceaux (un gros cours ne bloque pas la mémoire). */
export async function makeBackup({ withAudio = false, onProgress } = {}) {
  const courses = await listCourses();
  const head = { notabene: 'backup', version: 1, exportedAt: Date.now(), withAudio, prefs: exportPrefs() };
  const parts = [JSON.stringify(head).slice(0, -1), ',"courses":['];
  for (let i = 0; i < courses.length; i++) {
    const c = { ...courses[i] };
    if (withAudio && c.hasAudio) {
      const rows = await db.chunks(c.id);
      c.audio = [];
      for (const r of rows) c.audio.push({ part: r.part, seq: r.seq, type: r.blob.type, data: await toBase64(r.blob) });
    } else {
      c.hasAudio = false; c.parts = []; c.size = 0;   // sans audio dans la sauvegarde
    }
    parts.push((i ? ',' : '') + JSON.stringify(c));
    onProgress?.(i + 1, courses.length);
  }
  parts.push(']}');
  return new Blob(parts, { type: 'application/json' });
}

export async function restoreBackup(data) {
  if (data?.notabene !== 'backup' || !Array.isArray(data.courses)) throw new Error('Ce fichier n\'est pas une sauvegarde NotaBene.');
  const n = data.courses.length;
  const ok = await confirmBox(`Restaurer ${n} cours depuis cette sauvegarde du ${new Date(data.exportedAt).toLocaleDateString('fr-FR')} ? Les cours déjà présents sont mis à jour seulement si la sauvegarde est plus récente. Rien n'est supprimé.`, { ok: 'Restaurer' });
  if (!ok) return;
  if (data.prefs) importPrefs(data.prefs);
  let added = 0, updated = 0, skipped = 0;
  for (const c of data.courses) {
    const cur = await getCourse(c.id);
    if (cur && (cur.updatedAt || 0) >= (c.updatedAt || 0)) { skipped++; continue; }
    const audio = c.audio;
    delete c.audio;
    if (audio?.length) {
      await db.delChunks(c.id);
      for (const a of audio) await db.put('chunks', { courseId: c.id, part: a.part, seq: a.seq, blob: await fromBase64(a.data, a.type) });
    } else if (cur?.hasAudio) {
      // la sauvegarde n'a pas l'audio mais l'appareil l'a : on le garde
      Object.assign(c, { hasAudio: true, parts: cur.parts, size: cur.size, mime: cur.mime });
    }
    if (c.state === 'recording' || c.state === 'importing') c.state = 'ready';
    await db.put('courses', c);
    cur ? updated++ : added++;
  }
  toast(`Restauration terminée : ${added} ajouté(s), ${updated} mis à jour, ${skipped} inchangé(s).`, 'ok', 8000);
  location.hash = '#/';
  setTimeout(() => location.reload(), 300);
}

/** Bloc des réglages */
export function settingsBlock({ extras }) {
  const status = h('p', { class: 'small muted', style: 'margin:8px 0 0' });
  const save = async withAudio => {
    status.textContent = 'Préparation de la sauvegarde…';
    try {
      const blob = await makeBackup({ withAudio, onProgress: (i, n) => { status.textContent = `Préparation… ${i}/${n} cours`; } });
      download(blob, `notabene-sauvegarde-${new Date().toISOString().slice(0, 10)}${withAudio ? '-avec-audio' : ''}.json`);
      status.textContent = `Sauvegarde créée (${fmtSize(blob.size)}). Garde-la sur ton PC ou ton Drive.`;
    } catch (e) {
      status.textContent = '';
      toast(humanError(e), 'err');
    }
  };
  const restore = () => {
    const input = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
    input.onchange = async () => {
      const f = input.files[0];
      input.remove();
      if (!f) return;
      status.textContent = 'Lecture de la sauvegarde…';
      try { await restoreBackup(JSON.parse(await f.text())); }
      catch (e) { toast(e instanceof SyntaxError ? 'Fichier illisible : ce n\'est pas une sauvegarde NotaBene.' : humanError(e), 'err'); }
      status.textContent = '';
    };
    document.body.append(input);
    input.click();
  };
  add(extras, h('div', { class: 'card' },
    h('h2', null, '5. Sauvegarde et transfert'),
    h('p', { class: 'small muted' }, 'Pour passer du téléphone au PC (ou l\'inverse) : crée une sauvegarde ici, envoie le fichier sur l\'autre appareil, puis « Restaurer ». Tes clés API n\'y sont jamais.'),
    h('div', { class: 'btn-grid' },
      h('button', { class: 'btn', onclick: () => save(false) }, '💾 Sauvegarder (textes)'),
      h('button', { class: 'btn', onclick: async () => {
        const v = await modal({ title: 'Sauvegarde avec audio', body: 'Le fichier sera gros (environ 40 Mo par heure de cours). Continuer ?', buttons: [{ label: 'Annuler', value: false }, { label: 'Continuer', value: true, kind: 'primary' }] });
        if (v) save(true);
      } }, '💾 Avec les audios')),
    h('button', { class: 'btn block', style: 'margin-top:10px', onclick: restore }, '📂 Restaurer une sauvegarde'),
    status));
}
