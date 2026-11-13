// Réglages, clés API et matières : tout est dans le localStorage de CET appareil.
// Les clés API ne sont jamais dans le code, ni dans les sauvegardes, ni sur GitHub.
import { uid } from './util.js';

const K = { settings: 'nb.settings', keys: 'nb.keys', subjects: 'nb.subjects' };

const DEFAULTS = {
  engine: 'groq',                 // groq | openai | local
  claudeModel: 'claude-opus-5-5',
  micMode: 'brut',                // brut | ameliore
  chain: false,                   // passe-haut + compresseur + gain pendant l'enregistrement
  gain: 2,
  livePreview: false,
  theme: 'dark',
  lastSubject: '',
};

export const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 — recommandé (meilleur rapport qualité/prix)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 — moins cher, très bon' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 — le moins cher, plus simple' },
  { id: 'claude-fable-5-2', label: 'Claude Fable 5.2 — le plus puissant, le plus cher' },
];

export const ENGINES = {
  groq: { label: 'Groq — Whisper large-v3', short: 'Groq' },
  openai: { label: 'OpenAI — gpt-4o-transcribe', short: 'OpenAI' },
  local: { label: 'Local PC — transcripteur sur mon ordinateur', short: 'Local PC' },
};

function read(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
function write(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* stockage indisponible : on continue sans */ }
}

export const getSettings = () => ({ ...DEFAULTS, ...read(K.settings, {}) });
export function setSettings(patch) { const s = { ...getSettings(), ...patch }; write(K.settings, s); return s; }

/** { groq, openai, anthropic } */
export const getKeys = () => ({ groq: '', openai: '', anthropic: '', ...read(K.keys, {}) });
export function setKeys(patch) {
  const k = { ...getKeys(), ...patch };
  for (const n in k) k[n] = String(k[n] || '').trim();
  write(K.keys, k);
  return k;
}

// --- Matières -----------------------------------------------------------------
const DEFAULT_SUBJECTS = [
  ['Algorithmique', 'algorithme, pseudocode, AlgoBox, variable, affectation, boucle pour, tant que, répéter jusqu\'à, si sinon, tableau, procédure, fonction, paramètre, récursivité, tri à bulles, organigramme, complexité'],
  ['Langage C', 'gcc, printf, scanf, pointeur, malloc, free, struct, tableau, chaîne de caractères, include, stdio.h, int main, compilation, boucle for, while, switch, fonction, adresse mémoire'],
  ['Python', 'print, input, def, liste, tuple, dictionnaire, boucle for, while, range, import, module, indentation, fonction, classe, chaîne de caractères, pip'],
  ['JavaScript', 'variable, let, const, function, DOM, getElementById, événement, addEventListener, tableau, objet, JSON, console.log, callback, promesse, async, await'],
  ['HTML/CSS', 'balise, attribut, div, span, classe, identifiant, sélecteur, flexbox, grid, margin, padding, responsive, media query, formulaire, lien hypertexte'],
  ['Excel', 'cellule, formule, fonction SOMME, MOYENNE, SI, RECHERCHEV, tableau croisé dynamique, graphique, référence absolue, référence relative, feuille de calcul, classeur, mise en forme conditionnelle'],
  ['Word', 'mise en page, style, table des matières, en-tête, pied de page, publipostage, saut de page, interligne, retrait, tabulation, note de bas de page'],
  ['Maths', 'ensemble, fonction, dérivée, intégrale, matrice, déterminant, vecteur, logique, proposition, base binaire, hexadécimal, probabilité, suite, limite'],
  ['Communication', 'émetteur, récepteur, message, canal, feedback, communication verbale, non verbale, écoute active, argumentation, exposé, compte rendu'],
  ['Anglais technique', 'hardware, software, network, router, switch, firewall, database, server, troubleshooting, bandwidth, wireless'],
  ['ATO', 'processeur, CPU, mémoire vive, RAM, ROM, carte mère, bus, registre, unité arithmétique et logique, disque dur, SSD, BIOS, périphérique, binaire, octet, bit'],
  ['Réseaux', 'TCP/IP, adresse IP, masque de sous-réseau, modèle OSI, routeur, commutateur, switch, Ethernet, adresse MAC, DNS, DHCP, passerelle, paquet, trame, protocole, IPv4, IPv6, VLAN, câble RJ45, octet'],
];
const slug = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function getSubjects() {
  let list = read(K.subjects, null);
  if (!Array.isArray(list)) {
    list = DEFAULT_SUBJECTS.map(([name, vocab]) => ({ id: slug(name), name, vocab }));
    write(K.subjects, list);
  }
  return list;
}
export const saveSubjects = list => write(K.subjects, list);
export const getSubject = id => getSubjects().find(s => s.id === id) || null;
export const subjectName = id => getSubject(id)?.name || 'Sans matière';
export function addSubject(name, vocab = '') {
  const list = getSubjects();
  const s = { id: uid(), name: name.trim(), vocab };
  list.push(s);
  saveSubjects(list);
  return s;
}
export function updateSubject(id, patch) {
  const list = getSubjects();
  const s = list.find(x => x.id === id);
  if (s) { Object.assign(s, patch); saveSubjects(list); }
  return s;
}
export function removeSubject(id) { saveSubjects(getSubjects().filter(s => s.id !== id)); }

/** Pour la sauvegarde : réglages et matières, SANS les clés API */
export const exportPrefs = () => ({ settings: getSettings(), subjects: getSubjects() });
export function importPrefs({ settings, subjects } = {}) {
  if (settings) setSettings(settings);
  if (Array.isArray(subjects)) {
    const list = getSubjects();
    for (const s of subjects) {
      const i = list.findIndex(x => x.id === s.id);
      if (i >= 0) list[i] = { ...list[i], ...s }; else list.push(s);
    }
    saveSubjects(list);
  }
}

export function applyTheme() {
  const t = getSettings().theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', t === 'light' ? '#f4f5f8' : '#0f1115');
}
