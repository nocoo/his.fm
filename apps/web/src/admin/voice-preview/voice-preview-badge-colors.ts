/** Solid badge fills: white `#ffffff` text must meet WCAG AA (≥4.5:1) on these backgrounds in light and dark admin themes. */
export const voicePreviewBadgeFills: Record<string, `#${string}`> = {
  'gender-male': '#1d4ed8',
  'gender-female': '#6d28d9',
  'usage-learning': '#0f766e',
  'usage-manager-notes': '#c2410c',
  'style-teal': '#0f766e',
  'style-orange': '#c2410c',
  'style-red': '#b91c1c',
  'style-blue': '#1d4ed8',
  'style-purple': '#6d28d9',
  'style-slate': '#475569',
};

export const voicePreviewBadgeStyleTones = [
  'style-teal',
  'style-orange',
  'style-red',
  'style-blue',
  'style-purple',
  'style-slate',
] as const;

export type VoicePreviewBadgeTone = keyof typeof voicePreviewBadgeFills;

const WHITE = '#ffffff';

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

export function voicePreviewBadgeContrastOnWhite(fill: string) {
  return contrastRatio(WHITE, fill);
}
