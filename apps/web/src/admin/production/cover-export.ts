import layouts from '../../brand/cover-frame-layouts.json';
import { themeCoverFrameSrc } from '../../brand/themes';
import type { ThemeId } from '../../shared/appearance';
import { coverArtContainRect } from '../../shared/coverArtFit';

async function loadImage(url: string) {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = url;
  try {
    await image.decode();
  } catch {
    throw new Error('封面或品牌框架未能加载，请稍后重试。');
  }
  return image;
}

export async function exportCover(source: string, episodeNumber: number, themeId: ThemeId) {
  const frame = layouts.themes[themeId];
  const size = layouts.size;
  const [artwork, overlay, fonts] = await Promise.all([
    loadImage(source),
    loadImage(themeCoverFrameSrc(themeId)),
    document.fonts.load(`500 ${frame.episode.fontSize}px "Space Grotesk"`, 'EP.0123456789'),
  ]);
  if (!fonts.length) throw new Error('品牌字体未能加载，请稍后重试。');
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器暂时无法生成封面，请重试。');
  const { x, y, width, height } = coverArtContainRect(size, artwork.naturalWidth, artwork.naturalHeight);
  context.drawImage(artwork, x, y, width, height);
  context.drawImage(overlay, 0, 0, size, size);
  context.fillStyle = frame.episode.fill;
  context.font = `500 ${frame.episode.fontSize}px "Space Grotesk"`;
<<<<<<< HEAD
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  context.fillText(`EP.${String(episodeNumber).padStart(3, '0')}`, frame.episode.x, frame.episode.y);
=======
  context.textAlign = 'right';
  context.textBaseline = 'middle';
  context.fillText(`EP.${String(episodeNumber).padStart(2, '0')}`, frame.episode.x, frame.episode.y);
>>>>>>> c9e8407 (Show per-category episode labels in public and admin UI)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('封面导出失败，请重试。'))),
      'image/png',
    );
  });
}
