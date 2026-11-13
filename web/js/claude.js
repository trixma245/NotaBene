// Appel direct de l'API Claude depuis le navigateur (la clé reste sur l'appareil).
// Réponse en streaming : on voit le texte arriver, et les longues réponses ne coupent pas.
import { getKeys, getSettings } from './settings.js';
import { anthropicHeaders } from './keys.js';
import { StepError } from './transcribe.js';

// Modèles qui acceptent le « repli » côté serveur : si un filtre de sécurité refuse par erreur
// un passage (un cours de réseau qui parle de pare-feu...), l'API réessaie avec un autre modèle.
const WITH_FALLBACK = new Set(['claude-opus-5-5', 'claude-fable-5-2', 'claude-sonnet-5-5']);

async function apiError(r) {
  let msg = '', type = '';
  try { const j = await r.json(); msg = j?.error?.message || ''; type = j?.error?.type || ''; } catch {}
  if (r.status === 401) return new StepError('Clé Anthropic refusée. Vérifie-la dans Réglages (bouton « Tester la clé »).', { key: 'anthropic' });
  if (r.status === 403) return new StepError(`Accès refusé par Anthropic : ${msg || 'permission manquante'}.`, { key: 'anthropic' });
  if (/credit balance|billing|crédit/i.test(msg) || type === 'billing_error') return new StepError('Crédit Anthropic épuisé : recharge ton compte sur console.anthropic.com (Billing).', { key: 'anthropic' });
  if (r.status === 404 || /model/i.test(msg) && r.status === 400) return new StepError(`Ce modèle Claude n'est pas disponible pour ton compte (${msg}). Choisis-en un autre dans Réglages.`);
  if (r.status === 413) return new StepError('Texte trop long pour une seule demande à Claude.');
  if (r.status === 429) {
    const ra = parseFloat(r.headers.get('retry-after')) || 60;
    return new StepError(`Limite d'utilisation Anthropic atteinte. Reprise dans ${Math.round(ra)} s.`, { retry: true, waitMs: Math.max(15, ra) * 1000, limit: true });
  }
  if (r.status >= 500) return new StepError(`Claude est surchargé ou indisponible (${r.status}). Nouvel essai bientôt.`, { retry: true, waitMs: 45000 });
  return new StepError(`Erreur de l'API Claude (${r.status}) : ${msg || 'inconnue'}`);
}

/**
 * Envoie une demande à Claude.
 *  system, user : textes ; effort : 'low' | 'medium' | 'high' ; schema : schéma JSON de la réponse
 *  onText(texteComplet) : appelé pendant l'arrivée du texte
 * Renvoie { text, model, usage }.
 */
export async function askClaude({ system, user, effort = 'medium', schema = null, maxTokens = 64000, onText, signal }) {
  const key = getKeys().anthropic;
  if (!key) throw new StepError('Ajoute ta clé Anthropic dans Réglages pour le nettoyage, les fiches et les quiz.', { key: 'anthropic' });
  if (!navigator.onLine) throw new StepError('Pas de réseau : ça reprendra tout seul quand internet reviendra.', { offline: true, retry: true });
  const model = getSettings().claudeModel;
  const body = {
    model, max_tokens: maxTokens, stream: true,
    system, messages: [{ role: 'user', content: user }],
    output_config: { effort, ...(schema ? { format: { type: 'json_schema', schema } } : {}) },
  };
  const headers = anthropicHeaders(key);
  if (WITH_FALLBACK.has(model)) {
    body.fallbacks = 'default';
    headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
  }

  let r;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body), signal });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw new StepError('Impossible de joindre Claude (réseau). Ça reprendra quand la connexion sera revenue.', { offline: true, retry: true, waitMs: 15000 });
  }
  if (!r.ok) throw await apiError(r);

  // Lecture du flux d'événements (SSE)
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '', text = '', stop = null, usedModel = model, details = null;
  const usage = { input: 0, output: 0 };
  const handle = ev => {
    switch (ev.type) {
      case 'message_start':
        usedModel = ev.message?.model || usedModel;
        usage.input = ev.message?.usage?.input_tokens || 0;
        break;
      case 'content_block_delta':
        if (ev.delta?.type === 'text_delta') { text += ev.delta.text; onText?.(text); }
        break;
      case 'message_delta':
        stop = ev.delta?.stop_reason ?? stop;
        details = ev.delta?.stop_details ?? details;
        if (ev.usage?.output_tokens) usage.output = ev.usage.output_tokens;
        break;
      case 'error': {
        const t = ev.error?.type;
        if (t === 'overloaded_error' || t === 'api_error') throw new StepError('Claude est surchargé. Nouvel essai bientôt.', { retry: true, waitMs: 45000 });
        throw new StepError(`Erreur de Claude : ${ev.error?.message || t}`);
      }
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
        if (data) { try { handle(JSON.parse(data)); } catch (e) { if (e instanceof StepError) throw e; } }
      }
    }
  } catch (e) {
    if (e instanceof StepError || e?.name === 'AbortError') throw e;
    throw new StepError('La connexion a été coupée pendant la réponse de Claude. Nouvel essai bientôt.', { retry: true, waitMs: 15000, offline: !navigator.onLine });
  }

  if (stop === 'refusal') {
    throw new StepError(`Claude a refusé de traiter ce texte (filtre de sécurité${details?.category ? ` : ${details.category}` : ''}). Essaie un autre modèle dans Réglages.`);
  }
  if (stop === 'max_tokens') throw new StepError('La réponse de Claude a été coupée (trop longue). Réessaie : le texte sera découpé autrement.');
  if (!stop) throw new StepError('Réponse de Claude incomplète. Nouvel essai bientôt.', { retry: true, waitMs: 15000 });
  return { text: text.trim(), model: usedModel, usage };
}

/** Réponse JSON (avec schéma). */
export async function askClaudeJson(opts) {
  const r = await askClaude(opts);
  try {
    return { ...r, data: JSON.parse(r.text) };
  } catch {
    throw new StepError('Claude a renvoyé une réponse illisible. Nouvel essai bientôt.', { retry: true, waitMs: 5000 });
  }
}
