# Website appearance

The public site has one Open Interval identity and eight selectable visual directions. `apps/web/src/brand/identity.svg` is the canonical wordmark and parentheses symbol. Generated React components render paths inline; they do not depend on external SVG fragment loading. Public typography is Space Grotesk and Noto Sans SC. Basalt retains its own studio control typography.

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

Open `/admin/appearance`, select a card, then preview or apply it. Selection alone does not save. `?theme=<id>` previews all public routes without any write; internal navigation retains the preview, and its banner offers an exit. Preview links target the selected local/production environment. Applying changes the website for all listeners in that environment. Existing tabs refresh the setting on focus.

Migration `0006_appearance.sql` initializes the singleton to `interval`. The authenticated, same-origin `GET|PUT /admin/api/appearance` endpoint uses `{theme, version}` for writes. Updates compare the version atomically; a 409 retains the unsaved selection and requires an explicit reload. The private editorial profile is a separate record. Public `GET /api/appearance` exposes only `{appearance: {theme}}` with `Cache-Control: no-store`. Missing settings and request failures are visible errors, not silent theme substitutions.

Each direction changes palette, imagery and hero composition while sharing navigation, catalog filtering, reading and playback. Episode content always comes from the published API. Archived study titles and durations are not runtime data.

## Artwork, fonts and caching

`artwork/identity/manifest.json` records image/font source, SHA-256, byte size and native dimensions. Images use immutable `images/identity/<name>-<hash>.webp` keys on R2, delivered through `https://f.no.mt` with one-year immutable caching. The existing Grove retains its native 3504×2336 hero and dedicated retina mobile crops. The seven newer directions retain the approved 1536×1024 originals and 1024-square mobile crops; these are not enlarged into pretend higher-resolution images. Responsive `sizes` includes the image's cover-cropped height.

Fonts ship with the application through Vite's fingerprinted `/assets/*.woff2` URLs and Cloudflare static-asset CDN; small subsets are inlined into the generated CSS. This keeps deployment atomic with the CSS and avoids partially uploaded or negatively cached R2 font URLs. Noto Sans SC has 101 unicode-range subsets; the browser requests external subsets only when needed for the actual Chinese text. Space Grotesk retains its full character set. Both use `font-display: swap`. Their OFL licenses and source CSS are archived beside the files; there are no runtime requests to Google Fonts. `/assets/*` has one-year immutable caching. Stable `/brand/*` downloads revalidate.

```sh
uv run --no-project --with Pillow==12.3.0 python3 scripts/prepare-brand-assets.py
uv run --no-project --with fonttools==4.66.0 python3 scripts/prepare-identity.py
node_modules/.bin/biome check --write apps/web/src/brand
node scripts/upload-brand-assets.mjs
```

The image uploader requires explicit `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` environment variables (R2 write permission). It uses the Cloudflare REST API because `cf r2 objects put` does not currently expose `Cache-Control`; it never reads CLI credentials or changes authentication. The image uploader validates local digests, records resumable receipts under `.local/appearance/`, uploads all objects before checking CDN responses, then verifies MIME, cache headers and content digests. Verify the CDN before releasing CSS or JSON that references new keys. It never overwrites existing episode images. `images/` and `reference/` remain protected by storage cleanup. On the current development machine, use the existing explicit HTTPS proxy if direct Node networking fails; do not change TLS trust.

## Original covers and finished downloads

Generated, uploaded and stored episode covers must be clean images without typography, branding, borders or overlays. The public site and studio show the complete original, using `object-fit: contain` where necessary. Website theme changes do not rewrite cover bytes or published snapshots.

`apps/web/src/brand/frame.json` fixes the export geometry and neutral Interval palette. `scripts/prepare-identity.py` derives inline components, downloadable logo/symbol, favicon and a self-contained transparent SVG frame from the canonical source. Frame lettering is outlined from the archived Space Grotesk source, whose digest is checked against the approved study's font provenance; the SVG has no font dependency. Only “下载封面成品” composes that frame with the original and the real episode number, locally in the browser. It exports a 1600×1600 PNG, preserves the complete subject, and performs no upload or production mutation. Image/font failures show a retryable error rather than producing an unbranded download. R2 custom-domain CORS must permit the website and development origin for browser composition.

The owner still reviews the generated original and the downloaded composition. The upload endpoint validates actual PNG/JPEG/WebP bytes and size; it does not claim to detect a frame visually.
