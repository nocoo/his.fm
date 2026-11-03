# Audio uploads and playback

Content generation and audio composition happen outside his.fm. The site stores validated finished recordings and bumper files, presents a custom player and tracks script-version provenance. It has no provider keys, generation endpoint, job queue or voice-selection settings. Narration guidance is editable in channel/category prompt slots (for example the `voice` slot), not in provider settings.

## Recording contract

`PUT /api/agent/productions/:id/assets/audio?version=N`

- Requires `productions:write` and `storage:write`, the current optimistic version and an approved current script.
- Body is raw `audio/wav` or `audio/mpeg`, not multipart or JSON. `Content-Length` is required; browsers set it from the selected file.
- **WAV:** RIFF PCM16, one channel, 24,000 Hz; maximum request size 345,665,536 bytes (including up to 65,536 bytes of header).
- **MP3:** MPEG-1/2/2.5 Layer III with a valid frame sync or ID3 container; maximum request size 288,065,536 bytes (enough for 7,200 seconds at 320 kbps). Mono 96–128 kbps is recommended for narration.
- Duration must be positive and at most 7,200 seconds for both formats (MP3 near the cap allows a tiny validation slack for frame-scan rounding). No duration query/body is accepted; the server derives it from validated audio (WAV data chunk; MP3 Xing/Info gapless metadata when present (including LAME/Lavc/Lavf encoder delay and padding at tag+21..23), otherwise a streaming MPEG-1/2/2.5 Layer III frame scan).
- Server-chosen unique R2 key `productions/{id}/audio-{scriptVersion}-{uuid}.wav` or `.mp3`, immutable cache policy and conditional creation. The stored asset records size, duration, script version, timestamp, MIME type and `source: "upload"`.
- Changed script/production versions fail attachment rather than marking obsolete audio complete. No fabricated generation job is required.

`POST /api/agent/productions/:id/assets/audio/bind` accepts the same formats via allowlisted R2 keys: `uploads/<uuid>.wav|mp3` or `productions/{id}/audio-<scriptVersion>-<uuid>.wav|mp3` for the current production and script.

`DELETE /api/agent/productions/:id/assets/audio?version=N` detaches audio with the same scopes and stage policy. It does not remove immutable bytes. Cover detach follows the same rule. Asset changes after approval additionally need `productions:reopen`; approval scope alone is not enough.

## Other media

- Cover upload: raw PNG/JPEG/WebP, matching Content-Type and validated signature, at most 8 MiB.
- Generic `POST /api/agent/storage`: raw PNG/JPEG/WebP or complete 24 kHz mono PCM16 WAV, at most 25 MiB. The server chooses `uploads/<UUID>`, never a caller-supplied overwrite key. This operation does not attach a production asset.
- `POST /api/agent/bumpers?name=...&position=intro|outro`: PCM WAV at most 30 seconds and 3 MiB. Versioned metadata updates preserve its key; catalogue deletion preserves R2 bytes. The website does not mix bumpers into recordings.
- The learning column (`learning`) uses intro catalogue copy **这里是慢慢学会的每日手冲，我们一起看看今天冲了什么** and keeps outro copy **明天同一时间见** unless owners replace the WAV through **设置 → 贴片** or `POST /api/agent/bumpers?name=...&position=intro|outro` with a new recording. `PUT /api/agent/bumpers/:id` only updates JSON metadata (`name`, `position`, `version`) and keeps the existing media. Re-upload intro audio separately when the spoken line must change.

## Voice reference previews

The studio route `/admin/voice-preview` compares pre-generated MP3 samples for multiple TTS providers. Samples live in the `his-fm` R2 bucket and stream from `https://f.no.mt/reference/voices/`; the site does not synthesize audio.

### Provider registry

`apps/web/src/shared/voice-preview-registry.ts` is the sole provider registry. Each entry declares:

- `id` — stable provider key referenced by manifest rows
- `name` — studio display name
- `model` — default model label on cards and in search
- `description` — short catalogue copy
- `mark` — icon data for `ProviderMark` (`logo` with a bundled SVG asset, `microsoft` four-square mark, or `initials` with optional background colour)
- optional `defaultTraits` — tags shown instead of parsing `style` (MAI uses `中文` and `高保真`)
- optional `firstTraitIsLocale` — when true, the first trait badge uses the locale styling (ElevenLabs)

Registry order drives provider filter chips and counts. Providers with zero manifest rows stay registered but are hidden from filter controls until samples exist.

Current providers:

| id | name | model | samples |
| --- | --- | --- | ---: |
| `gemini` | Gemini | 3.8 Flash TTS | 30 |
| `elevenlabs` | ElevenLabs | Eleven v3 | 20 |
| `mai` | MAI Voice | MAI-Voice-2.1 | 5 |
| `doubao` | 豆包 | Seed-TTS 2.0 | 3 |
| `fish` | Fish Audio | Drama 3 | 1 |

### Manifest and transcript

`apps/web/src/shared/data/voice-preview-manifest.json` lists every sample with a uniform shape:

- `provider`, `voiceName`, `voiceId`, `gender`, `style`, `durationSeconds`, `objectKey`
- optional `model` when a row needs a label different from the registry default

`voice-preview-sample.md` beside the manifest holds the fixed comparison transcript (`voice-preview-sample.md` content is unchanged). Gender is stored explicitly on each row (`male`, `female`, `non-binary`, or `unknown`).

Object keys must stay under `reference/voices/`, pass `parseVoicePreviewStorageKey`, and remain unique. Filename convention: `<provider>-<voice>.mp3`, for example `gemini-Kore.mp3`, `elevenlabs-Alice.mp3`, `mai-2.1-zh-CN-Bo.mp3`, `doubao-liufei.mp3`, or `fish-drama3-lizheng.mp3`. Upload immutable keys and check for collisions before writing to R2. Storage cleanup protects the entire `reference/` prefix.

Optional upload path for operators with `storage:write`: `POST /storage?key=reference/voices/<name>.mp3` with `Content-Type: audio/mpeg` (see [api-onboarding](api-onboarding.md)).

### Studio behaviour

The unified grid exposes provider and gender filters, search, an expandable transcript, and optional technical IDs/keys. Each card probes the CDN with `HEAD`, uses the response `ETag` for playback cache busting, and keeps missing/loading/error feedback. The shared compact player retains seeking, mute, speed, retry and single-instance playback.

### Adding a provider or voice

1. Append a provider object to `voice-preview-registry.ts` (or extend an existing one).
2. Upload the MP3 to `reference/voices/<provider>-<voice>.mp3` on R2.
3. Append a manifest row with accurate `gender`, `style`/traits source, `durationSeconds`, and `objectKey`.

No React or Worker changes are required when the row validates against the registry and storage rules. Unit tests in `apps/web/tests/voice-samples.test.ts` enforce registry membership, key parsing, and uniqueness.

## Player

`apps/web/src/components/AudioPlayer.tsx` is shared by public episode pages, production assets, bumpers and storage previews. A hidden HTML audio element is the playback engine; browser-native controls are not shown.

The player supports play/pause, elapsed/total time, pointer/touch drag and keyboard seeking, volume/mute, playback speed, loading and retry. Cover images are non-draggable. Changing the source resets playback; starting another instance pauses the previous one. Admin compact mode uses Basalt tokens in both themes; the public player retains the listening room's visual identity.

R2 responses support HEAD, ETag/Last-Modified preconditions and one byte range, returning 206 or 416 as appropriate. Seek acceptance uses real browser playback with Range-enabled synthetic WAV files rather than merely asserting slider appearance. A record without audio shows an explicit manuscript-only state.

## Preservation and cleanup

Existing valid recordings, approvals and publication history survive retirement of generation state. Migration 0015 retains only allowlisted media provenance, not conversations, credentials or provider configuration. Reserved `images/` and `reference/` objects, referenced media and uploads younger than 24 hours remain protected from cleanup. Detach is not delete; see [operations](operations.md) for physical deletion limits.
