# Audio uploads and playback

Content generation and audio composition happen outside his.fm. The site stores validated finished recordings and bumper files, presents a custom player and tracks script-version provenance. It has no provider keys, generation endpoint, job queue or voice-selection settings. Narration guidance remains editable as `channel.prompts.narration`.

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

The studio `/admin/voice-preview` catalogue compares 55 recordings: 30 Gemini **3.8 Flash TTS**, 20 ElevenLabs **Eleven v3**, and five Microsoft **MAI-Voice-2.1** high-fidelity voices. Gemini's display label follows the owner's identification of the existing recordings; it is not a new API deployment identifier. Existing Gemini and ElevenLabs files are unchanged.

`apps/web/src/shared/data/voice-preview-manifest.json` owns voice IDs, durations and MP3 object keys; `voice-preview-sample.md` beside it owns the fixed comparison transcript. Samples use the `his-fm` R2 bucket and `https://f.no.mt/reference/voices/` CDN, with `gemini-<Voice>.mp3`, `elevenlabs-<Voice>.mp3`, and `mai-2.1-zh-CN-<Voice>.mp3` filenames. Keep new object keys immutable and check for collisions before uploading. Storage cleanup protects the entire `reference/` prefix.

The unified grid has provider/gender filters, search, an expandable transcript and optional technical IDs/keys. Gender labels remain visible alongside subtle card tints; River retains ElevenLabs' non-binary classification. Gemini genders follow [Google's voice options](https://docs.cloud.google.com/text-to-speech/docs/gemini-tts#voice_options); ElevenLabs uses the exact first metadata token, and MAI uses the regional voice-list response. Each card probes the CDN with `HEAD`, uses its ETag for playback cache busting and retains missing/loading/error feedback. The condensed shared player retains seeking, mute, speed, retry and single-instance playback without duplicate titles, an idle slogan or a volume slider.

### MAI reference generation

On 2026-10-20, the owner authorized external synthesis and R2 uploads, not a website deployment. Azure Speech's `eastus2` voice-list endpoint exposed `zh-CN-Bo`, `zh-CN-Grant`, `zh-CN-Harper`, `zh-CN-Lan` and `zh-CN-Mei`, each with the `:MAI-Voice-2.1` suffix. Bo/Grant are male; Harper/Lan/Mei are female. No Flash samples, cloned voices, model switch or generation endpoints are included.

The [MAI REST contract](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/mai-voices?pivots=programming-language-restkey&tabs=mai-voice-2-1) uses `POST https://eastus2.tts.speech.microsoft.com/cognitiveservices/v1`, a Speech resource key in `Ocp-Apim-Subscription-Key`, `Content-Type: application/ssml+xml`, and `X-Microsoft-OutputFormat: audio-24khz-160kbitrate-mono-mp3`. The XML-escaped canonical transcript (trailing whitespace removed, 680 characters) is the entire text of one `voice` element under `speak xml:lang="zh-CN"`; no style, prosody or text rewriting is applied. Keys remain outside this repository and the website.

All five files were checked with `ffprobe` for mono 24 kHz MP3 and measured duration, then uploaded with the pinned local `cf r2 objects put` command using `--bucket-name his-fm --content-type audio/mpeg --file <path>`. CDN bytes must match local SHA-256, with successful CORS and byte-range playback checks. Raw MP3/SSML and local execution receipts stay outside Git.

Transcript SHA-256 (UTF-8 after trimming trailing whitespace): `eb9085f45475e3680f0b44e936db7f1a63d5e442150674a42014409e5a609ce4`.

| Voice | Seconds | Bytes | MP3 SHA-256 |
| --- | ---: | ---: | --- |
| Bo | 97.248 | 1944960 | `6119f8ed1226650b907bf3d851ad3248ebefbadb9874f573ef057bfe6e91e42b` |
| Grant | 100.296 | 2005920 | `4e7747f654df81e3f665b1d79f1eb56eaeeeaa18ef4230a6fddd1b1117dce3ae` |
| Harper | 99.144 | 1982880 | `94979acae5b7c1f1a7ede8a7245cf3b968ae987efbffe67c7e4cacc7c1a351cc` |
| Lan | 122.448 | 2448960 | `e06960150955ffa8721fb0dd8a3ea7899e8c65d07ea80e853d2d559bffa2bdcd` |
| Mei | 98.568 | 1971360 | `50e36d2f9cc3cdbc98f5043c22ddbe50d6cad246adb121280c7b5f3ebedf56d3` |

## Player

`apps/web/src/components/AudioPlayer.tsx` is shared by public episode pages, production assets, bumpers and storage previews. A hidden HTML audio element is the playback engine; browser-native controls are not shown.

The player supports play/pause, elapsed/total time, pointer/touch drag and keyboard seeking, volume/mute, playback speed, loading and retry. Cover images are non-draggable. Changing the source resets playback; starting another instance pauses the previous one. Admin compact mode uses Basalt tokens in both themes; the public player retains the listening room's visual identity.

R2 responses support HEAD, ETag/Last-Modified preconditions and one byte range, returning 206 or 416 as appropriate. Seek acceptance uses real browser playback with Range-enabled synthetic WAV files rather than merely asserting slider appearance. A record without audio shows an explicit manuscript-only state.

## Preservation and cleanup

Existing valid recordings, approvals and publication history survive retirement of generation state. Migration 0015 retains only allowlisted media provenance, not conversations, credentials or provider configuration. Reserved `images/` and `reference/` objects, referenced media and uploads younger than 24 hours remain protected from cleanup. Detach is not delete; see [operations](operations.md) for physical deletion limits.
