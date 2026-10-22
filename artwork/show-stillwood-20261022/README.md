# Stillwood show artwork - local review

Status: generated and composed locally. Not approved for upload or production use.
No RSS, SEO settings, public assets or production records have been changed.

## Generation

- Deployment: `gpt-image-2.5-sunburst`, read from the user-selected environment's
  `AZURE_OPENAI_DEPLOYMENT_NAME` on the successful request.
- Native image: 2880 x 2880, high quality, one text-only generation through the
  Workflow `agi-image-generation/scripts/generate.py` helper function. Its
  function accepts custom sizes despite the CLI's narrower size choices.
- `prompt.txt` is the exact submitted prompt; the reference image was visually
  inspected, not transmitted to the API.
- `background-original.png` preserves returned bytes without modification.
- The first attempt returned 401. After the owner updated the credentials, the
  next request succeeded. Credentials and endpoint values are not archived.

## Composition and delivery

Run `node artwork/show-stillwood-20261022/compose.mjs` from the repository root
to recreate the derivatives without an API request. It requires the installed
project `sharp` dependency and the native background.

The wordmark uses unchanged paths from `apps/web/src/brand/identity.svg` and is
centered by its painted bounds, not its SVG viewBox whitespace. Broadcast echoes
derive from the canonical left parenthesis curve, mirrored to the right. The
ivory color is Stillwood paper `#ECEBE1`; outer echoes are less opaque. This
artwork treatment does not change the site's canonical header lockup.

The square retains the whole background. The landscape uses a centered crop,
with its vector overlay rendered at delivery resolution. Neither is upscaled.
The final JPEGs use sRGB, no alpha, and 4:4:4 chroma sampling. Compression selects
the highest tested integer quality under a conservative 500,000-byte budget.

| File | Purpose | Dimensions | Bytes |
| --- | --- | --- | --- |
| `podcast-cover.jpg` | Proposed channel `itunes:image` | 2880 x 2880 | 483,217 |
| `homepage-social.jpg` | Proposed homepage social image | 1200 x 630 | 144,848 |

`*-master.png` files are lossless composites. `*-overlay.svg` files preserve the
vector treatments; `*-review.png` and the 160-pixel thumbnail are visual checks
derived from the actual compressed JPEGs. `delivery.json` records hashes,
dimensions, sizes, quality settings and canonical identity provenance.

Both actual delivery JPEGs were opened in macOS Preview for owner review.
Uploading and changing production references require subsequent owner approval.
