import { Lexer, type Token, type Tokens } from 'marked';

export type OutlineEntry = { title: string; detail: string };

const maxEntries = 12;

function plainText(tokens: Token[]): string {
  return tokens
    .map((token) => {
      if ('tokens' in token && Array.isArray(token.tokens)) return plainText(token.tokens);
      if (token.type === 'codespan') return (token as Tokens.Codespan).text;
      if ('text' in token && typeof token.text === 'string')
        return token.text
          .replace(/[*_~`]/g, '')
          .replace(/\s+/g, ' ')
          .trim();
      return '';
    })
    .join('');
}

function splitEntry(text: string): OutlineEntry | null {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length < 4) return null;
  const separators = [normalized.indexOf('：'), normalized.indexOf(':')].filter((index) => index > 0);
  if (separators.length) {
    const at = Math.min(...separators);
    const head = normalized.slice(0, at).trim();
    if (head.length >= 2) return { title: head, detail: normalized.slice(at + 1).trim() };
  }
  return { title: normalized, detail: '' };
}

/**
 * The first markdown bullet list of an episode usually spells out what the episode covers: the
 * 「本期听点」list, a 「本期讨论」list, or a plain run of topic sentences. It is a temporary source
 * for the episode outline until structured topics exist on the episode itself.
 */
export function outlineFromShowNotes(showNotes: string): OutlineEntry[] {
  if (!showNotes.trim()) return [];
  for (const token of Lexer.lex(showNotes, { gfm: true })) {
    if (token.type !== 'list') continue;
    const list = token as Tokens.List;
    if (list.items.length < 3) continue;
    const seen = new Set<string>();
    const entries = list.items
      .map((item) => splitEntry(plainText(item.tokens)))
      .filter((entry): entry is OutlineEntry => entry !== null)
      .filter((entry) => !seen.has(entry.title) && Boolean(seen.add(entry.title)))
      .slice(0, maxEntries);
    if (entries.length >= 3) return entries;
  }
  return [];
}
