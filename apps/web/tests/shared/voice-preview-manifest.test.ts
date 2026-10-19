import { describe, expect, it } from 'vitest';
import {
  voicePreviewDescriptorBadges,
  voicePreviewEntries,
  voicePreviewUsageLabel,
} from '../../src/shared/voice-samples';

describe('voice preview manifest data', () => {
  it('lists fifty voices with per-entry models and gender counts', () => {
    expect(voicePreviewEntries).toHaveLength(50);

    const male = voicePreviewEntries.filter((entry) => entry.gender === '男声');
    const female = voicePreviewEntries.filter((entry) => entry.gender === '女声');
    expect(male).toHaveLength(27);
    expect(female).toHaveLength(23);

    const river = voicePreviewEntries.find((entry) => entry.voiceName === 'River');
    expect(river?.gender).toBe('女声');

    for (const entry of voicePreviewEntries) {
      expect(entry.model).toBe(entry.provider === 'gemini' ? 'gemini-3.8-flash-tts' : 'eleven_v4');
    }
  });

  it('marks only Puck and Charon with column usage', () => {
    const withUsage = voicePreviewEntries.filter((entry) => entry.usageCategoryId);
    expect(withUsage.map((entry) => entry.voiceName).sort()).toEqual(['Charon', 'Puck']);

    const puck = voicePreviewEntries.find((entry) => entry.voiceName === 'Puck');
    const charon = voicePreviewEntries.find((entry) => entry.voiceName === 'Charon');
    const zephyr = voicePreviewEntries.find((entry) => entry.voiceName === 'Zephyr');
    expect(puck).toBeDefined();
    expect(charon).toBeDefined();
    expect(voicePreviewUsageLabel(puck as NonNullable<typeof puck>)).toBe('每日手冲');
    expect(puck?.usageCategoryId).toBe('learning');
    expect(voicePreviewUsageLabel(charon as NonNullable<typeof charon>)).toBe('主理人手札');
    expect(charon?.usageCategoryId).toBe('manager-notes');
    expect(zephyr?.usageCategoryId).toBeUndefined();
  });

  it('splits ElevenLabs style descriptors without repeating gender', () => {
    const bill = voicePreviewEntries.find((entry) => entry.voiceName === 'Bill');
    const river = voicePreviewEntries.find((entry) => entry.voiceName === 'River');
    const puck = voicePreviewEntries.find((entry) => entry.voiceName === 'Puck');
    expect(bill).toBeDefined();
    expect(river).toBeDefined();
    expect(puck).toBeDefined();
    expect(voicePreviewDescriptorBadges(bill as NonNullable<typeof bill>)).toEqual([
      'American',
      'trustworthy',
    ]);
    expect(voicePreviewDescriptorBadges(river as NonNullable<typeof river>)).toEqual(['American', 'calm']);
    expect(voicePreviewDescriptorBadges(puck as NonNullable<typeof puck>)).toEqual(['Upbeat']);
  });

  it('handles usage and descriptor edge cases', () => {
    const sample = voicePreviewEntries[0];
    expect(voicePreviewUsageLabel({ ...sample, usageCategoryId: undefined })).toBeNull();
    expect(
      voicePreviewDescriptorBadges({
        ...sample,
        provider: 'elevenlabs',
        style: 'British, confident',
      }),
    ).toEqual(['British', 'confident']);
    expect(
      voicePreviewDescriptorBadges({
        ...sample,
        provider: 'gemini',
        style: '',
      }),
    ).toEqual([]);
  });
});
