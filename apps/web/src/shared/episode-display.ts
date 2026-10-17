export function formatEpisodeNumber(episodeNumber: number): string {
  return `EP.${String(episodeNumber).padStart(2, '0')}`;
}

export function formatEpisodeLabel(categoryName: string, episodeNumber: number): string {
  return `${categoryName} ${formatEpisodeNumber(episodeNumber)}`;
}
