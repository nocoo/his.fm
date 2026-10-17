import { FramedCover } from '../components/FramedCover';
import type { Episode } from '../shared/episode';

export function EpisodeCover({ episode, priority = false }: { episode: Episode; priority?: boolean }) {
  return (
    <FramedCover
      className="episode-cover"
      imageClassName="episode-cover-image"
      src={episode.coverUrl}
      alt={`${episode.title}的节目封面`}
      width={1600}
      height={1600}
      loading={priority ? 'eager' : 'lazy'}
    />
  );
}
