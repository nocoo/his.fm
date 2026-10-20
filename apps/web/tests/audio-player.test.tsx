// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioPlayer } from '../src/components/AudioPlayer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('shared audio player preview behavior', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
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
    await act(async () => container.querySelector<HTMLButtonElement>('.his-audio-play')?.click());
    expect(container.querySelector('[role="status"]')?.textContent).toBe('正在播放');
  });
});
