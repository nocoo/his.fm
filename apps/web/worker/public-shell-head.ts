import criticalCss from '../src/public/public-critical.generated.ts';

/** Inline above-the-fold rules, then load the full bundle without blocking first paint. */
export function preparePublicShellHead(html: string): string {
  const escaped = criticalCss.replace(/<\//g, '<\\/');
  const withCritical = html.includes('</head>')
    ? html.replace('</head>', `<style id="public-critical">${escaped}</style></head>`)
    : `<style id="public-critical">${escaped}</style>${html}`;
  return deferPublicStylesheets(withCritical);
}

/** Defer full stylesheets so they no longer block first paint once critical CSS is inlined. */
export function deferPublicStylesheets(html: string): string {
  return html.replace(/<link rel="stylesheet"([^>]*?)>/gi, (tag, attrs) => {
    const href = /href="([^"]+)"/.exec(attrs)?.[1];
    if (!href) return tag;
    const trimmed = attrs.trim();
    const attrSuffix = trimmed ? ` ${trimmed}` : '';
    return (
      `<link rel="preload" as="style"${attrSuffix} onload="this.onload=null;this.rel='stylesheet'">` +
      `<noscript><link rel="stylesheet"${attrSuffix}></noscript>`
    );
  });
}

export function publicCriticalCssForTests(): string {
  return criticalCss;
}
