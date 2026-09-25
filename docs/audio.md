# Cloud audio production

The audio utilities in `worker/audio.ts` use Gemini `gemini-3.8-flash-tts` through the Interactions API already exercised by the repository's `generate.py`.

## Format and memory bounds

Approved transcript text is segmented at sentence boundaries where possible, with a hard ceiling of 420 Unicode code points per request. Concatenating the chunks reproduces every original character. Spoken text is submitted as the text content itself; delivery instructions are separate `speech_metadata` annotations.

Every returned chunk and any selected intro/outro asset must be a complete RIFF WAV containing mono, 24 kHz, signed 16-bit PCM. No resampling, mixing, invented bumpers, or format guesses occur. The parser understands RIFF chunks and their padding rather than assuming every file has a 44-byte header. Header inspection uses an R2 range request capped at 64 KiB. Files with larger pre-audio metadata are rejected.

Gemini response JSON is bounded to 16 MiB before parsing, and each request has a 180-second timeout. The provider's response body is never included in HTTP error messages. API credentials are used only in the `x-goog-api-key` header.

Narration is assembled independently at `narration.wav`. If explicitly requested, a second composition adds both configured bumpers at `final.wav`. The default requires no bumper files. Each output records its voice and whether bumpers were included. Composition reads each source's PCM range sequentially and emits one canonical WAV header. Source ETags are pinned between inspection and consumption. A `FixedLengthStream` gives R2 the exact output byte count and enforces stream length. The complete episode is never buffered in memory. Output is limited to 30 minutes; at the fixed PCM format, a ten-minute narration occupies about 28.8 MB before bumpers. Final objects receive immutable cache metadata, so callers must always supply a unique per-job destination key.

## Orchestration contract

The caller owns the durable workflow, immutable job snapshot, configured bumper assets, retry policy, and approval/version comparison. It must check existing R2 chunk objects before invoking generation during a retry, persist each successful chunk under its job-specific key, and attach final results only when the current approved script version and job ID still match. A lost provider response before its chunk reaches R2 can require a second paid generation: the current endpoint does not establish an application-level exactly-once billing guarantee.

The utilities expose `AudioError.retryable` for provider HTTP 429 and 5xx responses. Other malformed-response and format errors fail without an automatic format fallback. Transient network exceptions remain ordinary errors for the workflow retry policy.

A successful generation and a valid WAV container establish neither a verbatim acoustic transcription nor editorial approval. The workflow should preserve the submitted script and require an audition before publication.

## Selection and preview

The settings page offers Google's 30 featured prebuilt voices with Mandarin-friendly labels, a delivery-style field and optional short preview. The original six voice references remain available. Per-episode selections override the defaults for that job only; each job snapshots its voice, style and optional bumper keys before dispatch.

`POST /admin/api/production-settings/preview` is owner-only and accepts `{ voice, speakingStyle, text }`, with text limited to 200 characters. It calls the same Gemini synthesis code as full narration, stores a validated WAV in R2 and returns its CDN URL and duration. A content hash over model, voice, style and text reuses an existing preview. Failed or changed previews never represent another selection. Requests with simultaneous identical misses can both reach the provider; the cache is not an exactly-once billing guarantee.

The key remains a Worker secret (`GEMINI_API_KEY`). The settings response exposes only configuration status; neither an agent nor the browser receives the key. The local production proxy allows a longer deadline for the preview endpoint, matching its bounded provider request. Full narration stays in a durable Workflow.

## Retrieved references

Retrieved 2026-09-25:

- [Gemini speech generation](https://ai.google.dev/gemini-api/docs/speech-generation): Interactions request shape, separate speech annotations, default WAV format, PCM encoding and sample rate.
- [Gemini 3.8 Flash TTS model](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-tts): 8,192 input-token and 16,384 output-token serving limits. The 420-character segment ceiling is this application's conservative operating limit, not a claimed provider duration guarantee.
- [Cloudflare Workflow rules](https://developers.cloudflare.com/workflows/build/rules-of-workflows/): idempotent step design and durable state.
- [Cloudflare Workflow limits](https://developers.cloudflare.com/workflows/reference/limits/): step payload/storage limits and CPU versus wall-clock execution limits.
- [Cloudflare Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/): bounded buffering, streaming, bindings, secrets, and asynchronous task handling.
