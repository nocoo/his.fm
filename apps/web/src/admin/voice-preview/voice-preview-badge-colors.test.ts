import { describe, expect, it } from 'vitest';
import { voicePreviewBadgeContrastOnWhite, voicePreviewBadgeFills } from './voice-preview-badge-colors';

describe('voice preview badge colors', () => {
  it('keeps white label contrast at WCAG AA on every solid fill', () => {
    for (const [name, fill] of Object.entries(voicePreviewBadgeFills)) {
      expect(voicePreviewBadgeContrastOnWhite(fill), name).toBeGreaterThanOrEqual(4.5);
    }
  });
});
