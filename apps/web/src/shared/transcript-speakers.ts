export type TranscriptSpeaker = '主播' | '预言家';

export type TranscriptSegment =
  | { kind: 'markdown'; text: string }
  | { kind: 'speaker'; speaker: TranscriptSpeaker; text: string };

const SPEAKER_LINE = /^\s*\*\*(主播|预言家)：\*\*(.*)$/;

export function parseTranscriptSpeakers(markdown: string): TranscriptSegment[] {
  const normalized = markdown.replace(/\r\n?/g, '\n');
  if (!normalized.trim()) return [{ kind: 'markdown', text: normalized }];

  const segments: TranscriptSegment[] = [];
  let markdownBuffer: string[] = [];
  let speaker: TranscriptSpeaker | null = null;
  let speakerLines: string[] = [];

  const flushMarkdown = () => {
    if (!markdownBuffer.length) return;
    segments.push({ kind: 'markdown', text: markdownBuffer.join('\n') });
    markdownBuffer = [];
  };

  const flushSpeaker = () => {
    if (!speaker) return;
    segments.push({ kind: 'speaker', speaker, text: speakerLines.join('\n').trimEnd() });
    speaker = null;
    speakerLines = [];
  };

  for (const line of normalized.split('\n')) {
    const match = SPEAKER_LINE.exec(line);
    if (match) {
      flushMarkdown();
      flushSpeaker();
      speaker = match[1] as TranscriptSpeaker;
      const rest = match[2] ?? '';
      speakerLines = rest ? [rest] : [];
      continue;
    }
    if (speaker) speakerLines.push(line);
    else markdownBuffer.push(line);
  }

  flushMarkdown();
  flushSpeaker();
  return segments.length ? segments : [{ kind: 'markdown', text: normalized }];
}

export function transcriptHasSpeakerBlocks(markdown: string): boolean {
  return parseTranscriptSpeakers(markdown).some((segment) => segment.kind === 'speaker');
}
