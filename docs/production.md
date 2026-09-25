# AI podcast production

The production record is the coordination boundary between Hermes, local creative agents, Cloudflare and the owner. Sources are stored as references or text; the server does not fetch arbitrary URLs. The editorial intent belongs to the brief and guides all generation prompts. Local agents verify the original sources before writing.

| Stage | Executor | Human decision |
| --- | --- | --- |
| Brief | Hermes collects article/GitHub URLs or text and intent | Mark the angle complete, or keep editing |
| Transcript | Hermes delegates to local Codex or another agent | Read and edit the full text, then mark the exact script version complete |
| Parallel production | Local GPT Image 2.5 cover; local description; Cloudflare Gemini audio | Review the cover, introduction and complete recording |
| Ready | Platform material preparation | Confirm final assets |
| Manual publication | Owner pastes into WeChat or Xiaoyuzhou | Record actual URL/time and synchronize approved website snapshot |

An agent bearer token can create, read, revise and delete unpublished production records, upload cover images, fetch prompts, submit for review, and dispatch audio. It cannot approve any review or record platform publication. Token creation/revocation is protected by Cloudflare Access; raw tokens are displayed once and only SHA-256 hashes are stored. Agent routes live outside `/admin` at `/api/agent`, so Access does not intercept the independent bearer authentication.

Every write requires the current `version`. A stale write returns 409; refetch and review changes before retrying. Agents edit only fields allowed in the current stage. The owner can edit any stage directly and mark the brief or script complete without a separate submission step. Completion actions can include validated `changes`, saved atomically with the transition. Earlier edits revoke dependent confirmations and make existing media stale while preserving text, files and publication history. A task preserves feedback and review history. Public episodes are immutable publication snapshots; editing those through the old catalog CRUD is blocked. An existing published snapshot remains available while a new revision is prepared.

## Owner studio

The top navigation exposes five stages through `?step=brief|script|assets|review|publish`. Any stage can be viewed immediately, without changing stored state. Completion turns its marker green and opens the next view. Required materials and owner confirmations still protect paid generation and publication. Earlier content remains editable; changing it revokes dependent confirmations while preserving the existing material. Reopening a completed stage allows local agents to work again without deleting the previous version.

Only one stage is mounted at a time. Cover, copy and audio have their own task tabs, with drafts retained between them. Unsaved changes require confirmation before switching stages or environments. Long text uses the same Charter/TsangerJinKai02 typography as xray Channel, safe Markdown and natural page height. Editing fields grow with content; fonts are private admin assets with provenance in their NOTICE.

Every stage identifies its execution location. Agent task buttons copy the selected environment, production ID, current API contract and saved content into a ready task; credentials are referenced only by environment variable name. Copying is disabled until unsaved content is saved. The owner can explicitly refresh after local agent work.

## Local creative work

`GET /api/agent/productions/:id/prompts` returns brief, script, cover and description prompts containing the intent, sources, approved script, review feedback and channel policy. Internal editorial rules guide preparation but must never be recited in published text.

Use the Workflow `agi-image-generation` skill, default deployment `gpt-image-2.5-sunburst`, for cover artwork. Save the original and exact prompt. The artwork itself contains no generated typography. Apply the canonical cream/grass-green brand frame and episode number:

```sh
uv run --with Pillow==12.3.0 python scripts/frame-cover.py original.png cover.webp --episode 1
```

The tool produces a square 1600×1600 WebP and refuses to replace its source. Upload that finished file using the cover endpoint. Human final review checks the composition and frame.

Hermes writes `summary` and `description` after script approval. Platform descriptions should contain meaningful listening points and verified source links. Do not invent timestamps before the final audio has been checked.

## Cloud audio

The Worker secret is `GEMINI_API_KEY`. Settings contain the selected voice, speaking style, and two immutable intro/outro R2 keys. Upload both bumpers in the studio before dispatching a complete episode; each must be 24 kHz, mono, 16-bit PCM WAV, at most 30 seconds. Convert an existing recording locally when needed:

```sh
ffmpeg -i intro-original.mp3 -ar 24000 -ac 1 -c:a pcm_s16le intro.wav
```

The `his-fm-audio` Cloudflare Workflow snapshots the approved script and settings. It checkpoints narration in sentence-aware chunks of at most 420 Unicode codepoints, calls `gemini-3.8-flash-tts`, saves WAV segments in R2, then streams intro + narration + outro into a single valid WAV. No full-recording memory buffer or browser tab is required. Format, source ETag and duration checks protect composition. Files are immutable and delivered through `https://f.no.mt`; local uploads stay in local R2 and use `/media/`.

A script revision invalidates an old running job before another paid generation step or result attachment. Completed checkpoints are reused by Workflow retries; a manually started replacement job has a new identity. The UI displays dispatch/generation failures and permits retry. Provider response bodies and credentials are never returned to clients.

## Publishing

The WeChat copy command is based on Firefly's approach: inline typography, approved cover, external links converted to numbered references, and both `text/html` and `text/plain` clipboard representations. Raw HTML and unapproved inline images are removed. Xiaoyuzhou receives clean plain text with paragraphs and timestamps preserved. Title and summary can be copied separately; WeChat body does not repeat those editor fields.

Copying content does not mark it published. The editor supplies the actual platform link and publication time and confirms publication. The D1 transaction records the platform event and updates the website snapshot only if the reviewed version is still current. The app does not log into either publishing platform.

See [Agent API](agent-api.md), [Audio implementation](audio.md), and [CI/CD](ci-cd.md).
