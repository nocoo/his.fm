import { HttpError } from './http';

export function rasterType(bytes: Uint8Array) {
  const text = (start: number, end: number) => new TextDecoder().decode(bytes.slice(start, end));
  if (
    bytes.length >= 45 &&
    bytes[0] === 137 &&
    text(1, 4) === 'PNG' &&
    bytes[4] === 13 &&
    bytes[5] === 10 &&
    bytes[6] === 26 &&
    bytes[7] === 10 &&
    text(12, 16) === 'IHDR' &&
    text(bytes.length - 8, bytes.length - 4) === 'IEND'
  )
    return { mime: 'image/png', extension: 'png' };
  if (
    bytes.length >= 16 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255 &&
    bytes.at(-2) === 255 &&
    bytes.at(-1) === 217
  )
    return { mime: 'image/jpeg', extension: 'jpg' };
  if (
    bytes.length >= 30 &&
    text(0, 4) === 'RIFF' &&
    text(8, 12) === 'WEBP' &&
    ['VP8 ', 'VP8L', 'VP8X'].includes(text(12, 16)) &&
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) + 8 === bytes.length
  )
    return { mime: 'image/webp', extension: 'webp' };
  throw new HttpError(415, '请上传完整的 PNG、JPEG 或 WebP 封面');
}
