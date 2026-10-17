"""Build complete, unicode-sharded theme fonts from the verified identity sources."""

import hashlib
import json
import re
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
DESTINATION = ROOT / 'artwork/identity/fonts/themes'
SOURCES = ROOT / '.local/design/fonts'
PROVENANCE = json.loads((ROOT / 'docs/design/assets/fonts/sources.json').read_text())


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def ranges(points):
    result = []
    for point in sorted(points):
        if result and result[-1][1] == point - 1:
            result[-1][1] = point
        else:
            result.append([point, point])
    return ', '.join(f'U+{a:X}' + (f'-{b:X}' if a != b else '') for a, b in result)


def face(family, file, weight, style='normal', points=None):
    result = f'''@font-face {{
  font-family: "{family}";
  font-style: {style};
  font-weight: {weight};
  font-display: swap;
  src: url("../../../../artwork/identity/fonts/themes/{file}") format("woff2");
'''
    if points:
        result += f'  unicode-range: {ranges(points)};\n'
    return result + '}\n'


def main():
    DESTINATION.mkdir(parents=True, exist_ok=True)
    css = []
    records = []
    for name, family, weight, style in (
        ('instrument-serif', 'Instrument Serif', '400', 'normal'),
        ('instrument-serif-italic', 'Instrument Serif', '400', 'italic'),
        ('syne', 'Syne', '400 800', 'normal'),
    ):
        record = next(item for item in PROVENANCE if item['font'] == name)
        source = ROOT / 'docs/design/assets/fonts' / record['delivery']
        if digest(source) != record['sha256']:
            raise ValueError(f'Font digest mismatch: {source}')
        target = DESTINATION / source.name
        target.write_bytes(source.read_bytes())
        license_file = ROOT / 'docs/design/assets/fonts' / record['license']
        (DESTINATION / license_file.name).write_bytes(license_file.read_bytes())
        css.append(face(family, target.name, weight, style))
        records.append({**record, 'file': target.name})

    record = next(item for item in PROVENANCE if item['font'] == 'noto-serif-sc')
    source = SOURCES / 'noto-serif-sc.ttf'
    if digest(source) != record['source_sha256']:
        raise ValueError(f'Font digest mismatch: {source}')
    font = TTFont(source, recalcTimestamp=False)
    available = set(font.getBestCmap())
    remaining = set(available)
    groups = []
    for sans in sorted((ROOT / 'artwork/identity/fonts').glob('noto-sans-sc-*.woff2')):
        points = set(TTFont(sans).getBestCmap()) & remaining
        if points:
            groups.append(points)
            remaining -= points
    extra = sorted(remaining)
    groups.extend(set(extra[i:i + 256]) for i in range(0, len(extra), 256))
    deliveries = []
    for index, points in enumerate(groups):
        target = DESTINATION / f'noto-serif-sc-{index:03}.woff2'
        font = TTFont(source, recalcTimestamp=False)
        options = subset.Options()
        options.layout_features = ['*']
        subsetter = subset.Subsetter(options=options)
        subsetter.populate(unicodes=points)
        subsetter.subset(font)
        font.flavor = 'woff2'
        font.save(target)
        css.append(face('Noto Serif SC', target.name, '200 900', points=points))
        deliveries.append({'file': target.name, 'sha256': digest(target), 'bytes': target.stat().st_size})
    license_file = ROOT / 'docs/design/assets/fonts' / record['license']
    (DESTINATION / license_file.name).write_bytes(license_file.read_bytes())
    records.append({
        'font': 'noto-serif-sc', 'source_url': record['source_url'],
        'source_sha256': record['source_sha256'], 'license': record['license'],
        'codepoints': len(available), 'deliveries': deliveries,
    })
    (DESTINATION / 'manifest.json').write_text(json.dumps(records, indent=2) + '\n')
    (ROOT / 'apps/web/src/brand/theme-fonts.css').write_text('\n'.join(css))
    font_css = ROOT / 'apps/web/src/brand/fonts.css'
    content = font_css.read_text()
    content = re.sub(r'(font-family: "Noto Sans SC";\s*font-style: normal;\s*font-weight:) 300 700;', r'\1 100 900;', content)
    font_css.write_text(content)
    print(f'Wrote complete theme fonts, including {len(groups)} serif subsets / {len(available)} codepoints.')


if __name__ == '__main__':
    main()
