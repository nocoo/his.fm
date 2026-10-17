import { initSync, Renderer, setGlyphCacheMaxBytes } from '@takumi-rs/wasm';
import wasm from '@takumi-rs/wasm/takumi_wasm_bg.wasm';

let initialized = false;

export async function renderCoverPng(svg: string, fonts: Uint8Array[]): Promise<Uint8Array> {
  if (!initialized) {
    initSync({ module: wasm });
    setGlyphCacheMaxBytes(1024 * 1024);
    initialized = true;
  }
  const renderer = new Renderer();
  try {
    for (const font of fonts) await renderer.registerFont(font);
    return await renderer.render(
      { type: 'image', src: 'cover.svg', style: { width: 1600, height: 1600 } },
      {
        width: 1600,
        height: 1600,
        format: 'png',
        images: [{ src: 'cover.svg', data: new TextEncoder().encode(svg), cache: 'none' }],
      },
    );
  } finally {
    renderer.free();
  }
}
