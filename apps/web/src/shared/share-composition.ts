export const shareArtworkFocusY = 0.4;

type ShareArtwork = { dataUrl: string; width: number; height: number };

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
  artwork?: ShareArtwork,
  width = 1200,
  height = 630,
): string {
  const dimensions = [width, height, ...(artwork ? [artwork.width, artwork.height] : [])];
  if (!dimensions.every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new RangeError('Share artwork dimensions must be positive safe integers');
  }
  const shortSide = Math.min(width, height);
  const inset = shortSide * 0.05;
  const position = shortSide * 0.1;
  const wordmarkWidth = shortSide * 0.42;
  const ink = artwork ? '#ECEBE1' : '#263C35';
  const wordmark = wordmarkSvg
    .replace(/<svg\b[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/fill="#263C35"/gi, `fill="${ink}"`);
  const scale = artwork ? Math.max(width / artwork.width, height / artwork.height) : 1;
  const imageWidth = artwork ? artwork.width * scale : width;
  const imageHeight = artwork ? artwork.height * scale : height;
  const top = Math.max(0, Math.min(imageHeight - height, imageHeight * shareArtworkFocusY - height / 2));
  const background = artwork
    ? `<image x="${(width - imageWidth) / 2}" y="${-top}" width="${imageWidth}" height="${imageHeight}" href="${escapeXml(artwork.dataUrl)}"/>`
    : `<defs><filter id="flax-paper"><feTurbulence type="fractalNoise" baseFrequency=".7 .35" numOctaves="3" seed="5"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".07"/></feComponentTransfer><feBlend in="SourceGraphic" mode="multiply"/></filter></defs><rect width="${width}" height="${height}" fill="#ECEBE1" filter="url(#flax-paper)"/>`;
  const outline = artwork
    ? ' stroke="#263C35" stroke-width="6" stroke-linejoin="round" paint-order="stroke fill"'
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${background}<rect x="${inset}" y="${inset}" width="${width - inset * 2}" height="${height - inset * 2}" fill="none" stroke="${ink}" stroke-opacity=".6" stroke-width="${shortSide * 0.0012}"/><svg x="${position}" y="${position}" width="${wordmarkWidth}" height="${(wordmarkWidth * 146) / 384}" viewBox="108 12 384 146"><g${outline}>${wordmark}</g></svg></svg>`;
}
