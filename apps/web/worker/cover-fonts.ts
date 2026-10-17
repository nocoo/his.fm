import manifest from '../public/brand/fonts/cover/manifest.json';
import type { coverText } from '../src/shared/cover-composition';
import { HttpError } from './http';
import { readBytes } from './production-body';

const maxFontBytes = 2 * 1024 * 1024;

type FontFace = { weight: number; file: string; bytes: number };
type FontShard = { family: string; ranges: number[][]; faces: FontFace[] };
type CoverFont = { id: string; shards: FontShard[] };

const coverFonts: CoverFont[] = manifest.fonts;

export async function loadCoverFonts(
  env: Pick<Env, 'ASSETS'>,
  origin: string,
  slots: ReturnType<typeof coverText>,
): Promise<{ fonts: Uint8Array[]; families: Record<string, string> }> {
  const selected = new Map<string, FontFace>();
  const families = new Set<string>();
  for (const slot of slots) {
    const font = coverFonts.find((font) => font.id === slot.font);
    if (!font) throw new HttpError(500, '封面字体配置无效');
    for (const character of slot.value) {
      const point = character.codePointAt(0) as number;
      const shard = font.shards.find((shard) =>
        shard.ranges.some(([start, end]) => point >= start && point <= end),
      );
      if (!shard) throw new HttpError(422, `封面字体不包含字符「${character}」，请调整文字`);
      const face = shard.faces.find((face) => face.weight === slot.weight);
      if (!face) throw new HttpError(500, '封面字体字重配置无效');
      selected.set(face.file, face);
      families.add(shard.family);
    }
  }
  const bytes = [...selected.values()].reduce((sum, face) => sum + face.bytes, 0);
  if (bytes > maxFontBytes) throw new HttpError(422, '封面字体资源超出限制，请缩短标题或分类');
  const fonts: Uint8Array[] = [];
  for (const face of selected.values()) {
    const url = new URL(`/brand/fonts/cover/${face.file}`, origin);
    const response = await env.ASSETS.fetch(new Request(url));
    if (!response.ok) throw new HttpError(503, '封面字体暂时无法加载');
    const bytes = await readBytes(response, face.bytes);
    if (bytes.byteLength !== face.bytes) throw new HttpError(503, '封面字体文件不完整');
    fonts.push(bytes);
  }
  return {
    fonts,
    families: Object.fromEntries(
      coverFonts
        .map((font) => [
          font.id,
          font.shards
            .filter((shard) => families.has(shard.family))
            .map((shard) => `'${shard.family}'`)
            .join(', '),
        ])
        .filter(([, family]) => family),
    ),
  };
}
