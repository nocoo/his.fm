export function setMediaMetadata(title: string, categoryName?: string, artworkUrl?: string) {
  if (typeof navigator === 'undefined' || !navigator.mediaSession || typeof MediaMetadata === 'undefined')
    return null;
  const metadata = new MediaMetadata({
    title,
    artist: 'his.fm',
    album: categoryName ?? '',
    artwork: artworkUrl ? [{ src: artworkUrl, sizes: '1400x1400', type: 'image/jpeg' }] : [],
  });
  navigator.mediaSession.metadata = metadata;
  return metadata;
}

export function clearMediaMetadata(metadata: MediaMetadata | null) {
  if (metadata && navigator.mediaSession?.metadata === metadata) navigator.mediaSession.metadata = null;
}
