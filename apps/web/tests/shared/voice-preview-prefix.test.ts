import { describe, expect, it } from 'vitest';
import {
  parseVoicePreviewStorageKey,
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
      'reference/other.wav',
    ]) {
      expect(parseVoicePreviewStorageKey(key)).toBeNull();
    }
  });
});
