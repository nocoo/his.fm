# his.fm artwork

Illustrations generated with Azure OpenAI `gpt-image-2.5-sunburst`, high quality. The initial visual reference informed text-only generation. The current Retina hero was subsequently created with an actual reference-image edit of the approved hero.

- `originals/` preserves the native generated PNGs, including any embedded provenance.
- `prompts/` contains the exact submitted prompts.
- `hero-retina-20260926/` preserves the native 3504×2336 hero, edit prompt, API/usage metadata and previous hero manifest.
- `manifest.json` records model, dimensions, prompt paths, originals, and delivery assets.
- `../apps/web/public/images/` contains optimized WebP derivatives for the website.

## Regeneration

For initial episode artwork, run from the repository root with the desired asset name. Credentials are loaded by direnv and are never stored here.

Set `HISFM_IMAGE_HELPER` to the absolute path of your Workflow `generate.py` helper (see `artwork/_image_helper.py`). Credentials load via your own direnv or secret store; they are never stored in this repository.

```sh
export HISFM_IMAGE_HELPER=/path/to/agi-image-generation/scripts/generate.py
direnv exec /path/to/your/workflow-env python3 artwork/generate_asset.py episode-01
```

To rebuild the delivery assets while preserving the native originals:

```sh
uv run --no-project --with Pillow==12.3.0 python3 artwork/optimize_images.py
```

Append `hero` to rebuild only the current hero derivatives. These use WebP quality 90 at 1752/3504 pixels wide, plus 1168/2336-pixel square mobile crops. Episode covers use quality 85 at 768 pixels. The manifest records crop coordinates, dimensions, SHA-256 digests and byte sizes. Never enlarge a derivative beyond its native original.

The hero must be regenerated through Workflow's image-edit route (`/images/edits`, multipart `image[]`), with the approved original as the real input, the archived prompt, model `gpt-image-2.5-sunburst`, size `3504x2336`, quality `high` and PNG output. The text-only helper deliberately rejects this asset. Preserve each new generation in a new archive and use new immutable R2 keys when publishing derivatives.

The previous 1536×1024 image supplied less than 53% of the physical width needed on 14/16-inch MacBook Retina displays. The new native image covers 2928/3360-pixel display widths. Mobile derivatives retain full vertical resolution and place the person at the 61.8% golden line. HTML `sizes` follows the full image extent under `object-fit: cover`, not just the visible crop width, to avoid selecting undersized assets on tall screens.

Regeneration incurs a new image-generation request and may produce a different image.

## Art direction

Cinematic forest shade, spring-green light, tactile botanical materials, quiet human scale, warm cream, and restrained violet and coral accents. Images intentionally contain no text or logos so the responsive interface owns all typography.
