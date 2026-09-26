import html
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent
BRANDS = [
    {
        "id": "01", "slug": "01-current", "name": "林间电台", "en": "THE GROVE", "label": "当前设计",
        "lead": "树荫之下，<br>世界慢一点。", "line": "世界很快。你可以，慢慢来。",
        "description": "收录现站的森林主视觉、草绿字标与温和圆角。把已经熟悉的 his.fm 放在这里，作为三套新提案的比较起点。",
        "palette": [("Paper", "#F3F3EC"), ("Forest", "#213E2D"), ("Grass", "#759C45"), ("Lime", "#D0F66D"), ("Lilac", "#DFD8F0")],
        "concept": "一段树荫，一点陪伴。", "logic": "柔和圆角、深林绿与大幅环境图像构成现站语气。五段声波是小尺寸识别，青草色圆点连接 his 与 fm。",
        "frame": "原有方形图像与 EP 编号卡片完整保留。此处补充展示同一视觉语言下的可复用标题层；这部分是设计整理，尚未应用到现站。",
        "type": "Existing grotesk / 系统黑体", "type_note": "保留现站的粗黑字标、中文无衬线与轻量英文标注。",
        "keywords": ["森林光线", "温和圆角", "青草绿", "环境叙事"],
        "hero": "current/hero-retina-20260926-1752.webp",
    },
    {
        "id": "02", "slug": "02-interval", "name": "间隙", "en": "OPEN INTERVAL", "label": "编辑实验",
        "lead": "今天就<br>到这里。", "line": "给日常，留一道间隙。",
        "description": "把暂停写成一对打开的括号。酸青绿、近黑色、极大的字与极细的线；真实皮肤与日常物件，出现在精确的秩序里。",
        "palette": [("Paper", "#F5F4EE"), ("Ink", "#1C211A"), ("Acid grass", "#D6F25B"), ("Cobalt", "#294ADF"), ("Concrete", "#D6D8CE")],
        "concept": "有张力，也有空隙。", "logic": "原创圆端字标保留连续的呼吸节奏，开口括号作为独立符号。版面用偏置的图像、整条酸青绿书脊和留白建立辨识度。",
        "frame": "固定 40 px 外沿与 64 px 左书脊。字标落在上端，中文标题进入底部纸白区；右上括号始终保留。照片只负责触感，信息始终清晰。",
        "type": "Custom rounded / Space Grotesk", "type_note": "字标独立绘制；Space Grotesk 负责拉丁字与索引，中文用思源黑体。大字紧、正文松。",
        "keywords": ["开口括号", "偏置网格", "直闪静物", "酸青书脊"],
        "hero": "02/hero.webp",
    },
    {
        "id": "03", "slug": "03-soft-landing", "name": "软着陆", "en": "SOFT LANDING", "label": "感官雕塑",
        "lead": "给今天，<br>一个落点。", "line": "生活有柔软的边。",
        "description": "让玻璃承接棉麻，让重量轻轻落地。淡紫、青草与奶油黄铺开；衬线字标、柔软回环和不对称的圆弧，共同留下触觉。",
        "palette": [("Butter", "#F5EDCF"), ("Aubergine", "#423048"), ("Lilac", "#D8C8EA"), ("Glass green", "#A7C96A"), ("Ivory", "#FFFBF1")],
        "concept": "一种接得住重量的轻。", "logic": "细腻的衬线字标与粗圆回环形成尺度反差。每张图都是可触摸的日常物件，不用漂浮的装饰堆叠，也不依赖复杂的数字界面。",
        "frame": "淡紫色外层固定，中央开出不对称圆弧窗口。品牌在上，标题在下，回环跨在窗口边缘；图像可以更换，柔软轮廓不变。",
        "type": "Instrument Serif / Noto Serif SC", "type_note": "英文保留 Instrument Serif 的细长曲线；中文标题用思源宋体，正文用黑体，形成轻而清晰的层次。",
        "keywords": ["柔性回环", "圆弧窗口", "玻璃与棉麻", "淡紫与青草"],
        "hero": "03/hero.webp",
    },
    {
        "id": "04", "slug": "04-human-sample", "name": "人间采样", "en": "HUMAN SAMPLE", "label": "独立刊物",
        "lead": "人间，<br>正在发生。", "line": "关掉窗口。开一扇窗。",
        "description": "把声音做成一张有体温的独立刊物。青草绿与柿子橙直接碰撞，黑白人物进入专色印刷；粗重刊头、切口与套色偏移形成鲜明节奏。",
        "palette": [("Newsprint", "#F2F0E6"), ("Carbon", "#20241E"), ("Grass ink", "#BCEF52"), ("Persimmon", "#FA603A"), ("Blush", "#EDC9D9")],
        "concept": "生活的颗粒，留在声音里。", "logic": "宽体字标与切口 h 构成刊头。网点、专色色块、被截断的圆和不等宽栏位提供节奏；人物保留皮肤与衣物的细节。",
        "frame": "上端是整幅青草色刊头，下端是橙色期号条与纸白标题。纵向装订线贯穿三张封面；图像再强烈，也有稳定的阅读入口。",
        "type": "Syne ExtraBold / Noto Sans SC", "type_note": "Syne 的宽体轮廓负责刊头，中文黑体保持厚度；索引使用等宽排版，只呈现真实期号与内容信息。",
        "keywords": ["专色套印", "宽体刊头", "人物切片", "独立刊物"],
        "hero": "04/hero.webp",
    },
    {
        "id": "05", "slug": "05-stillwood", "name": "雾林来信", "en": "STILLWOOD", "label": "山间木屋",
        "lead": "山里起雾了。<br>先坐一会儿。", "line": "窗外有风，屋里有一段声音。",
        "description": "深杉绿、潮湿木纹与一扇暖窗。把耳机的弧线藏进小屋的轮廓，像一封从林间寄来的信；天气照常经过，屋里保留自己的时间。",
        "palette": [("Flax", "#ECEBE1"), ("Pine", "#263C35"), ("Moss", "#A6AF94"), ("Window light", "#C69D65"), ("Fog", "#D4DAD2")],
        "concept": "把一扇窗，留在声音里。", "logic": "衬线字标保留木版书页的温度。独立符号用一个耳机拱顶接住小屋的斜屋面；开口、留白与一小块灯光构成识别。",
        "frame": "全幅环境图上保留一圈亚麻白细线，左上是小字标，右上是耳机小屋。底部松针色渐层托起宋体标题；暖窗色只出现一次，像一盏灯。",
        "type": "Instrument Serif / Noto Serif SC", "type_note": "英文用轻盈的衬线，中文用中等字重宋体。拉开行距，保留木屋里翻一页书的速度。",
        "keywords": ["耳机小屋", "雾中杉林", "亚麻细框", "一扇暖窗"],
        "hero": "05/hero.webp",
    },
    {
        "id": "06", "slug": "06-tidal-hours", "name": "岛屿时间", "en": "TIDAL HOURS", "label": "海上留白",
        "lead": "潮水有潮水的时间。<br>我有我的。", "line": "海面很宽，今天可以很小。",
        "description": "一座小岛，四周都是慢慢变淡的海。瓷白、潮蓝与砂色铺开大面积留白；细线耳机与水波相连，信息像岸边的潮痕，轻轻留在边上。",
        "palette": [("Porcelain", "#EFF1EB"), ("Deep tide", "#344C57"), ("Sea glass", "#B3C5C5"), ("Sand", "#D9C9AA"), ("Horizon", "#D7E0DF")],
        "concept": "时间不必只有一种刻度。", "logic": "定制细线字标像海面上的一条水平线。耳机拱线之下落入两道潮纹，耳罩同时也是岛屿的岸；空白和细线拥有同样的重量。",
        "frame": "瓷白窄边围住灰蓝主体图，标题落在干净的下缘。横向潮线贯穿三张封面，期号靠边，字标呼吸充分；画面很淡，标题仍然清楚。",
        "type": "Custom monoline / Space Grotesk", "type_note": "细线几何字标单独绘制。拉丁索引稍放宽字距，中文轻黑体保持朴素，正文不追求低对比。",
        "keywords": ["潮线耳机", "雾中孤岛", "瓷白留白", "水平节奏"],
        "hero": "06/hero.webp",
    },
    {
        "id": "07", "slug": "07-window-seat", "name": "靠窗的位置", "en": "WINDOW SEAT", "label": "通勤静处",
        "lead": "窗外很快。<br>这一段，慢慢听。", "line": "列车向前，我先听完这一段。",
        "description": "车窗外的城市横向掠过，车厢里的人保持清晰。石墨蓝、织物灰与暗琥珀像一张留下来的车票；圆角车窗和耳机弧线合成一处安静的角落。",
        "palette": [("Seat linen", "#E9E7DF"), ("Carriage", "#293940"), ("Dull amber", "#CEB581"), ("Window grey", "#AEBBBE"), ("Evening", "#657778")],
        "concept": "城市在动，耳边有个位置。", "logic": "一枚由耳机与车窗组成的方形符号，配合窄边票据式字标。时间只作为排版的节奏，不出现虚构时长、班次或进度。",
        "frame": "石墨色圆角窗框围住照片，亚麻白标题区在下方。侧边琥珀票根与微细孔线固定不动，照片里的城市可以流动；阅读顺序始终明确。",
        "type": "Space Grotesk / Noto Sans SC", "type_note": "中等字重黑体像车窗上的标识，数字用等宽节奏。缩小装饰，把位置留给人和一段可读的文字。",
        "keywords": ["车窗耳机", "内静外动", "织物与雨", "琥珀票根"],
        "hero": "07/hero.webp",
    },
    {
        "id": "08", "slug": "08-alpine-bloom", "name": "雪线花期", "en": "ALPINE BLOOM", "label": "高原微光",
        "lead": "山很远。<br>花开在眼前。", "line": "世界自有速度。花有花期。",
        "description": "群山退进雾里，一朵高原蓝花在近处静静展开。冰川白、鼠尾草与褪色花蓝构成低可视度景深；纤细花瓣接住耳机轮廓，让微小的生活拥有自己的尺度。",
        "palette": [("Glacial ivory", "#F0F1E9"), ("Slate", "#404F50"), ("Petal blue", "#B8C8D9"), ("Alpine sage", "#AFBCAC"), ("Pollen", "#D9C58D")],
        "concept": "山谷很大，一朵花也有位置。", "logic": "斜体字标像风吹过的细茎。花瓣形耳罩与一条耳机拱线组成花朵符号；不把花开讲成胜利，只把近处看得更仔细。",
        "frame": "薄雾色渐层承托标题，花蓝细线在四角轻轻停住。字标上移，花朵留在中央；三期分别是合拢、轻摆、展开，沿用同一组版式。",
        "type": "Instrument Serif Italic / Noto Serif SC", "type_note": "斜体英文与细宋体中文像一页植物随记。使用足够深的岩灰文字，柔和只留给画面。",
        "keywords": ["花瓣耳机", "雪山与蓝花", "薄雾景深", "植物随记"],
        "hero": "08/hero.webp",
    },
]

EPISODES = [
    {"number": "001", "title": "下班后，还要追多少个 AI？", "lines": ["下班后，", "还要追多少个 AI？"], "category": "work", "tag": "工作与睡眠", "status": "已有文稿", "summary": "十一点半，收藏夹又多了一条教程。聊聊睡眠、消息与那个总觉得自己还不够努力的晚上。", "cover": "01"},
    {"number": "002", "title": "散个步，不必顺便成为更好的自己", "lines": ["散个步，", "不必顺便变好。"], "category": "life", "tag": "走一段路", "status": "概念选题", "summary": "路线不用记录，耳机可以摘掉。去看看路边的树，是不是已经换了一点颜色。", "cover": "02"},
    {"number": "003", "title": "下一条 Prompt 之前，先好好吃饭", "lines": ["下一条 Prompt 之前，", "先好好吃饭。"], "category": "life", "tag": "屏幕之外", "status": "概念选题", "summary": "电脑合上了，脑子还在继续运行。关于一顿不看屏幕的晚饭，和今天结束工作的那个动作。", "cover": "03"},
]


def write(path, text):
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text.strip() + "\n")


def asset(brand, name, prefix="../assets/"):
    return f'{prefix}{brand["id"]}/{name}'


def logo(brand, prefix="../assets/", variant="logo", cls="brand-logo"):
    return f'<img class="{cls}" src="{asset(brand, variant + ".svg", prefix)}" alt="his.fm" width="600" height="170">'


def cover(brand, ep, prefix="../assets/", mode="complete"):
    num = ep["cover"]
    return f'<div class="cover-composition" data-layer="{mode}"><img class="cover-art" src="{asset(brand, "art-" + num + ".webp", prefix)}" alt="{html.escape(ep["title"])}的主体图" width="1024" height="1024" loading="lazy"><img class="cover-frame" src="{asset(brand, "frame-" + num + ".svg", prefix)}" alt="his.fm 品牌字标、期号与标题独立图层" width="1024" height="1024" loading="lazy"></div>'


def document(title, body, depth=1, cls="", css="study.css", script="study.js", favicon="02/symbol.svg"):
    up = "../" * depth
    return f'''<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><meta name="description" content="his.fm 品牌视觉设计提案。Logo、视觉系统、网站、双层节目封面与品牌应用。"><title>{title}</title><link rel="icon" href="{up}assets/{favicon}" type="image/svg+xml"><link rel="stylesheet" href="{up}fonts.css"><link rel="stylesheet" href="{up}{css}"><link rel="stylesheet" href="{up}quiet.css"></head><body class="{cls}"><a class="skip-link" href="#main">跳到正文</a>{body}<script src="{up}{script}" defer></script></body></html>'''


def study_nav(brand):
    group = BRANDS[:4] if int(brand['id']) <= 4 else BRANDS[4:]
    links = ''.join(f'<a href="../{b["slug"]}/index.html" {"aria-current=page" if b==brand else ""}><b>{b["id"]}</b><span>{b["name"]}</span></a>' for b in group)
    return f'<header class="study-nav"><a class="nav-home" href="../index.html">his.fm <span>DESIGN STUDIES</span></a><nav aria-label="设计方案">{links}</nav><a class="nav-view" href="site/index.html">进入网站 ↗</a></header>'


def chapter(number, label, title, copy=""):
    return f'<div class="chapter-head"><div><p class="eyebrow">{number} / {label}</p><h2>{title}</h2></div>{f"<p class=chapter-copy>{copy}</p>" if copy else ""}</div>'


def study_hero(brand):
    num = brand['id']
    return f'''<section class="case-hero hero-{num}">
    <div class="case-topline"><span>{num} / {brand['label']}</span><span>HIS.FM — BRAND IDENTITY / 2026</span><a href="#covers">封面先行 ↓</a></div>
    <div class="case-wordmark">{logo(brand,variant='logo-light' if num in ('01','05','07') else 'logo')}</div>
    <div class="case-image"><img src="../assets/{brand['hero']}" alt="{brand['name']}主视觉" width="1536" height="1024" fetchpriority="high"></div>
    <div class="case-statement"><span class="eyebrow">{brand['en']}</span><h1>{brand['lead']}</h1><p>{brand['line']}</p></div>
    <img class="case-symbol" src="{asset(brand,'symbol-light.svg' if num in ('01','05','07') else 'symbol.svg')}" alt="" width="128" height="128">
    <div class="case-bottomline"><span>一档给开发者的中文播客</span><span>声音里，有具体的生活。</span><span>SCROLL TO EXPLORE ↓</span></div>
    </section>'''


def make_study(brand):
    num = brand['id']
    swatches = ''.join(f'<button class="swatch" type="button" data-copy="{color}" aria-label="复制 {name} 色值 {color}" style="--swatch:{color}"><span class="swatch-color"></span><span>{name}<b>{color}</b></span></button>' for name, color in brand['palette'])
    chips = ''.join(f'<span>{item}</span>' for item in brand['keywords'])
    cards = ''.join(f'''<article class="cover-study-card">{cover(brand,ep)}<div class="cover-caption"><span>EP.{ep['number']}</span><h3>{ep['title']}</h3><p>{ep['status']} · {ep['tag']}</p></div><div class="download-row"><a download href="{asset(brand,'cover-'+ep['cover']+'.png')}">成品 PNG ↓</a><a download href="{asset(brand,'frame-'+ep['cover']+'.svg')}">Cover SVG ↓</a><a download href="{asset(brand,'frame-'+ep['cover']+'.png')}">透明 PNG ↓</a></div></article>''' for ep in EPISODES)
    next_brand = BRANDS[int(num) % len(BRANDS)]
    original_link = '../../../artwork/originals/episode-01.png' if num=='01' else f'../../../artwork/design-20260926/originals/{num}-01.png'
    extra = '<span class="annotation">基于现站资产整理的封面延展 · 未应用于线上</span>' if num == '01' else ''
    body = study_nav(brand) + '<main id="main">' + study_hero(brand) + f'''
    <section class="case-intro section-wrap"><span class="case-number">{num}</span><div><p class="eyebrow">{brand['en']}</p><h2>{brand['name']}<span> / {brand['label']}</span></h2></div><div><p class="intro-description">{brand['description']}</p><div class="keywords">{chips}</div></div></section>
    <nav class="chapter-nav section-wrap" aria-label="提案章节"><a href="#identity">01 品牌识别</a><a href="#covers">02 节目封面</a><a href="#website">03 公开网站</a><a href="#applications">04 品牌应用</a><a href="#files">05 交付文件</a></nav>
    <section class="identity-section section-wrap" id="identity">{chapter('01','VISUAL LANGUAGE',brand['concept'],brand['logic'])}
      <div class="identity-board"><div class="logo-primary"><span class="board-label">PRIMARY WORDMARK</span>{logo(brand)}<span class="board-foot">his.fm / {brand['en']}</span></div><div class="logo-symbol"><span class="board-label">SYMBOL</span><img src="{asset(brand,'symbol.svg')}" width="128" height="128" alt="{brand['name']}独立品牌符号"></div><div class="logo-reverse"><span class="board-label">REVERSED</span>{logo(brand,variant='logo-light')}</div><div class="logo-sizes"><span class="board-label">SMALL, STILL DISTINCT.</span><div>{''.join(f'<figure><img src="{asset(brand,"symbol.svg")}" width="{size}" height="{size}" alt="{size}像素符号"><figcaption>{size}px</figcaption></figure>' for size in [64,32,24,16])}</div><span class="board-foot">小尺寸保留轮廓，不堆叠细节。</span></div></div>
      <div class="palette">{swatches}</div><div class="type-board"><div><span class="eyebrow">TYPE DIRECTION</span><h3>{brand['type']}</h3><p>{brand['type_note']}</p></div><div class="type-specimen"><span class="type-latin">Aa — 0123.</span><span class="type-chinese">声音里，有具体的生活。</span></div></div>
    </section>
    <section class="cover-section" id="covers"><div class="section-wrap">{chapter('02','SERIAL COVER SYSTEM','三期节目，一种识别。','每张封面由主体图与独立品牌 Cover 叠加。字标、标题、期号和边框都在可替换的矢量前景层中。')}
    <div class="cover-toolbar"><p>同组选题，检验系列感。{extra}</p><div class="segmented" role="group" aria-label="封面图层"><button type="button" data-mode="complete" aria-pressed="true">完整封面</button><button type="button" data-mode="art" aria-pressed="false">仅主体图</button><button type="button" data-mode="frame" aria-pressed="false">仅 Cover</button></div></div>
    <div class="cover-grid">{cards}</div><p class="sample-note">001 使用现有文稿标题；002—003 为设计样题，编号仅用于系列比较。所有页面均为静态设计预览，未录制的节目没有播放控件。</p>
    <div class="layer-explainer"><div class="layer-copy"><span class="eyebrow">ONE FRAME. MANY STORIES.</span><h3>换一个故事。<br>仍然是 his.fm。</h3><p>{brand['frame']}</p><a class="text-link" download href="{original_link}">查看未经处理的主体原图 ↗</a></div><div class="exploded"><figure>{cover(brand,EPISODES[0],mode='art')}<figcaption>01 / SUBJECT<br>图像主体 · 独立底图</figcaption></figure><span class="math-symbol">+</span><figure>{cover(brand,EPISODES[0],mode='frame')}<figcaption>02 / IDENTITY<br>透明前景 · SVG / PNG</figcaption></figure><span class="math-symbol">=</span><figure>{cover(brand,EPISODES[0])}<figcaption>03 / EDITION<br>可直接导出的节目封面</figcaption></figure></div></div>
    </div></section>
    <section class="website-section section-wrap" id="website">{chapter('03','DIGITAL EXPERIENCE','从品牌，走进一段声音。','首页、节目列表、单集文稿与关于页面。每套独立编排，桌面与手机都可以直接打开。')}
      <div class="site-links"><a href="site/index.html">首页 ↗</a><a href="site/episodes.html">全部节目 ↗</a><a href="site/episode.html">单集详情 ↗</a><a href="site/about.html">关于频道 ↗</a></div>
      <div class="web-preview"><a class="desktop-preview" href="site/index.html" aria-label="打开 {brand['name']} 网站"><div class="browser-chrome"><i></i><i></i><i></i><span>his.fm</span><b>↗</b></div><img src="{asset(brand,'website-desktop.webp')}" alt="{brand['name']}网站桌面预览" width="1440" height="1100" loading="lazy"></a><a class="mobile-preview" href="site/index.html" aria-label="打开手机网站"><span class="phone-speaker"></span><img src="{asset(brand,'website-mobile.webp')}" alt="{brand['name']}网站手机预览" width="390" height="844" loading="lazy"></a></div>
    </section>
    <section class="applications-section section-wrap" id="applications">{chapter('04','IN THE WORLD','让声音，有自己的形状。','横幅、竖版海报、频道头像与小尺寸使用，共用同一套图形语法。')}
      <a class="banner-preview" download href="{asset(brand,'banner.png')}"><img src="{asset(brand,'banner.svg')}" alt="{brand['name']}1920×640品牌横幅" width="1920" height="640" loading="lazy"><span>1920 × 640 / CHANNEL BANNER ↓</span></a>
      <div class="application-grid"><a class="poster-preview" download href="{asset(brand,'poster.png')}"><img src="{asset(brand,'poster.svg')}" alt="{brand['name']}1080×1440品牌海报" width="1080" height="1440" loading="lazy"><span>1080 × 1440 / POSTER ↓</span></a><div class="application-right"><div class="channel-tile"><img src="{asset(brand,'avatar.svg')}" alt="his.fm频道头像" width="256" height="256"><div><span class="eyebrow">CHANNEL AVATAR</span><h3>his.fm</h3><p>声音里，有具体的生活。</p><a download href="{asset(brand,'avatar.png')}">下载频道头像 ↓</a></div></div><div class="stationery"><div class="stationery-card">{logo(brand)}<span>声音里，<br>有具体的生活。</span><small>his.fm / 中文播客</small></div><div class="stationery-ticket"><span>HIS.FM / TAKE A MOMENT</span><strong>给自己<br>一点时间。</strong><img src="{asset(brand,'symbol.svg')}" alt="" width="64" height="64"><span>随时打开。不必赶上。</span></div></div><div class="signature-strip"><span>HIS.FM</span><img src="{asset(brand,'symbol.svg')}" alt="" width="48" height="48"><span>{brand['en']}</span></div></div></div>
    </section>
    <section class="delivery-section section-wrap" id="files">{chapter('05','DELIVERY','一套可以继续生长的底稿。')}
    <div class="delivery-grid"><div><h3>品牌</h3><a download href="{asset(brand,'logo.svg')}">主字标 SVG ↓</a><a download href="{asset(brand,'logo-light.svg')}">反白字标 SVG ↓</a><a download href="{asset(brand,'symbol.svg')}">独立符号 SVG ↓</a><a download href="{asset(brand,'avatar.png')}">频道头像 PNG ↓</a></div><div><h3>封面</h3><a download href="{asset(brand,'cover-01.png')}">EP.001 完整封面 ↓</a><a download href="{asset(brand,'cover-02.png')}">EP.002 完整封面 ↓</a><a download href="{asset(brand,'cover-03.png')}">EP.003 完整封面 ↓</a><a download href="{asset(brand,'frame-01.svg')}">透明 Cover 母版 ↓</a></div><div><h3>应用</h3><a download href="{asset(brand,'banner.png')}">横幅 1920 × 640 ↓</a><a download href="{asset(brand,'poster.png')}">海报 1080 × 1440 ↓</a><a href="site/index.html">打开独立静态网站 ↗</a><a href="../README.md">交付与素材说明 ↗</a></div><div class="delivery-note"><span class="eyebrow">LOCAL DESIGN STUDY</span><p>字标与 Cover 为独立矢量。新主体图由 Workflow 的 GPT Image 2.5 Sunburst 生成；原图、提示词与来源记录单独归档。</p><p>提案尚未替换线上品牌。</p></div></div>
    </section></main><footer class="study-footer"><div><span class="eyebrow">NEXT DIRECTION</span><a href="../{next_brand['slug']}/index.html">{next_brand['id']} / {next_brand['name']} <span>↗</span></a></div><a href="../index.html">回到全部方案总览 ↑</a><p>his.fm / Design studies / September 2026</p></footer><div class="toast" role="status" aria-live="polite"></div>'''
    write(f'{brand["slug"]}/index.html',document(f'{num} {brand["name"]} — his.fm 品牌设计',body,cls=f'study theme-{num}',favicon=f'{num}/symbol.svg'))


def site_header(brand, page):
    links = ''.join(f'<a href="{file}" {"aria-current=page" if page == key else ""}>{label}</a>' for key,file,label in [('home','index.html','首页'),('episodes','episodes.html','全部节目'),('about','about.html','关于 his.fm')])
    variant = 'logo-light' if page=='home' and brand['id'] in ('05','07') else 'logo'
    return f'''<div class="prototype-bar"><a href="../index.html">← {brand['id']} {brand['name']} · 品牌提案</a><span>静态设计预览 · 未发布选题</span></div><header class="site-header"><a class="site-brand" href="index.html" aria-label="his.fm 首页">{logo(brand,prefix='../../assets/',variant=variant)}<span class="brand-caption">中文播客</span></a><nav aria-label="主导航">{links}</nav><a class="header-action" href="episode.html">从这一期开始 <span>↗</span></a><button class="menu-toggle" type="button" aria-expanded="false" aria-label="展开导航">菜单 +</button></header>'''


def site_footer(brand):
    return f'''<footer class="site-footer"><div class="site-footer-top"><p>今天的声音，<br>听到这里也可以。</p><nav aria-label="页脚"><a href="episodes.html">全部节目 ↗</a><a href="about.html">关于 his.fm ↗</a><a href="../index.html">设计提案 ↗</a></nav><span class="footer-small">一档给开发者的中文播客<br>工作，学习，生活。</span></div><a class="footer-logo" href="index.html" aria-label="his.fm 首页">{logo(brand,prefix='../../assets/')}</a><div class="footer-baseline"><span>© 2026 his.fm</span><span>声音里，有具体的生活。</span><a href="#top">回到顶部 ↑</a></div></footer>'''


def episode_cards(brand):
    return ''.join(f'''<article class="episode-card" data-category="{ep['category']}" data-title="{ep['title']}"><a class="episode-image" href="episode.html?episode={ep['cover']}" aria-label="阅读 {ep['title']}">{cover(brand,ep,prefix='../../assets/')}<span class="card-arrow">↗</span></a><div class="episode-meta"><span>{ep['tag']}</span><span>{ep['status']}</span></div><h3><a href="episode.html?episode={ep['cover']}">{ep['title']}</a></h3><p>{ep['summary']}</p><div class="episode-card-foot"><span>EP.{ep['number']}</span><a href="episode.html?episode={ep['cover']}">阅读文稿 ↗</a></div></article>''' for ep in EPISODES)


def site_home(brand):
    num = brand['id']
    title = brand['lead']
    if int(num) >= 5:
        return quiet_home(brand)
    if num=='02':
        hero = f'''<section class="site-hero interval-hero"><div class="hero-note"><span>HIS.FM / A LITTLE OPEN SPACE</span><span>中文 · 单人播讲</span></div><div class="hero-main"><div class="hero-copy"><span class="small-index">( 给自己一点时间 )</span><h1>{title}</h1><p>关于工作、睡眠，<br>和屏幕外的小事。</p><a class="cta" href="episode.html">先读这一期 <span>↗</span></a></div><div class="hero-photo"><img src="../../assets/{brand['hero']}" alt="椅边松弛的手与一片草叶" width="1536" height="1024"><img class="floating-symbol" src="{asset(brand,'symbol.svg','../../assets/')}" alt="" width="128" height="128"><span class="image-caption">关掉一个窗口。留下一点空白。</span></div></div><div class="hero-bottom"><span>EP.001 / 文稿已就绪</span><a href="episode.html">下班后，还要追多少个 AI？ <span>↗</span></a><span>SCROLL, AT YOUR PACE ↓</span></div></section><div class="editorial-ribbon"><span>开着的窗口</span><i>／</i><span>没回完的消息</span><i>／</i><span>还没凉的晚饭</span><i>／</i><span>今天就到这里</span></div>'''
    elif num=='03':
        hero = f'''<section class="site-hero soft-hero"><div class="soft-hero-image"><img src="../../assets/{brand['hero']}" alt="青草绿玻璃回环接住淡紫色软垫" width="1536" height="1024"></div><div class="hero-copy"><p class="eyebrow">HIS.FM / A SOFTER FREQUENCY</p><h1>生活有<br>柔软的边。</h1><p>工作里的问号，生活里的逗号。<br>放进一段声音，慢慢聊。</p><a class="cta" href="episode.html">从这一期开始 <span>↗</span></a></div><span class="soft-handwriting">a softer<br><em>landing.</em></span><div class="soft-feature"><img src="{asset(brand,'symbol.svg','../../assets/')}" alt="" width="48" height="48"><div><span>本期文稿 / EP.001</span><a href="episode.html">下班后，还要追多少个 AI？ ↗</a></div></div><span class="soft-edge">给今天，一个落点。 ↓</span></section>'''
    else:
        hero = f'''<section class="site-hero sample-hero"><div class="sample-masthead">{logo(brand,prefix='../../assets/')}<div><span>独立中文播客</span><span>工作 / 学习 / 生活</span><img src="{asset(brand,'symbol.svg','../../assets/')}" alt="" width="56" height="56"></div></div><div class="sample-hero-grid"><div class="sample-title"><span class="eyebrow">THE HUMAN SIDE OF EVERYDAY.</span><h1>{title}</h1><p>关掉窗口，开一扇窗。<br>聊聊下班以后，还在发生的事。</p><a class="cta" href="episode.html">翻开这一期 <span>↗</span></a><span class="sample-title-foot">声音里，有具体的生活。 / 001</span></div><div class="sample-image"><img src="../../assets/{brand['hero']}" alt="在窗边感受晚风的成年人，青草绿与柿子橙的套色图像" width="1536" height="1024"><span class="image-sticker">HUMAN<br>SAMPLE ↗</span></div></div><div class="sample-edition"><span>本期 / EP.001</span><a href="episode.html">下班后，还要追多少个 AI？</a><span>文稿就绪 ↗</span></div></section>'''
    return hero + f'''<section class="episodes-section site-wrap" id="episodes"><div class="section-heading"><div><span class="eyebrow">ON THE OTHER SIDE OF THE SCREEN</span><h2>{'把耳朵，借给生活。' if num!='04' else '本期与下期。'}</h2></div><a href="episodes.html">全部节目 ↗</a></div><div class="episode-grid">{episode_cards(brand)}</div></section><section class="site-interlude"><span class="eyebrow">A NOTE FROM HIS.FM</span><p>{'很多事还没做完。<br>晚饭倒是可以先吃。' if num=='02' else '把那些没来得及聊的话，<br>留给一段声音。' if num=='03' else '还有一件小事。<br>今天的晚风，也不错。'}</p><img src="{asset(brand,'symbol.svg','../../assets/')}" alt="" width="128" height="128"><a href="about.html">认识 his.fm ↗</a></section><section class="site-about-teaser site-wrap"><p class="eyebrow">HELLO, WE ARE HIS.FM</p><h2>新的工具一直来。<br>生活也还在继续。</h2><div><p>有时是一个开源项目，有时是一项研究，也可能只是下班以后没想明白的一件小事。</p><p>his.fm 从这些地方开始，聊聊工作怎样进入生活，人又怎样给自己留一点位置。</p><a class="text-link" href="about.html">关于这个频道 ↗</a></div></section>'''


def quiet_home(brand):
    num = brand['id']
    source = '../../assets/' + brand['hero']
    symbol = asset(brand, 'symbol.svg', '../../assets/')
    light_symbol = asset(brand, 'symbol-light.svg', '../../assets/')
    if num == '05':
        opening = f'''<section class="stillwood-hero"><img class="quiet-landscape" src="{source}" alt="雾中杉林与一座亮着暖窗的木屋" width="1536" height="1024" fetchpriority="high"><div class="stillwood-copy"><p class="eyebrow">HIS.FM / A LETTER FROM STILLWOOD</p><h1>山里起雾了。<br>先坐一会儿。</h1><p>消息还在来，天色慢慢暗了。<br>关上一个窗口，留一段声音在身边。</p><a class="quiet-link" href="episode.html">从这篇文稿开始 <span>↗</span></a></div><div class="stillwood-seal"><img src="{light_symbol}" alt="耳机与木屋组成的品牌符号" width="80" height="80"><span>STILLWOOD<br>HIS.FM</span></div><div class="quiet-hero-baseline"><span>窗外有风，屋里有一段声音。</span><a href="#episodes">往下走走 ↓</a></div></section>'''
        sentence = '天色慢慢暗了。<br>不妨把灯打开。'
        image_caption = '一扇窗，一盏灯。 / STILLWOOD'
        image_note = '山间的安静，也可以从一副耳机开始。'
    elif num == '06':
        opening = f'''<section class="tidal-hero"><img class="quiet-landscape" src="{source}" alt="灰蓝海面上一座小小的松树岛，远处消失在海雾中" width="1536" height="1024" fetchpriority="high"><div class="tidal-copy"><p class="eyebrow">HIS.FM / TIDAL HOURS</p><h1>潮水有潮水的时间。<br><em>我有我的。</em></h1><p>路上、午后，或者事情还没做完的时候。<br>挑一段声音，听到哪儿就到哪儿。</p><a class="quiet-link" href="episode.html">先读这一期 <span>↗</span></a></div><span class="tidal-handwriting">at your<br><em>own tide.</em></span><div class="tidal-mark"><img src="{symbol}" alt="潮线与耳机组成的品牌符号" width="64" height="64"><span>A SMALL ISLAND.<br>A LITTLE TIME.</span></div><div class="quiet-hero-baseline"><span>海面很宽，今天可以很小。</span><a href="#episodes">慢慢往下 ↓</a></div></section><div class="tide-line" aria-hidden="true"><span>IN</span><i></i><span>YOUR OWN TIME</span><i></i><span>OUT</span></div>'''
        sentence = '留一小段空白。<br>就像海面上的这一处。'
        image_caption = '潮水有潮水的时间。 / TIDAL HOURS'
        image_note = '没有需要赶上的声音。'
    elif num == '07':
        opening = f'''<section class="window-hero"><div class="window-copy"><p class="eyebrow">HIS.FM / WINDOW SEAT</p><img src="{light_symbol}" alt="车窗耳机品牌符号" width="64" height="64"><h1>窗外很快。<br>这一段，<br><span>慢慢听。</span></h1><p>下一站还没到。<br>耳机里的声音，先陪你坐一会儿。</p><a class="quiet-link" href="episode.html">打开这一期文稿 <span>↗</span></a></div><figure class="commute-window"><img src="{source}" alt="戴着耳机的成年乘客坐在通勤列车窗边，窗外城市掠过" width="1536" height="1024" fetchpriority="high"><figcaption>THE CITY MOVES.<br>THIS MOMENT STAYS.</figcaption></figure><div class="window-ticket"><span>EP.001<br><b>本期文稿</b></span><a href="episode.html">下班后，还要追多少个 AI？<span>↗</span></a><span>靠窗的位置<br><b>HIS.FM</b></span></div></section>'''
        sentence = '窗外又过了一站。<br>耳边的这一段，还没结束。'
        image_caption = '列车向前，声音留在耳边。 / WINDOW SEAT'
        image_note = '这一小段通勤，也可以有自己的节奏。'
    else:
        opening = f'''<section class="alpine-hero"><img class="quiet-landscape" src="{source}" alt="雾中雪山山谷，一朵淡蓝高原花在岩石边开放" width="1536" height="1024" fetchpriority="high"><div class="alpine-copy"><p class="eyebrow">HIS.FM / FIELD NOTES IN SOUND</p><h1>山很远。<br>花开在眼前。</h1><p>有些变化很大，有些生活很小。<br>用一段声音，看看离自己近一点的事。</p><a class="quiet-link" href="episode.html">从这一期开始 <span>↗</span></a></div><div class="alpine-inscription"><img src="{symbol}" alt="花瓣与耳机组成的品牌符号" width="74" height="74"><span>ALPINE BLOOM<br><em>in its own time.</em></span></div><div class="quiet-hero-baseline"><span>世界自有速度。花有花期。</span><a href="#episodes">看近处的生活 ↓</a></div></section>'''
        sentence = '群山退进雾里。<br>眼前这一朵，刚刚打开。'
        image_caption = '近处的花，远处的山。 / ALPINE BLOOM'
        image_note = '不用把每一次花开，都讲成一个道理。'
    return opening + f'''<section class="episodes-section site-wrap quiet-episodes" id="episodes"><div class="section-heading"><div><span class="eyebrow">A FEW THINGS TO LISTEN TO</span><h2>最近，想聊这些。</h2></div><a href="episodes.html">全部节目 ↗</a></div><div class="episode-grid">{episode_cards(brand)}</div></section><section class="quiet-pause"><div class="quiet-pause-copy"><span class="eyebrow">A MOMENT, IN YOUR OWN TIME.</span><h2>{sentence}</h2><p>{image_note}</p><a class="quiet-link" href="about.html">认识 his.fm <span>↗</span></a></div><figure><img src="{asset(brand,'art-02.webp','../../assets/')}" alt="{brand['name']}系列的安静日常画面" width="1024" height="1024" loading="lazy"><figcaption>{image_caption}</figcaption></figure></section><section class="site-about-teaser site-wrap"><p class="eyebrow">HELLO, WE ARE HIS.FM</p><h2>新的工具一直来。<br>生活也还在继续。</h2><div><p>有时是一个开源项目，有时是一项研究，也可能只是下班以后没想明白的一件小事。</p><p>从具体的工作、睡眠、休息与相处开始，留一点时间，把它聊清楚。</p><a class="text-link" href="about.html">关于这个频道 ↗</a></div></section>'''


def site_library(brand):
    return f'''<section class="library-opening site-wrap"><p class="eyebrow">THE EPISODE INDEX / 节目目录</p><h1>挑一段声音，<br>陪眼下的生活。</h1><div class="library-bottom"><p>有空时打开。听到哪儿，就到哪儿。</p><span>3 个文稿与选题预览</span></div></section><section class="library-section site-wrap"><div class="library-controls"><div class="filter-group" role="group" aria-label="节目分类"><button type="button" data-filter="all" aria-pressed="true">全部 03</button><button type="button" data-filter="work" aria-pressed="false">工作</button><button type="button" data-filter="life" aria-pressed="false">生活</button></div><label class="search-field"><span>搜索节目</span><input type="search" placeholder="搜索标题…" autocomplete="off" aria-label="搜索节目标题"></label></div><div class="episode-grid">{episode_cards(brand)}</div><p class="empty-state" hidden>没有找到这个标题。换个词试试。</p><p class="library-note">音频仍在准备，先把已经写下的内容放在这里。</p></section>'''


def manuscript_html():
    parts = (REPO/'episodes/001-how-to-live-better/transcript.md').read_text().split('\n\n')
    return ''.join(f'<p>{html.escape(p.strip())}</p>' for p in parts if p.strip() and not p.startswith('#'))


def site_episode(brand):
    panels = []
    samples = [manuscript_html(), '<p>下班以后，你习惯往哪个方向走？</p><p>这期想从一条没有目的地的路开始。经过熟悉的路口，看看常去的店有没有开门，听听傍晚街道上的声音。没有需要完成的步数，也不必向谁证明今晚过得很充实。</p><p>这是封面设计使用的概念选题，尚未形成正式节目文稿。</p>', '<p>饭已经摆上桌，消息提醒还在闪。</p><p>你想着回复最后一条，又顺手打开了另一个窗口。等再抬头，菜已经凉了。下一条 Prompt 之前，我们想聊聊一顿不看屏幕的晚饭，以及今天的工作怎样有一个结束。</p><p>这是封面设计使用的概念选题，尚未形成正式节目文稿。</p>']
    for ep, sample in zip(EPISODES,samples):
        hidden = ' hidden' if ep['cover'] != '01' else ''
        panels.append(f'''<article class="episode-detail site-wrap" data-episode="{ep['cover']}"{hidden}><a class="back-link" href="episodes.html">← 所有节目</a><div class="detail-opening"><div class="detail-cover">{cover(brand,ep,prefix='../../assets/')}</div><div class="detail-heading"><span class="eyebrow">EP.{ep['number']} / {ep['tag']}</span><h1>{ep['title']}</h1><p>{ep['summary']}</p><div class="recording-state"><span class="status-dot"></span><span>{'文稿已就绪，音频仍在准备。' if ep['cover']=='01' else '概念选题，尚未录制。'}</span></div><a class="cta" href="#transcript-{ep['cover']}">阅读{'文稿' if ep['cover']=='01' else '选题'} <span>↓</span></a></div></div><div class="transcript-layout" id="transcript-{ep['cover']}"><aside><span class="eyebrow">{'TRANSCRIPT' if ep['cover']=='01' else 'EDITORIAL SKETCH'}</span><strong>{'本期文稿' if ep['cover']=='01' else '选题草稿'}</strong><span>his.fm<br>一段声音的起点</span></aside><div class="transcript">{sample}<div class="transcript-end">{logo(brand,prefix='../../assets/')}<span>这一段，就到这里。</span></div></div></div></article>''')
    return ''.join(panels) + '<div class="detail-next site-wrap"><a href="episodes.html">回到节目目录 ↗</a></div>'


def site_about(brand):
    return f'''<section class="about-opening site-wrap"><p class="eyebrow">HELLO, WE ARE HIS.FM</p><h1>在每一次更新之间，<br>生活照常发生。</h1><img src="{asset(brand,'symbol.svg','../../assets/')}" alt="" width="128" height="128"></section><figure class="about-image"><img src="../../assets/{brand['hero']}" alt="{brand['name']}品牌主视觉" width="1536" height="1024"><figcaption>一些声音，一点陪伴。 / his.fm</figcaption></figure><section class="about-story site-wrap"><span class="eyebrow">ABOUT THE PODCAST</span><div><h2>屏幕那边，<br>是具体的人。</h2><p>his.fm 是一档面向成年开发者的中文播客。聊新的工具、新的工作方式，也聊睡眠、休息和下班以后的日常。</p><p>一个开源项目、一项研究，可能让我们重新看见一件身边的小事：为什么晚上总想再看一条教程，怎样和同事说清一个问题，什么时候能安心吃一顿晚饭。</p><p>节目采用单人播讲，每期通常按十分钟准备。有些问题不会在十分钟里得到答案，我们可以先把它说具体。</p><p>资料整理、文稿、封面与声音制作有 AI 参与，发布前由频道所有者确认。这里没有虚构的采访或主持人亲历。</p><a class="cta" href="episode.html">从第一篇文稿开始 <span>↗</span></a></div></section>'''


def make_sites(brand):
    if brand['id'] == '01':
        return
    for name,file,content in [('home','index.html',site_home(brand)),('episodes','episodes.html',site_library(brand)),('episode','episode.html',site_episode(brand)),('about','about.html',site_about(brand))]:
        body = '<div id="top">' + site_header(brand,name) + '<main id="main">' + content + '</main>' + site_footer(brand) + '</div>'
        write(f'{brand["slug"]}/site/{file}',document(f'his.fm · {brand["name"]}',body,depth=2,cls=f'website theme-{brand["id"]} page-{name}',css='website.css',script='website.js',favicon=f'{brand["id"]}/symbol.svg'))


def direction_cards(brands):
    return ''.join(f'''<article class="direction-card index-{b['id']}"><a class="direction-visual" href="{b['slug']}/index.html"><div class="direction-top"><span>{b['id']} / {b['label']}</span><span>↗</span></div>{logo(b,prefix='assets/',variant='logo-light' if b['id'] in ('01','05','07') else 'logo')}<img class="direction-image" src="assets/{b['hero']}" alt="{b['name']}主视觉" width="1536" height="1024" loading="lazy"><img class="direction-symbol" src="{asset(b,'symbol-light.svg' if b['id'] in ('01','05','07') else 'symbol.svg','assets/')}" alt="" width="128" height="128"><span class="direction-line">{b['line']}</span></a><div class="direction-description"><div><span class="eyebrow">{b['en']}</span><h2><a href="{b['slug']}/index.html">{b['name']} <span>↗</span></a></h2></div><p>{b['description']}</p><div class="index-palette">{''.join(f'<span style="background:{c}" title="{n} {c}"></span>' for n,c in b['palette'])}</div></div><div class="mini-covers">{''.join(f'<a href="{b["slug"]}/index.html#covers" aria-label="查看{b["name"]}节目封面">{cover(b,ep,prefix="assets/")}</a>' for ep in EPISODES)}</div><div class="direction-links"><a href="{b['slug']}/index.html">完整品牌提案 ↗</a><a href="{b['slug']}/site/index.html">打开网站 ↗</a></div></article>''' for b in brands)


def make_index():
    body = f'''<header class="index-nav"><a href="index.html">his.fm <span>DESIGN STUDIES</span></a><span>SEPTEMBER 2026 / VOL.01 + 02</span><a href="#quiet">新方向 05—08 ↓</a></header>
    <main id="main"><section class="index-hero"><div class="index-intro"><p class="eyebrow"><span class="live-dot"></span> A PODCAST. EIGHT VISUAL WORLDS.</p><h1>一种声音。<br><span>八种性格。</span></h1><div class="index-hero-bottom"><p>his.fm 品牌视觉提案<br>声音里，有具体的生活。</p><span>01 当前设计<br>02—08 全新方向</span><a href="#quiet" aria-label="浏览新增安静方向">↓</a></div></div><div class="index-art"><img src="assets/03/hero.webp" alt="玻璃回环与软垫，软着陆方向主视觉" width="1536" height="1024"><div class="index-art-label"><span>IDENTITY / EDITORIAL / DIGITAL</span><strong>Human,<br><em>by nature.</em></strong><span>完整字标 · 双层封面 · 网站 · 品牌应用</span></div><span class="index-edition">HIS.FM<br>2026</span></div></section>
    <div class="index-meta"><span>08 / BRAND WORLDS</span><span>24 / SERIES COVERS</span><span>32 / STATIC WEB PAGES</span><span>28 / NEW GENERATED IMAGES</span></div>
    <nav class="round-nav" aria-label="探索轮次"><a href="#directions">01—04 / 最初的四种性格 <span>↓</span></a><a href="#quiet">05—08 / 按自己的节奏 <span>↓</span></a></nav>
    <section class="direction-section" id="directions"><div class="index-section-heading"><span class="eyebrow">ROUND 01 / FIRST EXPLORATIONS</span><p>现有森林、编辑实验、感官雕塑与独立刊物。</p></div><div class="directions-grid">{direction_cards(BRANDS[:4])}</div></section>
    <section class="direction-section quiet-directions" id="quiet"><div class="quiet-round-opening"><div><span class="eyebrow">ROUND 02 / AT YOUR OWN PACE</span><h2>声音里，<br>有一处安静。</h2></div><p>雾林、孤岛、通勤列车与雪线花朵。<br>风景里有留白，耳边有自己的时间。</p><span class="round-number">05—08</span></div><div class="directions-grid">{direction_cards(BRANDS[4:])}</div></section>
    <section class="comparison-section"><div><p class="eyebrow">THE SAME VOICE. A DIFFERENT FEEL.</p><h2>先看封面，<br>再走进喜欢的那一套。</h2><p>每套使用相同的三组选题，方便比较。可以单独查看生成主体、透明 Cover 和叠加成品，下载对应的 SVG 与 PNG。</p></div><div class="comparison-table"><div><span>方向</span><span>识别核心</span><span>主要气质</span></div>{''.join(f'<a href="{b["slug"]}/index.html"><strong>{b["id"]} {b["name"]}</strong><span>{b["keywords"][0]}</span><span>{b["label"]} ↗</span></a>' for b in BRANDS)}</div></section></main><footer class="index-footer"><a href="#main">his.fm ↗</a><p>Brand identity studies / 2026.09.26<br>本地静态设计提案 · 尚未替换线上品牌</p><a href="README.md">交付说明 ↗</a></footer>'''
    write('index.html',document('his.fm — 一种声音，八种性格',body,depth=0,cls='design-index'))


if __name__ == '__main__':
    for brand in BRANDS:
        make_study(brand)
        make_sites(brand)
    make_index()
    write('assets/design-system.json',json.dumps({'brands':BRANDS,'episodes':EPISODES},ensure_ascii=False,indent=2))
    print('已生成总览、8 套品牌提案与 28 个新网站页面。')
