import type { EpisodeTopic } from './episode';
import type { OutlineEntry } from './show-notes-outline';

type StructureFields = {
  lead: string;
  researchNote: string;
  credits: string;
  body: string;
  topics: EpisodeTopic[];
};

/** Rows written before the structure migration still carry their episode body in `showNotes`. */
export function hasStructuredContent(episode: StructureFields): boolean {
  return Boolean(
    episode.lead.trim() ||
      episode.researchNote.trim() ||
      episode.credits.trim() ||
      episode.body.trim() ||
      episode.topics.length,
  );
}

export function outlineFromTopics(topics: EpisodeTopic[]): OutlineEntry[] {
  return topics.map((topic) => ({ title: topic.title, detail: topic.detail }));
}
