// Stockage local (IndexedDB). Tout reste sur l'appareil.
//   courses : un enregistrement par cours (titre, matière, transcription, fiche, quiz, cartes...)
//   chunks  : l'audio, par petits morceaux -> clé [courseId, part, seq]
//   jobs    : transcriptions en cours / en attente (pour reprendre après une coupure)
import { emit, uid } from './util.js';

let _db = null;

export function openDb() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error("Ce navigateur ne permet pas de stocker les cours (IndexedDB absent). Essaie avec Chrome."));
    const r = indexedDB.open('notabene', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('courses')) d.createObjectStore('courses', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('chunks')) d.createObjectStore('chunks', { keyPath: ['courseId', 'part', 'seq'] });
      if (!d.objectStoreNames.contains('jobs')) d.createObjectStore('jobs', { keyPath: 'courseId' });
    };
    r.onsuccess = () => { _db = r.result; _db.onversionchange = () => { _db.close(); _db = null; }; res(_db); };
    r.onerror = () => rej(r.error || new Error("Impossible d'ouvrir le stockage local (navigation privée ?)."));
    r.onblocked = () => rej(new Error('Stockage bloqué par un autre onglet NotaBene. Ferme les autres onglets.'));
  });
}

async function run(store, mode, fn) {
  const d = await openDb();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    let out;
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('Écriture annulée (stockage plein ?)'));
    const r = fn(t.objectStore(store));
    if (r) r.onsuccess = () => { out = r.result; };
  });
}

const range = (id, part) => part == null
  ? IDBKeyRange.bound([id, 0, 0], [id, Infinity, Infinity])
  : IDBKeyRange.bound([id, part, 0], [id, part, Infinity]);

export const db = {
  get: (s, k) => run(s, 'readonly', o => o.get(k)),
  all: s => run(s, 'readonly', o => o.getAll()),
  put: (s, v) => run(s, 'readwrite', o => o.put(v)),
  del: (s, k) => run(s, 'readwrite', o => o.delete(k)),
  /** Morceaux audio d'un cours (ou d'une seule partie), dans l'ordre */
  chunks: (id, part) => run('chunks', 'readonly', o => o.getAll(range(id, part))),
  delChunks: id => run('chunks', 'readwrite', o => o.delete(range(id))),
};

/** Une « partie » = un fichier audio complet et lisible seul (5 min max pour les enregistrements). */
export async function partBlob(course, part) {
  const rows = await db.chunks(course.id, part);
  const meta = (course.parts || []).find(p => p.part === part);
  return new Blob(rows.map(r => r.blob), { type: meta?.mime || course.mime || '' });
}

export function newCourse({ title, subjectId = '', source = 'rec' } = {}) {
  const now = Date.now();
  return {
    id: uid(), title: title || `Cours du ${new Date(now).toLocaleDateString('fr-FR')}`, autoTitle: !title,
    subjectId, source, createdAt: now, updatedAt: now, state: 'ready',
    duration: 0, size: 0, mime: '', fileName: '', parts: [], hasAudio: false,
    raw: null, clean: null, sheet: null, quiz: null, cards: null,
  };
}

export async function saveCourse(c, silent = false) {
  c.updatedAt = Date.now();
  await db.put('courses', c);
  if (!silent) emit('course', { id: c.id });
  return c;
}
export const getCourse = id => db.get('courses', id);
export async function listCourses() {
  return (await db.all('courses')).sort((a, b) => b.createdAt - a.createdAt);
}
export async function deleteCourse(id) {
  await db.delChunks(id);
  await db.del('jobs', id);
  await db.del('courses', id);
  emit('course', { id, deleted: true });
}
/** Supprime seulement l'audio (on garde transcription, fiche, quiz...) */
export async function deleteAudio(id) {
  await db.delChunks(id);
  const c = await getCourse(id);
  if (c) { c.hasAudio = false; c.size = 0; c.parts = []; await saveCourse(c); }
}

export async function storageInfo() {
  let usage = 0, quota = 0, persisted = false;
  try { if (navigator.storage?.estimate) ({ usage = 0, quota = 0 } = await navigator.storage.estimate()); } catch {}
  try { if (navigator.storage?.persisted) persisted = await navigator.storage.persisted(); } catch {}
  return { usage, quota, persisted };
}
/** Demande au navigateur de ne jamais effacer nos données tout seul */
export async function askPersist() {
  try { if (navigator.storage?.persist) return await navigator.storage.persist(); } catch {}
  return false;
}
