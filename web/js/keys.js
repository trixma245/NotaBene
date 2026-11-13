// Vérifie qu'une clé API fonctionne (bouton « Tester » des réglages).
// Les clés partent uniquement vers le service concerné, jamais ailleurs.

export const ANTHROPIC_VERSION = '2026-10-21';

/** En-têtes communs pour appeler l'API Claude directement depuis le navigateur */
export const anthropicHeaders = key => ({
  'content-type': 'application/json',
  'x-api-key': key,
  'anthropic-version': ANTHROPIC_VERSION,
  'anthropic-dangerous-direct-browser-access': 'true',
});

const PROVIDERS = {
  groq: { name: 'Groq', url: 'https://api.groq.com/openai/v1/models', headers: k => ({ Authorization: `Bearer ${k}` }) },
  openai: { name: 'OpenAI', url: 'https://api.openai.com/v1/models', headers: k => ({ Authorization: `Bearer ${k}` }) },
  anthropic: { name: 'Anthropic', url: 'https://api.anthropic.com/v1/models?limit=1', headers: anthropicHeaders },
};

/** Renvoie { ok, message } */
export async function testKey(provider, key) {
  const p = PROVIDERS[provider];
  if (!key) return { ok: false, message: `Colle d'abord ta clé ${p.name}.` };
  if (!navigator.onLine) return { ok: false, message: 'Pas de connexion internet : impossible de tester la clé maintenant.' };
  try {
    const r = await fetch(p.url, { headers: p.headers(key) });
    if (r.ok) return { ok: true, message: `Clé ${p.name} valide ✓` };
    if (r.status === 401 || r.status === 403) return { ok: false, message: `Clé ${p.name} refusée. Vérifie que tu l'as copiée en entier, sans espace.` };
    if (r.status === 429) return { ok: true, message: `Clé ${p.name} reconnue, mais la limite d'utilisation est atteinte pour l'instant.` };
    return { ok: false, message: `${p.name} a répondu une erreur (${r.status}). Réessaie plus tard.` };
  } catch {
    return { ok: false, message: `Impossible de joindre ${p.name}. Vérifie ta connexion.` };
  }
}
