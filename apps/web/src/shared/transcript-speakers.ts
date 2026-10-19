import { lexTranscriptDocument, type TranscriptSpeaker, tokensToMarkdown } from './transcript-document';

export type { TranscriptSpeaker };

export type TranscriptSegment =
  | { kind: 'markdown'; text: string }
  | { kind: 'speaker'; speaker: TranscriptSpeaker; text: string };

export function parseTranscriptSpeakers(markdown: string): TranscriptSegment[] {
  const { groups } = lexTranscriptDocument(markdown);
  if (!groups.length) {
    const normalized = markdown.replace(/\r\n?/g, '\n');
    return [{ kind: 'markdown', text: normalized }];
  }
  return groups.map((group) =>
    group.kind === 'markdown'
      ? { kind: 'markdown', text: tokensToMarkdown(group.tokens) }
      : { kind: 'speaker', speaker: group.speaker, text: tokensToMarkdown(group.tokens).trimEnd() },
  );
}

export function transcriptHasSpeakerBlocks(markdown: string): boolean {
  return lexTranscriptDocument(markdown).hasSpeakerTurns;
}
