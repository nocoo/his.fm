# his.fm identity artwork archive

Original generated subjects for the static identity studies in [`docs/design`](../../docs/design/README.md).

Each of the seven new directions has one landscape hero and three square episode subjects. Study 01 uses the earlier artwork archive and does not generate replacement images.

- `prompts/NN-hero.txt` and `prompts/NN-01.txt` through `NN-03.txt`: exact generation prompts.
- `originals/`: original model outputs, without destructive edits or resaving.
- `requests/`: deployment name, quality, requested dimensions, timestamps, completion status, and any previous attempt records.
- `manifest.json`: original dimensions, byte sizes, hashes, and corresponding delivery directories.
- `generate.py`: a small sequential driver importing the canonical Workflow image-generation helper.

The model is Azure OpenAI `gpt-image-2.5-sunburst`, with `quality=high`. The canonical helper is `workflow/agents/skills/agi-image-generation/scripts/generate.py`. Authentication stays inside the Workflow direnv environment. No credentials, authenticated headers, or API response payloads are archived here.

All lettering, symbols, borders, and cover typography are separately authored vector layers. The images intentionally contain no brand text. Illustrated people are fictional adults; the artwork does not claim a documentary encounter or a host's personal experience.

Working request logs and temporary previews stay under the repository's ignored `.local/design/` directory. Delivery WebPs and composed SVG/PNG exports live in `docs/design/assets/NN/`. Existing originals are never overwritten by the driver.
