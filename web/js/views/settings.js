// Réglages : moteur de transcription, clés API, modèle Claude, apparence, stockage.
import { h, toast, fmtSize, confirmBox, debounce, add, put } from '../util.js';
import { getSettings, setSettings, getKeys, setKeys, CLAUDE_MODELS, ENGINES, applyTheme } from '../settings.js';
import { listCourses, deleteAudio, storageInfo, askPersist } from '../db.js';
import { testKey } from '../keys.js';
import { banner } from './common.js';

function keyField(provider, label, help, link) {
  const keys = getKeys();
  const input = h('input', { type: 'password', value: keys[provider], placeholder: 'Colle ta clé ici', autocomplete: 'off', spellcheck: 'false' });
  const status = h('p', { class: 'small', style: 'margin:6px 0 0' });
  input.addEventListener('input', debounce(() => { setKeys({ [provider]: input.value }); status.textContent = 'Clé enregistrée sur cet appareil.'; status.style.color = ''; }, 300));
  return h('div', { style: 'margin:12px 0' },
    h('label', { class: 'field', style: 'margin-bottom:6px' }, h('span', null, label), input),
    h('div', { class: 'row' },
      h('button', { class: 'btn sm', onclick: () => { input.type = input.type === 'password' ? 'text' : 'password'; } }, '👁 Afficher'),
      h('button', { class: 'btn sm', onclick: async e => {
        e.target.disabled = true; status.textContent = 'Test en cours…'; status.style.color = '';
        const r = await testKey(provider, input.value.trim());
        status.textContent = r.message; status.style.color = r.ok ? 'var(--green)' : 'var(--red)';
        e.target.disabled = false;
      } }, 'Tester la clé'),
      h('a', { class: 'small', href: link, target: '_blank', rel: 'noopener' }, 'Où la trouver ?')),
    status,
    help && h('p', { class: 'muted small', style: 'margin:4px 0 0' }, help));
}

export default async function settingsView(root) {
  const s = getSettings();
  const storageBox = h('div');
  const extras = h('div');

  async function renderStorage() {
    const info = await storageInfo();
    const courses = (await listCourses()).filter(c => c.hasAudio && c.size).sort((a, b) => b.size - a.size);
    const total = courses.reduce((n, c) => n + c.size, 0);
    put(storageBox, 
      h('p', null, `Audios des cours : `, h('b', null, fmtSize(total)),
        info.quota ? ` · Espace utilisé par l'appli : ${fmtSize(info.usage)} sur ${fmtSize(info.quota)} disponibles` : ''),
      info.quota ? h('div', { class: 'progress' }, h('i', { style: `width:${Math.min(100, info.usage / info.quota * 100).toFixed(1)}%` })) : null,
      info.persisted
        ? banner('ok', '🔒 Stockage protégé : le navigateur n\'effacera pas tes cours tout seul.')
        : banner('warn', 'Le navigateur peut effacer les données si l\'appareil manque de place. ',
          h('button', { class: 'btn sm', onclick: async () => {
            const ok = await askPersist();
            toast(ok ? 'Stockage protégé ✓' : 'Le navigateur a refusé pour l\'instant. Installe l\'appli sur l\'écran d\'accueil puis réessaie, et fais des sauvegardes régulières.', ok ? 'ok' : '');
            renderStorage();
          } }, 'Protéger mes données')),
      courses.length ? h('h3', null, 'Libérer de la place') : null,
      courses.length ? h('p', { class: 'muted small' }, 'Supprimer un audio garde la transcription, la fiche et les quiz.') : null,
      h('div', { class: 'list' }, courses.map(c => h('div', { class: 'item' },
        h('div', { class: 'grow' }, h('div', { class: 'item-title' }, c.title), h('div', { class: 'item-meta' }, `${fmtSize(c.size)} · ${new Date(c.createdAt).toLocaleDateString('fr-FR')}${c.raw ? '' : ' · pas encore transcrit !'}`)),
        h('button', { class: 'btn sm', onclick: async () => {
          const warn = c.raw ? '' : ' ATTENTION : ce cours n\'est pas encore transcrit, tu ne pourras plus le faire.';
          if (await confirmBox(`Supprimer l'audio de « ${c.title} » (${fmtSize(c.size)}) ?${warn}`, { ok: 'Supprimer l\'audio', danger: true })) { await deleteAudio(c.id); renderStorage(); }
        } }, 'Supprimer l\'audio')))));
  }

  add(root, 
    h('h1', null, 'Réglages'),

    h('div', { class: 'card' },
      h('h2', null, '1. Transcription'),
      h('label', { class: 'field' }, h('span', null, 'Moteur utilisé pour transformer l\'audio en texte'),
        h('select', { value: s.engine, onchange: e => setSettings({ engine: e.target.value }) },
          Object.entries(ENGINES).map(([id, e]) => h('option', { value: id }, e.label)))),
      h('p', { class: 'muted small' }, 'Groq : rapide, offre gratuite. OpenAI : payant, très bon. Local PC : gratuit et sans internet, avec le transcripteur fourni (dossier local-transcriber).'),
      keyField('groq', 'Clé API Groq', 'Commence par « gsk_ ».', 'https://console.groq.com/keys'),
      keyField('openai', 'Clé API OpenAI', 'Commence par « sk- ».', 'https://platform.openai.com/api-keys')),

    h('div', { class: 'card' },
      h('h2', null, '2. Nettoyage, fiches et quiz (Claude)'),
      keyField('anthropic', 'Clé API Anthropic', 'Commence par « sk-ant- ».', 'https://console.anthropic.com/settings/keys'),
      h('label', { class: 'field' }, h('span', null, 'Modèle Claude'),
        h('select', { value: s.claudeModel, onchange: e => setSettings({ claudeModel: e.target.value }) },
          CLAUDE_MODELS.map(m => h('option', { value: m.id }, m.label))))),

    banner('info', '🔐 Tes clés restent uniquement dans ce navigateur, sur cet appareil. Elles ne sont ni dans le code, ni sur GitHub, ni dans les sauvegardes. Elles ne sont envoyées qu\'au service concerné (Groq, OpenAI ou Anthropic).'),

    h('div', { class: 'card' },
      h('h2', null, '3. Apparence'),
      h('label', { class: 'field' }, h('span', null, 'Thème'),
        h('select', { value: s.theme, onchange: e => { setSettings({ theme: e.target.value }); applyTheme(); } },
          h('option', { value: 'dark' }, 'Sombre'), h('option', { value: 'light' }, 'Clair')))),

    h('div', { class: 'card' }, h('h2', null, '4. Stockage'), storageBox),
    extras,
    h('p', { class: 'muted small center' }, 'NotaBene · tout est stocké sur cet appareil, rien n\'est envoyé ailleurs sans ton action.'));

  renderStorage();
  for (const load of SETTINGS_BLOCKS) load().then(m => m.settingsBlock?.({ extras, refresh: renderStorage })).catch(e => console.error(e));
}

const SETTINGS_BLOCKS = [
  () => import('../pipeline.js'),
  () => import('../backup.js'),
];
