import frame from '../../brand/frame.json';

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

export async function exportCover(source: string, episodeNumber: number) {
  const [artwork, overlay, fonts] = await Promise.all([
    loadImage(source),
    loadImage('/brand/cover-frame.svg'),
    document.fonts.load(`500 ${frame.episode.fontSize}px "Space Grotesk"`, 'EP.0123456789'),
  ]);
  if (!fonts.length) throw new Error('品牌字体未能加载，请稍后重试。');
  const canvas = document.createElement('canvas');
  canvas.width = frame.size;
  canvas.height = frame.size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器暂时无法生成封面，请重试。');
  context.fillStyle = frame.paper;
  context.fillRect(0, 0, frame.size, frame.size);
  const scale = Math.min(
    frame.artwork.width / artwork.naturalWidth,
    frame.artwork.height / artwork.naturalHeight,
  );
  const width = artwork.naturalWidth * scale;
  const height = artwork.naturalHeight * scale;
  context.drawImage(
    artwork,
    frame.artwork.x + (frame.artwork.width - width) / 2,
    frame.artwork.y + (frame.artwork.height - height) / 2,
    width,
    height,
  );
  context.drawImage(overlay, 0, 0, frame.size, frame.size);
  context.fillStyle = frame.ink;
  context.font = `500 ${frame.episode.fontSize}px "Space Grotesk"`;
  context.textAlign = 'right';
  context.textBaseline = 'middle';
  context.fillText(`EP.${String(episodeNumber).padStart(3, '0')}`, frame.episode.x, frame.episode.y);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('封面导出失败，请重试。'))),
      'image/png',
    );
  });
}
