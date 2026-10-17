"""Build static cover-only font shards from hash-verified full identity sources."""

import hashlib
import io
import json
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / '.local/design/fonts'
DESTINATION = ROOT / 'apps/web/public/brand/fonts/cover'
PROVENANCE = ROOT / 'docs/design/assets/fonts/sources.json'
FONTS = {
    'noto-sans-sc': ('Noto Sans SC', [400, 500, 550, 600, 650, 850]),
    'noto-serif-sc': ('Noto Serif SC', [500, 550]),
    'space-grotesk': ('Space Grotesk', [500, 600, 700]),
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def ranges(points):
    result = []
    for point in sorted(points):
        if result and result[-1][1] == point - 1:
            result[-1][1] = point
        else:
            result.append([point, point])
    return result


def static_face(variable, family, name, weight):
    font = TTFont(io.BytesIO(variable), recalcTimestamp=False)
    instantiateVariableFont(font, {'wght': weight}, inplace=True)
    if 'fvar' in font or font['OS/2'].usWeightClass != weight:
        raise ValueError(f'Font is not static weight {weight}: {name}')
    style = 'Regular' if weight == 400 else f'Weight {weight}'
    names = {1: family, 2: style, 4: f'{family} {style}',
             6: f'{name.replace("-", "")}-{weight}', 16: family, 17: style}
    font['name'].names = [item for item in font['name'].names if item.nameID not in {*names, 25}]
    for name_id, value in names.items():
        font['name'].setName(value, name_id, 3, 1, 0x409)
        font['name'].setName(value, name_id, 1, 0, 0)
    font.flavor = 'woff2'
    output = io.BytesIO()
    font.save(output)
    font.close()
    return output.getvalue()


def main():
    DESTINATION.mkdir(parents=True, exist_ok=True)
    provenance = json.loads(PROVENANCE.read_text())
    records = []
    written = set()
    for name, (family, weights) in FONTS.items():
        record = next(item for item in provenance if item['font'] == name)
        source = SOURCES / f'{name}.ttf'
        source_bytes = source.read_bytes()
        if digest(source_bytes) != record['source_sha256']:
            raise ValueError(f'Font digest mismatch: {source}')
        with TTFont(io.BytesIO(source_bytes), recalcTimestamp=False) as font:
            available = sorted(font.getBestCmap())
        shards = []
        for index, offset in enumerate(range(0, len(available), 512)):
            points = available[offset:offset + 512]
            font = TTFont(io.BytesIO(source_bytes), recalcTimestamp=False)
            options = subset.Options()
            options.layout_features = ['*']
            options.bidi_closure = False
            subsetter = subset.Subsetter(options=options)
            subsetter.populate(unicodes=points)
            subsetter.subset(font)
            if set(font.getBestCmap()) != set(points):
                raise ValueError(f'Font shard lost Unicode coverage: {name}:{index}')
            variable = io.BytesIO()
            font.save(variable)
            font.close()
            shard_name = f'{name}-{index:03}'
            shard_family = f'{family} Cover {index:03}'
            faces = []
            for weight in weights:
                data = static_face(variable.getvalue(), shard_family, shard_name, weight)
                sha256 = digest(data)
                filename = f'{shard_name}-{weight}-{sha256[:16]}.woff2'
                (DESTINATION / filename).write_bytes(data)
                written.add(filename)
                faces.append({'weight': weight, 'file': filename, 'sha256': sha256, 'bytes': len(data)})
            shards.append({'family': shard_family, 'ranges': ranges(points), 'faces': faces})
            print(f'Built {shard_name}: {len(points)} codepoints, {len(weights)} static weights', flush=True)
        license_source = PROVENANCE.parent / record['license']
        (DESTINATION / record['license']).write_bytes(license_source.read_bytes())
        records.append({
            'id': name, 'family': family, 'codepoints': len(available),
            'source_url': record['source_url'], 'source_sha256': record['source_sha256'],
            'license': record['license'], 'shards': shards,
        })
    (DESTINATION / 'manifest.json').write_text(json.dumps({'version': 1, 'fonts': records}, indent=2) + '\n')
    for path in DESTINATION.glob('*.woff2'):
        if path.name not in written:
            path.unlink()


if __name__ == '__main__':
    main()
