import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

SIZE = 1600
CREAM = "#f4f4e9"
INK = "#173d2b"
GRASS = "#c5f344"


def frame(source, output, episode):
    with Image.open(source) as original:
        original = ImageOps.exif_transpose(original).convert("RGB")
        artwork = ImageOps.fit(original, (1472, 1264), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (SIZE, SIZE), CREAM)
    canvas.paste(artwork, (64, 180))
    draw = ImageDraw.Draw(canvas)
    brand = ImageFont.load_default(size=104)
    label = ImageFont.load_default(size=46)
    draw.text((60, 32), "his.fm", fill=INK, font=brand)
    draw.rounded_rectangle((1250, 38, 1536, 136), radius=49, fill=GRASS)
    draw.text((1290, 56), f"EP.{episode:03d}", fill=INK, font=label)
    draw.text((64, 1490), "his.fm", fill=INK, font=label)
    for index, height in enumerate([24, 46, 74, 46, 24]):
        x = 1380 + index * 32
        draw.rounded_rectangle((x, 1514 - height // 2, x + 12, 1514 + height // 2), radius=6, fill=INK)
    destination = Path(output)
    if destination.resolve() == Path(source).resolve():
        raise ValueError("Output must not replace the original generated image")
    destination.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(destination, "WEBP", quality=94, method=6)
    print(f"已生成统一品牌封面：{destination}（1600 × 1600）")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Apply the canonical his.fm cover frame")
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--episode", type=int, required=True)
    args = parser.parse_args()
    if not 1 <= args.episode <= 99999:
        parser.error("episode must be between 1 and 99999")
    frame(args.source, args.output, args.episode)
