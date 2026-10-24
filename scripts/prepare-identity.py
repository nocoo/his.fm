import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
source = (ROOT / 'apps/web/src/brand/identity.svg').read_text()
palettes = json.loads((ROOT / 'apps/web/src/brand/cover-frame-layouts.json').read_text())['themes']
palette = palettes['interval']


def symbol(name):
    match = re.search(rf'<symbol id="{name}" viewBox="([^"]+)">(.*?)</symbol>', source, re.S)
    if not match:
        raise ValueError(f'Missing identity symbol: {name}')
    return match[1], match[2]


def svg(viewbox, body, color=palette['ink'].lower()):
    _, _, width, height = viewbox.split()
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="{viewbox}" color="{color}" role="img" aria-label="his.fm">{body}</svg>\n'


wordmark = symbol('wordmark')
mark = symbol('symbol')
components = ['// Generated from identity.svg by scripts/prepare-identity.py.\n']
for name, css, shape, fallback_width in [
    ('Wordmark', 'wordmark', wordmark, 144),
    ('BrandSymbol', 'symbol', mark, 28),
]:
    body = shape[1].replace('stroke-width', 'strokeWidth').replace('stroke-linecap', 'strokeLinecap').replace('stroke-linejoin', 'strokeLinejoin')
    _, _, box_width, box_height = shape[0].split()
    fallback_height = round(fallback_width * int(box_height) / int(box_width))
    components.append(f'''export function {name}({{ className = '' }}: {{ className?: string }}) {{
  return (
    <svg
      className={{`brand-{css} ${{className}}`}}
      viewBox="{shape[0]}"
      width={{{fallback_width}}}
      height={{{fallback_height}}}
      aria-hidden="true"
      focusable="false"
    >
      {body}
    </svg>
  );
}}
''')
(ROOT / 'apps/web/src/brand/Brand.tsx').write_text('\n'.join(components))
destination = ROOT / 'apps/web/public/brand'
destination.mkdir(parents=True, exist_ok=True)
(destination / 'logo.svg').write_text(svg(*wordmark))
(destination / 'symbol.svg').write_text(svg(*mark))
favicons = destination / 'favicons'
favicons.mkdir(parents=True, exist_ok=True)
for theme, colors in palettes.items():
    (favicons / f'{theme}.svg').write_text(svg('0 0 128 128', f'<rect width="128" height="128" rx="20" fill="{colors["ink"].lower()}"/><g transform="translate(16 16) scale(0.75)">{mark[1]}</g>', '#ffffff'))
print('已生成统一字标、符号和八套主题图标。')
