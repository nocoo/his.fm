import { readFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { coverDimensions, rasterType } from '../../worker/media-validation';

it('recognizes supported raster signatures and rejects corrupt or incomplete containers', () => {
  const png = Uint8Array.from(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
      'base64',
    ),
  );
  const webp = Uint8Array.from(readFileSync(new URL('../../public/images/episode-01.webp', import.meta.url)));
  const jpeg = new Uint8Array(32);
  jpeg.set([255, 216, 255, 224]);
  jpeg.set([255, 217], 30);
  for (const [bytes, mime, extension] of [
    [png, 'image/png', 'png'],
    [jpeg, 'image/jpeg', 'jpg'],
    [webp, 'image/webp', 'webp'],
  ] as const)
    expect(rasterType(bytes)).toEqual({ mime, extension });
  for (const [bytes, indices] of [
    [png, [0, 1, 4, 5, 6, 7, 12, png.length - 8]],
    [jpeg, [0, 1, 2, 30, 31]],
    [webp, [0, 4, 8, 12]],
  ] as const) {
    for (const index of indices) {
      const broken = bytes.slice();
      broken[index] = 0;
      expect(() => rasterType(broken)).toThrow();
    }
    expect(() => rasterType(bytes.slice(0, 10))).toThrow();
  }
});

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
  'base64',
);

function pngChunk(kind: string, data: Uint8Array) {
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length);
  chunk.write(kind, 4);
  chunk.set(data, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  return chunk;
}

function webpChunk(kind: string, data: Uint8Array) {
  const chunk = Buffer.alloc(8 + data.length + (data.length % 2));
  chunk.write(kind);
  chunk.writeUInt32LE(data.length, 4);
  chunk.set(data, 8);
  return chunk;
}

function webp(...chunks: Uint8Array[]) {
  const body = Buffer.concat(chunks);
  const header = Buffer.from('RIFF\0\0\0\0WEBP');
  header.writeUInt32LE(body.length + 4, 4);
  return Buffer.concat([header, body]);
}

function lossy(width = 32, height = 24) {
  const data = Buffer.from([0, 0, 0, 0x9d, 1, 0x2a, 0, 0, 0, 0]);
  data.writeUInt16LE(width, 6);
  data.writeUInt16LE(height, 8);
  return data;
}

function lossless(width = 32, height = 24) {
  const data = Buffer.alloc(10);
  data[0] = 0x2f;
  data.writeUInt32LE((width - 1) | ((height - 1) << 14), 1);
  return data;
}

function canvas(flags = 0, width = 32, height = 24) {
  const data = Buffer.alloc(10);
  data[0] = flags;
  data.writeUIntLE(width - 1, 4, 3);
  data.writeUIntLE(height - 1, 7, 3);
  return data;
}

function jpeg(...segments: { marker: number; data: Uint8Array }[]) {
  return Buffer.concat([
    Buffer.from([255, 216]),
    ...segments.map(({ marker, data }) => {
      const segment = Buffer.alloc(data.length + 4);
      segment.set([255, marker]);
      segment.writeUInt16BE(data.length + 2, 2);
      segment.set(data, 4);
      return segment;
    }),
    Buffer.from([255, 217]),
  ]);
}

const sof = { marker: 0xc0, data: new Uint8Array([8, 0, 24, 0, 32, 3, 1, 17, 0, 2, 17, 1, 3, 17, 1]) };

describe('finished cover dimension guards', () => {
  it('reads real PNG, JPEG, lossy, lossless and alpha WebP without decoding pixels', async () => {
    const image = sharp({ create: { width: 80, height: 60, channels: 4, background: '#ff000080' } });
    const variants = await Promise.all([
      image.clone().png().toBuffer(),
      image.clone().jpeg().toBuffer(),
      image.clone().webp().toBuffer(),
      image.clone().webp({ lossless: true }).toBuffer(),
      image.clone().removeAlpha().webp().toBuffer(),
    ]);
    for (const bytes of variants) {
      const offset = Buffer.concat([Buffer.alloc(7), bytes]).subarray(7);
      expect(coverDimensions(offset)).toEqual({ width: 80, height: 60 });
    }
    expect(coverDimensions(png)).toEqual({ width: 1, height: 1 });
    expect(coverDimensions(jpeg(sof))).toEqual({ width: 32, height: 24 });
    expect(coverDimensions(webp(webpChunk('VP8L', lossless())))).toEqual({ width: 32, height: 24 });
    expect(coverDimensions(webp(webpChunk('VP8 ', lossy())))).toEqual({ width: 32, height: 24 });
  });

  it('rejects a valid two-frame APNG and each animation chunk before rendering', () => {
    const control = Buffer.alloc(8);
    control.writeUInt32BE(2);
    const frame = Buffer.alloc(26);
    frame.writeUInt32BE(1, 4);
    frame.writeUInt32BE(1, 8);
    frame.writeUInt16BE(1, 20);
    frame.writeUInt16BE(10, 22);
    const second = Buffer.from(frame);
    second.writeUInt32BE(1);
    const idatLength = png.readUInt32BE(33);
    const idat = png.subarray(41, 41 + idatLength);
    const frameData = Buffer.alloc(idat.length + 4);
    frameData.writeUInt32BE(2);
    frameData.set(idat, 4);
    const animated = Buffer.concat([
      png.subarray(0, 33),
      pngChunk('acTL', control),
      pngChunk('fcTL', frame),
      pngChunk('IDAT', idat),
      pngChunk('fcTL', second),
      pngChunk('fdAT', frameData),
      png.subarray(-12),
    ]);
    expect(() => coverDimensions(animated)).toThrow('不是静态');
    for (const kind of ['acTL', 'fcTL', 'fdAT']) {
      const bytes = Buffer.concat([png.subarray(0, 33), pngChunk(kind, control), png.subarray(33)]);
      expect(() => coverDimensions(bytes)).toThrow('不是静态');
    }
  });

  it('rejects malformed PNG chunks and bounds pixel counts independently of encoded bytes', () => {
    for (const [offset, value] of [
      [8, 12],
      [33, 0xffffffff],
      [png.length - 12, 1],
    ] as const) {
      const broken = Buffer.from(png);
      broken.writeUInt32BE(value, offset);
      expect(() => coverDimensions(broken)).toThrow('封面尺寸无效');
    }
    const duplicate = Buffer.concat([png.subarray(0, 33), png.subarray(8, 33), png.subarray(33)]);
    expect(() => coverDimensions(duplicate)).toThrow('封面尺寸无效');
    const partial = Buffer.concat([png.subarray(0, -12), Buffer.from([0]), png.subarray(-12)]);
    expect(() => coverDimensions(partial)).toThrow();
    for (const [width, height, status] of [
      [0, 1, 415],
      [1, 0, 415],
      [8193, 1, 413],
      [1, 8193, 413],
      [4096, 4096, 413],
    ] as const) {
      const oversized = Buffer.from(png);
      oversized.writeUInt32BE(width, 16);
      oversized.writeUInt32BE(height, 20);
      expect(() => coverDimensions(oversized)).toThrow(expect.objectContaining({ status }));
    }
  });

  it('accepts exactly four million pixels and rejects the next row or column', async () => {
    const image = await sharp({
      create: { width: 2000, height: 2000, channels: 3, background: '#293940' },
    })
      .png()
      .toBuffer();
    expect(coverDimensions(image)).toEqual({ width: 2000, height: 2000 });
    for (const offset of [16, 20]) {
      const oversized = Buffer.from(image);
      oversized.writeUInt32BE(2001, offset);
      expect(() => coverDimensions(oversized)).toThrow(expect.objectContaining({ status: 413 }));
    }
  });

  it('rejects JPEG marker/segment corruption and duplicate or absent dimension headers', () => {
    const missing = jpeg({ marker: 0xe0, data: new Uint8Array(12) });
    const short = jpeg({ marker: 0xc0, data: new Uint8Array(5) }, { marker: 0xda, data: new Uint8Array(4) });
    for (const bytes of [missing, short, jpeg(sof, sof)])
      expect(() => coverDimensions(bytes)).toThrow('封面尺寸无效');
    for (const [offset, value] of [
      [21, 0],
      [4, 0],
      [4, 255],
    ] as const) {
      const broken = jpeg(sof, { marker: 0xe0, data: new Uint8Array(8) });
      broken[offset] = value;
      if (offset === 4 && value === 0) broken[5] = 1;
      expect(() => coverDimensions(broken)).toThrow('封面尺寸无效');
    }
    const padded = Buffer.concat([Buffer.from([255, 216, 255]), jpeg(sof).subarray(2)]);
    expect(coverDimensions(padded)).toEqual({ width: 32, height: 24 });
  });

  it('rejects animated WebP, conflicting canvas sizes and incomplete chunk boundaries', () => {
    const pixels = webpChunk('VP8 ', lossy());
    const malformed = [
      webp(webpChunk('VP8X', canvas(2)), pixels),
      webp(webpChunk('VP8X', canvas()), webpChunk('ANIM', new Uint8Array(6)), pixels),
      webp(webpChunk('VP8X', canvas()), webpChunk('ANMF', new Uint8Array(6)), pixels),
      webp(webpChunk('VP8X', canvas(0, 33)), pixels),
      webp(webpChunk('VP8X', canvas(0, 32, 25)), pixels),
      webp(webpChunk('VP8X', canvas())),
      webp(webpChunk('VP8X', new Uint8Array(9)), pixels),
      webp(webpChunk('VP8X', canvas()), webpChunk('VP8X', canvas()), pixels),
      webp(pixels, pixels),
      webp(webpChunk('VP8L', lossless()), webpChunk('VP8L', lossless())),
      webp(webpChunk('VP8X', canvas()), webpChunk('VP8 ', new Uint8Array(9))),
      webp(webpChunk('VP8X', canvas()), webpChunk('VP8L', new Uint8Array(4))),
      webp(pixels, new Uint8Array(1)),
    ];
    for (const bytes of malformed) expect(() => coverDimensions(bytes)).toThrow('封面尺寸无效');
    for (const offset of [4, 5, 6, 7, 23, 24, 25]) {
      const broken = webp(pixels);
      broken[offset] ^= 255;
      expect(() => coverDimensions(broken)).toThrow();
    }
    const chunkOverflow = webp(pixels);
    chunkOverflow.writeUInt32LE(0xffffffff, 16);
    expect(() => coverDimensions(chunkOverflow)).toThrow('封面尺寸无效');
    const invalidLossless = lossless();
    invalidLossless[0] = 0;
    expect(() => coverDimensions(webp(webpChunk('VP8L', invalidLossless)))).toThrow();
    invalidLossless[0] = 0x2f;
    invalidLossless[4] |= 0x80;
    expect(() => coverDimensions(webp(webpChunk('VP8L', invalidLossless)))).toThrow('封面尺寸无效');
    expect(
      coverDimensions(webp(webpChunk('VP8X', canvas()), pixels, webpChunk('EXIF', new Uint8Array(1)))),
    ).toEqual({ width: 32, height: 24 });
  });
});
