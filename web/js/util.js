// Petits outils partagés par toute l'appli.

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/** Crée un élément HTML : h('button', {class:'btn', onclick: fn}, 'Texte') */
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  let value;
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') value = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, kids);
  if (value !== undefined) el.value = value; // après les <option> pour les <select>
  return el;
}
function append(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.append(k.nodeType ? k : String(k));
  }
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

/** 75 -> "01:15", 3725 -> "1:02:05" */
export function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
  const p = n => String(n).padStart(2, '0');
  return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${p(mm)}:${p(ss)}`;
}
/** "01:15" ou "1:02:05" -> secondes */
export function parseTime(str) {
  const p = String(str).trim().split(':').map(Number);
  if (p.some(isNaN)) return null;
  return p.reduce((a, n) => a * 60 + n, 0);
}
/** Durée lisible : "1 h 32", "12 min", "45 s" */
export function fmtDur(sec) {
  sec = Math.round(sec || 0);
  if (sec < 60) return `${sec} s`;
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}
export function fmtSize(b) {
  b = b || 0;
  if (b < 1024) return `${b} o`;
  if (b < 1048576) return `${(b / 1024).toFixed(0)} Ko`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1).replace('.', ',')} Mo`;
  return `${(b / 1073741824).toFixed(2).replace('.', ',')} Go`;
}
export const fmtDate = t => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
export const fmtDateTime = t => new Date(t).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Texte simplifié pour chercher sans tenir compte des accents ni des majuscules */
export const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const safeName = s => String(s || 'cours').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'cours';

export function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/** Télécharge un fichier créé dans le navigateur */
export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** Petit message en bas de l'écran */
export function toast(msg, kind = '', ms = 4500) {
  const el = h('div', { class: `toast ${kind}` }, msg);
  $('#toasts').append(el);
  setTimeout(() => el.remove(), kind === 'err' ? Math.max(ms, 7000) : ms);
}

/** Fenêtre de dialogue. Renvoie la valeur du bouton choisi (null si fermée). */
export function modal({ title, body, buttons = [{ label: 'OK', value: true, kind: 'primary' }] }) {
  return new Promise(resolve => {
    const close = v => { bg.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') close(null); };
    const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
      title && h('h3', null, title),
      typeof body === 'string' ? h('p', null, body) : body,
      h('div', { class: 'actions' }, buttons.map(b =>
        h('button', { class: `btn ${b.kind || ''}`, onclick: () => close(typeof b.value === 'function' ? b.value() : b.value) }, b.label))));
    const bg = h('div', { class: 'modal-bg', onclick: e => { if (e.target === bg) close(null); } }, box);
    document.body.append(bg);
    document.addEventListener('keydown', onKey);
    (box.querySelector('input,textarea,select') || box.querySelector('.btn.primary,.btn.danger') || box).focus?.();
  });
}
export const confirmBox = (msg, { ok = 'Oui', cancel = 'Annuler', danger = false, title = 'Confirmer' } = {}) =>
  modal({ title, body: msg, buttons: [{ label: cancel, value: false }, { label: ok, value: true, kind: danger ? 'danger' : 'primary' }] }).then(v => v === true);
export function promptBox(title, value = '', { placeholder = '', multiline = false, ok = 'Enregistrer', help = '' } = {}) {
  const input = multiline ? h('textarea', { placeholder, value, rows: 6 }) : h('input', { type: 'text', placeholder, value });
  const body = h('div', null, help && h('p', { class: 'muted small' }, help), input);
  return modal({ title, body, buttons: [{ label: 'Annuler', value: null }, { label: ok, value: () => input.value, kind: 'primary' }] });
}
/** Menu d'actions : items = [{label, value, kind}] */
export function menuBox(title, items) {
  return new Promise(resolve => {
    const close = v => { bg.remove(); resolve(v); };
    const box = h('div', { class: 'modal menu' }, h('h3', null, title),
      items.filter(Boolean).map(i => h('button', { class: `btn block ${i.kind || ''}`, onclick: () => close(i.value) }, i.label)),
      h('button', { class: 'btn block ghost', onclick: () => close(null) }, 'Fermer'));
    const bg = h('div', { class: 'modal-bg', onclick: e => { if (e.target === bg) close(null); } }, box);
    document.body.append(bg);
  });
}

/** Messagerie interne : emit('course', {id}) / on('course', fn) -> renvoie une fonction pour se désabonner */
const bus = new EventTarget();
export const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));
export function on(type, fn) {
  const f = e => fn(e.detail);
  bus.addEventListener(type, f);
  return () => bus.removeEventListener(type, f);
}

/** Traduit une erreur technique en message compréhensible */
export function humanError(e) {
  const m = e?.message || String(e);
  if (e?.name === 'QuotaExceededError' || /quota/i.test(m)) return "Le stockage de l'appareil est plein. Supprime d'anciens audios dans Réglages → Stockage.";
  if (e?.name === 'AbortError') return 'Opération annulée.';
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) return 'Pas de connexion internet (ou le service ne répond pas). Réessaie quand le réseau revient.';
  return m;
}
