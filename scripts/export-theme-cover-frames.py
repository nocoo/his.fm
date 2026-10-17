#!/usr/bin/env python3
"""Export per-theme transparent cover overlays from docs/design into apps/web/public/brand/frames/."""

import argparse
import hashlib
import importlib.util
import json
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

# Episode badge placement per theme (1024 design space), scaled for export in cover-export.
EPISODE_BADGE = {
    'grove': {'x': 834, 'y': 93, 'fontSize': 39, 'fill': 'paper'},
    'interval': {'x': 96, 'y': 793, 'fontSize': 33, 'fill': 'ink'},
    'soft-landing': {'x': 705, 'y': 105, 'fontSize': 28, 'fill': 'ink'},
    'human-sample': {'x': 62, 'y': 758, 'fontSize': 38, 'fill': 'ink'},
    'stillwood': {'x': 91, 'y': 758, 'fontSize': 31, 'fill': 'paper'},
    'tidal-hours': {'x': 46, 'y': 170, 'fontSize': 28, 'fill': 'ink'},
    'window-seat': {'x': 71, 'y': 163, 'fontSize': 27, 'fill': 'paper'},
    'alpine-bloom': {'x': 62, 'y': 758, 'fontSize': 29, 'fill': 'ink'},
}


def svg_body(content: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{EXPORT_SIZE}" height="{EXPORT_SIZE}" '
        f'viewBox="0 0 {SOURCE_SIZE} {SOURCE_SIZE}" role="img" aria-label="his.fm cover frame">\n'
        f'{content}\n</svg>\n'
    )


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def export_frames(destination: Path, layout_path: Path, quiet: bool = False) -> None:
    assets.prepare_fonts()
    destination.mkdir(parents=True, exist_ok=True)
    layouts: dict[str, dict] = {}
    for brand in pages.BRANDS:
        theme_id = THEME_BY_BRAND[brand['id']]
        content = assets.overlay_frame(brand)
        (destination / f'{theme_id}.svg').write_text(svg_body(content))
        paper, ink, accent = [c for _, c in brand['palette'][:3]]
        badge = EPISODE_BADGE[theme_id]
        scale = EXPORT_SIZE / SOURCE_SIZE
        fill_color = paper if badge['fill'] == 'paper' else ink
        layouts[theme_id] = {
            'paper': paper,
            'ink': ink,
            'accent': accent,
            'episode': {
                'x': round(badge['x'] * scale),
                'y': round(badge['y'] * scale),
                'fontSize': round(badge['fontSize'] * scale),
                'fill': fill_color,
            },
        }
        if not quiet:
            print(f'wrote {theme_id}.svg from docs/design {brand["slug"]} ({brand["name"]})')
    layout_path.write_text(json.dumps({'size': EXPORT_SIZE, 'themes': layouts}, indent=2) + '\n')
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
        if digest(layout_path) != digest(tmp_layout):
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
