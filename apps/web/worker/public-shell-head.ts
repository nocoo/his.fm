import criticalCss from '../src/public/public-critical.generated.ts';

/** Inline above-the-fold rules before the render-blocking full bundle. */
export function preparePublicShellHead(html: string): string {
  const escaped = criticalCss.replace(/<\//g, '<\\/');
  const style = `<style id="public-critical">${escaped}</style>`;
  // The critical block must precede the stylesheet so the full bundle wins the cascade once loaded.
  const firstStylesheet = html.search(/<link rel="stylesheet"/i);
  if (firstStylesheet >= 0) {
    return `${html.slice(0, firstStylesheet)}${style}${html.slice(firstStylesheet)}`;
  }
  if (html.includes('</head>')) {
    return html.replace('</head>', `${style}</head>`);
  }
  return `${style}${html}`;
}

export function publicCriticalCssForTests(): string {
  return criticalCss;
}
