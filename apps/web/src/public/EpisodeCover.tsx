import { useLocation } from 'react-router';
import { FramedCover } from '../components/FramedCover';
import { coverArtwork, coverDesignSize } from '../shared/cover-composition';
import type { PublicEpisodeSummary } from '../shared/episode';
import { episodeThumbnailProps, episodeThumbnailSizes } from '../shared/episode-thumbnail';
import { useAppearance } from './Appearance';

export function EpisodeCover({
  episode,
  categoryName,
  priority = false,
}: {
  episode: PublicEpisodeSummary;
  categoryName: string;
  priority?: boolean;
}) {
  const { id } = useAppearance();
  const { pathname } = useLocation();
  const artwork = coverArtwork(id);
  return (
    <FramedCover
      className="episode-cover"
      imageClassName="episode-cover-image"
      {...episodeThumbnailProps(episode, id)}
      sizes={episodeThumbnailSizes(
        artwork.width / coverDesignSize,
        priority,
        id === 'human-sample' && pathname === '/episodes',
      )}
      title={episode.title}
      episodeNumber={episode.episodeNumber}
      categoryName={categoryName}
      alt={`${episode.title}的节目封面`}
      width={1600}
      height={1600}
      loading={priority ? 'eager' : 'lazy'}
    />
  );
}
