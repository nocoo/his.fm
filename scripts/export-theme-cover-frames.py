#!/usr/bin/env python3
"""Export the approved cover frames and their dynamic text slots from docs/design."""

import argparse
import hashlib
import importlib.util
import json
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DESIGN = ROOT / 'docs/design'
spec = importlib.util.spec_from_file_location('design_pages', DESIGN / 'build.py')
pages = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pages)
spec = importlib.util.spec_from_file_location('design_assets', DESIGN / 'build_assets.py')
assets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(assets)

THEME_BY_BRAND = {
    '01': 'grove',
    '02': 'interval',
    '03': 'soft-landing',
    '04': 'human-sample',
    '05': 'stillwood',
    '06': 'tidal-hours',
    '07': 'window-seat',
    '08': 'alpine-bloom',
}

EXPORT_SIZE = 1600
SOURCE_SIZE = 1024
TITLE_RIGHT = 842

ART_WINDOWS = {
    'grove': (0, 0, 1024, 1024),
    'interval': (92, 174, 892, 559),
    'soft-landing': (56, 180, 912, 610),
    'human-sample': (30, 203, 994, 517),
    'stillwood': (0, 0, 1024, 1024),
    'tidal-hours': (36, 190, 952, 540),
    'window-seat': (65, 181, 904, 573),
    'alpine-bloom': (0, 0, 1024, 1024),
}


def canonical_cover_logo(x: float, y: float, width: float, color: str) -> str:
    identity = (ROOT / 'apps/web/src/brand/identity.svg').read_text()
    wordmark = re.search(r'<symbol id="wordmark"[^>]*>(.*?)</symbol>', identity, re.S)[1]
    symbol = re.search(r'<symbol id="symbol"[^>]*>(.*?)</symbol>', identity, re.S)[1]
    scale = width / 600
    # The first round stroke starts at (10 - 14 / 2) * 1.68 + 20, not at the viewBox edge.
    left_inset = 25.04
    return (
        f'<g data-cover-lockup="canonical" color="{color}" '
        f'transform="translate({x - left_inset * scale} {y}) scale({scale})">'
        f'{wordmark}<g transform="translate({600 + 600 * 8 / 116} 0) scale({170 / 128})">'
        f'{symbol}</g></g>'
    )


def svg_body(content: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{EXPORT_SIZE}" height="{EXPORT_SIZE}" '
        f'viewBox="0 0 {SOURCE_SIZE} {SOURCE_SIZE}" role="img" aria-label="his.fm cover frame">\n'
        f'{content}\n</svg>\n'
    )


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def export_frames(destination: Path, layout_path: Path, quiet: bool = False) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    layouts: dict[str, dict] = {}
    font_widths: dict[str, list[float]] = {}
    for brand in pages.BRANDS:
        theme_id = THEME_BY_BRAND[brand['id']]
        paper, ink, accent = [c for _, c in brand['palette'][:3]]
        slots = []
        outline = assets.text
        place_logo = assets.place_logo

        def cover_logo(num, x, y, width, color):
            if num in ('05', '08'):
                return canonical_cover_logo(x, y, width, '#ffffff' if num == '05' else ink)
            return place_logo(num, x, y, width, color)

        def capture(value, x, y, size, color, font='noto-sans-sc', weight=500, max_width=None, tracking=0):
            if any(token in value for token in ('{number}', '{category}', '{title1}', '{title2}')):
                if value in ('{title1}', '{title2}'):
                    max_width = min(max_width or SOURCE_SIZE - x - 32, TITLE_RIGHT - x)
                if theme_id == 'window-seat' and value in ('{title1}', '{title2}'):
                    y = 886 if value == '{title1}' else 959
                if theme_id == 'interval':
                    if value == '{number}':
                        y = 1000
                    elif value in ('{title1}', '{title2}'):
                        size = 58
                        y = 872 if value == '{title1}' else 944
                slots.append({
                    'template': value, 'x': x, 'y': y, 'size': size, 'fill': color,
                    'font': font, 'weight': weight, 'maxWidth': max_width or SOURCE_SIZE - x - 32,
                    'tracking': tracking,
                })
                return ''
            return outline(value, x, y, size, color, font, weight, max_width, tracking)

        assets.text = capture
        assets.place_logo = cover_logo
        try:
            content = assets.frame(brand, {
                'number': '{number}', 'tag': '{category}', 'lines': ('{title1}', '{title2}'),
            })
        finally:
            assets.text = outline
            assets.place_logo = place_logo
        if theme_id == 'tidal-hours':
            content += (
                f'<rect x="1" y="1" width="1022" height="1022" fill="none" '
                f'stroke="{ink}" stroke-width="2" stroke-opacity=".45"/>'
            )
        for slot in slots:
            key = f'{slot["font"]}:{slot["weight"]}'
            if key not in font_widths:
                glyphs, cmap, units = assets.font_data(slot['font'], slot['weight'])
                font_widths[key] = [round(glyphs[cmap[point]].width / units, 6) for point in range(32, 127)]
        frame = svg_body(content)
        (destination / f'{theme_id}.svg').write_text(frame)
        layouts[theme_id] = {
            'frameDigest': hashlib.sha256(frame.encode()).hexdigest(),
            'paper': paper,
            'ink': ink,
            'accent': accent,
            'artwork': dict(zip(('x', 'y', 'width', 'height'), ART_WINDOWS[theme_id])),
            'text': slots,
        }
        if not quiet:
            print(f'wrote {theme_id}.svg from docs/design {brand["slug"]} ({brand["name"]})')
    layout_path.write_text(json.dumps({
        'size': EXPORT_SIZE, 'designSize': SOURCE_SIZE, 'themes': layouts, 'fontWidths': font_widths,
    }, indent=2) + '\n')
    if not quiet:
        print(f'wrote {layout_path.relative_to(ROOT)}')


def verify_committed(destination: Path, layout_path: Path) -> int:
    with tempfile.TemporaryDirectory() as tmp:
        tmp_dest = Path(tmp) / 'frames'
        tmp_layout = Path(tmp) / 'cover-frame-layouts.json'
        export_frames(tmp_dest, tmp_layout, quiet=True)
        mismatches: list[str] = []
        for theme_id in THEME_BY_BRAND.values():
            committed = destination / f'{theme_id}.svg'
            generated = tmp_dest / f'{theme_id}.svg'
            if digest(committed) != digest(generated):
                mismatches.append(f'{theme_id}.svg')
        if json.loads(layout_path.read_text()) != json.loads(tmp_layout.read_text()):
            mismatches.append(layout_path.name)
        if mismatches:
            print('Committed cover frames are out of date. Run:', file=sys.stderr)
            print('  python3 scripts/export-theme-cover-frames.py', file=sys.stderr)
            for name in mismatches:
                print(f'  - {name}', file=sys.stderr)
            return 1
    print('Cover frame exports match committed files.')
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--check',
        action='store_true',
        help='Exit non-zero when committed SVGs/layout differ from generator output.',
    )
    args = parser.parse_args()
    destination = ROOT / 'apps/web/public/brand/frames'
    layout_path = ROOT / 'apps/web/src/brand/cover-frame-layouts.json'
    if args.check:
        raise SystemExit(verify_committed(destination, layout_path))
    export_frames(destination, layout_path)


if __name__ == '__main__':
    main()
