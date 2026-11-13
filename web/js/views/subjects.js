// Matières : liste (#/subjects) et cours d'une matière (#/s/:id). Vocabulaire modifiable par matière.
import { h, on, toast, promptBox, confirmBox, menuBox, add, put } from '../util.js';
import { listCourses, saveCourse } from '../db.js';
import { getSubjects, getSubject, addSubject, updateSubject, removeSubject } from '../settings.js';
import { courseItem, head } from './common.js';

export default async function subjects(root, { params }) {
  return params[0] ? subjectView(root, params[0]) : listView(root);
}

async function listView(root) {
  const box = h('div', { class: 'list' });
  async function render() {
    const courses = await listCourses();
    const count = id => courses.filter(c => (c.subjectId || '') === id).length;
    const known = new Set(getSubjects().map(s => s.id));
    const orphans = courses.filter(c => !c.subjectId || !known.has(c.subjectId)).length;
    put(box, 
      ...getSubjects().map(s => h('a', { class: 'item', href: `#/s/${encodeURIComponent(s.id)}` },
        h('div', { class: 'grow' }, h('div', { class: 'item-title' }, s.name),
          h('div', { class: 'item-meta' }, s.vocab ? `Vocabulaire : ${s.vocab.slice(0, 70)}${s.vocab.length > 70 ? '…' : ''}` : 'Pas de vocabulaire')),
        h('span', { class: 'chip' }, String(count(s.id))))),
      orphans ? h('a', { class: 'item', href: '#/s/none' }, h('div', { class: 'grow item-title' }, 'Sans matière'), h('span', { class: 'chip' }, String(orphans))) : null);
  }
  add(root, 
    h('div', { class: 'row' }, h('h1', { class: 'grow', style: 'margin:0' }, 'Matières'),
      h('button', { class: 'btn sm', onclick: async () => {
        const name = await promptBox('Nouvelle matière', '', { placeholder: 'ex. Systèmes d\'exploitation', ok: 'Ajouter' });
        if (!name?.trim()) return;
        const s = addSubject(name);
        toast(`Matière « ${s.name} » ajoutée.`, 'ok');
        render();
      } }, '+ Ajouter')),
    h('p', { class: 'muted small' }, 'Le vocabulaire de chaque matière aide la transcription et la correction (noms techniques, sigles...).'),
    box);
  await render();
  return on('course', render);
}

async function subjectView(root, id) {
  const none = id === 'none';
  const s = none ? null : getSubject(id);
  if (!none && !s) { add(root, head('Matière introuvable', '#/subjects')); return; }
  const titleEl = h('h1', null, none ? 'Sans matière' : s.name);
  const vocabEl = h('p', { class: 'small muted' });
  const listBox = h('div', { class: 'list' });

  const renderVocab = () => {
    if (none) return;
    const cur = getSubject(id);
    put(vocabEl, h('b', null, 'Vocabulaire : '), cur.vocab || h('i', null, 'aucun'), ' ',
      h('a', { href: '#', onclick: e => { e.preventDefault(); editVocab(); } }, 'modifier'));
  };
  async function editVocab() {
    const cur = getSubject(id);
    const v = await promptBox(`Vocabulaire — ${cur.name}`, cur.vocab, { multiline: true, help: 'Mots techniques, sigles, noms propres, séparés par des virgules. Ils sont donnés à Whisper et à Claude pour bien les écrire.' });
    if (v == null) return;
    updateSubject(id, { vocab: v.replace(/\s+/g, ' ').trim() });
    renderVocab();
  }
  async function render() {
    const known = new Set(getSubjects().map(x => x.id));
    const courses = (await listCourses()).filter(c => none ? (!c.subjectId || !known.has(c.subjectId)) : c.subjectId === id);
    put(listBox, ...(courses.length ? courses.map(c => courseItem(c)) : [h('div', { class: 'empty' }, 'Aucun cours dans cette matière.')]));
  }
  async function menu() {
    const v = await menuBox(s.name, [
      { label: '✏️ Renommer', value: 'rename' },
      { label: '📖 Modifier le vocabulaire', value: 'vocab' },
      { label: '🗑️ Supprimer la matière', value: 'delete', kind: 'danger' },
    ]);
    if (v === 'rename') {
      const n = await promptBox('Nom de la matière', getSubject(id).name);
      if (n?.trim()) { updateSubject(id, { name: n.trim() }); titleEl.textContent = n.trim(); }
    } else if (v === 'vocab') editVocab();
    else if (v === 'delete') {
      const courses = (await listCourses()).filter(c => c.subjectId === id);
      if (!(await confirmBox(`Supprimer la matière « ${s.name} » ? ${courses.length ? `Ses ${courses.length} cours sont gardés (classés « Sans matière »).` : ''}`, { ok: 'Supprimer', danger: true }))) return;
      for (const c of courses) { c.subjectId = ''; await saveCourse(c, true); }
      removeSubject(id);
      location.hash = '#/subjects';
    }
  }

  add(root, 
    h('div', { class: 'head' },
      h('a', { class: 'btn back ghost', href: '#/subjects', 'aria-label': 'Retour' }, '←'),
      titleEl,
      none ? null : h('button', { class: 'btn sm ghost', onclick: menu, 'aria-label': 'Actions' }, '⋯')),
    vocabEl, listBox);
  renderVocab();
  await render();
  return on('course', render);
}
