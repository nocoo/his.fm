#!/usr/bin/env python3
"""Export per-theme transparent cover overlays from docs/design into apps/web/public/brand/frames/."""

import importlib.util
import json
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
    'grove': {'x': 834, 'y': 93, 'fontSize': 39},
    'interval': {'x': 96, 'y': 793, 'fontSize': 33},
    'soft-landing': {'x': 705, 'y': 105, 'fontSize': 28},
    'human-sample': {'x': 62, 'y': 758, 'fontSize': 38},
    'stillwood': {'x': 91, 'y': 758, 'fontSize': 31},
    'tidal-hours': {'x': 46, 'y': 170, 'fontSize': 28},
    'window-seat': {'x': 71, 'y': 163, 'fontSize': 27},
    'alpine-bloom': {'x': 62, 'y': 758, 'fontSize': 29},
}


def svg_body(content: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{EXPORT_SIZE}" height="{EXPORT_SIZE}" '
        f'viewBox="0 0 {SOURCE_SIZE} {SOURCE_SIZE}" role="img" aria-label="his.fm cover frame">\n'
        f'{content}\n</svg>\n'
    )


def main() -> None:
    assets.prepare_fonts()
    destination = ROOT / 'apps/web/public/brand/frames'
    destination.mkdir(parents=True, exist_ok=True)
    layouts: dict[str, dict] = {}
    for brand in pages.BRANDS:
        theme_id = THEME_BY_BRAND[brand['id']]
        content = assets.overlay_frame(brand)
        (destination / f'{theme_id}.svg').write_text(svg_body(content))
        paper, ink, accent = [c for _, c in brand['palette'][:3]]
        badge = EPISODE_BADGE[theme_id]
        scale = EXPORT_SIZE / SOURCE_SIZE
        layouts[theme_id] = {
            'paper': paper,
            'ink': ink,
            'accent': accent,
            'episode': {
                'x': round(badge['x'] * scale),
                'y': round(badge['y'] * scale),
                'fontSize': round(badge['fontSize'] * scale),
            },
        }
        print(f'wrote {theme_id}.svg from docs/design {brand["slug"]} ({brand["name"]})')
    layout_path = ROOT / 'apps/web/src/brand/cover-frame-layouts.json'
    layout_path.write_text(json.dumps({'size': EXPORT_SIZE, 'themes': layouts}, indent=2) + '\n')
    print(f'wrote {layout_path.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
