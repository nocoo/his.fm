// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoicePreviewContent } from '../src/admin/voice-preview/VoicePreview';
import { voicePreviewCatalog, voicePreviewSampleScript } from '../src/shared/voice-samples';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('admin voice preview page', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false }) as Response),
    );
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('renders unified header, full script and both providers without details', async () => {
    await act(async () => {
      root.render(<VoicePreviewContent />);
    });

    expect(container.querySelector('details')).toBeNull();
    expect(container.textContent).toContain('全部音色预览（Gemini + ElevenLabs）');
    expect(container.textContent).toContain(voicePreviewSampleScript.slice(0, 24));
    expect(container.textContent).toContain('reference/voices/');

    const rows = container.querySelectorAll('.appearance-voice-compare-row');
    expect(rows.length).toBe(
      Math.max(voicePreviewCatalog('gemini').length, voicePreviewCatalog('elevenlabs').length),
    );

    const geminiCards = container.querySelectorAll('.appearance-voice-card[data-provider="gemini"]');
    const elevenlabsCards = container.querySelectorAll('.appearance-voice-card[data-provider="elevenlabs"]');
    expect(geminiCards).toHaveLength(30);
    expect(elevenlabsCards).toHaveLength(20);
    expect(container.textContent).toContain('ElevenLabs · Bill');
    expect(container.textContent).toContain('gemini-3.8-flash-tts');
    expect(container.textContent).toContain('eleven_v4');
    expect(container.textContent).not.toContain('gemini-2.5-flash-preview-tts');
    expect(container.textContent).not.toContain('eleven_v3');

    const billCard = [
      ...container.querySelectorAll('.appearance-voice-card[data-provider="elevenlabs"]'),
    ].find((card) => card.textContent?.includes('Bill'));
    expect(billCard?.textContent).toContain('男声');
    expect(billCard?.textContent).toContain('American');
    expect(billCard?.textContent).not.toMatch(/male,\s*American/);

    const puckCard = [...container.querySelectorAll('.appearance-voice-card[data-provider="gemini"]')].find(
      (card) => card.textContent?.includes('Puck'),
    );
    expect(puckCard?.textContent).toContain('每日手冲');
    expect(puckCard?.textContent).toContain('Upbeat');

    const charonCard = [...container.querySelectorAll('.appearance-voice-card[data-provider="gemini"]')].find(
      (card) => card.textContent?.includes('Charon'),
    );
    expect(charonCard?.textContent).toContain('主理人手札');
    expect(charonCard?.textContent).toContain('Informative');

    const zephyrCard = [...container.querySelectorAll('.appearance-voice-card[data-provider="gemini"]')].find(
      (card) => card.textContent?.includes('Zephyr'),
    );
    expect(zephyrCard?.textContent).not.toContain('主理人手札');

    expect(container.querySelectorAll('.appearance-voice-badges').length).toBeGreaterThan(0);

    for (const mark of container.querySelectorAll('.appearance-provider-mark [data-logo]')) {
      expect(mark).not.toBeNull();
    }
  });
});
