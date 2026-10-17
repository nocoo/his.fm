import base64
import hashlib
import importlib.util
import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from fontTools import subset
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent
spec = importlib.util.spec_from_file_location("design_pages", ROOT / "build.py")
pages = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pages)
FONTS = ROOT / "assets/fonts"
SOURCES = REPO / ".local/design/fonts"
FONT_SOURCES = {
    "space-grotesk": ("spacegrotesk", "SpaceGrotesk%5Bwght%5D.ttf"),
    "syne": ("syne", "Syne%5Bwght%5D.ttf"),
    "instrument-serif": ("instrumentserif", "InstrumentSerif-Regular.ttf"),
    "instrument-serif-italic": ("instrumentserif", "InstrumentSerif-Italic.ttf"),
    "noto-sans-sc": ("notosanssc", "NotoSansSC%5Bwght%5D.ttf"),
    "noto-serif-sc": ("notoserifsc", "NotoSerifSC%5Bwght%5D.ttf"),
}
GLYPHSETS = {}
FONT_FILES = {}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare_fonts():
    FONTS.mkdir(parents=True, exist_ok=True)
    SOURCES.mkdir(parents=True, exist_ok=True)
    corpus = (ROOT / "build.py").read_text() + Path(__file__).read_text()
    corpus += (REPO / "episodes/001-how-to-live-better/transcript.md").read_text()
    corpus += ''.join(chr(i) for i in range(32, 256))
    records = []
    for name, (family, filename) in FONT_SOURCES.items():
        target = FONTS / f"{name}.woff2"
        source = SOURCES / f"{name}.ttf"
        url = f"https://raw.githubusercontent.com/google/fonts/main/ofl/{family}/{filename}"
        license_url = f"https://raw.githubusercontent.com/google/fonts/main/ofl/{family}/OFL.txt"
        if not source.exists():
            with urllib.request.urlopen(url, timeout=60) as response:
                source.write_bytes(response.read())
        license_source = SOURCES / f"{family}-OFL.txt"
        if not license_source.exists():
            with urllib.request.urlopen(license_url, timeout=60) as response:
                license_source.write_bytes(response.read())
        (FONTS / license_source.name).write_text('\n'.join(line.rstrip() for line in license_source.read_text().splitlines()) + '\n')
        if not target.exists() or name.startswith('noto-'):
            font = TTFont(source)
            if name.startswith('noto-'):
                options = subset.Options()
                options.layout_features = ['*']
                sub = subset.Subsetter(options=options)
                sub.populate(text=corpus)
                sub.subset(font)
            font.flavor = 'woff2'
            font.save(target)
        records.append({"font": name, "source_url": url, "source_sha256": sha(source), "license": license_source.name, "delivery": target.name, "sha256": sha(target), "subset": name.startswith('noto-')})
    (FONTS / "sources.json").write_text(json.dumps(records, indent=2) + '\n')


def font_data(name, weight=400):
    key = (name, weight)
    if key not in GLYPHSETS:
        font = TTFont(FONTS / f"{name}.woff2")
        FONT_FILES[name] = font
        locations = {"wght": weight} if "fvar" in font else None
        GLYPHSETS[key] = (font.getGlyphSet(location=locations), font.getBestCmap(), font['head'].unitsPerEm)
    return GLYPHSETS[key]


def text(value, x, y, size, color, font='noto-sans-sc', weight=500, max_width=None, tracking=0):
    glyphs, cmap, units = font_data(font, weight)
    names = [cmap.get(ord(c)) for c in value]
    if any(n is None for n in names):
        missing = ''.join(c for c, n in zip(value, names) if n is None)
        raise ValueError(f"Missing glyphs in {font}: {missing}")
    widths = [glyphs[n].width for n in names]
    scale = size / units
    width = sum(widths) * scale + max(0, len(value) - 1) * tracking
    if max_width and width > max_width:
        scale *= max_width / width
        tracking *= max_width / width
    cursor = x
    pen = SVGPathPen(glyphs)
    for name, width in zip(names, widths):
        glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, cursor, y)))
        cursor += width * scale + tracking
    return f'<path fill="{color}" d="{pen.getCommands()}"/>'


def glyph_wordmark(value, font_name, color, weight=400):
    glyphs, cmap, units = font_data(font_name, weight)
    pen = SVGPathPen(glyphs)
    bounds_pen = BoundsPen(glyphs)
    cursor = 0
    for character in value:
        name = cmap[ord(character)]
        transform = (1, 0, 0, 1, cursor, 0)
        glyphs[name].draw(TransformPen(pen, transform))
        glyphs[name].draw(TransformPen(bounds_pen, transform))
        cursor += glyphs[name].width - units * .028
    x0, y0, x1, y1 = bounds_pen.bounds
    scale = min(570 / (x1 - x0), 140 / (y1 - y0))
    tx = (600 - (x1 - x0) * scale) / 2 - x0 * scale
    ty = (170 - (y1 - y0) * scale) / 2 + y1 * scale
    return f'<path fill="{color}" transform="matrix({scale} 0 0 {-scale} {tx} {ty})" d="{pen.getCommands()}"/>'


def logo_markup(num, color):
    if num == '02':
        return f'''<g fill="none" stroke="{color}" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" transform="translate(20 16) scale(1.68 1.48)"><path d="M10 8V83M10 54C10 28 61 27 61 55V83M85 44V83M143 42C129 31 108 38 109 50C110 62 146 56 146 72C146 86 123 88 111 78M197 83V31C197 13 209 10 223 12M184 43H224M248 83V42M248 59C248 32 287 33 287 60V83M287 60C287 33 327 33 327 60V83"/><circle fill="{color}" stroke="none" cx="85" cy="15" r="7.5"/><circle fill="{color}" stroke="none" cx="170" cy="80" r="7.5"/></g>'''
    if num == '03':
        return glyph_wordmark('his.fm', 'instrument-serif', color)
    if num == '04':
        return glyph_wordmark('his.fm', 'syne', color, 800)
    if num == '05':
        return glyph_wordmark('his.fm', 'instrument-serif', color)
    if num == '06':
        return f'''<g fill="none" stroke="{color}" stroke-width="4.8" stroke-linecap="round" stroke-linejoin="round" transform="translate(24 16) scale(1.68 1.48)"><path d="M10 8V83M10 58C10 30 62 28 62 57V83M87 44V83M146 42C132 29 109 38 110 50C111 64 148 54 148 71C148 87 126 91 111 80M197 83V32C197 14 207 8 223 12M184 43H224M248 83V43M248 59C248 33 287 33 287 60V83M287 60C287 33 327 33 327 60V83"/><circle fill="{color}" stroke="none" cx="87" cy="18" r="3.7"/><circle fill="{color}" stroke="none" cx="170" cy="81" r="3.7"/></g>'''
    if num == '07':
        return glyph_wordmark('his.fm', 'space-grotesk', color, 500)
    if num == '08':
        return glyph_wordmark('his.fm', 'instrument-serif-italic', color)
    return glyph_wordmark('his.fm', 'space-grotesk', color, 700)


def symbol_markup(num, color):
    if num == '01':
        return f'<g fill="{color}"><rect x="13" y="48" width="12" height="32" rx="6"/><rect x="36" y="32" width="12" height="64" rx="6"/><rect x="58" y="16" width="12" height="96" rx="6"/><rect x="80" y="32" width="12" height="64" rx="6"/><rect x="103" y="48" width="12" height="32" rx="6"/></g>'
    if num == '02':
        return f'<g fill="none" stroke="{color}" stroke-width="17" stroke-linecap="round"><path d="M48 16C7 27 7 101 48 112M80 16C121 27 121 101 80 112"/></g>'
    if num == '03':
        return f'<path d="M19 99V49C19 15 61 15 61 49V83C61 113 106 113 106 79V27" fill="none" stroke="{color}" stroke-width="19" stroke-linecap="round"/>'
    if num == '05':
        return f'<g fill="none" stroke="{color}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 81V58C19 31 37 15 64 15C91 15 109 31 109 58V81M38 73L64 51L90 73M43 72V109H85V72"/></g><g fill="{color}"><rect x="11" y="66" width="17" height="35" rx="7"/><rect x="100" y="66" width="17" height="35" rx="7"/><rect x="59" y="85" width="10" height="16"/></g>'
    if num == '06':
        return f'<g fill="none" stroke="{color}" stroke-width="4.5" stroke-linecap="round"><path d="M18 84V60C18 32 37 14 64 14C91 14 110 32 110 60V84M34 88Q49 78 64 88T94 88M38 105Q51 96 64 105T90 105"/><rect x="12" y="61" width="17" height="36" rx="8"/><rect x="99" y="61" width="17" height="36" rx="8"/></g>'
    if num == '07':
        return f'<g fill="none" stroke="{color}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 79V44Q20 13 50 13H78Q108 13 108 44V79M38 111H90M43 79H85M48 80V110M80 80V110"/></g><g fill="{color}"><rect x="10" y="64" width="21" height="37" rx="8"/><rect x="97" y="64" width="21" height="37" rx="8"/></g>'
    if num == '08':
        return f'<g fill="none" stroke="{color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M24 79C17 48 30 16 64 16C98 16 111 48 104 79M64 70V113M64 105Q48 90 38 97M64 97Q78 82 91 89"/><path d="M63 71C39 73 27 60 36 45C52 38 67 49 63 71ZM65 71C89 73 101 60 92 45C76 38 61 49 65 71Z"/></g><g fill="{color}"><ellipse cx="23" cy="81" rx="9" ry="17" transform="rotate(-14 23 81)"/><ellipse cx="105" cy="81" rx="9" ry="17" transform="rotate(14 105 81)"/><circle cx="64" cy="73" r="5"/></g>'
    return f'<path fill="{color}" d="M16 13H43V55C58 34 92 35 101 61C105 71 105 84 105 113H77V74C77 56 43 61 43 81V113H16Z"/><path fill="{color}" d="M103 12H120V29H103Z"/>'


def place_logo(num, x, y, width, color):
    return f'<g transform="translate({x} {y}) scale({width / 600})">{logo_markup(num,color)}</g>'


def place_symbol(num, x, y, width, color):
    return f'<g transform="translate({x} {y}) scale({width / 128})">{symbol_markup(num,color)}</g>'


def svg(width, height, content):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-label="his.fm brand artwork">{content}</svg>\n'


def embedded_image(path, x, y, width, height, fit='xMidYMid slice'):
    data = base64.b64encode(path.read_bytes()).decode()
    return f'<image x="{x}" y="{y}" width="{width}" height="{height}" preserveAspectRatio="{fit}" href="data:image/webp;base64,{data}"/>'


def overlay_frame(brand):
    """Site/export overlay: brand frame and decoration only, no episode copy."""
    num = brand['id']
    if int(num) >= 5:
        return quiet_overlay_frame(brand)
    paper, ink, accent = [c for _, c in brand['palette'][:3]]
    if num == '02':
        content = f'<path d="M0 0H1024V1024H0ZM92 174V733H984V174Z" fill="{paper}" fill-rule="evenodd"/><rect width="64" height="1024" fill="{accent}"/>'
        content += place_logo(num, 91, 25, 398, ink) + place_symbol(num, 884, 57, 76, ink)
        content += f'<path d="M92 161H984M92 746H984" fill="none" stroke="{ink}" stroke-width="1.3"/><rect x="64" y="174" width="14" height="56" fill="#294ADF"/>'
    elif num == '03':
        content = f'<path d="M0 0H1024V1024H0ZM56 310C56 238 114 180 186 180H944Q968 180 968 204V638C968 724 894 790 808 790H80Q56 790 56 766Z" fill="{accent}" fill-rule="evenodd"/>'
        content += place_logo(num, 43, 15, 402, ink)
        content += f'<circle cx="906" cy="763" r="49" fill="{paper}"/>' + place_symbol(num, 869, 725, 75, ink)
    elif num == '04':
        content = f'<rect width="1024" height="203" fill="{accent}"/><rect x="0" y="0" width="30" height="1024" fill="{ink}"/><rect x="30" y="764" width="994" height="260" fill="{paper}"/><rect x="30" y="720" width="994" height="56" fill="#FA603A"/>'
        content += place_logo(num, 40, 14, 749, ink) + place_symbol(num, 867, 42, 112, ink)
        content += f'<path d="M16 224V687M5 230H27M5 681H27" stroke="{paper}" stroke-width="2" fill="none"/>'
    else:
        accent = '#D0F66D'
        content = '<defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#14291e" stop-opacity=".72"/><stop offset=".4" stop-color="#14291e" stop-opacity="0"/><stop offset=".58" stop-color="#14291e" stop-opacity="0"/><stop offset="1" stop-color="#14291e" stop-opacity=".94"/></linearGradient></defs><rect width="1024" height="1024" fill="url(#shade)"/>'
        content += f'<rect x="27" y="27" width="970" height="970" rx="38" stroke="{accent}" stroke-opacity=".45" stroke-width="1.5" fill="none"/>'
        content += place_symbol(num, 56, 58, 51, paper) + place_logo(num, 119, 40, 292, paper)
    return content


def quiet_overlay_frame(brand):
    num = brand['id']
    paper, ink, accent, secondary, _ = [c for _, c in brand['palette']]
    if num == '05':
        content = f'<defs><linearGradient id="forest-shade" x1="0" y1="0" x2="0" y2="1"><stop stop-color="{ink}" stop-opacity=".7"/><stop offset=".27" stop-color="{ink}" stop-opacity="0"/><stop offset=".55" stop-color="{ink}" stop-opacity="0"/><stop offset=".81" stop-color="{ink}" stop-opacity=".85"/><stop offset="1" stop-color="{ink}"/></linearGradient></defs><rect width="1024" height="1024" fill="url(#forest-shade)"/>'
        content += f'<rect x="31" y="31" width="962" height="962" fill="none" stroke="{paper}" stroke-opacity=".45" stroke-width="1.2"/>'
        content += place_logo(num, 59, 46, 319, paper) + place_symbol(num, 880, 53, 83, paper)
    elif num == '06':
        content = f'<path d="M0 0H1024V1024H0ZM36 190V730H988V190Z" fill="{paper}" fill-rule="evenodd"/>'
        content += place_logo(num, 43, 30, 365, ink) + place_symbol(num, 890, 55, 73, ink)
        content += f'<path d="M36 748H988M36 758H336M706 758H988" fill="none" stroke="{ink}" stroke-width="1" stroke-opacity=".6"/>'
    elif num == '07':
        content = f'<path d="M0 0H1024V1024H0ZM65 270Q65 181 154 181H882Q969 181 969 270V698Q969 754 913 754H121Q65 754 65 698Z" fill="{ink}" fill-rule="evenodd"/>'
        content += f'<rect x="0" y="0" width="28" height="1024" fill="{accent}"/><path d="M41 15V1010" stroke="{paper}" stroke-opacity=".5" stroke-dasharray="2 9"/><rect x="55" y="808" width="940" height="185" fill="{paper}"/>'
        content += place_logo(num, 61, 28, 389, paper) + place_symbol(num, 879, 42, 83, paper)
    else:
        content = f'<defs><linearGradient id="alpine-mist" x1="0" y1="0" x2="0" y2="1"><stop stop-color="{paper}" stop-opacity=".86"/><stop offset=".25" stop-color="{paper}" stop-opacity="0"/><stop offset=".6" stop-color="{paper}" stop-opacity="0"/><stop offset=".8" stop-color="{paper}" stop-opacity=".92"/><stop offset="1" stop-color="{paper}"/></linearGradient></defs><rect width="1024" height="1024" fill="url(#alpine-mist)"/>'
        content += f'<path d="M40 97V40H97M927 40H984V97M40 927V984H97M927 984H984V927" stroke="{ink}" stroke-opacity=".5" fill="none" stroke-width="1.2"/>'
        content += place_logo(num, 54, 41, 334, ink) + place_symbol(num, 882, 53, 80, ink)
        content += f'<path d="M62 790V945" stroke="{accent}" stroke-width="3"/><circle cx="62" cy="782" r="5" fill="{secondary}"/>'
    return content


def frame(brand, ep):
    num = brand['id']
    if int(num) >= 5:
        return quiet_frame(brand, ep)
    paper, ink, accent = [c for _, c in brand['palette'][:3]]
    title_a, title_b = ep['lines']
    if num == '02':
        content = f'<path d="M0 0H1024V1024H0ZM92 174V733H984V174Z" fill="{paper}" fill-rule="evenodd"/><rect width="64" height="1024" fill="{accent}"/>'
        content += place_logo(num,91,25,398,ink) + place_symbol(num,884,57,76,ink)
        content += text('OPEN INTERVAL',665,67,18,ink,font='space-grotesk',weight=500,tracking=1)
        content += text('中文播客 / HIS.FM',665,107,17,ink)
        content += f'<g transform="translate(40 700) rotate(-90)">{text("A LITTLE OPEN SPACE",0,0,19,ink,font="space-grotesk",weight=600,tracking=2)}</g>'
        content += text(ep['number'],14,986,20,ink,font='space-grotesk',weight=600)
        content += f'<path d="M92 161H984M92 746H984" fill="none" stroke="{ink}" stroke-width="1.3"/><rect x="64" y="174" width="14" height="56" fill="#294ADF"/>'
        content += text('EP.'+ep['number'],96,793,21,ink,font='space-grotesk',weight=600)
        content += text(ep['tag'],784,793,20,ink,max_width=190)
        content += text(title_a,92,880,65,ink,weight=650,max_width=856)
        content += text(title_b,92,960,65,ink,weight=650,max_width=856)
        content += text('给日常，留一道间隙。',95,1000,16,ink)
        content += text('HIS.FM / 2026',804,1000,15,ink,font='space-grotesk',max_width=155)
    elif num == '03':
        content = f'<path d="M0 0H1024V1024H0ZM56 310C56 238 114 180 186 180H944Q968 180 968 204V638C968 724 894 790 808 790H80Q56 790 56 766Z" fill="{accent}" fill-rule="evenodd"/>'
        content += place_logo(num,43,15,402,ink)
        content += text('SOFT LANDING',709,63,20,ink,font='space-grotesk',tracking=1)
        content += text('EP.'+ep['number']+' / '+ep['tag'],705,105,18,ink,max_width=260)
        content += text('生活有柔软的边。',709,142,16,ink)
        content += f'<circle cx="906" cy="763" r="49" fill="{paper}"/>' + place_symbol(num,869,725,75,ink)
        content += text(title_a,56,886,64,ink,font='noto-serif-sc',weight=550,max_width=913)
        content += text(title_b,56,970,66,ink,font='noto-serif-sc',weight=550,max_width=913)
        content += text('HIS.FM / 一段声音，一个落点。',58,1003,15,ink,max_width=480)
    elif num == '04':
        content = f'<rect width="1024" height="203" fill="{accent}"/><rect x="0" y="0" width="30" height="1024" fill="{ink}"/><rect x="30" y="764" width="994" height="260" fill="{paper}"/><rect x="30" y="720" width="994" height="56" fill="#FA603A"/>'
        content += place_logo(num,40,14,749,ink) + place_symbol(num,867,42,112,ink)
        content += text('HUMAN SAMPLE / 中文播客',62,187,16,ink,font='noto-sans-sc',max_width=620)
        content += text('EP.'+ep['number'],62,758,24,ink,font='space-grotesk',weight=700)
        content += text(ep['tag'],780,758,21,ink,max_width=204)
        content += text(title_a,62,871,66,ink,weight=850,max_width=898)
        content += text(title_b,62,955,67,ink,weight=850,max_width=898)
        content += text('声音里，有具体的生活。',66,1000,17,ink)
        content += text('HIS.FM',877,1000,17,ink,font='space-grotesk',weight=600,max_width=100)
        content += f'<path d="M16 224V687M5 230H27M5 681H27" stroke="{paper}" stroke-width="2" fill="none"/>'
    else:
        accent = '#D0F66D'
        content = '<defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#14291e" stop-opacity=".72"/><stop offset=".4" stop-color="#14291e" stop-opacity="0"/><stop offset=".58" stop-color="#14291e" stop-opacity="0"/><stop offset="1" stop-color="#14291e" stop-opacity=".94"/></linearGradient></defs><rect width="1024" height="1024" fill="url(#shade)"/>'
        content += f'<rect x="27" y="27" width="970" height="970" rx="38" stroke="{accent}" stroke-opacity=".45" stroke-width="1.5" fill="none"/>'
        content += place_symbol(num,56,58,51,paper) + place_logo(num,119,40,292,paper)
        content += text('EP.'+ep['number'],834,93,25,paper,font='space-grotesk',weight=600)
        content += text(ep['tag'],59,766,21,accent)
        content += text(title_a,53,859,67,paper,weight=600,max_width=918)
        content += text(title_b,53,946,70,paper,weight=600,max_width=918)
        content += text('一些声音，一点陪伴。',59,984,17,accent)
    return content


def quiet_frame(brand, ep):
    num = brand['id']
    paper, ink, accent, secondary, _ = [c for _, c in brand['palette']]
    title_a, title_b = ep['lines']
    if num == '05':
        content = f'<defs><linearGradient id="forest-shade" x1="0" y1="0" x2="0" y2="1"><stop stop-color="{ink}" stop-opacity=".7"/><stop offset=".27" stop-color="{ink}" stop-opacity="0"/><stop offset=".55" stop-color="{ink}" stop-opacity="0"/><stop offset=".81" stop-color="{ink}" stop-opacity=".85"/><stop offset="1" stop-color="{ink}"/></linearGradient></defs><rect width="1024" height="1024" fill="url(#forest-shade)"/>'
        content += f'<rect x="31" y="31" width="962" height="962" fill="none" stroke="{paper}" stroke-opacity=".45" stroke-width="1.2"/>'
        content += place_logo(num,59,46,319,paper) + place_symbol(num,880,53,83,paper)
        content += text('STILLWOOD / HIS.FM',66,164,16,paper,font='space-grotesk',tracking=2)
        content += f'<rect x="65" y="738" width="9" height="26" fill="{secondary}"/>'
        content += text('EP.'+ep['number']+' / '+ep['tag'],91,758,20,paper)
        content += text(title_a,61,857,66,paper,font='noto-serif-sc',weight=500,max_width=904)
        content += text(title_b,61,943,66,paper,font='noto-serif-sc',weight=500,max_width=904)
        content += text('窗外有风，屋里有一段声音。',65,979,16,paper)
        content += text('IN YOUR OWN TIME',758,979,14,paper,font='space-grotesk',max_width=210)
    elif num == '06':
        content = f'<path d="M0 0H1024V1024H0ZM36 190V730H988V190Z" fill="{paper}" fill-rule="evenodd"/>'
        content += place_logo(num,43,30,365,ink) + place_symbol(num,890,55,73,ink)
        content += text('TIDAL HOURS',614,76,18,ink,font='space-grotesk',tracking=2)
        content += text('A LITTLE TIME, YOUR OWN.',614,112,13,ink,font='space-grotesk',tracking=1,max_width=254)
        content += text('EP.'+ep['number'],46,170,18,ink,font='space-grotesk',tracking=1)
        content += text(ep['tag'],830,170,18,ink,max_width=147)
        content += f'<path d="M36 748H988M36 758H336M706 758H988" fill="none" stroke="{ink}" stroke-width="1" stroke-opacity=".6"/>'
        content += text(title_a,44,854,62,ink,weight=400,max_width=926)
        content += text(title_b,44,939,64,ink,weight=400,max_width=926)
        content += text('海面很宽，今天可以很小。',47,997,16,ink)
        content += text('HIS.FM / TIDAL HOURS',729,997,15,ink,font='space-grotesk',max_width=246)
    elif num == '07':
        content = f'<path d="M0 0H1024V1024H0ZM65 270Q65 181 154 181H882Q969 181 969 270V698Q969 754 913 754H121Q65 754 65 698Z" fill="{ink}" fill-rule="evenodd"/>'
        content += f'<rect x="0" y="0" width="28" height="1024" fill="{accent}"/><path d="M41 15V1010" stroke="{paper}" stroke-opacity=".5" stroke-dasharray="2 9"/><rect x="55" y="808" width="940" height="185" fill="{paper}"/>'
        content += place_logo(num,61,28,389,paper) + place_symbol(num,879,42,83,paper)
        content += text('WINDOW SEAT',592,79,19,paper,font='space-grotesk',tracking=1.3)
        content += text('A PLACE TO LISTEN.',592,118,15,accent,font='space-grotesk',tracking=1)
        content += text('HIS.FM / EP.'+ep['number'],71,163,17,paper,font='space-grotesk',tracking=1)
        content += text(ep['tag'],774,792,19,paper,max_width=180)
        content += text('列车向前，我先听完这一段。',72,792,17,accent,max_width=601)
        content += text(title_a,76,875,59,ink,weight=550,max_width=890)
        content += text(title_b,76,956,62,ink,weight=550,max_width=890)
        content += text('HIS.FM / WINDOW SEAT',75,1013,13,paper,font='space-grotesk',tracking=2)
    else:
        content = f'<defs><linearGradient id="alpine-mist" x1="0" y1="0" x2="0" y2="1"><stop stop-color="{paper}" stop-opacity=".86"/><stop offset=".25" stop-color="{paper}" stop-opacity="0"/><stop offset=".6" stop-color="{paper}" stop-opacity="0"/><stop offset=".8" stop-color="{paper}" stop-opacity=".92"/><stop offset="1" stop-color="{paper}"/></linearGradient></defs><rect width="1024" height="1024" fill="url(#alpine-mist)"/>'
        content += f'<path d="M40 97V40H97M927 40H984V97M40 927V984H97M927 984H984V927" stroke="{ink}" stroke-opacity=".5" fill="none" stroke-width="1.2"/>'
        content += place_logo(num,54,41,334,ink) + place_symbol(num,882,53,80,ink)
        content += text('ALPINE BLOOM',62,169,17,ink,font='space-grotesk',tracking=2.5)
        content += text('FIELD NOTES IN SOUND',623,92,15,ink,font='space-grotesk',tracking=1,max_width=244)
        content += text('EP.'+ep['number']+' / '+ep['tag'],62,758,19,ink)
        content += f'<path d="M62 790V945" stroke="{accent}" stroke-width="3"/><circle cx="62" cy="782" r="5" fill="{secondary}"/>'
        content += text(title_a,83,850,62,ink,font='noto-serif-sc',weight=500,max_width=873)
        content += text(title_b,83,933,64,ink,font='noto-serif-sc',weight=500,max_width=873)
        content += text('世界自有速度。花有花期。',65,978,16,ink)
        content += text('IN ITS OWN TIME',782,978,14,ink,font='space-grotesk',max_width=181)
    return content


def banner(brand, hero_path):
    num=brand['id']
    if int(num) >= 5:
        return quiet_application(brand, hero_path, 'banner')
    paper,ink,accent=[c for _,c in brand['palette'][:3]]
    if num=='01':
        content=embedded_image(hero_path,0,0,1920,640)
        content+='<rect width="1920" height="640" fill="#122f26" opacity=".25"/>'
        content+=place_logo(num,70,45,650,paper)
        content+=text('世界很快。',74,391,89,paper,weight=600)+text('你可以，慢慢来。',74,507,89,'#D0F66D',weight=600)
        content+=place_symbol(num,1650,80,170,'#D0F66D')
        content+=text('一档给开发者的中文播客',81,591,22,paper)
    elif num=='02':
        content=f'<rect width="1920" height="640" fill="{accent}"/>'+embedded_image(hero_path,840,0,1080,640)
        content+=place_logo(num,52,32,735,ink)
        content+=text('今天就到这里。',65,426,89,ink,weight=700,max_width=730)
        content+=text('工作，睡眠，和屏幕外的小事。',71,496,27,ink)
        content+=text('HIS.FM / OPEN INTERVAL',71,590,23,ink,font='space-grotesk',weight=500,tracking=2)
        content+=place_symbol(num,1740,41,123,ink)
    elif num=='03':
        content=embedded_image(hero_path,0,0,1920,640)
        content+=place_logo(num,41,25,663,ink)
        content+=text('给今天，一个落点。',73,410,81,ink,font='noto-serif-sc',weight=500,max_width=806)
        content+=text('声音里，有具体的生活。',77,493,25,ink)
        content+=text('SOFT LANDING / HIS.FM',78,584,22,ink,font='space-grotesk',tracking=2)
        content+=place_symbol(num,1710,45,142,ink)
    else:
        content=f'<rect width="1920" height="640" fill="{accent}"/>'+embedded_image(hero_path,910,0,1010,640)
        content+=place_logo(num,33,12,788,ink)
        content+=text('人间，正在发生。',58,404,94,ink,weight=850,max_width=817)
        content+=text('关掉窗口。开一扇窗。',63,486,29,ink)
        content+='<rect x="0" y="556" width="910" height="84" fill="#FA603A"/>'
        content+=text('HUMAN SAMPLE / 独立中文播客',63,607,22,ink,max_width=785)
        content+=place_symbol(num,1735,43,125,ink)
    return svg(1920,640,content)


def poster(brand, hero_path):
    num=brand['id']
    if int(num) >= 5:
        return quiet_application(brand, hero_path, 'poster')
    paper,ink,accent=[c for _,c in brand['palette'][:3]]
    if num=='01':
        content=embedded_image(hero_path,0,0,1080,1440)
        content+='<rect width="1080" height="1440" fill="#0e281b" opacity=".35"/>'
        content+=place_logo(num,65,81,852,paper)
        content+=text('世界很快。',68,928,106,paper,weight=600)+text('你可以，',68,1065,106,paper,weight=600)+text('慢慢来。',68,1202,106,'#D0F66D',weight=600)
        content+=place_symbol(num,847,1190,126,'#D0F66D')
        content+=text('HIS.FM / 一些声音，一点陪伴。',72,1362,23,paper,max_width=870)
    elif num=='02':
        content=f'<rect width="1080" height="1440" fill="{accent}"/>'+embedded_image(hero_path,74,410,1006,660)
        content+=place_logo(num,52,49,866,ink)
        content+=text('OPEN INTERVAL',76,340,30,ink,font='space-grotesk',tracking=3)
        content+=text('今天就',67,1205,98,ink,weight=700)+text('到这里。',67,1322,98,ink,weight=700)
        content+=place_symbol(num,860,1180,126,ink)
        content+=text('给日常，留一道间隙。 / HIS.FM',78,1388,20,ink)
    elif num=='03':
        content=f'<rect width="1080" height="1440" fill="{accent}"/>'
        content+='<defs><clipPath id="window"><path d="M54 608C54 491 149 396 266 396H1000Q1026 396 1026 422V990C1026 1098 938 1186 830 1186H80Q54 1186 54 1160Z"/></clipPath></defs>'
        content+=f'<g clip-path="url(#window)">{embedded_image(hero_path,54,396,972,790)}</g>'
        content+=place_logo(num,42,58,816,ink)
        content+=text('SOFT LANDING',70,343,29,ink,font='space-grotesk',tracking=3)
        content+=text('给今天，一个落点。',58,1299,87,ink,font='noto-serif-sc',weight=500,max_width=960)
        content+=text('生活有柔软的边。 / HIS.FM',68,1382,22,ink)
        content+=place_symbol(num,895,243,113,ink)
    else:
        content=f'<rect width="1080" height="1440" fill="{accent}"/>'+embedded_image(hero_path,31,352,1049,762)
        content+=place_logo(num,38,42,963,ink)
        content+=text('HUMAN SAMPLE / 独立中文播客',65,310,25,ink,max_width=940)
        content+='<rect x="0" y="1076" width="1080" height="364" fill="#FA603A"/>'
        content+=text('人间，',59,1213,113,ink,weight=850)+text('正在发生。',59,1347,113,ink,weight=850,max_width=950)
        content+=text('关掉窗口。开一扇窗。 / HIS.FM',67,1407,22,ink)
        content+=place_symbol(num,873,1124,118,ink)
        content+=f'<rect width="24" height="1440" fill="{ink}"/>'
    return svg(1080,1440,content)


def quiet_application(brand, hero_path, kind):
    num = brand['id']
    paper, ink, accent, secondary, _ = [c for _, c in brand['palette']]
    lines = {
        '05': ('山里起雾了。', '先坐一会儿。'),
        '06': ('潮水有潮水的时间。', '我有我的。'),
        '07': ('窗外很快。', '这一段，慢慢听。'),
        '08': ('山很远。', '花开在眼前。'),
    }[num]
    serif = num in ('05', '08')
    font = 'noto-serif-sc' if serif else 'noto-sans-sc'
    if kind == 'banner':
        if num == '07':
            content = f'<rect width="1920" height="640" fill="{ink}"/><defs><clipPath id="train-window"><rect x="833" y="30" width="1057" height="580" rx="70"/></clipPath></defs>'
            content += f'<g clip-path="url(#train-window)">{embedded_image(hero_path,833,30,1057,580,fit="xMaxYMid slice")}</g>'
            content += place_logo(num,58,48,592,paper) + place_symbol(num,697,57,83,paper)
            content += text(lines[0],73,352,75,paper,weight=500,max_width=699)
            content += text(lines[1],73,461,73,paper,weight=500,max_width=699)
            content += f'<rect x="30" y="546" width="761" height="64" fill="{accent}"/>'
            content += text('HIS.FM / WINDOW SEAT',73,587,22,ink,font='space-grotesk',tracking=2)
            content += text('中文播客',636,587,21,ink)
        else:
            color = paper if num=='05' else ink
            content = embedded_image(hero_path,0,0,1920,640)
            if num == '05':
                content += f'<defs><linearGradient id="shade"><stop stop-color="{ink}" stop-opacity=".76"/><stop offset=".7" stop-color="{ink}" stop-opacity="0"/></linearGradient></defs><rect width="1920" height="640" fill="url(#shade)"/>'
                content += f'<rect x="29" y="29" width="1862" height="582" stroke="{paper}" stroke-width="1" stroke-opacity=".4" fill="none"/>'
            elif num == '08':
                content += f'<defs><linearGradient id="shade"><stop stop-color="{paper}" stop-opacity=".8"/><stop offset=".7" stop-color="{paper}" stop-opacity="0"/></linearGradient></defs><rect width="1920" height="640" fill="url(#shade)"/>'
            content += place_logo(num,57,39,484,color)
            content += place_symbol(num,1742,65,91,color)
            content += text(lines[0],79,375,74,color,font=font,weight=500,max_width=893)
            content += text(lines[1],79,485,78,color,font=font,weight=500,max_width=893)
            content += text('HIS.FM / '+brand['en'],83,591,21,color,font='space-grotesk',tracking=2)
            content += text('一档给开发者的中文播客',1484,591,19,color,max_width=345)
            if num == '06':
                content += f'<path d="M80 543H1834M80 553H560M1460 553H1834" stroke="{ink}" stroke-opacity=".45" stroke-width="1" fill="none"/>'
        return svg(1920,640,content)
    if num == '06':
        content = f'<rect width="1080" height="1440" fill="{paper}"/>'
        content += embedded_image(hero_path,35,350,1010,687)
        content += place_logo(num,50,59,756,ink) + place_symbol(num,904,102,89,ink)
        content += text('TIDAL HOURS / A LITTLE TIME, YOUR OWN.',61,307,23,ink,font='space-grotesk',tracking=1,max_width=961)
        content += f'<path d="M35 1060H1045M35 1070H366M748 1070H1045" fill="none" stroke="{ink}" stroke-width="1"/>'
        content += text(lines[0],52,1180,76,ink,weight=400,max_width=968)
        content += text(lines[1],52,1291,86,ink,weight=400,max_width=968)
        content += text('海面很宽，今天可以很小。 / HIS.FM',57,1395,22,ink)
    elif num == '07':
        content = f'<rect width="1080" height="1440" fill="{ink}"/><rect width="24" height="1440" fill="{accent}"/>'
        content += '<defs><clipPath id="train-window"><rect x="60" y="362" width="979" height="715" rx="99"/></clipPath></defs>'
        content += f'<g clip-path="url(#train-window)">{embedded_image(hero_path,60,362,979,715,fit="xMaxYMid slice")}</g>'
        content += place_logo(num,49,61,797,paper) + place_symbol(num,896,100,94,paper)
        content += text('HIS.FM / WINDOW SEAT',65,322,25,paper,font='space-grotesk',tracking=2)
        content += f'<rect x="56" y="1126" width="987" height="240" fill="{paper}"/>'
        content += text(lines[0],76,1220,80,ink,weight=500,max_width=942)
        content += text(lines[1],76,1325,82,ink,weight=500,max_width=942)
        content += text('列车向前，我先听完这一段。 / HIS.FM',67,1410,21,paper)
    else:
        color = paper if num=='05' else ink
        shade = ink if num=='05' else paper
        content = embedded_image(hero_path,0,0,1080,1440,fit='xMaxYMid slice')
        content += f'<defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop stop-color="{shade}" stop-opacity=".6"/><stop offset=".28" stop-color="{shade}" stop-opacity="0"/><stop offset=".64" stop-color="{shade}" stop-opacity="0"/><stop offset=".85" stop-color="{shade}" stop-opacity=".94"/><stop offset="1" stop-color="{shade}"/></linearGradient></defs><rect width="1080" height="1440" fill="url(#shade)"/>'
        content += f'<rect x="30" y="30" width="1020" height="1380" fill="none" stroke="{color}" stroke-width="1.1" stroke-opacity=".5"/>'
        content += place_logo(num,45,51,828,color) + place_symbol(num,901,292,92,color)
        content += text(brand['en']+' / HIS.FM',66,342,24,color,font='space-grotesk',tracking=2)
        content += text(lines[0],64,1149,93,color,font=font,weight=500,max_width=945)
        content += text(lines[1],64,1272,94,color,font=font,weight=500,max_width=945)
        content += text(brand['line'],68,1372,22,color,max_width=925)
    return svg(1080,1440,content)


def make_brand(brand):
    num=brand['id']
    directory=ROOT/'assets'/num
    directory.mkdir(parents=True,exist_ok=True)
    paper,ink,accent=[c for _,c in brand['palette'][:3]]
    for suffix,color in [('',ink),('-light',paper)]:
        (directory/f'logo{suffix}.svg').write_text(svg(600,170,logo_markup(num,color)))
        (directory/f'symbol{suffix}.svg').write_text(svg(128,128,symbol_markup(num,color)))
    avatar_content=f'<rect width="1024" height="1024" fill="{accent if num!="01" else ink}"/>'
    avatar_content+=place_symbol(num,253,187,518,ink if num!='01' else '#D0F66D')
    avatar_content+=place_logo(num,267,766,490,ink if num!='01' else paper)
    (directory/'avatar.svg').write_text(svg(1024,1024,avatar_content))
    art_root=REPO/'artwork/design-20260926'
    source_hero=REPO/'apps/web/public/images/hero-retina-20260926-1752.webp' if num=='01' else art_root/'originals'/f'{num}-hero.png'
    hero_path=directory/'hero.webp'
    with Image.open(source_hero) as original:
        image=original.convert('RGB')
        image.thumbnail((1752,1168),Image.Resampling.LANCZOS)
        image.save(hero_path,'WEBP',quality=90,method=6)
    records=[]
    for ep in pages.EPISODES:
        episode_number=ep['cover']
        source=REPO/'artwork/originals'/f'episode-{episode_number}.png' if num=='01' else art_root/'originals'/f'{num}-{episode_number}.png'
        target=directory/f'art-{episode_number}.webp'
        with Image.open(source) as original:
            image=original.convert('RGB')
            image.thumbnail((1024,1024),Image.Resampling.LANCZOS)
            image.save(target,'WEBP',quality=91,method=6)
        frame_content=frame(brand,ep)
        (directory/f'frame-{episode_number}.svg').write_text(svg(1024,1024,frame_content))
        composite=embedded_image(target,0,0,1024,1024)+frame_content
        (directory/f'cover-{episode_number}.svg').write_text(svg(1024,1024,composite))
        records.append({"id":ep['number'],"title":ep['title'],"source":str(source.relative_to(REPO)),"source_sha256":sha(source),"subject":target.name,"subject_sha256":sha(target),"foreground":f'frame-{episode_number}.svg',"composite":f'cover-{episode_number}.svg',"dimensions":[1024,1024]})
    (directory/'banner.svg').write_text(banner(brand,hero_path))
    (directory/'poster.svg').write_text(poster(brand,hero_path))
    manifest={"direction":brand['name'],"number":num,"status":"proposal; not adopted", "source_mode":"existing assets with proposed cover extensions" if num=='01' else "GPT Image 2.5 Sunburst subjects with independent vector identity", "hero":{"source":str(source_hero.relative_to(REPO)),"source_sha256":sha(source_hero),"delivery":'hero.webp',"delivery_sha256":sha(hero_path)}, "covers":records,"typography":"All SVG lettering is outlined; no font dependency inside graphics.","raster_exports":"Cover/frame 1024x1024; banner 1920x640; poster 1080x1440; avatar 1024x1024. Layout exports are composited derivatives, not claims of native generation resolution."}
    (directory/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    print(f'已制作 {num} {brand["name"]} 的字标、双层封面、横幅与海报。',flush=True)


if __name__=='__main__':
    prepare_fonts()
    for brand in pages.BRANDS:
        if len(sys.argv)==1 or brand['id'] in sys.argv[1:]:
            make_brand(brand)
