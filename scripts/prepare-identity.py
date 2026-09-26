import hashlib
import json
import re
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
source = (ROOT / 'src/brand/identity.svg').read_text()
layout = json.loads((ROOT / 'src/brand/frame.json').read_text())
font_path = ROOT / 'artwork/identity/sources/space-grotesk.ttf'
provenance = next(item for item in json.loads((ROOT / 'docs/design/assets/fonts/sources.json').read_text()) if item['font'] == 'space-grotesk')
if hashlib.sha256(font_path.read_bytes()).hexdigest() != provenance['source_sha256']:
    raise ValueError('Space Grotesk source digest mismatch')
font = TTFont(font_path)
glyphs = font.getGlyphSet(location={'wght': 500})
cmap = font.getBestCmap()


def symbol(name):
    match = re.search(rf'<symbol id="{name}" viewBox="([^"]+)">(.*?)</symbol>', source, re.S)
    if not match:
        raise ValueError(f'Missing identity symbol: {name}')
    return match[1], match[2]


def svg(viewbox, body):
    _, _, width, height = viewbox.split()
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="{viewbox}" color="{layout["ink"]}" role="img" aria-label="his.fm">{body}</svg>\n'


def lettering(text, x, y, end=False):
    scale = 26 / font['head'].unitsPerEm
    glyph_names = [cmap[ord(char)] for char in text]
    if end:
        x -= sum(glyphs[name].width * scale for name in glyph_names) + 2 * (len(text) - 1)
    pen = SVGPathPen(glyphs, ntos=lambda value: f'{value:.3f}'.rstrip('0').rstrip('.'))
    for name in glyph_names:
        glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, x, y)))
        x += glyphs[name].width * scale + 2
    return f'<path fill="{layout["ink"]}" d="{pen.getCommands()}"/>'


wordmark = symbol('wordmark')
mark = symbol('symbol')
components = ['// Generated from identity.svg by scripts/prepare-identity.py.\n']
for name, css, shape in [('Wordmark', 'wordmark', wordmark), ('BrandSymbol', 'symbol', mark)]:
    body = shape[1].replace('stroke-width', 'strokeWidth').replace('stroke-linecap', 'strokeLinecap').replace('stroke-linejoin', 'strokeLinejoin')
    components.append(f'''export function {name}({{ className = '' }}: {{ className?: string }}) {{
  return <svg className={{`brand-{css} ${{className}}`}} viewBox="{shape[0]}" aria-hidden="true" focusable="false">{body}</svg>;
}}
''')
(ROOT / 'src/brand/Brand.tsx').write_text('\n'.join(components))
destination = ROOT / 'public/brand'
destination.mkdir(parents=True, exist_ok=True)
(destination / 'logo.svg').write_text(svg(*wordmark))
(destination / 'symbol.svg').write_text(svg(*mark))
(ROOT / 'public/favicon.svg').write_text(svg('0 0 128 128', f'<rect width="128" height="128" rx="20" fill="{layout["accent"]}"/>{mark[1]}'))
size = layout['size']
art = layout['artwork']
frame = f'''
<path d="M0 0H{size}V{size}H0ZM{art['x']} {art['y']}V{art['y'] + art['height']}H{art['x'] + art['width']}V{art['y']}Z" fill="{layout['paper']}" fill-rule="evenodd"/>
<rect width="60" height="{size}" fill="{layout['accent']}"/>
<g transform="translate(136 30) scale(.88)">{wordmark[1]}</g>
<g transform="translate(1376 68) scale(.625)">{mark[1]}</g>
{lettering('HIS.FM / CHINESE PODCAST', 160, 1548)}
{lettering('AT YOUR OWN PACE.', 1440, 1548, end=True)}
'''
(destination / 'cover-frame.svg').write_text(svg(f'0 0 {size} {size}', frame))
print('已生成统一字标、符号、站点图标和字体轮廓化的透明封面框架。')
