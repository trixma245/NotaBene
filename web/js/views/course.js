// Page d'un cours : titre, matière, lecteur audio, étapes (transcrire, nettoyer, fiche...) et onglets.
// Chaque fonctionnalité (transcription, fiche, quiz...) est un petit module dans js/course/.
import { h, on, toast, fmtDur, fmtDate, fmtSize, confirmBox, promptBox, menuBox, humanError, add, put } from '../util.js';
import { getCourse, saveCourse, deleteCourse, deleteAudio } from '../db.js';
import { Player } from '../player.js';
import { head, subjectSelect, banner } from './common.js';

/* Modules de fonctionnalités, dans l'ordre des onglets. Chacun exporte par défaut :
   { id, label, has(course), step(course, ctx), render(panel, course, ctx), menu(course, ctx), noAudio(course, ctx), cleanup() } */
const FEATURES = [
  () => import('../course/steps.js'),
  () => import('../course/sheet.js'),
  () => import('../course/quiz.js'),
  () => import('../course/cards.js'),
  () => import('../course/clean.js'),
  () => import('../course/raw.js'),
  () => import('../course/more.js'),
];

export default async function courseView(root, { params, query }) {
  const id = params[0];
  let course = await getCourse(id);
  if (!course) {
    add(root, head('Cours introuvable'), h('div', { class: 'empty' }, 'Ce cours n\'existe pas (ou plus) sur cet appareil.'));
    return;
  }
  const feats = (await Promise.all(FEATURES.map(load => load().then(m => m.default).catch(e => { console.error(e); return null; })))).filter(Boolean);
  let player = null;
  let tab = params[1] || null;

  const titleEl = h('h1', null, course.title);
  const metaEl = h('p', { class: 'muted small' });
  const subjBox = h('div');
  const noteBox = h('div');
  const playerBox = h('div');
  const stepsBox = h('div');
  const tabsBar = h('div', { class: 'tabs' });
  const panel = h('div');

  const ctx = {
    get course() { return course; },
    get player() { return player; },
    seek(t) { if (player) player.seek(t, true); else toast('Ce cours n\'a pas d\'audio à écouter.'); },
    refresh: () => reload(),
    setTab(t) { tab = t; renderBody(); },
  };

  function buildPlayer() {
    player?.destroy();
    player = null;
    playerBox.replaceChildren();
    if (course.hasAudio && course.parts?.length) {
      player = new Player(course);
      add(playerBox, player.el);
    } else {
      add(playerBox, h('div', { class: 'card' },
        h('p', { class: 'muted', style: 'margin:0' }, '🔇 Ce cours n\'a pas d\'audio sur cet appareil.'),
        feats.map(f => f.noAudio?.(course, ctx))));
    }
  }

  function renderHeader() {
    titleEl.textContent = course.title;
    metaEl.textContent = [fmtDate(course.createdAt), course.duration ? fmtDur(course.duration) : null, course.size ? fmtSize(course.size) : null].filter(Boolean).join(' · ');
    put(subjBox, subjectSelect(course.subjectId, async v => { course.subjectId = v; await saveCourse(course); }));
    put(noteBox, 
      ...(course.recovered ? [banner('ok', 'Cet enregistrement a été récupéré après une fermeture imprévue de l\'appli.')] : []),
      ...(course.gaps?.length ? [banner('warn', `⚠️ ${course.gaps.length} coupure(s) possible(s) pendant l'enregistrement (appli mise en veille) : vers ${course.gaps.slice(0, 6).map(g => fmtDurShort(g.at)).join(', ')}.`)] : []));
  }
  const fmtDurShort = s => `${Math.floor(s / 60)} min ${String(Math.floor(s % 60)).padStart(2, '0')}`;

  function renderBody() {
    const steps = feats.map(f => f.step?.(course, ctx)).filter(Boolean);
    put(stepsBox, ...(steps.length ? [h('div', { class: 'card stack' }, steps)] : []));
    const tabs = feats.filter(f => f.render);
    if (!tabs.length) { tabsBar.replaceChildren(); panel.replaceChildren(); return; }
    if (!tabs.some(f => f.id === tab)) tab = (tabs.find(f => f.has?.(course)) || tabs[tabs.length - 1]).id;
    put(tabsBar, ...tabs.map(f => h('button', {
      class: f.id === tab ? 'active' : '',
      onclick: () => { tab = f.id; history.replaceState(null, '', `#/c/${id}/${tab}`); renderBody(); },
    }, f.label, f.has?.(course) ? '' : ' ·')));
    panel.replaceChildren();
    try { tabs.find(f => f.id === tab).render(panel, course, ctx); } catch (e) { console.error(e); add(panel, banner('err', humanError(e))); }
  }

  const audioSig = c => `${c.hasAudio}|${(c.parts || []).map(p => `${p.part}:${p.size}`).join(',')}`;
  async function reload() {
    const c = await getCourse(id);
    if (!c) { location.hash = '#/'; return; }
    const changed = audioSig(c) !== audioSig(course);
    course = c;
    renderHeader();
    if (changed) buildPlayer(); else if (player) player.course = c;
    renderBody();
  }

  async function openMenu() {
    const extra = feats.flatMap(f => f.menu?.(course, ctx) || []);
    const items = [
      { label: '✏️ Renommer', value: 'rename' },
      ...extra.map((e, i) => ({ label: e.label, value: `x${i}` })),
      course.source === 'rec' && { label: '🎙️ Continuer l\'enregistrement', value: 'resume' },
      course.hasAudio && { label: '🗑️ Supprimer seulement l\'audio', value: 'delaudio' },
      { label: '🗑️ Supprimer le cours', value: 'delete', kind: 'danger' },
    ];
    const v = await menuBox(course.title, items);
    if (!v) return;
    if (v === 'rename') return rename();
    if (v === 'resume') { location.hash = `#/rec/${id}`; return; }
    if (v === 'delaudio') {
      if (await confirmBox(`Supprimer l'audio de « ${course.title} » (${fmtSize(course.size)}) ? La transcription et la fiche sont conservées. C'est définitif.`, { ok: 'Supprimer l\'audio', danger: true })) {
        await deleteAudio(id); toast('Audio supprimé.');
      }
      return;
    }
    if (v === 'delete') {
      if (await confirmBox(`Supprimer définitivement « ${course.title} » avec son audio, sa transcription et sa fiche ?`, { ok: 'Supprimer', danger: true })) {
        await deleteCourse(id); toast('Cours supprimé.'); location.hash = '#/';
      }
      return;
    }
    if (v.startsWith('x')) { try { await extra[+v.slice(1)].run(); } catch (e) { toast(humanError(e), 'err'); } }
  }
  async function rename() {
    const t = await promptBox('Titre du cours', course.title);
    if (t && t.trim()) { course.title = t.trim(); course.autoTitle = false; await saveCourse(course); }
  }

  // Clic sur un horodatage ou une phrase -> l'audio saute à cet endroit
  panel.addEventListener('click', e => {
    const el = e.target.closest('[data-t]');
    if (el && panel.contains(el)) { e.preventDefault(); ctx.seek(+el.dataset.t); }
  });

  add(root, 
    h('div', { class: 'head' },
      h('a', { class: 'btn back ghost', href: course.subjectId ? `#/s/${course.subjectId}` : '#/', 'aria-label': 'Retour' }, '←'),
      titleEl,
      h('button', { class: 'btn sm ghost', onclick: openMenu, 'aria-label': 'Plus d\'actions' }, '⋯')),
    metaEl, subjBox, noteBox, playerBox, stepsBox, tabsBar, panel);
  renderHeader();
  buildPlayer();
  renderBody();
  const t0 = parseFloat(query.get('t'));
  if (!isNaN(t0) && player) player.seek(t0, false);

  const off = on('course', d => { if (d.id === id && !d.deleted) reload(); });
  return () => { off(); player?.destroy(); feats.forEach(f => { try { f.cleanup?.(); } catch {} }); };
}
