# Public rendering and podcast discovery

Public HTML is rendered in the Worker using the same React route tree as the
browser. Published episodes, public categories, appearance and site SEO form a
request-scoped bootstrap snapshot. The browser hydrates that snapshot and
revalidates public API data on mount; returning from the studio must not reuse a
stale snapshot indefinitely. Transcripts, drafts and settings audit fields are
not included in the bootstrap. Markdown uses the existing safe public renderer.

All requests run through the Worker before assets. Static assets have no SPA
fallback; the Worker explicitly serves studio shells and renders public 404s
with `noindex`. Local Vite module paths pass through unchanged. Public trailing
slashes redirect to canonical paths. HTTP apex and www requests redirect to
HTTPS apex. Production configuration binds both `his.fm` and `www.his.fm` to the
Worker; verify both DNS and TLS after deployment before calling the redirect live.

HTTPS responses include HSTS. All responses have baseline CSP directives for
base URLs, objects and framing; production public HTML additionally restricts
scripts to same-origin sources and nonce-bearing scripts. Inline bootstrap JSON
escapes HTML delimiters. Development retains Vite's script execution behavior.
The browser configures Zod's jitless mode before dynamically importing schemas:
even a caught `Function()` capability probe creates a CSP violation. Public
stylesheets remain in the static entry so no-JavaScript pages retain their layout.

The uncached gateway normalizes canonical URLs and strips request credentials
before invoking the named `PublicContent` entrypoint. Native Workers Cache stores
only successful public HTML templates (60 seconds) and versioned artwork
derivatives (one hour). Each HTML delivery gets a fresh CSP nonce after the cache
read and uses browser `no-store`; admin/API/authentication responses never enter
this cache. Unknown queries bypass it. Successful episode, production, category,
SEO and appearance mutations synchronously purge the owning entrypoint's cache.
A purge failure is logged and exposed as `X-Public-Cache: invalidation-failed`;
it does not falsely report that an already committed content write failed.

Published R2 cover images use finite responsive WebP candidates at 160, 240, 320,
480, 640 and 960 pixels. The theme and saved episode version are part of the URL.
Native Images crops to the same centered, bleed-adjusted artwork window as the
frontend, so rectangular originals are not undersampled by `object-fit: cover`.
It streams the original without modifying R2 or adding text/frames. Sources above
the native 20 MB input bound or failed transformations temporarily redirect to
their validated original with `no-store`; they are not cached as successful WebP.
The separate 4 MiB / 4MP guards on composed PNG export do not apply to this native
transformation path. Existing small seed WebPs and external images retain their
original URLs. Lazy loading remains enabled outside the detail artwork.

The home page preloads responsive hero variants using the same source sets,
media queries and size calculation as the visible picture. Fingerprinted hero
assets are immutable; replaceable media keeps bounded cache lifetimes. Re-measure
mobile Lighthouse after deployment rather than treating preload as a score claim.
The manifest and Apple touch icon reuse the existing identity.

## Share and podcast artwork

Non-episode pages use the configured site sharing image, falling back to
`/brand/share.jpg` when `defaultOgImageUrl` is empty or absent. The committed
1200 x 630 JPEG is theme-independent Stillwood branding: paper texture, a thin
frame and the his.fm wordmark, without episode copy. Existing site-wide and
page-specific image overrides remain effective on these pages. Clearing
`defaultOgImageUrl` is valid and restores the code fallback without changing
other saved settings.

Episode pages use `/episodes/{encoded-id}/share.jpg` for both `og:image` and
`twitter:image`. An explicit episode SEO `ogImageUrl` wins; site image overrides,
site defaults and the source cover URL do not replace the per-episode image.
The stable record ID is URL-encoded independently of the public category/slug
page URL. This 1200 x 630 JPEG cover-crops the clean original full-bleed with a
theme-independent Stillwood frame and wordmark. It has no title, title panel,
episode number or category copy.

Both site and category RSS feeds include an `itunes:image` on every emitted
item, pointing to `/episodes/{encoded-id}/art.jpg`. The default 1400 x 1400 JPEG
uses the current site theme's complete framed cover composition, including the
real title, episode number and category. Originals are expected to be 1400 square;
smaller 1024px originals still upscale gracefully. Larger originals are read automatically, with composition
and effective detail capped at 1600 square. `?size=N` accepts 1400–3000; outputs
above 1600 are upscaled JPEGs rather than additional native-resolution detail. Item
artwork is independent of episode social-image overrides and channel artwork.
The channel uses the configured `podcastCoverUrl`; an empty value falls back to
the committed 3000 x 3000 `/brand/podcast.jpg`, not the landscape sharing image.

The public episode JPEG endpoints serve published episodes only and render on
demand with `no-store`; they do not enter the named public-content cache or the
responsive WebP-thumbnail cache. These sRGB JPEG derivatives have no alpha or
embedded ICC profile and never overwrite clean originals or saved publication
snapshots. Static brand assets are committed with their reproducible generation
script. These code defaults do not rewrite saved or live SEO settings.

## Studio social previews

The standalone episode editor, linked episode snapshot, production publication
panel and homepage SEO settings include a live platform selector for X/Twitter,
Facebook, LinkedIn, WeChat chat, Slack, Discord, iMessage and Telegram. These are
responsive CSS approximations, not embedded platform renderers or crawler checks.
Landscape cards use the resolved sharing image; WeChat center-crops that same
image to a square thumbnail. Platform-specific widths, line clamps, colors and
image placement simulate common presentations, but actual apps may crop,
truncate, omit descriptions or cache old data differently. WeChat may also need
publisher-side JS-SDK configuration; this preview does not implement it.

Episode metadata reuses `projectPublicEpisode` and its shared `seo-resolve` chain,
including the category label, site and episode overrides, canonical category/slug
URL and stable record-ID `share.jpg` URL. Homepage previews call
`resolveSiteDefaults`. The expandable metadata section shows the exact resolved
title, description, URL, image, Twitter card type and robots value. The configured
site name is shown as a settings value, not a claim that `og:site_name` is emitted.
Local previews use the current origin; selecting production data uses `https://his.fm`.

Editor text follows unsaved edits without saving them. Images load only for a
saved, already-published, non-future snapshot whose cover and image override are
unchanged; drafts, changed images and future publications show an explicit
placeholder without requesting their public image endpoint. Homepage images also
wait until their resolved URL matches the saved settings. Failed image loads show
an unavailable state, never a substitute original cover. This is not proof that a
platform crawler can access or has refreshed the image.

The production panel finds linked snapshots only by `sourceProductionId`. When a
snapshot exists it previews that snapshot, not a newer production revision; a
clear notice distinguishes the two. Before first publication it projects the
currently saved production as a draft, without loading a public image or claiming
publication. None of these previews publishes content, changes approval state,
uploads media or posts to an external platform.

## Podcast launch requirements

The site and category feeds use published episodes with real, positive-length
MP3 audio objects in the configured R2 bucket. WAV uploads remain playable on the
website but are omitted from directory RSS: Apple accepts MP3/AAC for RSS, not
the WAV formats accepted by its separate subscriber-upload workflow. The CMS
currently accepts MP3/WAV uploads; it does not transcode audio or accept AAC.
Only configured CDN URLs and local
`/media/` URLs can resolve to those objects. Unknown external hosts are not
fetched. Entries without usable audio are omitted; preview content is not a
podcast enclosure. Durations use rounded positive stored seconds, including
historical fractional values; file size is never used to infer duration.

The versioned SEO settings expose:

- `podcastCoverUrl`: an optional custom JPEG/PNG URL, independent of the Open Graph image.
- `podcastOwnerEmail`: the explicitly approved public contact email.
- `podcastAuthorType`: `Person` or `Organization`, defaulting to `Organization`.
- `podcastAuthorUrl`: an optional owner-confirmed HTTPS homepage, defaulting empty.

Empty saved cover/email values remain empty. RSS resolves an empty cover to the
brand square; it never invents an owner email. URL validation does not prove
custom artwork dimensions or color space. Before directory submission, inspect
the actual channel and item images: square, 1400-3000 pixels, JPEG/PNG, RGB.
The source 768px WebP and archived 1024px originals are not directory artwork by
themselves; use the generated JPEG derivatives rather than those source URLs.
Do not invent an email or change the author identity on behalf of the owner.

RSS emits boolean explicit values, owner metadata when configured, an
`atom:author` URI when `podcastAuthorUrl` is set, byte lengths from R2 metadata
and standard iTunes channel taxonomy. Submission acceptance
still requires live endpoint and platform validation after deployment. The
1200 x 630 Open Graph image is separate from the square podcast cover.
See [the owner content checklist](seo-content-checklist.md) for confirmed values,
artwork delivery requirements, per-production SEO and the versioned correction
path. Deployment alone does not populate these production settings.

References:

- https://podcasters.apple.com/support/823-podcast-requirements
- https://podcasters.apple.com/support/893-audio-requirements
- https://podcasters.apple.com/support/1691-apple-podcasts-categories
- https://providersupport.spotify.com/article/podcast-delivery-specification-1-9
- https://support.spotify.com/us/creators/article/adding-your-email-address-to-your-rss-feed/
