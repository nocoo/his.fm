import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearMediaMetadata, setMediaMetadata } from './media-session';

describe('media session metadata', () => {
  const session: { metadata: MediaMetadataInit | null } = { metadata: null };

  beforeEach(() => {
    session.metadata = null;
    vi.stubGlobal('navigator', { mediaSession: session });
    vi.stubGlobal(
      'MediaMetadata',
      class {
        constructor(metadata: MediaMetadataInit) {
          Object.assign(this, metadata);
        }
      },
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('provides one full-resolution JPEG with the episode and programme names', () => {
    const metadata = setMediaMetadata('Episode title', 'Programme', 'https://his.fm/episodes/id/art.jpg');
    expect(session.metadata).toBe(metadata);
    expect(metadata).toEqual({
      title: 'Episode title',
      artist: 'his.fm',
      album: 'Programme',
      artwork: [{ src: 'https://his.fm/episodes/id/art.jpg', sizes: '1400x1400', type: 'image/jpeg' }],
    });
  });

  it('replaces episode artwork with empty artwork for an unillustrated preview', () => {
    setMediaMetadata('Episode', 'Programme', 'https://his.fm/episodes/id/art.jpg');
    const metadata = setMediaMetadata('Voice preview');
    expect(metadata).toEqual({ title: 'Voice preview', artist: 'his.fm', album: '', artwork: [] });
    expect(session.metadata).toBe(metadata);
  });

  it('clears only the metadata owned by the releasing player', () => {
    const first = setMediaMetadata('First');
    const second = setMediaMetadata('Second');
    clearMediaMetadata(first);
    expect(session.metadata).toBe(second);
    clearMediaMetadata(second);
    expect(session.metadata).toBeNull();
    clearMediaMetadata(null);
    expect(session.metadata).toBeNull();
  });

  it.each([undefined, {}, { mediaSession: null }])('does nothing without a media session: %j', (value) => {
    vi.stubGlobal('navigator', value);
    expect(setMediaMetadata('Episode')).toBeNull();
    clearMediaMetadata(null);
  });

  it('does nothing without the metadata constructor', () => {
    vi.stubGlobal('MediaMetadata', undefined);
    expect(setMediaMetadata('Episode')).toBeNull();
    expect(session.metadata).toBeNull();
  });
});
