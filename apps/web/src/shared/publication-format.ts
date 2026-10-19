import { Lexer, Marked, type Token, type Tokens } from 'marked';
import type { Production } from './production';
import { lexTranscriptDocument, type TranscriptSpeaker } from './transcript-document';

type PublicationContent = Pick<
  Production,
  'title' | 'description' | 'transcript' | 'summary' | 'assets' | 'sources'
>;
const ink = '#183d2e';
const muted = '#687469';
const speakerTint = { 主播: '#eef4f0', 预言家: '#f3f0ea' } satisfies Record<TranscriptSpeaker, string>;
export const DEFAULT_READING_LABEL_PREFIX = 'studio-transcript-label';

export function sanitizeReadingIdPrefix(value: string) {
  const sanitized = value
    .replace(/[^A-Za-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return sanitized || DEFAULT_READING_LABEL_PREFIX;
}

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

function createWechatMarked(references: string[]) {
  return new Marked({
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
}

function parseWechatTokens(marked: Marked, tokens: Token[]) {
  if (!tokens.length) return '';
  return marked.parser(tokens);
}

function renderWechatSpeakerBlock(speaker: TranscriptSpeaker, bodyHtml: string) {
  const background = speakerTint[speaker];
  return `<section data-speaker="${escapeHtml(speaker)}" style="margin:0 0 22px;padding:16px 18px;border-radius:12px;background:${background};"><p style="margin:0 0 12px;font-size:14px;font-weight:600;letter-spacing:0.04em;color:${ink};">${escapeHtml(speaker)}</p><div>${bodyHtml}</div></section>`;
}

function formatWechatTranscript(transcript: string, references: string[]) {
  const document = lexTranscriptDocument(transcript);
  const marked = createWechatMarked(references);
  if (!document.hasSpeakerTurns) {
    return transcript ? marked.parse(transcript, { async: false }) : '';
  }
  return document.groups
    .map((group) => {
      if (group.kind === 'markdown') return parseWechatTokens(marked, group.tokens);
      const body = parseWechatTokens(marked, group.tokens);
      return renderWechatSpeakerBlock(group.speaker, body);
    })
    .join('');
}

export function formatWechat(production: PublicationContent): { html: string; text: string } {
  const references: string[] = [];
  const content = formatWechatTranscript(production.transcript, references);
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

function createReadingMarked() {
  return new Marked({
    gfm: true,
    breaks: true,
    renderer: {
      html() {
        return '';
      },
      image() {
        return '';
      },
      link({ href, tokens }) {
        const label = this.parser.parseInline(tokens);
        const url = secureUrl(href);
        return url
          ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`
          : label;
      },
    },
  });
}

function parseReadingTokens(marked: Marked, tokens: Token[]) {
  if (!tokens.length) return '';
  return marked.parser(tokens);
}

function renderReadingSpeakerBlock(
  speaker: TranscriptSpeaker,
  bodyHtml: string,
  labelPrefix: string,
  index: number,
) {
  const id = `${labelPrefix}-${index}`;
  return `<div class="studio-transcript-block" data-speaker="${escapeHtml(speaker)}" role="group" aria-labelledby="${id}"><div class="studio-transcript-block-label" id="${id}">${escapeHtml(speaker)}</div><div class="studio-transcript-block-body">${bodyHtml}</div></div>`;
}

export function formatReading(markdown: string, options: { idPrefix?: string } = {}): string {
  const document = lexTranscriptDocument(markdown);
  if (!document.hasSpeakerTurns) {
    return markdown ? createReadingMarked().parse(markdown, { async: false }) : '';
  }
  const marked = createReadingMarked();
  const labelPrefix = sanitizeReadingIdPrefix(options.idPrefix ?? DEFAULT_READING_LABEL_PREFIX);
  let speakerIndex = 0;
  return document.groups
    .map((group) => {
      if (group.kind === 'markdown') return parseReadingTokens(marked, group.tokens);
      const body = parseReadingTokens(marked, group.tokens);
      return renderReadingSpeakerBlock(group.speaker, body, labelPrefix, speakerIndex++);
    })
    .join('\n');
}
