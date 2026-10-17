import { initSync, Renderer, setGlyphCacheMaxBytes } from '@takumi-rs/wasm';
import wasm from '@takumi-rs/wasm/takumi_wasm_bg.wasm';
import { HttpError } from './http';

let initialized = false;
let rendering = false;

export async function renderCoverPng(svg: string, fonts: Uint8Array[]): Promise<Uint8Array> {
  return renderCover(svg, fonts, 1600, 1600, 'png');
}

export async function renderCoverJpeg(
  svg: string,
  fonts: Uint8Array[],
  width: number,
  height: number,
): Promise<Uint8Array> {
  return renderCover(svg, fonts, width, height, 'jpeg');
}

async function renderCover(
  svg: string,
  fonts: Uint8Array[],
  width: number,
  height: number,
  format: 'png' | 'jpeg',
): Promise<Uint8Array> {
  if (rendering) throw new HttpError(503, '封面正在生成，请稍后重试');
  if (!initialized) {
    initSync({ module: wasm });
    setGlyphCacheMaxBytes(1024 * 1024);
    initialized = true;
  }
  const renderer = new Renderer();
  rendering = true;
  try {
    for (const font of fonts) await renderer.registerFont(font);
    return await renderer.render(
      { type: 'image', src: 'cover.svg', style: { width, height } },
      {
        width,
        height,
        format,
        quality: 90,
        images: [{ src: 'cover.svg', data: new TextEncoder().encode(svg), cache: 'none' }],
      },
    );
  } finally {
    renderer.free();
    rendering = false;
  }
}
