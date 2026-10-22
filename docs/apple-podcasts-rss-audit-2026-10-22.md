# Apple Podcasts RSS audit - 2026-10-22

## Scope and evidence

Read-only inspection of `https://his.fm/feed.xml` and its 11 published items,
against production v2.10.7 (`40cda6feaa8938ff9766eab481d1b8f93b90a2cb`).
Checks covered XML, source implementation, HTTP GET/HEAD/range responses,
image properties and short MP3 samples. Artwork GETs can populate managed caches.
No content changes, uploads, Apple submission or Podcasts Connect validation were
performed. This is not an Apple acceptance certificate.

Temporary local evidence was saved in `/tmp/hisfm-apple-rss.xml` and
`/tmp/hisfm-apple-audit/report.json`, with image bodies and 64 KiB audio samples
in the latter directory. Temporary files are not durable repository evidence;
the observations below record the inspected state, not a continuing guarantee.
Owner contact values are intentionally omitted.

## Verified checks

- Public HTTPS feed GET and HEAD returned 200 with
  `application/rss+xml; charset=utf-8`. RSS 2.0 XML parsed with iTunes/content
  namespaces.
- Channel title, description, `zh-CN` language, author, `Technology` category,
  `itunes:explicit=false`, image and configured owner email were present.
  The channel description occupied 99 UTF-8 bytes.
- All 11 current GUIDs and enclosure URLs were unique. Enclosure URLs were ASCII;
  publication dates were valid and not in the future.
- All 11 MP3 HEAD requests returned 200; actual Content-Length matched enclosure
  length. All audio requests for bytes `0-65535` returned 206 with correct ranges.
  Sampled streams reported MP3, 24 kHz, mono, 128 kbps.
- Channel artwork was JPEG, 3000 x 3000, sRGB, opaque, 72 DPI,
  **1,033,583 bytes (about 1009 KiB)**. Its byte-range request returned 206.
- All 11 episode images eventually returned 200 and were JPEG, 1400 x 1400,
  sRGB, opaque, 72 DPI. HEAD responses included Content-Length and Last-Modified.
  Initial transient failures are recorded separately below.

## Findings and follow-up

### 1. GUID stability is not preserved across URL changes

`apps/web/worker/feed.ts` builds each GUID from the public category/slug URL and
sets `isPermaLink="true"`. Current uniqueness passes, but changing the category or
slug changes the GUID. Apple requires GUIDs to remain stable even when other
episode metadata changes.

Use a persistent episode identity for new items. Before changing existing GUIDs,
establish whether a directory has already ingested them and preserve those
identities; blindly replacing all existing GUIDs can create duplicates or lose
continuity. No GUIDs were changed during this audit.

### 2. Description length and rich-text compatibility need normalization

The latest daily episode (2026-10-22) had 12,842 characters in its XML-decoded
description including HTML, or approximately 6,611 visible characters after
stripping tags. Apple's tag reference states a 10,000-character description
limit. The raw decoded field exceeds it; actual Apple counting and rejection
have not been tested.

Descriptions contain XML-escaped HTML rather than CDATA and use
`section`, `h2`, `ul`, `li` and `a`. Apple's documented rich-text route uses CDATA
and a limited HTML set (`p`, `ol`, `ul`, `li`, `a`). The XML remains valid, but
rendering compatibility is not proven. `itemDescription` and `renderItem` in
`apps/web/worker/feed.ts` currently impose no description budget.

Normalize supported HTML and enforce an explicit serialized description budget
without changing the full website notes. Treat this as a compatibility risk,
not evidence that Apple has already rejected the feed.

### 3. Cold episode artwork can temporarily return 503

With three concurrent audit requests, the 2026-10-20 episode image initially
returned 503 with `Retry-After: 1` and an artwork-generation-in-progress message.
A later sequential request returned 200. This was a transient generation issue,
not a persistently missing image.

`ensureEpisodeArt` in `apps/web/worker/episode-art.ts` checks R2 before an
isolate-level composition guard. A newly versioned frame can leave a cold cache
and expose this guard to crawlers. Plan reliable delivery/prewarming around
artwork changes; do not simply remove the memory-protection guard.

### 4. Episode artwork does not honor byte ranges

A request for bytes `0-15` of a dynamic episode `art.jpg?v=...` returned 200 and
the entire 390,567-byte JPEG, rather than 206 and 16 bytes. The channel image and
all tested audio ranges passed. Apple's validation guidance asks media/artwork
hosting to support HEAD and byte ranges. Record this as an interoperability gap,
not a demonstrated automatic rejection.

### 5. AI disclosure requires a content-level decision

Apple's content guidelines section 1.11 requires disclosure in audio/video and
metadata for episodes and shows using AI-generated content such as synthetic
voices. Inspected show/about copy and episode descriptions did not clearly
disclose synthetic narration; discussing AI as a topic is not such a disclosure.

The audit did not listen to full episodes or establish how every recording was
made. Confirm actual usage with the owner before concluding noncompliance. If
synthetic narration is used, review both spoken and metadata disclosures. Codec
properties and repository capabilities alone do not prove synthetic narration.

### 6. Recommendations and unmeasured properties

- The owner requests a replacement show cover under **512 KiB**. The current
  image exceeds that target. This audit did not establish 512 KiB as an enforced
  Apple ingestion limit; dimensions and encoding already passed.
- For 24 kHz mono, Apple's recommended bitrate range is 40-80 kbps. The current
  128 kbps MP3s are heavier than recommended, not an unsupported RSS format.
  Do not apply the separate subscriber-audio WAV/FLAC requirements to RSS MP3s.
- Loudness (-16 LKFS +/-1) and true peak (at most -1 dBFS) were not measured;
  short encoded samples are insufficient for whole-program loudness assessment.
- The newer Episode Art guide recommends avoiding logos/text, whereas older tag
  help contains different branding advice. Current themed episode art includes
  both. This is design guidance, not a demonstrated technical failure; do not
  undo approved episode frames on this basis.
- Ownership/licensing, explicit-content accuracy and complete spoken content
  were not reviewed. Actual Podcasts Connect validation remains outstanding.

## Approved next scope and publication boundary

The owner requested new channel/show artwork and matching landscape homepage
social-sharing artwork in theme 05 (Stillwood), using GPT Image 2.5 Sunburst.
Reference: `grok-image-97059118-f941-47d2-a044-5c17b9f7209b.jpg` in Downloads.
Use the canonical site VI lettering and a parentheses/broadcast-signal motif.
This is separate from the already approved 05/08 episode-frame corrections.

First locate the model invocation and credential configuration without calling
the API, then present the design. Generation remains pending that discussion.
Keep generated originals and optimized delivery copies separate. Deliver a
1400-3000-pixel square, opaque sRGB show cover under 512 KiB and a matching
landscape social image. Inspect native model output dimensions before choosing
derivatives; do not describe an upscaled image as native high-resolution output.
Local owner review must precede any upload or production reference replacement.

## Official references

Consulted on 2026-10-22; requirements can change.

- [Podcast requirements](https://podcasters.apple.com/support/823-podcast-requirements)
- [RSS tags](https://help.apple.com/itc/podcasts_connect/en.lproj/itcb54353390.html)
- [Audio requirements](https://podcasters.apple.com/support/893-audio-requirements)
- [Artwork requirements](https://podcasters.apple.com/support/artwork-requirements)
- [Show cover](https://podcasters.apple.com/support/5514-show-cover-template)
- [Episode art](https://podcasters.apple.com/support/5516-episode-art-template)
- [Validation](https://podcasters.apple.com/support/829-validate-your-podcast)
- [Content guidelines](https://podcasters.apple.com/support/891-content-and-subscription-guidelines)
