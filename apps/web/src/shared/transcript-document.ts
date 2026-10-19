import { Lexer, type Token, type Tokens } from 'marked';

export type TranscriptSpeaker = '主播' | '预言家';

export type TranscriptTokenGroup =
  | { kind: 'markdown'; tokens: Token[] }
  | { kind: 'speaker'; speaker: TranscriptSpeaker; tokens: Token[] };

export type TranscriptDocument = {
  tokens: Token[];
  groups: TranscriptTokenGroup[];
  hasSpeakerTurns: boolean;
};

export const SPEAKER_LABEL_PREFIX = /^\*\*(主播|预言家)：\*\*/;

export function parseSpeakerLabelPrefix(text: string) {
  const match = SPEAKER_LABEL_PREFIX.exec(text);
  if (!match) return null;
  const speaker = match[1] as TranscriptSpeaker;
  const prefix = match[0];
  return { speaker, prefix, body: text.slice(prefix.length) };
}

function stripSpeakerLabelFromInlines(inline: Token[], prefix: string): Token[] | null {
  let remaining = prefix.length;
  const stripped: Token[] = [];
  for (const token of inline) {
    if (remaining <= 0) {
      stripped.push(token);
      continue;
    }
    if (token.type !== 'text' || !('text' in token)) return null;
    const text = String(token.text);
    const raw = 'raw' in token ? String(token.raw) : text;
    if (text.length < remaining) {
      remaining -= text.length;
      continue;
    }
    const nextText = text.slice(remaining);
    const nextRaw = raw.slice(remaining);
    remaining = 0;
    if (nextText.length > 0) {
      stripped.push({ ...token, text: nextText, raw: nextRaw });
    }
  }
  return remaining > 0 ? null : stripped;
}

function peelSpeakerParagraph(token: Tokens.Paragraph, lexer: Lexer) {
  const parsed = parseSpeakerLabelPrefix(token.text);
  if (!parsed) return null;
  const { speaker, prefix, body } = parsed;
  const labelText = `${speaker}：`;
  let inline = token.tokens ? [...token.tokens] : [];
  if (inline[0]?.type === 'strong' && inline[0].text === labelText) {
    inline = inline.slice(1);
  } else if (token.text.startsWith(prefix)) {
    const withoutLabel = stripSpeakerLabelFromInlines(inline, prefix);
    inline = withoutLabel ?? lexer.inlineTokens(body);
  }
  const paragraph: Tokens.Paragraph = { ...token, text: body, raw: body, tokens: inline };
  return { speaker, paragraph };
}

export function lexTranscriptDocument(markdown: string): TranscriptDocument {
  const normalized = markdown.replace(/\r\n?/g, '\n');
  const lexer = new Lexer({ gfm: true, breaks: true });
  const tokens = lexer.lex(normalized);
  const groups: TranscriptTokenGroup[] = [];
  let markdownTokens: Token[] = [];
  let speaker: TranscriptSpeaker | null = null;
  let speakerTokens: Token[] = [];

  const flushMarkdown = () => {
    if (!markdownTokens.length) return;
    groups.push({ kind: 'markdown', tokens: markdownTokens });
    markdownTokens = [];
  };

  const flushSpeaker = () => {
    if (!speaker) return;
    groups.push({ kind: 'speaker', speaker, tokens: speakerTokens });
    speaker = null;
    speakerTokens = [];
  };

  for (const token of tokens) {
    if (token.type === 'def') continue;

    if (token.type === 'paragraph') {
      const peeled = peelSpeakerParagraph(token as Tokens.Paragraph, lexer);
      if (peeled) {
        flushMarkdown();
        flushSpeaker();
        speaker = peeled.speaker;
        speakerTokens = [peeled.paragraph];
        continue;
      }
    }

    if (speaker) speakerTokens.push(token);
    else markdownTokens.push(token);
  }

  flushMarkdown();
  flushSpeaker();

  return {
    tokens,
    groups,
    hasSpeakerTurns: groups.some((group) => group.kind === 'speaker'),
  };
}

export function tokensToMarkdown(tokens: Token[]) {
  return tokens.map((token) => token.raw).join('');
}
