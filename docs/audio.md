# Native audio production

## Execution boundary

The Worker does not call a TTS provider and has no Gemini secret or AudioWorkflow binding. It retains authenticated owner APIs, immutable job snapshots, D1 state, R2 storage and deterministic WAV composition. The native coordinator delegates each website-created speech job to a dedicated `speech` conversation with only `generate_speech` and `submit_result`. The tool launches `packages/agent/src/speech-cli.ts` as a bounded Node subprocess. The script reads private credentials itself; neither keys nor raw configuration enter model messages, browser responses, shell arguments or job records.

The user-global `~/.config/his.fm/config.json` owns `speech`, `speechKeys` and an opaque `configRevision`. Settings updates use a SQLite process lock, optimistic revisions and atomic 0600 file replacement. Local and production runtimes share provider settings but retain separate website tokens, station leases and tasks. Restart does not clear jobs or copy tokens between environments.

## Providers and format

- Gemini: `gemini-3.8-flash-tts`, Interactions API, separate speech metadata for delivery instructions, the existing 30 prebuilt voices.
- ElevenLabs: `eleven_v4`, text-to-speech conversion API, selected voice ID, Stability and Similarity. Delivery instructions become audio tags; v4 does not support the Speed/Style controls or SSML. Requests specify Mandarin and `pcm_24000`; the native codec wraps PCM in a valid WAV header.

Both providers produce mono 24 kHz signed 16-bit PCM WAV. Sentence-aware chunks preserve the spoken script and are capped at 420 Unicode code points. Each provider call has a 180-second deadline and bounded response size. HTTP errors are sanitized. Native content-addressed chunks and completed audio survive retries; a lost provider response before local persistence can still incur a second charge. No exactly-once billing guarantee is claimed.

Native assembly is bounded to 30 minutes and stores its result in the private speech cache. The website accepts binary uploads only from the enrolled active station generation and exact command/job scope. D1 checks the lease, command, approved script version and current job before committing. Job state and production attachment are transactional; completed audio cannot regress on replay.

## Pages and owner APIs

- `/admin/appearance`: Brand Appearance, retaining the existing versioned website theme settings.
- `/admin/ai`: provider model/voice parameters and write-only new keys. `GET /admin/api/ai-settings` returns an allowlisted status projection; `PUT` uses the current version. No endpoint returns an existing key, masked key or complete private config. Offline state is unavailable, not unconfigured.
- `/admin/connections`: environment-specific machine tokens.
- `/admin/narration`: provider-independent delivery style and optional short preview.
- `/admin/bumpers`: named intro/outro WAV library. Production selects each position independently, defaulting to none.
- `/admin/voices`: same-script Gemini and ElevenLabs comparisons alongside the original six Gemini references.

`POST /admin/api/production-settings/preview` accepts `{ provider, voice, speakingStyle, text }` with at most 200 characters. It returns a cached preview or `202 { jobId }`. Poll `GET /admin/api/production-settings/preview/:id`; completion exposes the real WAV URL and duration. The canonical cache digest includes provider, model, voice, style, text, Stability and Similarity. Identical active jobs deduplicate; an explicit retry of failed work creates a fresh command attempt over the same cache identity.

`GET /admin/api/production-settings/previews` lists completed previews matching the common comparison script. Samples are actual generated audio, not placeholders. `POST /admin/api/productions/:id/audio` requires the current optimistic version and human-approved script. Optional provider/voice/style overrides and independent `introId`/`outroId` are frozen into the job.

The native speech transport is `GET/POST/PUT/DELETE /api/agent/runtime/speech/:id`, protected by Bearer authentication, station ID, generation and command headers. GET reads the immutable job; POST marks execution; PUT uploads verified audio; DELETE records a failed attempt. It does not grant general file upload, approval, publication or config privileges.

## Acceptance and limitations

Local acceptance generated the same Chinese script with Gemini Kore (25.00 s) and ElevenLabs George (21.04 s), Sarah (21.20 s), Liam (19.92 s). Dedicated speech conversations returned successful website receipts and the comparison page lists the resulting local R2 audio. Credentials never appeared in those receipts. Valid PCM and successful receipts do not establish verbatim acoustic transcription or human listening approval.

The owner's supplied `kLhAstPcnnPxqzk6gS5i` voice remains configured. The current account rejected this library voice with `payment_required`; the three comparison voices were verified separately. Voice-list permission is also absent on this key. The UI never claims a present key guarantees every voice is callable. No account upgrade, production upload or deployment was performed.

## References

Retrieved 2026-10-04:

- https://elevenlabs.io/docs/overview/capabilities/text-to-speech/eleven-v4
- https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices
- https://elevenlabs.io/docs/api-reference/text-to-speech/convert
- https://ai.google.dev/gemini-api/docs/speech-generation
- https://developers.cloudflare.com/durable-objects/best-practices/websockets/
