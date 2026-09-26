import concurrent.futures
import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
ARCHIVE = ROOT / 'artwork/identity'
CDN = 'https://f.no.mt'
THEMES = ['interval', 'soft-landing', 'human-sample', 'stillwood', 'tidal-hours', 'window-seat', 'alpine-bloom']
FOCUS = [.62, .66, .66, .78, .96, .78, .79]
assets = []
fonts = []
runtime = {}


def register(path, source, prefix, dimensions=None):
    data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    key = f'{prefix}/{path.stem}-{digest[:16]}{path.suffix}'
    record = {
        'file': str(path.relative_to(ROOT)),
        'source': source,
        'sha256': digest,
        'bytes': len(data),
        'contentType': 'font/woff2' if path.suffix == '.woff2' else 'image/webp',
    }
    if dimensions:
        record['dimensions'] = list(dimensions)
    if path.suffix == '.woff2':
        fonts.append(record)
        return f'../../{path.relative_to(ROOT)}'
    record['key'] = key
    assets.append(record)
    return f'{CDN}/{key}'


def webp(image, name, source):
    path = ARCHIVE / 'images' / f'{name}.webp'
    image.save(path, 'WEBP', quality=91, method=6)
    return register(path, source, 'images/identity', image.size)


def download_font(item):
    index, block = item
    source = re.search(r'url\(([^)]+)\)', block)[1]
    path = ARCHIVE / 'fonts' / f'noto-sans-sc-{index:03}.woff2'
    if not path.exists():
        data = subprocess.check_output(['curl', '-fsSL', '--retry', '2', '--max-time', '30', source])
        if data[:4] != b'wOF2':
            raise ValueError(f'Invalid font from {source}')
        path.write_bytes(data)
    return path, source, block


for directory in ['images', 'fonts', 'sources']:
    (ARCHIVE / directory).mkdir(parents=True, exist_ok=True)
(ROOT / 'src/brand').mkdir(parents=True, exist_ok=True)

for index, theme in enumerate(THEMES, 2):
    source = f'artwork/design-20260926/originals/{index:02}-hero.png'
    with Image.open(ROOT / source) as original:
        original = ImageOps.exif_transpose(original).convert('RGB')
        if original.size != (1536, 1024):
            raise ValueError(f'Unexpected native resolution: {source}')
        large = webp(original, f'{theme}-hero-1536', source)
        small = webp(original.resize((768, 512), Image.Resampling.LANCZOS), f'{theme}-hero-768', source)
        mobile = ImageOps.fit(original, (1024, 1024), Image.Resampling.LANCZOS, centering=(FOCUS[index - 2], .5))
        mobile_large = webp(mobile, f'{theme}-mobile-1024', source)
        mobile_small = webp(mobile.resize((640, 640), Image.Resampling.LANCZOS), f'{theme}-mobile-640', source)
        thumbnail = webp(original.resize((480, 320), Image.Resampling.LANCZOS), f'{theme}-thumbnail', source)
    art_source = f'artwork/design-20260926/originals/{index:02}-02.png'
    with Image.open(ROOT / art_source) as original:
        artwork = webp(original.convert('RGB').resize((768, 768), Image.Resampling.LANCZOS), f'{theme}-artwork', art_source)
    runtime[theme] = {
        'hero': large,
        'srcSet': f'{small} 768w, {large} 1536w',
        'mobileSrcSet': f'{mobile_small} 640w, {mobile_large} 1024w',
        'thumbnail': thumbnail,
        'artwork': artwork,
        'width': 1536,
        'height': 1024,
    }

runtime['grove'] = {
    'hero': f'{CDN}/images/hero-retina-20260926-1752.webp',
    'srcSet': f'{CDN}/images/hero-retina-20260926-1752.webp 1752w, {CDN}/images/hero-retina-20260926-3504.webp 3504w',
    'mobileSrcSet': f'{CDN}/images/hero-retina-20260926-mobile-1168.webp 1168w, {CDN}/images/hero-retina-20260926-mobile-2336.webp 2336w',
    'thumbnail': f'{CDN}/images/hero-retina-20260926-1752.webp',
    'artwork': f'{CDN}/images/episode-03.webp',
    'width': 3504,
    'height': 2336,
}

source_css = (ARCHIVE / 'sources/noto-sans-sc.css').read_text()
blocks = re.findall(r'@font-face\s*\{[^}]+\}', source_css)
if not blocks:
    raise ValueError('The archived font CSS contains no subsets')
latin = ARCHIVE / 'fonts/space-grotesk.woff2'
shutil.copyfile(ROOT / 'docs/design/assets/fonts/space-grotesk.woff2', latin)
latin_url = register(latin, 'docs/design/assets/fonts/sources.json', 'reference/identity')
css = [f'@font-face {{ font-family: "Space Grotesk"; font-style: normal; font-weight: 300 700; font-display: swap; src: url("{latin_url}") format("woff2"); }}']
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    for path, source, block in pool.map(download_font, enumerate(blocks)):
        url = register(path, source, 'reference/identity')
        css.append(block.replace(source, url))
for font in ['spacegrotesk', 'notosanssc']:
    shutil.copyfile(ROOT / f'docs/design/assets/fonts/{font}-OFL.txt', ARCHIVE / f'fonts/{font}-OFL.txt')
(ROOT / 'src/brand/fonts.css').write_text('\n\n'.join(css) + '\n')
(ROOT / 'src/brand/assets.json').write_text(json.dumps(runtime, ensure_ascii=False, indent=2) + '\n')
(ARCHIVE / 'manifest.json').write_text(json.dumps({
    'identity': 'Open Interval',
    'sourceStudy': 'docs/design/02-interval',
    'cdn': CDN,
    'cacheControl': 'public, max-age=31536000, immutable',
    'assets': assets,
    'fonts': fonts,
}, ensure_ascii=False, indent=2) + '\n')
print(f'已准备 {len(THEMES) + 1} 套主视觉、{len(fonts)} 个字体文件和 {len(assets)} 个 R2 图像资源。')
