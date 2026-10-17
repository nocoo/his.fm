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

- `podcastCoverUrl`: a dedicated JPEG/PNG URL, independent of the Open Graph image.
- `podcastOwnerEmail`: the explicitly approved public contact email.
- `podcastAuthorType`: `Person` or `Organization`, defaulting to `Organization`.
- `podcastAuthorUrl`: an optional owner-confirmed HTTPS homepage, defaulting empty.

Empty cover/email values remain empty and are launch blockers in the studio.
URL validation does not prove artwork dimensions or color space. Before directory
submission, inspect the actual square image: 1400-3000 pixels, JPEG/PNG, RGB.
The current 768px WebP and archived 1024px originals are not compliant. Obtain an
approved original or explicit permission for a derivative; do not invent an email
or change the author identity on behalf of the owner.

RSS emits boolean explicit values, owner metadata when configured, byte lengths
from R2 metadata and standard iTunes channel taxonomy. Submission acceptance
still requires live endpoint and platform validation after deployment. A 1200x630
Open Graph image is a separate social-preview improvement, not the podcast cover.
See [the owner content checklist](seo-content-checklist.md) for confirmed values,
artwork delivery requirements, per-production SEO and the versioned correction
path. Deployment alone does not populate these production settings.

References:

- https://podcasters.apple.com/support/823-podcast-requirements
- https://podcasters.apple.com/support/893-audio-requirements
- https://podcasters.apple.com/support/1691-apple-podcasts-categories
- https://providersupport.spotify.com/article/podcast-delivery-specification-1-9
- https://support.spotify.com/us/creators/article/adding-your-email-address-to-your-rss-feed/
