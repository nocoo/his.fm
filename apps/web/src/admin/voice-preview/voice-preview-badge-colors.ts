export const voicePreviewBadgeStyleTones = [
  'style-teal',
  'style-orange',
  'style-red',
  'style-blue',
  'style-purple',
  'style-slate',
] as const;

export type VoicePreviewBadgeTone =
  | 'gender-male'
  | 'gender-female'
  | 'usage-learning'
  | 'usage-manager-notes'
  | (typeof voicePreviewBadgeStyleTones)[number];

const HEX_COLOR = /#([0-9a-fA-F]{6})\b/;

function normalizeHex(value: string): `#${string}` {
  const match = HEX_COLOR.exec(value);
  if (!match) throw new Error(`expected hex color, got ${value}`);
  return `#${match[1].toLowerCase()}`;
}

/** Parse solid badge backgrounds from `voice-preview.css` (source of truth for fills). */
export function parseVoicePreviewBadgeFills(css: string): Record<string, `#${string}`> {
  const fills: Record<string, `#${string}`> = {};
  const blockRe = /\.voice-preview-page\s+([^{]+)\{[^}]*background-color:\s*(#[0-9a-fA-F]{6})\s*;/g;
  for (const match of css.matchAll(blockRe)) {
    const selectors = match[1];
    const color = normalizeHex(match[2]);
    for (const tone of selectors.matchAll(/appearance-voice-badge--([a-z0-9-]+)/g)) {
      fills[tone[1]] = color;
    }
  }
  return fills;
}

/** Parse badge label color from the shared `.appearance-voice-badge` rule in `voice-preview.css`. */
export function parseVoicePreviewBadgeLabelColor(css: string): `#${string}` {
  const match = css.match(
    /\.voice-preview-page \.appearance-voice-badges \.appearance-voice-badge\s*\{[^}]*\bcolor:\s*(#[0-9a-fA-F]{3,8})\s*;/,
  );
  if (!match) throw new Error('voice preview badge label color missing in CSS');
  return normalizeHex(match[1].length === 4 ? expandShortHex(match[1]) : match[1]);
}

function expandShortHex(short: string): string {
  const normalized = short.replace('#', '');
  if (normalized.length !== 3) return short;
  return `#${normalized
    .split('')
    .map((char) => char + char)
    .join('')}`;
}

function channel(value: string) {
  const normalized = value.replace('#', '');
  const r = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const g = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const b = Number.parseInt(normalized.slice(4, 6), 16) / 255;
  const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return [linear(r), linear(g), linear(b)] as const;
}

function relativeLuminance(hex: string) {
  const [r, g, b] = channel(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(foreground: string, background: string) {
  const l1 = relativeLuminance(foreground);
  const l2 = relativeLuminance(background);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}
