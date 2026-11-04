import criticalCss from '../src/public/public-critical.generated.ts';

/** Promotion must be a nonce-carrying script: CSP blocks inline event handlers such as onload. */
const promoteDeferredStyles =
  '<script>(function(){var links=document.querySelectorAll("link[data-defer-style]");' +
  'function promote(){for(var i=0;i<links.length;i++){links[i].rel="stylesheet"}}' +
  'for(var i=0;i<links.length;i++){links[i].addEventListener("load",promote)}' +
  'document.addEventListener("DOMContentLoaded",promote)})()</script>';

/** Inline above-the-fold rules, then load the full bundle without blocking first paint. */
export function preparePublicShellHead(html: string): string {
  const escaped = criticalCss.replace(/<\//g, '<\\/');
  const style = `<style id="public-critical">${escaped}</style>`;
  // The critical block must precede the deferred stylesheets so the full bundle wins the cascade.
  const firstStylesheet = html.search(/<link rel="stylesheet"/i);
  const withCritical =
    firstStylesheet >= 0
      ? `${html.slice(0, firstStylesheet)}${style}${html.slice(firstStylesheet)}`
      : html.includes('</head>')
        ? html.replace('</head>', `${style}</head>`)
        : `${style}${html}`;
  return deferPublicStylesheets(withCritical);
}

/** Defer full stylesheets so they no longer block first paint once critical CSS is inlined. */
export function deferPublicStylesheets(html: string): string {
  let deferred = false;
  const rewritten = html.replace(/<link rel="stylesheet"([^>]*?)>/gi, (tag, attrs) => {
    const href = /href="([^"]+)"/.exec(attrs)?.[1];
    if (!href) return tag;
    deferred = true;
    const trimmed = attrs.trim();
    const attrSuffix = trimmed ? ` ${trimmed}` : '';
    return (
      `<link rel="preload" as="style" data-defer-style${attrSuffix}>` +
      `<noscript><link rel="stylesheet"${attrSuffix}></noscript>`
    );
  });
  if (!deferred) return rewritten;
  return rewritten.includes('</head>')
    ? rewritten.replace('</head>', `${promoteDeferredStyles}</head>`)
    : `${rewritten}${promoteDeferredStyles}`;
}

export function publicCriticalCssForTests(): string {
  return criticalCss;
}
