# Website appearance

The public site has one Open Interval navigation identity and eight selectable visual directions. `apps/web/src/brand/identity.svg` is the canonical wordmark and parentheses symbol. Generated React components render paths inline; they do not depend on external SVG fragment loading. Theme typography includes Space Grotesk, Noto Sans SC, Noto Serif SC, Instrument Serif and Syne. Basalt retains its own studio control typography.

| ID | Direction |
| --- | --- |
| `grove` | 林间电台 / The Grove |
| `interval` | 间隙 / Open Interval |
| `soft-landing` | 软着陆 / Soft Landing |
| `human-sample` | 人间采样 / Human Sample |
| `stillwood` | 雾林来信 / Stillwood |
| `tidal-hours` | 岛屿时间 / Tidal Hours |
| `window-seat` | 靠窗的位置 / Window Seat |
| `alpine-bloom` | 雪线花期 / Alpine Bloom |

## Select and preview

The canonical header ID is `his.fm ()`. Its trailing open parentheses allude to a function call, `func()`. `BrandLockup` reuses the exact outlined wordmark and symbol from `identity.svg`: 116px wordmark width, a square symbol matching the wordmark's height (`116 * 170 / 600`, about 33px) and an 8px gap, centered vertically. The parentheses have equal typographic scale rather than appearing as a smaller companion icon. Public/studio top-left headers, the appearance specimen and all theme-card previews use this lockup without theme-specific font substitution. Both parts use the theme's dark primary (`ink`) on light surfaces and white on dark surfaces. Card slogans use one shared responsive font size; card titles also keep one size across all themes.

`scripts/prepare-identity.py` exports eight `/brand/favicons/<theme>.svg` assets from the same canonical symbol. Every 128-square icon uses its theme's dark primary background and a centered white mark at 75% scale, with a 16-unit inset and the same rounded corners. Public SSR emits the saved/preview theme's icon before JavaScript; client navigation and saved studio changes keep it synchronized. `/favicon.svg` is a non-cacheable redirect to the saved theme's asset for login and other shells. Card selection alone never changes the favicon. Archived studies, hero/footer decorations, finished-cover/share artwork and installed-app icons remain separate assets outside this update.

Open `/admin/appearance`, select a card, then preview or apply it. Selection alone does not save. `?theme=<id>` previews all public routes without any write; internal navigation retains the preview, and its banner offers an exit. Preview links target the selected local/production environment. Applying changes the website for all listeners in that environment. Existing tabs refresh the setting on focus.

Migration `0006_appearance.sql` initializes the singleton to `interval`. The authenticated, same-origin `GET|PUT /admin/api/appearance` endpoint uses `{theme, version}` for writes. Updates compare the version atomically; a 409 retains the unsaved selection and requires an explicit reload. The private editorial profile is a separate record. Public `GET /api/appearance` exposes only `{appearance: {theme}}` with `Cache-Control: no-store`. Missing settings and request failures are visible errors, not silent theme substitutions.

Each direction changes palette, imagery and hero composition while sharing navigation, catalog filtering, reading and playback. Episode content always comes from the published API. Archived study titles and durations are not runtime data.

`docs/design/index.html` indexes the eight archived design studies. The implementation preserves their distinct hero proportions, artwork windows, decorative marks and typographic hierarchy rather than replacing them with palette variants of one layout. The four quieter directions use a left-copy/right-image reflection section that stacks on phones. Public navigation, footer identity and real editorial content remain shared intentionally.

## Artwork, fonts and caching

`artwork/identity/manifest.json` records image/font source, SHA-256, byte size and native dimensions. Images use immutable `images/identity/<name>-<hash>.webp` keys on R2, delivered through `https://f.no.mt` with one-year immutable caching. The existing Grove retains its native 3504×2336 hero and dedicated retina mobile crops. The seven newer directions retain the approved 1536×1024 originals and 1024-square mobile crops; these are not enlarged into pretend higher-resolution images. Responsive `sizes` includes the image's cover-cropped height.

Browser fonts ship with the application through Vite's fingerprinted `/assets/*.woff2` URLs and Cloudflare static-asset CDN; small subsets are inlined into the generated CSS. This keeps deployment atomic with the CSS and avoids partially uploaded or negatively cached R2 font URLs. Noto Sans SC has 101 unicode-range subsets and its actual 100-900 weight range; Noto Serif SC has complete Unicode-sharded coverage from the verified full source, not just the characters in the studies. The browser requests subsets needed for visible text. Instrument Serif includes its real italic face, and Syne supplies the Human Sample Latin hierarchy. All use `font-display: swap`. OFL licenses and source hashes are archived beside the files; there are no runtime requests to Google Fonts. `/assets/*` has one-year immutable caching. Stable `/brand/*` downloads revalidate.

```sh
uv run --no-project --with Pillow==12.3.0 python3 scripts/prepare-brand-assets.py
python3 scripts/prepare-identity.py
uv run --no-project --with fonttools --with brotli python3 scripts/prepare-theme-fonts.py
uv run --no-project --with fonttools --with brotli --with Pillow==12.3.0 python3 scripts/export-theme-cover-frames.py
uv run --no-project --with fonttools --with brotli python3 scripts/prepare-cover-fonts.py
node_modules/.bin/biome check --write apps/web/src/brand
node_modules/.bin/biome format --write apps/web/public/brand/fonts/cover/manifest.json
node scripts/upload-brand-assets.mjs
```

The font generators require full sources under `.local/design/fonts`; source URLs and required SHA-256 digests are recorded in `docs/design/assets/fonts/sources.json`. Generation fails on a digest mismatch. The upload command is a separate, explicitly authorized remote operation, not a prerequisite for local checks.

The image uploader requires explicit `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` environment variables (R2 write permission). It uses the Cloudflare REST API because `cf r2 objects put` does not currently expose `Cache-Control`; it never reads CLI credentials or changes authentication. The image uploader validates local digests, records resumable receipts under `.local/appearance/`, uploads all objects before checking CDN responses, then verifies MIME, cache headers and content digests. Verify the CDN before releasing CSS or JSON that references new keys. It never overwrites existing episode images. `images/` and `reference/` remain protected by storage cleanup. On the current development machine, use the existing explicit HTTPS proxy if direct Node networking fails; do not change TLS trust.

## Original covers and finished downloads

Generated, uploaded and stored episode covers must be clean images without typography, branding, borders or overlays. The public site and studio preview the selected theme's finished composition without modifying those originals. The artwork is center-cropped with `object-fit: cover` into the design's actual window, not stretched or padded into a generic square. Website theme changes do not rewrite cover bytes or published snapshots.

Provide a **1400 x 1400 square original**; smaller originals are accepted and upscaled without inventing source detail. Keep the main subject near **x = 50%, y = 40%** for landscape sharing, with essential details inside the **y = 13.75-66.25%** crop band on square originals and clear of the finished border and wordmark. Square themed compositions retain a centered artwork window.

`scripts/export-theme-cover-frames.py` derives eight static frame SVGs and `apps/web/src/brand/cover-frame-layouts.json` from the archived `frame()` designs. Logos and decorative microcopy stay outlined; actual title, episode number and category are independent text slots. `src/shared/cover-composition.ts` supplies the same text layout and centered crop to both `FramedCover` and PNG export. Bounded artwork bleeds two design units beneath the frame to prevent a light antialiasing seam. Titles balance across two lines; short titles center vertically and overlong copy shrinks before truncating. ASCII fitting uses generated per-font/per-weight advances, not a uniform Latin-width guess; Chinese glyphs retain their em-width layout. A right-hand safe area keeps long titles clear of the public action. Window Seat uses tighter baselines optically centered in its ticket panel. Public hover arrows use the theme's dark primary circle and a white icon, inset at the bottom-right; these navigation controls are not part of exported artwork.

“下载封面成品” requests a real **1600 x 1600 PNG** from the authenticated Worker endpoint, not a browser canvas or an HTML screenshot. Both production and episode exports take an explicit theme and an optional expected saved version; the studio sends that version and disables download for unsaved episode edits. See [API onboarding](api-onboarding.md#finished-cover-png) for paths and scopes. Export performs no upload, approval, publication or content mutation. There is no arbitrary remote image fetch or browser CORS dependency: originals come from the configured R2 binding or same-origin bundled images. In local development only, the three exact seeded CDN episode URLs resolve to their bundled local images.

The export decoder accepts static PNG/JPEG/WebP originals up to **4 MiB**, **4,000,000 pixels**, and **8192 pixels per side**. These export limits are deliberately stricter than the existing 8 MiB production upload limit. Animated PNG/WebP, malformed headers, missing originals and unavailable font/frame assets fail explicitly. Actual pixel decoding can additionally reject corrupt image data. One composition per isolate bounds simultaneous WASM memory; contention returns 503 with `Retry-After: 1`, not a hidden queue.

Takumi WASM renders the composition with static cover-only font shards from `/brand/fonts/cover/`. The loader selects only the required glyphs and exact weights, limits selected font bytes to 2 MiB, and reads them through ASSETS. These files are separate from browser variable fonts and are not embedded wholesale in the Worker. The renderer is freed after every request. Local memory measurements support the bounded export envelope but do not certify every input, total isolate memory or Workers Free CPU suitability.

The owner still reviews the generated original and the downloaded composition. The upload endpoint validates actual PNG/JPEG/WebP bytes and size; it does not claim to detect a frame visually.

## Public RSS and share artwork

`node scripts/generate-share-art.mjs` reproducibly generates two committed,
theme-independent Stillwood brand JPEGs: `/brand/share.jpg` (1200 x 630) and
`/brand/podcast.jpg` (3000 x 3000). They use the archived outlined Stillwood
wordmark, a thin inset border and a deterministic flax paper texture, with no
other copy. Outputs are flattened sRGB JPEGs without ICC or EXIF metadata.
Empty SEO artwork settings use these assets in code; generation never changes
saved settings or uploads assets to R2.

Public `GET|HEAD /episodes/{id}/art.jpg` serves the current website theme's
exact framed composition, including saved title, episode number and category.
The default is 1400 square; `?size=N` accepts integers from 1400 through 3000.
`GET|HEAD /episodes/{id}/share.jpg` serves 1200 x 630, cover-cropping the original
full-bleed under the theme-independent Stillwood border and wordmark. It contains
no episode copy or title panel and has no size parameter. These stable record-ID
URLs resolve to current versioned URLs: `art.jpg?v=<hash>` (optionally with
`&size=N`) and `share.jpg?v=<hash>`.

Uploading a clean cover through either the studio or
`PUT /api/agent/productions/{id}/assets/cover?version=N` pregenerates the
production's square podcast art and landscape share image as immutable generated
R2 objects before publication. Publication and republication warm the linked
episode's current artwork keys. Cover changes select new generated versions;
title, episode number, category and website-theme changes select new square-art
versions when they affect the composition. Square art follows the selected
website theme; landscape sharing remains theme-independent. Only generated
outputs are cached, never replacements for originals. Storage cleanup protects
current generated versions; superseded versions may be reclaimed subject to the
existing reference and age safeguards.

The shared `shareArtworkFocusY` in `src/shared/share-composition.ts` anchors
this landscape crop at **x = 50%, y = 40%** of the original (a focal point, not
a percentage of leftover crop space).
For a square original, the 1200:630 crop covers 52.5% of its height: its top is
`clamp(0.40 * height - cropHeight / 2, 0, height - cropHeight)`, or 13.75%,
and its bottom is 66.25%. This prioritizes the upper-middle subject zone
(approximately y = 22–58%), rather than the logo zone (0–25%) or title panel
(57–100%) of the cover safe-area convention. The shared SVG composition clamps
the window to the source bounds for other aspect ratios. Native Images streams
the original into an aspect-preserving WebP bounded to 1600 x 1600 before the
SVG positions and clips it; only this bounded intermediate has its dimensions
parsed. This keeps decoding bounded without applying PNG-export input limits
to originals, and works identically in local and production runtimes (the pinned
local Images emulator ignores coordinate gravity). Square framed artwork retains
its centered crop.

Both routes use only currently published, non-future episode snapshots, return
404 for private/missing episodes, and bypass the named `PublicContent` cache.
Warming production assets never makes drafts public. After current database
publication/version checks, an independent native `caches.default` cache uses
the full versioned request URL. An edge hit skips R2; an edge miss reads the
generated R2 object, rendering and storing it only if that object is missing.
Successful GETs populate the edge asynchronously through `ctx.waitUntil`.
Versioned responses retain immutable cache headers, ETag and Last-Modified;
conditional 304s honor the same validators. HEAD reads cached GET metadata
without a body; cold HEAD/304 may remain R2 metadata-only and do not populate
the edge. Successful versioned responses and 304s include `x-hisfm-art`:
`edge-hit`, `r2-hit` or `rendered`. Default 1400-square art and share images
should be `r2-hit` after successful upload/publication warming, or `edge-hit`
if already cached; other sizes may render. Repeat GETs at the same edge can
hit after asynchronous fill, but cache residency is not globally guaranteed.
Plain and stale-version URLs retain no-store 302 redirects to preserve immediate
withdrawal and version changes. This cache does not alter `PublicContent`.
Native Images streams trusted R2 or bundled sources (up to 20 MB), cropping the
real original to the theme's artwork window before Takumi composition. Cropped
intermediates use WebP to retain transparency over the theme paper. Square
composition and effective image detail are capped at the existing 1600-square
export resolution; requested sizes above 1600 are explicitly upscaled by native
Images to the final JPEG dimensions. This keeps WASM bounded: a full 3000-square
WASM composition exceeds the Workers memory budget. Larger originals supply more
detail up to the composition cap; no thumbnail replaces the original. Existing
1400 originals are the expected input; smaller 1024 originals still upscale
gracefully without inventing source detail. Landscape
artwork uses the bounded native intermediate followed by a 1200 x 630 JPEG render.
The separate authenticated PNG export retains its 4 MiB / 4MP source guards.
Render contention returns 503; source/asset/decode failures remain explicit.
Directory acceptance still requires live Apple/Spotify validation.
