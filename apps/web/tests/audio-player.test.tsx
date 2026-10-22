// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioPlayer } from '../src/components/AudioPlayer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('shared audio player preview behavior', () => {
  let container: HTMLDivElement;
  let root: Root;
  const mediaSession: { metadata: MediaMetadataInit | null } = { metadata: null };

  beforeEach(() => {
    mediaSession.metadata = null;
    vi.stubGlobal('navigator', { mediaSession });
    vi.stubGlobal(
      'MediaMetadata',
      class {
        constructor(metadata: MediaMetadataInit) {
          Object.assign(this, metadata);
        }
      },
    );
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async function (this: HTMLMediaElement) {
      Object.defineProperty(this, 'paused', { configurable: true, value: false });
      this.dispatchEvent(new Event('play'));
      this.dispatchEvent(new Event('playing'));
    });
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
      Object.defineProperty(this, 'paused', { configurable: true, value: true });
      this.dispatchEvent(new Event('pause'));
    });
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('preserves full-player heading, status and controls by default', async () => {
    await act(async () =>
      root.render(<AudioPlayer src="/first.mp3" title="完整播放器" subtitle="节目摘要" preload="none" />),
    );
    expect(container.querySelector('.his-audio-title')?.textContent).toBe('完整播放器');
    expect(container.querySelector('.his-audio-subtitle')?.textContent).toBe('节目摘要');
    expect(container.querySelector('[role="status"]')?.textContent).toBe('准备好，慢慢听');
    expect(container.querySelector('.his-audio-volume-slider')).not.toBeNull();
    expect(container.querySelector('audio')?.hasAttribute('controls')).toBe(false);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="静音"]')?.click());
    expect(container.querySelector('audio')?.muted).toBe(true);
    expect(container.querySelector('[aria-label="取消静音"]')).not.toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('.his-audio-speed')?.click());
    expect(container.querySelector('audio')?.playbackRate).toBe(1.25);
    expect(container.querySelector('.his-audio-speed')?.getAttribute('aria-label')).toContain('1.25 倍');
  });

  it('omits only preview idle copy and retains loading, playback, errors and retry', async () => {
    await act(async () =>
      root.render(<AudioPlayer src="/preview.mp3" title="Bo" compact hideIdleStatus preload="none" />),
    );
    const audio = container.querySelector('audio');
    expect(audio).not.toBeNull();
    expect(container.querySelector('section')?.getAttribute('aria-label')).toBe('音频播放器：Bo');
    expect(container.querySelector('[role="status"]')?.textContent).toBe('');
    expect(container.querySelector('[aria-label="播放进度（秒）"]')).not.toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="播放"]')?.click());
    expect(container.querySelector('[aria-label="暂停"]')).not.toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toBe('正在播放');
    await act(async () => audio?.dispatchEvent(new Event('waiting')));
    expect(container.querySelector('[role="status"]')?.textContent).toBe('正在加载音频…');
    await act(async () => {
      if (audio) Object.defineProperty(audio, 'error', { configurable: true, value: { code: 2 } });
      audio?.dispatchEvent(new Event('error'));
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      '音频暂时无法加载，请检查网络后重试。',
    );
    expect(container.querySelector<HTMLButtonElement>('.his-audio-play')?.disabled).toBe(true);
    await act(async () => container.querySelector<HTMLButtonElement>('.his-audio-retry')?.click());
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toBe('正在加载音频…');
    expect(container.querySelector<HTMLButtonElement>('.his-audio-play')?.disabled).toBe(false);
    expect(audio?.preload).toBe('metadata');
  });

  it('preserves mutual exclusion between a full player and preview and resets on source changes', async () => {
    await act(async () =>
      root.render(
        <>
          <AudioPlayer src="/full.mp3" preload="none" />
          <AudioPlayer src="/preview.mp3" title="Preview" compact hideIdleStatus preload="none" />
        </>,
      ),
    );
    const players = container.querySelectorAll<HTMLElement>('.his-audio-player');
    const first = players[0].querySelector('audio');
    const second = players[1].querySelector('audio');
    await act(async () => players[0].querySelector<HTMLButtonElement>('.his-audio-play')?.click());
    expect(first?.paused).toBe(false);
    await act(async () => players[1].querySelector<HTMLButtonElement>('.his-audio-play')?.click());
    expect(first?.paused).toBe(true);
    expect(second?.paused).toBe(false);
    expect(players[0].querySelector('[aria-label="播放"]')).not.toBeNull();
    await act(async () => {
      if (second) {
        Object.defineProperty(second, 'duration', { configurable: true, value: 120 });
        second.currentTime = 35;
        second.dispatchEvent(new Event('loadedmetadata'));
        second.dispatchEvent(new Event('timeupdate'));
      }
      players[1].querySelector<HTMLButtonElement>('.his-audio-speed')?.click();
    });
    expect(players[1].querySelector('.his-audio-times')?.textContent).toBe('0:352:00');
    await act(async () => root.render(<AudioPlayer src="/new.mp3" compact hideIdleStatus preload="none" />));
    expect(second?.paused).toBe(true);
    expect(container.querySelector('audio')?.getAttribute('src')).toBe('/new.mp3');
    expect(container.querySelector('.his-audio-times')?.textContent).toBe('0:00—:——');
    expect(container.querySelector('.his-audio-speed')?.textContent).toBe('1×');
    expect(container.querySelector('[role="status"]')?.textContent).toBe('');
  });

  it('retains a blocked-play notice in preview instead of hiding it as idle copy', async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(
      new DOMException('Blocked', 'NotAllowedError'),
    );
    await act(async () =>
      root.render(<AudioPlayer src="/preview.mp3" compact hideIdleStatus preload="none" />),
    );
    await act(async () => container.querySelector<HTMLButtonElement>('.his-audio-play')?.click());
    expect(container.querySelector('[role="status"]')?.textContent).toBe('播放未能开始，请再次点击播放。');
    expect(mediaSession.metadata).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('.his-audio-play')?.click());
    expect(container.querySelector('[role="status"]')?.textContent).toBe('正在播放');
  });

  it('publishes artwork only on play, retains it while paused and refreshes active details', async () => {
    const render = (title: string, categoryName: string, mediaArtworkUrl: string) =>
      root.render(
        <AudioPlayer
          src="/episode.mp3"
          title={title}
          categoryName={categoryName}
          mediaArtworkUrl={mediaArtworkUrl}
          preload="none"
        />,
      );
    await act(async () => render('First', 'Programme', 'https://his.fm/episodes/first/art.jpg'));
    expect(mediaSession.metadata).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('.his-audio-play')?.click());
    expect(mediaSession.metadata).toEqual({
      title: 'First',
      artist: 'his.fm',
      album: 'Programme',
      artwork: [{ src: 'https://his.fm/episodes/first/art.jpg', sizes: '1400x1400', type: 'image/jpeg' }],
    });
    const playingMetadata = mediaSession.metadata;
    await act(async () => container.querySelector<HTMLButtonElement>('.his-audio-play')?.click());
    expect(mediaSession.metadata).toBe(playingMetadata);
    await act(async () => render('Corrected', 'New programme', 'https://his.fm/episodes/new/art.jpg'));
    expect(mediaSession.metadata?.title).toBe('Corrected');
    expect(mediaSession.metadata?.album).toBe('New programme');
    expect(mediaSession.metadata?.artwork?.[0].src).toBe('https://his.fm/episodes/new/art.jpg');
    await act(async () => container.querySelector('audio')?.dispatchEvent(new Event('ended')));
    expect(mediaSession.metadata?.title).toBe('Corrected');
    await act(async () => root.render(null));
    expect(mediaSession.metadata).toBeNull();
  });

  it('never lets an inactive player update or clear the active preview metadata', async () => {
    const render = (title: string, showEpisode = true) =>
      root.render(
        <>
          {showEpisode && (
            <AudioPlayer key="episode" src="/episode.mp3" title={title} mediaArtworkUrl="/art.jpg" />
          )}
          <AudioPlayer key="preview" src="/preview.mp3" title="Preview" compact />
        </>,
      );
    await act(async () => render('Episode'));
    const buttons = container.querySelectorAll<HTMLButtonElement>('.his-audio-play');
    await act(async () => buttons[0].click());
    await act(async () => buttons[1].click());
    const previewMetadata = mediaSession.metadata;
    expect(previewMetadata?.title).toBe('Preview');
    expect(previewMetadata?.artwork).toEqual([]);
    await act(async () => render('Inactive update'));
    expect(mediaSession.metadata).toBe(previewMetadata);
    await act(async () => container.querySelector('audio')?.dispatchEvent(new Event('error')));
    expect(mediaSession.metadata).toBe(previewMetadata);
    await act(async () => render('Inactive update', false));
    expect(mediaSession.metadata).toBe(previewMetadata);
  });

  it('clears stale metadata on source replacement and active media errors', async () => {
    await act(async () => root.render(<AudioPlayer src="/first.mp3" title="First" />));
    await act(async () => container.querySelector<HTMLButtonElement>('.his-audio-play')?.click());
    expect(mediaSession.metadata?.title).toBe('First');
    await act(async () => root.render(<AudioPlayer src="/second.mp3" title="Second" />));
    expect(mediaSession.metadata).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('.his-audio-play')?.click());
    expect(mediaSession.metadata?.title).toBe('Second');
    await act(async () => container.querySelector('audio')?.dispatchEvent(new Event('error')));
    expect(mediaSession.metadata).toBeNull();
    await act(async () => root.render(<AudioPlayer src="/second.mp3" title="Changed after error" />));
    expect(mediaSession.metadata).toBeNull();
  });
});
