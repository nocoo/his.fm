import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
source = (ROOT / 'apps/web/src/brand/identity.svg').read_text()
palette = json.loads((ROOT / 'apps/web/src/brand/cover-frame-layouts.json').read_text())['themes']['interval']


def symbol(name):
    match = re.search(rf'<symbol id="{name}" viewBox="([^"]+)">(.*?)</symbol>', source, re.S)
    if not match:
        raise ValueError(f'Missing identity symbol: {name}')
    return match[1], match[2]


def svg(viewbox, body):
    _, _, width, height = viewbox.split()
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="{viewbox}" color="{palette["ink"].lower()}" role="img" aria-label="his.fm">{body}</svg>\n'


wordmark = symbol('wordmark')
mark = symbol('symbol')
components = ['// Generated from identity.svg by scripts/prepare-identity.py.\n']
for name, css, shape in [('Wordmark', 'wordmark', wordmark), ('BrandSymbol', 'symbol', mark)]:
    body = shape[1].replace('stroke-width', 'strokeWidth').replace('stroke-linecap', 'strokeLinecap').replace('stroke-linejoin', 'strokeLinejoin')
    components.append(f'''export function {name}({{ className = '' }}: {{ className?: string }}) {{
  return <svg className={{`brand-{css} ${{className}}`}} viewBox="{shape[0]}" aria-hidden="true" focusable="false">{body}</svg>;
}}
''')
(ROOT / 'apps/web/src/brand/Brand.tsx').write_text('\n'.join(components))
destination = ROOT / 'apps/web/public/brand'
destination.mkdir(parents=True, exist_ok=True)
(destination / 'logo.svg').write_text(svg(*wordmark))
(destination / 'symbol.svg').write_text(svg(*mark))
(ROOT / 'apps/web/public/favicon.svg').write_text(svg('0 0 128 128', f'<rect width="128" height="128" rx="20" fill="{palette["accent"].lower()}"/>{mark[1]}'))
print('已生成统一字标、符号和站点图标。')
