import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  parseVoicePreviewBadgeFills,
  parseVoicePreviewBadgeLabelColor,
} from './voice-preview-badge-colors';

const css = readFileSync(fileURLToPath(new URL('./voice-preview.css', import.meta.url)), 'utf8');

describe('voice preview badge colors', () => {
  it('keeps label contrast at WCAG AA on every CSS solid fill', () => {
    const fills = parseVoicePreviewBadgeFills(css);
    const label = parseVoicePreviewBadgeLabelColor(css);
    expect(Object.keys(fills).length).toBeGreaterThan(0);
    for (const [name, fill] of Object.entries(fills)) {
      expect(contrastRatio(label, fill), name).toBeGreaterThanOrEqual(4.5);
    }
  });
});
