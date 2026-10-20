import { describe, expect, it } from 'vitest';
import { voicePreviewStoragePrefix } from '../src/shared/voice-preview-prefix';
import {
  type VoicePreviewEntry,
  type VoicePreviewFilters,
  voicePreviewCatalog,
  voicePreviewEntries,
  voicePreviewGender,
  voicePreviewMediaUrl,
  voicePreviewResults,
  voicePreviewSampleScript,
  voiceProviderInfo,
} from '../src/shared/voice-samples';

const catalog = voicePreviewCatalog();
const all: VoicePreviewFilters = { provider: 'all', gender: 'all', query: '' };
const fixture: VoicePreviewEntry = {
  provider: 'elevenlabs',
  voiceName: 'Test',
  voiceId: 'test-id',
  style: 'female, American, warm',
  durationSeconds: 120,
  objectKey: 'reference/voices/test.mp3',
};

describe('voice preview catalog', () => {
  it('lists all 55 real MP3 samples, including only high-fidelity MAI 2.1', () => {
    expect(voicePreviewEntries).toHaveLength(55);
    expect(voicePreviewResults(catalog, all).providerCounts).toEqual({ gemini: 30, elevenlabs: 20, mai: 5 });
    expect(new Set(catalog.map((entry) => entry.objectKey)).size).toBe(55);
    expect(
      catalog.filter((entry) => entry.provider === 'mai').map((entry) => [entry.voiceName, entry.gender]),
    ).toEqual([
      ['Bo', 'male'],
      ['Grant', 'male'],
      ['Harper', 'female'],
      ['Lan', 'female'],
      ['Mei', 'female'],
    ]);
    for (const entry of catalog) {
      expect(entry.objectKey.startsWith(voicePreviewStoragePrefix)).toBe(true);
      expect(entry.objectKey.endsWith('.mp3')).toBe(true);
      expect(entry.durationSeconds).toBeGreaterThan(0);
      if (entry.provider === 'mai') expect(entry.voiceId).toBe(`zh-CN-${entry.voiceName}:MAI-Voice-2.1`);
    }
    expect(catalog.find((entry) => entry.voiceId === 'pqHfZKP75CvOlQylNhV4')?.objectKey).toBe(
      'reference/voices/elevenlabs-Bill.mp3',
    );
    expect(voiceProviderInfo.gemini.model).toBe('3.8 Flash TTS');
    expect(voiceProviderInfo.elevenlabs.model).toBe('Eleven v3');
    expect(voiceProviderInfo.mai.model).toBe('MAI-Voice-2.1');
  });

  it('interleaves alphabetized provider catalogs without empty cards or mutating the manifest', () => {
    const before = [...voicePreviewEntries];
    expect(catalog.slice(0, 6).map((entry) => entry.voiceName)).toEqual([
      'Achernar',
      'Alice',
      'Bo',
      'Achird',
      'Aria',
      'Grant',
    ]);
    expect(catalog).toHaveLength(55);
    expect(voicePreviewCatalog()).toEqual(catalog);
    expect(voicePreviewEntries).toEqual(before);
    expect(voicePreviewCatalog([])).toEqual([]);
  });

  it('uses the official Gemini gender mapping rather than guessing from style or names', () => {
    expect(
      catalog
        .filter((entry) => entry.provider === 'gemini' && entry.gender === 'female')
        .map((entry) => entry.voiceName),
    ).toEqual([
      'Achernar',
      'Aoede',
      'Autonoe',
      'Callirrhoe',
      'Despina',
      'Erinome',
      'Gacrux',
      'Kore',
      'Laomedeia',
      'Leda',
      'Pulcherrima',
      'Sulafat',
      'Vindemiatrix',
      'Zephyr',
    ]);
    expect(catalog.filter((entry) => entry.provider === 'gemini' && entry.gender === 'male')).toHaveLength(
      16,
    );
    expect(voicePreviewGender({ ...fixture, provider: 'gemini', voiceName: 'Unlisted', style: 'male' })).toBe(
      'unknown',
    );
  });

  it('parses only an exact first gender token and retains real traits', () => {
    expect(voicePreviewGender(fixture)).toBe('female');
    expect(voicePreviewGender({ ...fixture, style: ' male , warm' })).toBe('male');
    expect(voicePreviewGender({ ...fixture, style: 'non-binary, calm' })).toBe('non-binary');
    expect(voicePreviewGender({ ...fixture, style: 'female-ish, male' })).toBe('unknown');
    expect(voicePreviewGender({ ...fixture, style: 'warm, female' })).toBe('unknown');
    expect(voicePreviewGender({ ...fixture, style: '' })).toBe('unknown');
    expect(catalog.find((entry) => entry.voiceName === 'River')?.gender).toBe('non-binary');
    expect(voicePreviewCatalog([fixture])[0].traits).toEqual(['American', 'warm']);
    expect(voicePreviewCatalog([{ ...fixture, style: ' , warm, ' }])[0].traits).toEqual(['warm']);
    expect(voicePreviewCatalog([{ ...fixture, style: 'warm, female' }])[0].traits).toEqual([
      'warm',
      'female',
    ]);
  });

  it('combines provider, gender and normalized search, with counts before gender filtering', () => {
    const result = voicePreviewResults(catalog, {
      provider: 'mai',
      gender: 'female',
      query: '  MAI-VOICE-2.1  ',
    });
    expect(result.filtered.map((entry) => entry.voiceName)).toEqual(['Harper', 'Lan', 'Mei']);
    expect(result.matchingCount).toBe(5);
    expect(result.genderOptions).toEqual([
      { gender: 'male', count: 2 },
      { gender: 'female', count: 3 },
      { gender: 'non-binary', count: 0 },
    ]);
    expect(voicePreviewResults(catalog, all).filtered).toEqual(catalog);
    expect(
      voicePreviewResults(catalog, { ...all, gender: 'non-binary' }).filtered.map((entry) => entry.voiceName),
    ).toEqual(['River']);
    expect(voicePreviewResults(catalog, { ...all, query: 'does-not-exist' }).filtered).toEqual([]);
    expect(voicePreviewResults([], all).genderOptions).toEqual([]);
    expect(voicePreviewResults(voicePreviewCatalog([{ ...fixture, style: '' }]), all).genderOptions).toEqual([
      { gender: 'unknown', count: 1 },
    ]);
  });

  it.each([
    ['  aChErNaR  ', 'Achernar'],
    ['pqHfZKP75CvOlQylNhV4', 'Bill'],
    ['trustworthy', 'Bill'],
    ['非二元', 'River'],
    ['ElevenLabs', 'River'],
    ['Eleven v3', 'River'],
    ['3.8 Flash TTS', 'Kore'],
    ['zh-CN-Mei:MAI-Voice-2.1', 'Mei'],
    ['中文', 'Bo'],
    ['高保真', 'Harper'],
  ])('searches all displayed metadata: %s', (query, voiceName) => {
    expect(
      voicePreviewResults(catalog, { ...all, query }).filtered.some((entry) => entry.voiceName === voiceName),
    ).toBe(true);
  });

  it('keeps object URLs and optional ETag cache versions intact', () => {
    const key = fixture.objectKey;
    const base = `https://f.no.mt/${key}`;
    for (const version of [undefined, null, '', '""']) expect(voicePreviewMediaUrl(key, version)).toBe(base);
    expect(voicePreviewMediaUrl(key, '"abc/123"')).toBe(`${base}?v=abc%2F123`);
  });

  it('embeds the complete canonical sample script verbatim', () => {
    expect(voicePreviewSampleScript).toContain('欢迎收听 his.fm');
    expect(voicePreviewSampleScript).toContain('hi@his.fm');
    expect(voicePreviewSampleScript.split('\n\n').length).toBeGreaterThan(1);
  });
});
