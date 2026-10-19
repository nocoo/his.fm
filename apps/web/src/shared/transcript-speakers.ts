import { Lexer } from 'marked';

export type TranscriptSpeaker = '主播' | '预言家';

export type TranscriptSegment =
  | { kind: 'markdown'; text: string }
  | { kind: 'speaker'; speaker: TranscriptSpeaker; text: string };

const SPEAKER_PARAGRAPH = /^\*\*(主播|预言家)：\*\*(.*)$/;

export function parseTranscriptSpeakers(markdown: string): TranscriptSegment[] {
  const normalized = markdown.replace(/\r\n?/g, '\n');
  if (!normalized.trim()) return [{ kind: 'markdown', text: normalized }];

  const tokens = Lexer.lex(normalized);
  const segments: TranscriptSegment[] = [];
  let markdownParts: string[] = [];
  let speaker: TranscriptSpeaker | null = null;
  let speakerParagraphs: string[] = [];

  const flushMarkdown = () => {
    if (!markdownParts.length) return;
    segments.push({ kind: 'markdown', text: markdownParts.join('') });
    markdownParts = [];
  };

  const flushSpeaker = () => {
    if (!speaker) return;
    segments.push({ kind: 'speaker', speaker, text: speakerParagraphs.join('\n\n').trimEnd() });
    speaker = null;
    speakerParagraphs = [];
  };

  for (const token of tokens) {
    if (token.type === 'space') {
      if (!speaker) markdownParts.push(token.raw);
      continue;
    }

    if (token.type === 'paragraph') {
      const match = SPEAKER_PARAGRAPH.exec(token.text);
      if (match) {
        flushMarkdown();
        flushSpeaker();
        speaker = match[1] as TranscriptSpeaker;
        const rest = match[2] ?? '';
        speakerParagraphs = rest ? [rest] : [];
        continue;
      }
      if (speaker) speakerParagraphs.push(token.text);
      else markdownParts.push(token.raw);
      continue;
    }

    flushSpeaker();
    markdownParts.push(token.raw);
  }

  flushMarkdown();
  flushSpeaker();
  return segments.length ? segments : [{ kind: 'markdown', text: normalized }];
}

export function transcriptHasSpeakerBlocks(markdown: string): boolean {
  return parseTranscriptSpeakers(markdown).some((segment) => segment.kind === 'speaker');
}
