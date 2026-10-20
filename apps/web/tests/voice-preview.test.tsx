// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useReferenceSample } from '../src/admin/voice-preview/useReferenceSample';
import { VoicePreviewContent } from '../src/admin/voice-preview/VoicePreview';
import { voicePreviewSampleScript } from '../src/shared/voice-samples';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ url }: { url: string }) {
  const sample = useReferenceSample(url);
  return (
    <button type="button" data-status={sample.status} onClick={sample.retry}>
      {sample.playbackUrl}
    </button>
  );
}

describe('admin voice preview', () => {
  let container: HTMLDivElement;
  let root: Root;
  const fetchSample = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchSample
      .mockReset()
      .mockImplementation(async () => new Response(null, { headers: { ETag: '"sample/version"' } }));
    vi.stubGlobal('fetch', fetchSample);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders all 55 compact cards with accurate tags/models and collapsed disclosures', async () => {
    await act(async () => root.render(<VoicePreviewContent />));
    expect(container.querySelectorAll('.appearance-voice-card')).toHaveLength(55);
    expect(container.querySelectorAll('.appearance-voice-card audio')).toHaveLength(55);
    expect(container.querySelectorAll('.appearance-voice-card[data-provider="mai"]')).toHaveLength(5);
    expect(container.querySelector('[data-voice="River"]')?.getAttribute('data-gender')).toBe('non-binary');
    expect(container.querySelector('[data-voice="Bo"] .voice-sample-tags')?.textContent).toBe(
      '男声中文高保真',
    );
    expect(container.querySelector('[data-voice="Kore"] .voice-model-label')?.textContent).toBe(
      '3.8 Flash TTS',
    );
    expect(container.querySelector('[data-voice="Alice"] .voice-model-label')?.textContent).toBe('Eleven v3');
    expect(container.querySelector('[data-voice="Mei"] .voice-model-label')?.textContent).toBe(
      'MAI-Voice-2.1',
    );
    expect(
      container.querySelectorAll('.voice-provider-icon[data-provider="mai"] .voice-microsoft-mark'),
    ).not.toHaveLength(0);
    expect(container.querySelector('audio')?.getAttribute('src')).toMatch(/\?v=sample%2Fversion$/);
    expect(container.querySelector('audio')?.getAttribute('preload')).toBe('none');
    expect(container.querySelector('.voice-script-body')).toBeNull();
    expect(container.querySelector('.voice-technical')).toBeNull();
    expect(container.textContent).not.toContain('准备好，慢慢听');
    expect(container.textContent).not.toContain('待生成');
    expect(container.querySelectorAll('[role="combobox"]')).toHaveLength(2);
    expect(fetchSample).toHaveBeenCalledWith(expect.stringContaining('https://f.no.mt/reference/voices/'), {
      method: 'HEAD',
      mode: 'cors',
    });

    const scriptButton = container.querySelector<HTMLButtonElement>('[aria-controls="voice-fixed-script"]');
    await act(async () => scriptButton?.click());
    expect(scriptButton?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('.voice-script-body')?.textContent).toBe(voicePreviewSampleScript);
    await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')?.click());
    expect(container.querySelectorAll('.voice-technical')).toHaveLength(55);
    expect(container.querySelector('[data-voice="Bo"] .voice-technical')?.textContent).toContain(
      'zh-CN-Bo:MAI-Voice-2.1',
    );
    await act(async () => scriptButton?.click());
    expect(scriptButton?.getAttribute('aria-expanded')).toBe('false');
  });

  it('combines accessible filters, keeps selected pills selected and clears an empty result', async () => {
    await act(async () => root.render(<VoicePreviewContent />));
    const provider = [
      ...container.querySelectorAll<HTMLButtonElement>('[role="radiogroup"][aria-label="按厂商筛选"] button'),
    ].find((button) => button.textContent?.startsWith('MAI Voice'));
    await act(async () => provider?.click());
    expect(container.querySelectorAll('.appearance-voice-card')).toHaveLength(5);
    await act(async () => provider?.click());
    expect(container.querySelectorAll('.appearance-voice-card')).toHaveLength(5);
    const gender = container.querySelector<HTMLButtonElement>(
      '[role="radiogroup"][aria-label="按性别筛选"] [data-gender="female"]',
    );
    await act(async () => gender?.click());
    expect(
      [...container.querySelectorAll('.voice-sample-name')].map((element) => element.textContent),
    ).toEqual(['Harper', 'Lan', 'Mei']);
    await act(async () => gender?.click());
    expect(container.querySelectorAll('.appearance-voice-card')).toHaveLength(3);
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[role="radiogroup"][aria-label="按性别筛选"] [data-gender="non-binary"]',
        )
        ?.click(),
    );
    expect(container.querySelectorAll('.appearance-voice-card')).toHaveLength(0);
    expect(container.textContent).toContain('没有匹配的音色');
    const clear = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === '清除筛选',
    );
    await act(async () => clear?.click());
    expect(container.querySelectorAll('.appearance-voice-card')).toHaveLength(55);
  });

  it('distinguishes checking, missing and failed probes, and retries without enabling missing audio', async () => {
    let resolveFirst: (response: Response) => void = () => {};
    fetchSample.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    fetchSample.mockResolvedValueOnce(new Response(null, { status: 404 }));
    fetchSample.mockRejectedValueOnce(new Error('offline'));
    await act(async () => root.render(<VoicePreviewContent />));
    const first = container.querySelector('[data-voice="Achernar"]');
    const missing = container.querySelector('[data-voice="Alice"]');
    const failed = container.querySelector('[data-voice="Bo"]');
    expect(first?.textContent).toContain('正在检查参考样片');
    expect(first?.querySelector('audio')).toBeNull();
    expect(missing?.textContent).toContain('尚未上传样片');
    expect(missing?.querySelector('audio')).toBeNull();
    expect(failed?.textContent).toContain('参考样片检查失败');
    await act(async () => {
      resolveFirst(new Response());
    });
    expect(first?.querySelector('audio')).not.toBeNull();
    await act(async () => missing?.querySelector<HTMLButtonElement>('button')?.click());
    expect(missing?.querySelector('audio')?.getAttribute('src')).toContain('?v=sample%2Fversion');
    await act(async () => failed?.querySelector<HTMLButtonElement>('button')?.click());
    expect(failed?.querySelector('audio')).not.toBeNull();
  });

  it.each([null, '', '""', '" version "'])('handles ETag %s and an existing query string', async (etag) => {
    fetchSample.mockResolvedValue(new Response(null, { headers: etag === null ? {} : { ETag: etag } }));
    await act(async () => root.render(<Probe url="https://example.invalid/test.mp3?source=preview" />));
    expect(container.querySelector('button')?.dataset.status).toBe('available');
    expect(container.textContent).toBe(
      `https://example.invalid/test.mp3?source=preview${etag === '" version "' ? '&v=version' : ''}`,
    );
  });

  it('reports HTTP errors and ignores late completion from an old URL', async () => {
    let resolveOld: (response: Response) => void = () => {};
    fetchSample.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    await act(async () => root.render(<Probe url="https://example.invalid/old.mp3" />));
    fetchSample.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await act(async () => root.render(<Probe url="https://example.invalid/new.mp3" />));
    expect(container.querySelector('button')?.dataset.status).toBe('error');
    await act(async () => {
      resolveOld(new Response());
    });
    expect(container.querySelector('button')?.dataset.status).toBe('error');
    expect(container.textContent).toBe('https://example.invalid/new.mp3');
    await act(async () => container.querySelector('button')?.click());
    expect(container.querySelector('button')?.dataset.status).toBe('available');
  });

  it('ignores a late rejection after the probe unmounts', async () => {
    let rejectOld: (error: Error) => void = () => {};
    fetchSample.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectOld = reject;
        }),
    );
    await act(async () => root.render(<Probe url="https://example.invalid/old.mp3" />));
    await act(async () => root.render(null));
    await act(async () => {
      rejectOld(new Error('offline'));
    });
    expect(container.textContent).toBe('');
  });
});
