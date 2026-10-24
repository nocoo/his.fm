import type { EpisodeTopic } from './episode';

export function outlineFromTopics(topics: EpisodeTopic[]) {
  return topics.map((topic) => ({ title: topic.title, detail: topic.detail }));
}
