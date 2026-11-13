// Étapes réalisées par Claude : nettoyage du texte, fiche de révision, quiz et cartes.
// Les longs cours sont traités par morceaux (résultats gardés au fur et à mesure), puis fusionnés.
import { askClaude, askClaudeJson } from './claude.js';
import { StepError } from './transcribe.js';
import { getCourse, saveCourse } from './db.js';
import { getSubject } from './settings.js';
import { fmtTime, fmtDur, uid } from './util.js';
import { wordCount, emphasisHints } from './merge.js';

const CLEAN_CHUNK_WORDS = 2800;      // ≈ 20 min de parole par demande
const SHEET_SINGLE_MAX_WORDS = 45000; // au-delà (≈ 5 h de cours), fiche par morceaux puis fusion

function context(course) {
  const s = getSubject(course.subjectId);
  return [
    `Matière : ${s?.name || 'non précisée'}`,
    s?.vocab ? `Vocabulaire de la matière (orthographe correcte) : ${s.vocab}` : null,
    course.title && !course.autoTitle ? `Titre donné par l'étudiant : ${course.title}` : null,
    course.duration ? `Durée de l'enregistrement : ${fmtDur(course.duration)}` : null,
  ].filter(Boolean).join('\n');
}

const ABOUT = "Tu aides un étudiant de 1re année en IRT (Informatique, Réseaux et Télécommunications) à l'ESGIS, au Bénin. Les cours sont en français et ont été enregistrés en classe, souvent de loin (téléphone dans un sac ou un casier) : la transcription automatique contient des erreurs.";

// ------------------------------------------------------------------ 1. Nettoyage
const CLEAN_SYSTEM = `${ABOUT}

Ta tâche : remettre au propre UN passage de la transcription automatique d'un cours.

Règles :
1. Corrige les mots mal reconnus quand le contexte du cours ou le vocabulaire de la matière rend la correction évidente (par ex. « masque de sous réseau », « adresse IP », noms de fonctions ou de commandes). En cas de doute, garde le mot transcrit.
2. Enlève les hésitations (euh, ben, hein, voilà...), les faux départs, les répétitions involontaires, et les apartés sans rapport avec le cours (discipline, bruits, discussions d'élèves).
3. Remets la ponctuation et les majuscules, et découpe en paragraphes cohérents (un paragraphe = une idée).
4. Chaque paragraphe commence par l'horodatage entre crochets de la ligne source où il commence, recopié tel quel (ex. [12:34] ou [1:02:05]). N'invente jamais d'horodatage.
5. Si un passage est vraiment incompréhensible (mots sans lien, phrase sans sens), écris à sa place [inaudible ~mm:ss] avec le temps approximatif. Ne devine pas.
6. N'ajoute AUCUNE information, explication ou exemple qui n'a pas été dit. Ne résume pas : garde tout le contenu du cours, dans l'ordre, avec les mots du professeur autant que possible.
7. Code, commandes, formules et adresses dictés par le prof : mets-les en \`code\`, ou en bloc \`\`\` s'il y a plusieurs lignes.
8. Réponds uniquement avec le texte propre en Markdown (paragraphes, éventuellement listes), sans titre général, sans introduction ni conclusion de ta part.`;

function cleanChunks(segs) {
  const chunks = [];
  let cur = [], words = 0;
  for (const s of segs) {
    cur.push(s);
    words += wordCount(s.t);
    if (words >= CLEAN_CHUNK_WORDS) { chunks.push(cur); cur = []; words = 0; }
  }
  if (cur.length) {
    // un dernier morceau trop petit est rattaché au précédent
    if (chunks.length && wordCount(cur.map(s => s.t).join(' ')) < CLEAN_CHUNK_WORDS / 4) chunks[chunks.length - 1].push(...cur);
    else chunks.push(cur);
  }
  return chunks;
}

export async function cleanStep(courseId, job, ctx) {
  const course = await getCourse(courseId);
  if (!course?.raw?.segments?.length) throw new StepError('Il faut d\'abord une transcription (et elle ne doit pas être vide).');
  const d = job.data.clean || (job.data.clean = { parts: [] });
  const chunks = cleanChunks(course.raw.segments);
  if (d.parts.length > chunks.length) d.parts = [];
  for (let i = 0; i < chunks.length; i++) {
    if (d.parts[i]) continue;
    const lines = chunks[i].map(s => `[${fmtTime(s.s)}] ${s.t}`).join('\n');
    const prev = i > 0 ? d.parts[i - 1].slice(-700) : '';
    const user = [
      context(course),
      chunks.length > 1 ? `Passage ${i + 1} sur ${chunks.length}.` : null,
      prev ? `Fin du passage précédent déjà remis au propre (pour la continuité, ne pas le répéter) :\n"""\n${prev}\n"""` : null,
      course.raw.approx ? 'Note : les horodatages de cette transcription sont approximatifs (à quelques secondes près).' : null,
      `Transcription automatique à remettre au propre (une ligne = un segment, avec son horodatage) :\n"""\n${lines}\n"""`,
    ].filter(Boolean).join('\n\n');
    ctx.report({ label: `Nettoyage du texte (${i + 1}/${chunks.length})…`, done: i, total: chunks.length });
    let shown = 0;
    const r = await askClaude({
      system: CLEAN_SYSTEM, user, effort: 'medium', signal: ctx.signal,
      onText: t => { if (t.length - shown > 400) { shown = t.length; ctx.report({ label: `Nettoyage du texte (${i + 1}/${chunks.length}) — ${wordCount(t)} mots…`, done: i, total: chunks.length }); } },
    });
    d.parts[i] = r.text;
    d.model = r.model;
    await ctx.save();
  }
  const c = await getCourse(courseId);
  c.clean = { md: d.parts.join('\n\n'), model: d.model, createdAt: Date.now() };
  await saveCourse(c);
}

// ------------------------------------------------------------------ 2. Fiche de révision
const SHEET_SYSTEM = `${ABOUT}

Ta tâche : rédiger la fiche de révision du cours à partir de son texte (déjà remis au propre).

Structure exacte, en Markdown :
# <Titre court et précis du cours>
## Plan du cours
(liste numérotée des grandes parties, dans l'ordre où le prof les a traitées, avec l'horodatage [mm:ss] du début de chaque partie)
## Résumé
(5 à 12 phrases : l'essentiel à comprendre)
## Notions clés
(liste à puces : chaque notion en **gras** suivie d'une explication courte)
## Définitions
(liste : **terme** : définition telle que donnée en cours)
## Formules, syntaxe et code
(formules, syntaxes, commandes et programmes vus en cours, dans des blocs \`\`\` avec le langage indiqué ; explique en une ligne à quoi sert chaque bloc)
## Exemples
(les exemples et exercices traités en classe, avec leur solution si elle a été donnée)
## ⚠️ Le prof a insisté
(tout ce que le prof a souligné : « retenez », « important », « à l'examen », « attention », répétitions, mises en garde. Une puce par point, avec l'horodatage [mm:ss] pour réécouter)

Règles :
- Utilise UNIQUEMENT ce qui a été dit dans le cours. N'ajoute aucune notion, définition ou exemple extérieur.
- Si le prof s'est visiblement trompé ou si la transcription a abîmé un code ou une formule, tu peux le rectifier, mais signale-le avec « (corrigé) ».
- Garde les passages [inaudible ~mm:ss] utiles en les signalant, sans inventer leur contenu.
- Si une section n'a rien à contenir, écris simplement : _Rien de particulier dans ce cours._
- Écris en français clair, phrases courtes, pour réviser vite.
- Réponds uniquement avec la fiche, sans phrase d'introduction ni de conclusion.`;

const MERGE_SYSTEM = `${ABOUT}

On t'a donné plusieurs fiches partielles d'un même cours très long (une par morceau). Fusionne-les en UNE fiche unique avec exactement la même structure (titre, Plan du cours, Résumé, Notions clés, Définitions, Formules syntaxe et code, Exemples, ⚠️ Le prof a insisté). Supprime les doublons, garde tous les horodatages [mm:ss], n'ajoute rien qui ne soit pas dans les fiches partielles. Réponds uniquement avec la fiche en Markdown.`;

function sheetSource(course) {
  if (course.clean?.md) return course.clean.md;
  if (course.raw?.segments?.length) return course.raw.segments.map(s => `[${fmtTime(s.s)}] ${s.t}`).join('\n');
  return '';
}

export async function sheetStep(courseId, job, ctx) {
  const course = await getCourse(courseId);
  const text = sheetSource(course || {});
  if (!text) throw new StepError('Il faut d\'abord une transcription.');
  const hints = emphasisHints(course.raw?.segments);
  const hintText = hints.length ? `Passages où le prof semble insister (repérés automatiquement, à vérifier) :\n${hints.join('\n')}` : null;
  const d = job.data.sheet || (job.data.sheet = { parts: [] });
  let md, model;
  const report = (label, t) => ctx.report({ label: t ? `${label} — ${wordCount(t)} mots…` : label, done: null, total: null });

  if (wordCount(text) <= SHEET_SINGLE_MAX_WORDS) {
    const user = [context(course), hintText, `Texte du cours :\n"""\n${text}\n"""`].filter(Boolean).join('\n\n');
    report('Rédaction de la fiche de révision…');
    const r = await askClaude({ system: SHEET_SYSTEM, user, effort: 'high', signal: ctx.signal, onText: t => report('Rédaction de la fiche', t) });
    md = r.text; model = r.model;
  } else {
    // Cours très long : fiche par morceaux, puis fusion
    const paras = text.split(/\n{2,}/);
    const pieces = [];
    let cur = [];
    for (const p of paras) { cur.push(p); if (wordCount(cur.join(' ')) > SHEET_SINGLE_MAX_WORDS / 2) { pieces.push(cur.join('\n\n')); cur = []; } }
    if (cur.length) pieces.push(cur.join('\n\n'));
    for (let i = 0; i < pieces.length; i++) {
      if (d.parts[i]) continue;
      report(`Fiche partielle ${i + 1}/${pieces.length}…`);
      const r = await askClaude({ system: SHEET_SYSTEM, user: [context(course), `Morceau ${i + 1} sur ${pieces.length} d'un long cours.`, `Texte :\n"""\n${pieces[i]}\n"""`].join('\n\n'), effort: 'high', signal: ctx.signal, onText: t => report(`Fiche partielle ${i + 1}/${pieces.length}`, t) });
      d.parts[i] = r.text;
      await ctx.save();
    }
    report('Fusion des fiches…');
    const r = await askClaude({ system: MERGE_SYSTEM, user: [context(course), hintText, ...d.parts.map((p, i) => `Fiche partielle ${i + 1} :\n"""\n${p}\n"""`)].filter(Boolean).join('\n\n'), effort: 'high', signal: ctx.signal, onText: t => report('Fusion des fiches', t) });
    md = r.text; model = r.model;
  }

  const c = await getCourse(courseId);
  c.sheet = { md, model, createdAt: Date.now() };
  // Titre automatique : on reprend celui de la fiche
  const t = /^#\s+(.+)$/m.exec(md);
  if (c.autoTitle && t) c.title = t[1].replace(/[*_`#]/g, '').trim().slice(0, 90);
  await saveCourse(c);
}

// ------------------------------------------------------------------ 3. Quiz et cartes
const TRAIN_SYSTEM = `${ABOUT}

Ta tâche : créer du matériel d'entraînement à partir de la fiche et du texte du cours.
- mcq : questions à choix multiples (4 choix, une seule bonne réponse ; "answer" = position de la bonne réponse, à partir de 0 ; "explanation" = pourquoi, en t'appuyant sur le cours). Varie la position de la bonne réponse. Les mauvais choix doivent être plausibles.
- open : questions ouvertes type examen, avec une réponse modèle complète mais concise ("answer").
- cards : cartes de révision (recto = question ou terme court ; verso = réponse courte, 1 à 3 phrases ou un bout de code).
Règles : uniquement le contenu du cours, rien d'extérieur. Français clair. Priorité à ce que le prof a souligné. Pas de question sur les passages inaudibles.`;

const TRAIN_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['mcq', 'open', 'cards'],
  properties: {
    mcq: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['question', 'choices', 'answer', 'explanation'],
      properties: { question: { type: 'string' }, choices: { type: 'array', items: { type: 'string' } }, answer: { type: 'integer' }, explanation: { type: 'string' } } } },
    open: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['question', 'answer'],
      properties: { question: { type: 'string' }, answer: { type: 'string' } } } },
    cards: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['front', 'back'],
      properties: { front: { type: 'string' }, back: { type: 'string' } } } },
  },
};

export function trainCounts(durationSec) {
  const h = Math.max(0.5, Math.min(3, (durationSec || 3600) / 3600));
  return { mcq: Math.round(6 + 4 * h), open: Math.round(2 + 1.5 * h), cards: Math.round(10 + 8 * h) };
}

/** Garde la progression de révision des cartes qui existaient déjà (même recto). */
export function mergeCards(oldCards, fresh) {
  const byFront = new Map((oldCards || []).map(c => [c.front.trim().toLowerCase(), c]));
  return fresh.map(f => {
    const o = byFront.get(f.front.trim().toLowerCase());
    return o ? { ...o, back: f.back } : { id: uid(), front: f.front, back: f.back, due: 0, ivl: 0, ease: 2.5, reps: 0, lapses: 0 };
  });
}

export async function trainStep(courseId, job, ctx) {
  const course = await getCourse(courseId);
  if (!course?.sheet?.md && !course?.clean?.md && !course?.raw) throw new StepError('Il faut d\'abord une transcription.');
  const n = trainCounts(course.duration);
  const text = sheetSource(course);
  const words = text.split(/\s+/);
  const user = [
    context(course),
    `Nombre souhaité : ${n.mcq} QCM, ${n.open} questions ouvertes, ${n.cards} cartes.`,
    course.sheet?.md ? `Fiche de révision :\n"""\n${course.sheet.md}\n"""` : null,
    `Texte du cours${words.length > 60000 ? ' (début)' : ''} :\n"""\n${words.slice(0, 60000).join(' ')}\n"""`,
  ].filter(Boolean).join('\n\n');
  ctx.report({ label: 'Création du quiz et des cartes…', done: null, total: null });
  const r = await askClaudeJson({ system: TRAIN_SYSTEM, user, effort: 'medium', schema: TRAIN_SCHEMA, signal: ctx.signal,
    onText: t => ctx.report({ label: `Création du quiz et des cartes — ${Math.round(t.length / 100) / 10} k caractères…`, done: null, total: null }) });
  const data = r.data || {};
  const mcq = (data.mcq || []).filter(q => q.question && Array.isArray(q.choices) && q.choices.length >= 2 && q.answer >= 0 && q.answer < q.choices.length);
  const open = (data.open || []).filter(q => q.question && q.answer);
  const fresh = (data.cards || []).filter(c => c.front && c.back);
  if (!mcq.length && !open.length && !fresh.length) throw new StepError('Claude n\'a produit aucune question. Réessaie.', { retry: true, waitMs: 5000 });
  const c = await getCourse(courseId);
  c.quiz = { mcq, open, model: r.model, createdAt: Date.now() };
  c.cards = mergeCards(c.cards, fresh);
  await saveCourse(c);
}
