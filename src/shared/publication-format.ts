import { Lexer, Marked, type Token, type Tokens } from 'marked';
import type { Production } from './production';

type PublicationContent = Pick<
  Production,
  'title' | 'description' | 'transcript' | 'summary' | 'assets' | 'sources'
>;
const ink = '#183d2e';
const muted = '#687469';

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function secureUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

function plain(tokens: Token[]): string {
  return tokens
    .map((token) => {
      if (token.type === 'html' || token.type === 'image' || token.type === 'def') return '';
      if (token.type === 'space' || token.type === 'hr') return '\n';
      if (token.type === 'br') return '\n';
      if (token.type === 'list')
        return `${token.items.map((item: Tokens.ListItem, index: number) => `${token.ordered ? `${index + 1}.` : '•'} ${plain(item.tokens).trim()}`).join('\n')}\n\n`;
      if (token.type === 'table')
        return `${[token.header, ...token.rows].map((row) => row.map((cell: Tokens.TableCell) => plain(cell.tokens)).join(' / ')).join('\n')}\n\n`;
      if (token.type === 'link') {
        const label = plain(token.tokens ?? []);
        const url = secureUrl(token.href);
        return url && url !== label ? `${label}（${url}）` : label;
      }
      const value =
        'tokens' in token && token.tokens ? plain(token.tokens) : 'text' in token ? String(token.text) : '';
      return ['heading', 'paragraph', 'blockquote', 'code'].includes(token.type) ? `${value}\n\n` : value;
    })
    .join('');
}

export function cleanText(markdown: string): string {
  return plain(Lexer.lex(markdown))
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function formatXiaoyuzhou(production: PublicationContent): string {
  return cleanText(production.description);
}

export function formatWechat(production: PublicationContent): { html: string; text: string } {
  const references: string[] = [];
  const parser = new Marked({
    gfm: true,
    breaks: true,
    renderer: {
      html() {
        return '';
      },
      image() {
        return '';
      },
      paragraph({ tokens }) {
        return `<p style="margin:0 0 18px;line-height:1.9;">${this.parser.parseInline(tokens)}</p>`;
      },
      heading({ tokens }) {
        return `<h2 style="font-size:20px;line-height:1.5;color:${ink};margin:28px 0 14px;">${this.parser.parseInline(tokens)}</h2>`;
      },
      code({ text }) {
        return `<pre style="white-space:pre-wrap;font-size:14px;padding:16px;background:#f4f5ee;">${escapeHtml(text)}</pre>`;
      },
      codespan({ text }) {
        return `<code>${escapeHtml(text)}</code>`;
      },
      link({ href, tokens }) {
        const label = this.parser.parseInline(tokens);
        const url = secureUrl(href);
        if (!url) return label;
        let index = references.indexOf(url);
        if (index < 0) index = references.push(url) - 1;
        return `${label}<sup style="color:${muted};">[${index + 1}]</sup>`;
      },
    },
  });
  const content = parser.parse(production.transcript, { async: false });
  for (const source of production.sources) {
    const url = source.type === 'text' ? '' : secureUrl(source.content);
    if (url && !references.includes(url)) references.push(url);
  }
  const cover = secureUrl(production.assets.cover?.url ?? '');
  const image = cover
    ? `<img src="${escapeHtml(cover)}" alt="${escapeHtml(production.title)}" style="display:block;width:100%;height:auto;margin:0 0 24px;"/>`
    : '';
  const footnotes = references.length
    ? `<section style="font-size:13px;color:${muted};word-break:break-all;"><h3 style="font-size:15px;">参考资料</h3>${references.map((url, index) => `<p>[${index + 1}] ${escapeHtml(url)}</p>`).join('')}</section>`
    : '';
  const html = `<section style="font-family:system-ui,-apple-system,sans-serif;font-size:16px;color:${ink};line-height:1.9;">${image}${content}${footnotes}<p style="margin-top:28px;font-size:14px;color:${muted};">his.fm</p></section>`;
  const text = `${cleanText(production.transcript)}${references.length ? `\n\n参考资料\n${references.map((url, index) => `[${index + 1}] ${url}`).join('\n')}` : ''}\n\nhis.fm`;
  return { html, text };
}
