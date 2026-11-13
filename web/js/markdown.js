// Mini-afficheur Markdown (titres, listes, tableaux, blocs de code...) sans dépendance.
// Tout le texte est échappé : rien de ce que renvoie une IA ne peut injecter du HTML.
// Les horodatages [mm:ss] deviennent cliquables (l'audio saute à cet endroit).
import { esc, parseTime } from './util.js';

function inline(s) {
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s);
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?![\w*])/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  s = s.replace(/\[inaudible\s*~?\s*(\d{1,2}(?::\d{2}){1,2})\s*\]/gi, (_, t) => `<span class="inaud" data-t="${parseTime(t)}" title="Écouter ce passage">[inaudible ~${t}]</span>`);
  s = s.replace(/\[inaudible\]/gi, '<span class="inaud">[inaudible]</span>');
  s = s.replace(/\[(\d{1,2}(?::\d{2}){1,2})\]/g, (_, t) => `<a class="ts" data-t="${parseTime(t)}" title="Écouter à partir d'ici">${t}</a>`);
  return s.replace(/\u0000(\d+)\u0000/g, (_, n) => `<code>${esc(codes[n])}</code>`);
}

const LIST = /^(\s*)([-*+•]|\d+[.)])\s+(.*)$/;
const isList = l => LIST.test(l);
const isHr = l => /^\s*([-*_])(\s*\1){2,}\s*$/.test(l);
const isFence = l => /^\s*(```|~~~)/.test(l);
const isHead = l => /^#{1,6}\s+/.test(l);
const isQuote = l => /^\s*>/.test(l);
const isTableSep = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && l.includes('-');
const cells = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());

function renderList(lines) {
  let html = '';
  const stack = [];
  for (const ln of lines) {
    const m = LIST.exec(ln);
    if (!m) { html += ' ' + inline(ln.trim()); continue; }   // suite de la puce précédente
    const indent = m[1].replace(/\t/g, '    ').length;
    const type = /\d/.test(m[2]) ? 'ol' : 'ul';
    while (stack.length && indent < stack[stack.length - 1].indent) html += `</li></${stack.pop().type}>`;
    const top = stack[stack.length - 1];
    if (!top || indent > top.indent) { stack.push({ indent, type }); html += `<${type}><li>`; }
    else if (top.type !== type) { html += `</li></${stack.pop().type}>`; stack.push({ indent, type }); html += `<${type}><li>`; }
    else html += '</li><li>';
    html += inline(m[3]);
  }
  while (stack.length) html += `</li></${stack.pop().type}>`;
  return html;
}

export function renderMd(src) {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    if (!ln.trim()) { i++; continue; }
    if (isFence(ln)) {
      const lang = ln.trim().slice(3).trim();
      const buf = [];
      i++;
      while (i < lines.length && !isFence(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code${lang ? ` data-lang="${esc(lang)}"` : ''}>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const hm = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(ln);
    if (hm) { out.push(`<h${hm[1].length}>${inline(hm[2])}</h${hm[1].length}>`); i++; continue; }
    if (isHr(ln)) { out.push('<hr>'); i++; continue; }
    if (isQuote(ln)) {
      const buf = [];
      while (i < lines.length && isQuote(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${renderMd(buf.join('\n'))}</blockquote>`);
      continue;
    }
    if (isList(ln)) {
      const buf = [];
      while (i < lines.length && (isList(lines[i]) || (buf.length && /^\s{2,}\S/.test(lines[i]) && !isFence(lines[i])))) buf.push(lines[i++]);
      out.push(renderList(buf));
      continue;
    }
    if (ln.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(ln);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(cells(lines[i++]));
      out.push('<table><thead><tr>' + head.map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
        rows.map(r => '<tr>' + head.map((_, k) => `<td>${inline(r[k] ?? '')}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }
    const buf = [lines[i++].trim()];
    while (i < lines.length && lines[i].trim() && !isFence(lines[i]) && !isHead(lines[i]) && !isHr(lines[i]) && !isQuote(lines[i]) && !isList(lines[i])) buf.push(lines[i++].trim());
    out.push(`<p>${inline(buf.join('\n')).replace(/\n/g, '<br>')}</p>`);
  }
  return out.join('\n');
}

/** Texte brut (pour la recherche et l'export .txt) */
export const mdToText = md => String(md ?? '')
  .replace(/```[\s\S]*?```/g, m => m.replace(/```\w*\n?/g, ''))
  .replace(/^#{1,6}\s+/gm, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1')
  .replace(/^\s*[-*+]\s+/gm, '• ').replace(/^\s*>\s?/gm, '');
