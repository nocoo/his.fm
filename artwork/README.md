# his.fm artwork

Four original illustrations generated with Azure OpenAI `gpt-image-2.5-sunburst`, high quality. The reference image was visually inspected to inform the art direction; it was not sent as an image-edit input.

- `originals/` preserves the native generated PNGs, including any embedded provenance.
- `prompts/` contains the exact submitted prompts.
- `manifest.json` records model, dimensions, prompt paths, originals, and delivery assets.
- `../public/images/` contains optimized WebP derivatives for the website.

## Regeneration

Run from the repository root, replacing `hero` with the desired asset name. Credentials are loaded by direnv and are never stored here.

```sh
direnv exec ~/workspace/personal/workflow python3 artwork/generate_asset.py hero
```

To rebuild the delivery assets while preserving the native originals:

```sh
uv run --no-project --with pillow python3 artwork/optimize_images.py
```

Delivery images use WebP quality 85: the hero retains its full width and episode covers are resized to 768 pixels. The manifest records original and delivery SHA-256 digests and byte sizes.

The helper requires the local Workflow installation at `~/workspace/personal/workflow/agents/skills/agi-image-generation/scripts/generate.py`. Regeneration incurs a new image-generation request and may produce a different image.

## Art direction

Cinematic forest shade, spring-green light, tactile botanical materials, quiet human scale, warm cream, and restrained violet and coral accents. Images intentionally contain no text or logos so the responsive interface owns all typography.
