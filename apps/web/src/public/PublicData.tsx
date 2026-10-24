import { createContext, useContext } from 'react';
import type { PublicAppearance } from '../shared/appearance';
import type { PublicCategory } from '../shared/category';
import type { PublicEpisode, PublicEpisodeSummary } from '../shared/episode';
import type { SiteSeo } from '../shared/seo';

export type PublicData = {
  origin: string;
  appearance: PublicAppearance;
  episodes: PublicEpisodeSummary[];
  /** Present only when the request itself renders an episode page. */
  episode?: PublicEpisode;
  categories: PublicCategory[];
  site: SiteSeo;
};

export const PublicDataContext = createContext<PublicData | null>(null);
export const usePublicData = () => useContext(PublicDataContext);

export function usePublicOrigin() {
  const data = usePublicData();
  return data?.origin ?? window.location.origin;
}
