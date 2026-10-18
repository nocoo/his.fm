import { describe, expect, it } from 'vitest';
import {
  parseVoicePreviewStorageKey,
  voicePreviewStorageKeyMinLength,
  voicePreviewStorageKeyOpenApiPattern,
  voicePreviewStoragePrefix,
} from '../../src/shared/voice-preview-prefix';

describe('voice preview storage keys', () => {
  it('accepts manifest-style MP3 keys under reference/voices/', () => {
    expect(parseVoicePreviewStorageKey('reference/voices/elevenlabs-Bill.mp3')).toBe(
      'reference/voices/elevenlabs-Bill.mp3',
    );
    expect(parseVoicePreviewStorageKey('reference/voices/gemini-Achernar.mp3')).toBe(
      'reference/voices/gemini-Achernar.mp3',
    );
  });

  it('rejects traversal, wrong prefix and non-mp3 names', () => {
    for (const key of [
      null,
      '',
      'uploads/evil.mp3',
      `${voicePreviewStoragePrefix}../secret.mp3`,
      `${voicePreviewStoragePrefix}nested/file.mp3`,
      `${voicePreviewStoragePrefix}no-extension`,
      `${voicePreviewStoragePrefix}.mp3`,
      `${voicePreviewStoragePrefix}a..b.mp3`,
      'reference/other.wav',
    ]) {
      expect(parseVoicePreviewStorageKey(key)).toBeNull();
    }
  });

  it('keeps OpenAPI pattern aligned with parser edge cases', () => {
    const pattern = new RegExp(voicePreviewStorageKeyOpenApiPattern);
    expect(voicePreviewStorageKeyMinLength).toBe('reference/voices/a.mp3'.length);
    expect(parseVoicePreviewStorageKey('reference/voices/a.mp3')).toBe('reference/voices/a.mp3');
    expect(pattern.test('reference/voices/a.mp3')).toBe(true);
    expect(pattern.test('reference/voices/a..b.mp3')).toBe(false);
    for (const key of [
      'reference/voices/elevenlabs-Bill.mp3',
      `${voicePreviewStoragePrefix}../secret.mp3`,
      `${voicePreviewStoragePrefix}.mp3`,
    ]) {
      const parsed = parseVoicePreviewStorageKey(key);
      if (parsed) expect(pattern.test(parsed)).toBe(true);
      else expect(pattern.test(key)).toBe(false);
    }
  });
});
