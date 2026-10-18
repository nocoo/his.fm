// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoicePreviewContent } from '../src/admin/voice-preview/VoicePreview';
import {
  elevenlabsVoiceCatalog,
  geminiVoiceCatalog,
  voiceComparisonPairs,
} from '../src/shared/voice-samples';

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

  it('renders unified header, comparison pairs and both provider sections without details', async () => {
    await act(async () => {
      root.render(<VoicePreviewContent />);
    });

    expect(container.querySelector('details')).toBeNull();
    expect(container.textContent).toContain('全部音色预览（Gemini + ElevenLabs）');
    expect(container.textContent).toContain('reference/voices/');

    const pairSections = container.querySelectorAll('.appearance-voice-pair');
    expect(pairSections).toHaveLength(voiceComparisonPairs.length);

    const providerSections = container.querySelectorAll('.appearance-voice-provider-section');
    expect(providerSections).toHaveLength(2);
    expect(providerSections[0]?.getAttribute('data-provider')).toBe('gemini');
    expect(providerSections[1]?.getAttribute('data-provider')).toBe('elevenlabs');

    expect(container.textContent).toContain(`${geminiVoiceCatalog.length} 个音色`);
    expect(container.textContent).toContain(`${elevenlabsVoiceCatalog.length} 个音色`);

    const marks = container.querySelectorAll('.appearance-provider-mark');
    expect(marks.length).toBeGreaterThan(0);
    for (const mark of marks) {
      const logo = mark.querySelector('[data-logo]');
      expect(logo).not.toBeNull();
    }
  });
});
