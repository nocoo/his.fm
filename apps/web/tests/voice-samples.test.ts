import { describe, expect, it } from 'vitest';
import { voicePreviewStoragePrefix } from '../src/shared/voice-preview-prefix';
import {
  voicePreviewCatalog,
  voicePreviewComparisonRows,
  voicePreviewEntries,
  voicePreviewMediaUrl,
  voicePreviewSampleScript,
} from '../src/shared/voice-samples';

describe('voice preview manifest', () => {
  it('lists 50 manifest voices with MP3 object keys', () => {
    expect(voicePreviewEntries).toHaveLength(50);
    expect(voicePreviewCatalog('gemini')).toHaveLength(30);
    expect(voicePreviewCatalog('elevenlabs')).toHaveLength(20);
    expect(voicePreviewCatalog('elevenlabs').some((entry) => entry.voiceName === 'Bill')).toBe(true);
    expect(voicePreviewEntries.find((entry) => entry.voiceId === 'pqHfZKP75CvOlQylNhV4')?.objectKey).toBe(
      'reference/voices/elevenlabs-Bill.mp3',
    );
    for (const entry of voicePreviewEntries) {
      expect(entry.objectKey.startsWith(voicePreviewStoragePrefix)).toBe(true);
      expect(entry.objectKey.endsWith('.mp3')).toBe(true);
      expect(voicePreviewMediaUrl(entry.objectKey)).toBe(`https://f.no.mt/${entry.objectKey}`);
    }
  });

  it('builds comparison rows without collapsing either provider', () => {
    const rows = voicePreviewComparisonRows();
    expect(rows).toHaveLength(30);
    expect(rows.filter((row) => row.gemini).length).toBe(30);
    expect(rows.filter((row) => row.elevenlabs).length).toBe(20);
    expect(rows[19]?.gemini?.voiceName).toBeTruthy();
    expect(rows[19]?.elevenlabs?.voiceName).toBeTruthy();
    expect(rows[20]?.elevenlabs).toBeUndefined();
  });

  it('embeds the full fixed sample script verbatim', () => {
    expect(voicePreviewSampleScript).toContain('欢迎收听 his.fm');
    expect(voicePreviewSampleScript).toContain('hi@his.fm');
    expect(voicePreviewSampleScript.split('\n\n').length).toBeGreaterThan(1);
  });
});
