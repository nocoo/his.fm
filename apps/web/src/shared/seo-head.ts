import type { ResolvedPageSeo } from './seo-resolve';

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function seoHeadTags(seo: ResolvedPageSeo) {
  const robots = seo.noindex ? 'noindex, follow' : 'index, follow';
  const tags = [
    `<title>${escapeHtml(seo.title)}</title>`,
    `<meta name="description" content="${escapeHtml(seo.description)}" />`,
    `<meta name="robots" content="${robots}" />`,
    `<link rel="canonical" href="${escapeHtml(seo.canonical)}" />`,
    `<meta property="og:type" content="${escapeHtml(seo.ogType)}" />`,
    `<meta property="og:title" content="${escapeHtml(seo.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(seo.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(seo.canonical)}" />`,
    `<meta property="og:image" content="${escapeHtml(seo.ogImageUrl)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(seo.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(seo.description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(seo.ogImageUrl)}" />`,
  ];
  return tags.join('\n');
}

const managedHeadPatterns = [
  /<title>[\s\S]*?<\/title>\s*/gi,
  /<meta name="description"[^>]*>\s*/gi,
  /<meta name="robots"[^>]*>\s*/gi,
  /<link rel="canonical"[^>]*>\s*/gi,
  /<meta property="og:[^"]+"[^>]*>\s*/gi,
  /<meta name="twitter:[^"]+"[^>]*>\s*/gi,
  /<script type="application\/ld\+json">[\s\S]*?<\/script>\s*/gi,
];

function stripManagedHead(html: string) {
  return managedHeadPatterns.reduce((next, pattern) => next.replace(pattern, ''), html);
}

export function injectSeoIntoHtml(html: string, seo: ResolvedPageSeo, jsonLd?: unknown[]) {
  const head = seoHeadTags(seo);
  const jsonLdBlocks = jsonLd?.length
    ? jsonLd
        .map(
          (block) =>
            `<script type="application/ld+json">${JSON.stringify(block).replace(/</g, '\\u003c')}</script>`,
        )
        .join('\n')
    : '';
  const injection = `${head}\n${jsonLdBlocks}`;
  const stripped = stripManagedHead(html);
  if (stripped.includes('</head>')) {
    return stripped.replace('</head>', `${injection}\n</head>`);
  }
  return `${injection}\n${stripped}`;
}
