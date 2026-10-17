function escapeXml(value: string): string {
  const entities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  };
  return value.replace(/[&<>"']/g, (character) => entities[character]);
}

export function composeShareSvg(
  wordmarkSvg: string,
  artworkDataUrl?: string,
  width = 1200,
  height = 630,
): string {
  if (![width, height].every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new RangeError('Share artwork dimensions must be positive safe integers');
  }
  const shortSide = Math.min(width, height);
  const inset = shortSide * 0.05;
  const position = shortSide * 0.1;
  const wordmarkWidth = shortSide * 0.42;
  const ink = artworkDataUrl ? '#ECEBE1' : '#263C35';
  const wordmark = wordmarkSvg
    .replace(/<svg\b[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/fill="#263C35"/gi, `fill="${ink}"`);
  const background = artworkDataUrl
    ? `<image width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" href="${escapeXml(artworkDataUrl)}"/>`
    : `<defs><filter id="flax-paper"><feTurbulence type="fractalNoise" baseFrequency=".7 .35" numOctaves="3" seed="5"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".07"/></feComponentTransfer><feBlend in="SourceGraphic" mode="multiply"/></filter></defs><rect width="${width}" height="${height}" fill="#ECEBE1" filter="url(#flax-paper)"/>`;
  const outline = artworkDataUrl
    ? ' stroke="#263C35" stroke-width="6" stroke-linejoin="round" paint-order="stroke fill"'
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${background}<rect x="${inset}" y="${inset}" width="${width - inset * 2}" height="${height - inset * 2}" fill="none" stroke="${ink}" stroke-opacity=".6" stroke-width="${shortSide * 0.0012}"/><svg x="${position}" y="${position}" width="${wordmarkWidth}" height="${(wordmarkWidth * 146) / 384}" viewBox="108 12 384 146"><g${outline}>${wordmark}</g></svg></svg>`;
}
