import type { Episode } from '../shared/episode';

export function EpisodeCover({ episode, priority = false }: { episode: Episode; priority?: boolean }) {
  return (
    <div className="episode-cover">
      <img
        src={episode.coverUrl}
        alt={`${episode.title}的节目封面`}
        width={1600}
        height={1600}
        loading={priority ? 'eager' : 'lazy'}
      />
    </div>
  );
}
