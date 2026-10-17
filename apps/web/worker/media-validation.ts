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

export function coverDimensions(bytes: Uint8Array): { width: number; height: number } {
  const { mime } = rasterType(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const invalid = () => new HttpError(415, '封面尺寸无效，或图片不是静态 PNG、JPEG、WebP');
  let size: { width: number; height: number } | undefined;
  if (mime === 'image/png') {
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset);
      const kind = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8));
      if (offset + length + 12 > bytes.length || ['acTL', 'fcTL', 'fdAT'].includes(kind)) throw invalid();
      if (kind === 'IHDR' && (offset !== 8 || length !== 13)) throw invalid();
      if (kind === 'IEND' && (length !== 0 || offset + 12 !== bytes.length)) throw invalid();
      offset += length + 12;
    }
    if (offset !== bytes.length) throw invalid();
    size = { width: view.getUint32(16), height: view.getUint32(20) };
  } else if (mime === 'image/jpeg') {
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset++] !== 255) throw invalid();
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (offset + 2 > bytes.length) throw invalid();
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) throw invalid();
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 8 || size) throw invalid();
        size = { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) };
      }
      offset += length;
    }
  } else {
    let canvas: { width: number; height: number } | undefined;
    let offset = 12;
    const text = (start: number) => new TextDecoder().decode(bytes.subarray(start, start + 4));
    const uint24 = (start: number) => bytes[start] | (bytes[start + 1] << 8) | (bytes[start + 2] << 16);
    while (offset + 8 <= bytes.length) {
      const kind = text(offset);
      const length = view.getUint32(offset + 4, true);
      const start = offset + 8;
      if (start + length > bytes.length) throw invalid();
      if (kind === 'ANIM' || kind === 'ANMF') throw invalid();
      if (kind === 'VP8X') {
        if (length !== 10 || (bytes[start] & 2) !== 0 || canvas) throw invalid();
        canvas = { width: uint24(start + 4) + 1, height: uint24(start + 7) + 1 };
      } else if (kind === 'VP8 ') {
        if (
          length < 10 ||
          size ||
          bytes[start + 3] !== 0x9d ||
          bytes[start + 4] !== 1 ||
          bytes[start + 5] !== 0x2a
        )
          throw invalid();
        size = {
          width: view.getUint16(start + 6, true) & 0x3fff,
          height: view.getUint16(start + 8, true) & 0x3fff,
        };
      } else if (kind === 'VP8L') {
        if (length < 5 || size || bytes[start] !== 0x2f) throw invalid();
        const bits = view.getUint32(start + 1, true);
        if (bits >>> 29 !== 0) throw invalid();
        size = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
      }
      offset = start + length + (length % 2);
    }
    if (
      offset !== bytes.length ||
      (canvas && (canvas.width !== size?.width || canvas.height !== size?.height))
    )
      throw invalid();
  }
  if (!size || size.width < 1 || size.height < 1) throw invalid();
  if (size.width > 8192 || size.height > 8192 || size.width * size.height > 4_000_000) {
    throw new HttpError(413, '封面超过 4 百万像素，请先缩小干净原图再导出');
  }
  return size;
}
