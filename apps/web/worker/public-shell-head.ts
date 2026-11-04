/** Defer bundled stylesheets so they no longer block first paint. */
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
