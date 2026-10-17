import type { Mention } from './mentions';

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatMentionLine(mention: Mention): string {
  const base = `${mention.name} — ${mention.description}`;
  return mention.url ? `${base} (${mention.url})` : base;
}

export function formatMentionHtml(mention: Mention): string {
  const base = `${escapeHtml(mention.name)} — ${escapeHtml(mention.description)}`;
  if (!mention.url) return base;
  return `${base} (<a href="${escapeHtml(mention.url)}" rel="noopener noreferrer" target="_blank">${escapeHtml(mention.url)}</a>)`;
}

export function mentionsShowNotesHtml(mentions: Mention[]): string {
  if (!mentions.length) return '';
  const items = mentions.map((mention) => `<li>${formatMentionHtml(mention)}</li>`).join('');
  return `<section><h2>本期提到</h2><ul>${items}</ul></section>`;
}

export function podcastEpisodeMentionsJsonLd(mentions: Mention[]) {
  return mentions.map((mention) => ({
    '@type': 'Thing',
    name: mention.name,
    description: mention.description,
    ...(mention.url ? { url: mention.url } : {}),
  }));
}
