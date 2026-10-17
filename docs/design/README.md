# his.fm identity studies

Eight static identity studies for the public podcast brand. Open [the gallery](index.html) directly in Chrome. The quiet directions are in [the second collection](index.html#quiet). This archive is not a public application route; current implementation and preview links are documented in [website appearance](../appearance.md).

The gallery and individual pages also open directly from disk. Everything needed for display, including fonts, is local. No application build, account, API call, or audio service is required.

## Directions

| Study | Direction | Visual system |
| --- | --- | --- |
| [01](01-current/index.html) | 林间电台 / The Grove | Current public-site snapshot, forest green, existing imagery; proposed cover extensions |
| [02](02-interval/index.html) | 间隙 / Open Interval | Custom rounded wordmark, open parentheses, acid-green spine, tactile photography |
| [03](03-soft-landing/index.html) | 软着陆 / Soft Landing | Serif wordmark, soft loop, lilac windows, glass and fabric |
| [04](04-human-sample/index.html) | 人间采样 / Human Sample | Wide publication masthead, grass and persimmon, halftone human portraits |
| [05](05-stillwood/index.html) | 雾林来信 / Stillwood | Headphone cabin, forest mist, flax hairlines, one warm window |
| [06](06-tidal-hours/index.html) | 岛屿时间 / Tidal Hours | Monoline wordmark, headphone tides, porcelain margins, a solitary island |
| [07](07-window-seat/index.html) | 靠窗的位置 / Window Seat | Headphone window, amber ticket, still train interior and moving city |
| [08](08-alpine-bloom/index.html) | 雪线花期 / Alpine Bloom | Italic wordmark, petal headphones, alpine blue poppies and misty snow peaks |

Every study contains a wordmark, reversed wordmark, independent symbol, palette, typography, three episode covers, desktop/mobile website previews, a banner, a poster, an avatar, and identity applications. Each website has a home page, episode index, episode detail, and about page: 32 website pages in total, plus eight identity books and one gallery.

Studies 01–04 were reviewed as initial style directions. Studies 05–08 extend the exploration into quieter environments. This round is for visual selection; production adoption and detailed refinement are separate work.

## Cover layers and exports

For each study, `assets/NN/` contains:

| File | Purpose |
| --- | --- |
| `art-01.webp` through `art-03.webp` | Subject-only images, without generated typography |
| `frame-01.svg` through `frame-03.svg` | Independent foreground Cover: brand, title, episode number, frame |
| `frame-01.png` through `frame-03.png` | Transparent raster foregrounds, 1024 × 1024 |
| `cover-01.svg` through `cover-03.svg` | Self-contained composites with embedded subject images and outlined foregrounds |
| `cover-01.png` through `cover-03.png` | Finished square covers, 1024 × 1024 |
| `logo.svg`, `logo-light.svg` | Outlined wordmarks |
| `symbol.svg`, `symbol-light.svg` | Independent vector symbols |
| `banner.svg`, `banner.png` | Channel banner, 1920 × 640 |
| `poster.svg`, `poster.png` | Vertical poster, 1080 × 1440 |
| `avatar.svg`, `avatar.png` | Channel avatar, 1024 × 1024 |
| `website-desktop.webp`, `website-mobile.webp` | Actual rendered home-page previews |
| `manifest.json` | Source paths, hashes, image dimensions, and export provenance |

The cover selector in each identity book switches between composite, subject, and foreground. SVG text is outlined and does not depend on installed fonts. Foregrounds have transparent image windows; forest and alpine variants also use translucent tonal gradients for legibility. A layout export is a composed derivative, not a claim about native image-model resolution.

All studies use the same three comparison subjects. Episode 001 refers to the existing manuscript. Episodes 002–003 are explicitly labeled design concepts; their numbering does not imply publication. There is no fabricated playable audio. Generated scenes are illustrative brand artwork, not evidence of interviews, real visits, or personal experience.

## Sources

- Studies 02–08 use 28 original images generated with Azure OpenAI `gpt-image-2.5-sunburst`, high quality, through the requested Workflow repository helper. Landscape masters are 1536 × 1024; cover subjects are 1024 × 1024.
- Original generated files, exact English prompts, request records, and hashes are archived in [`artwork/design-20260926/`](../../artwork/design-20260926/README.md). Originals are preserved separately from delivery derivatives.
- Study 01 keeps the existing public-site imagery. Its static website is a frozen snapshot; the page generator deliberately does not recapture it. The extra branded cover frames are proposals and have not been applied to the live site.
- The references in the owner's `Downloads/his.fm/a`, `b`, `c`, and `d` folders informed typographic scale, grid discipline, and identity presentation. No reference image or third-party logo was copied into the delivery.
- Space Grotesk, Syne, Instrument Serif, Noto Sans SC, and Noto Serif SC are bundled under their SIL Open Font Licenses. See [`assets/fonts/sources.json`](assets/fonts/sources.json) and the accompanying OFL files. Chinese webfonts are subset to the design and manuscript corpus; their sources are cached locally for regeneration.

## Regeneration

Run from the repository root. Image generation is an explicit separate operation and uses the Workflow direnv credentials. Never put credentials in these files.

```sh
direnv exec /Users/nocoo/workspace/personal/workflow \
  python3 artwork/design-20260926/generate.py 05-hero 05-01 05-02 05-03

python3 docs/design/build.py

uv run --no-project --with Pillow==12.3.0 --with fonttools --with brotli \
  python3 docs/design/build_assets.py 05 06 07 08

node docs/design/render.mjs 05 06 07 08
```

The image driver skips originals that already exist and sends requests sequentially. `build.py` writes static pages and design tokens. `build_assets.py` outlines vector lettering and creates image derivatives. `render.mjs` uses the repository's existing Playwright installation to export PNGs and website previews. Temporary browser screenshots and downloaded font source files stay under ignored `.local/design/`.

Basic verification passed for local references across 41 HTML pages, decoding and dimensions of 28 generated originals, 24 finished covers and transparent foregrounds, and 16 desktop/mobile views of the new identity books and home pages, including the cover-layer selector. This round deliberately stops at style review. No production deployment or public application change is part of this delivery.
