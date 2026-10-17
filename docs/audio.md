# Audio uploads and playback

Content generation and audio composition happen outside his.fm. The site stores validated finished recordings and bumper files, presents a custom player and tracks script-version provenance. It has no provider keys, generation endpoint, job queue or voice-selection settings. Narration guidance remains editable as `channel.prompts.narration`.

## Recording contract

`PUT /api/agent/productions/:id/assets/audio?version=N`

- Requires `productions:write` and `storage:write`, the current optimistic version and an approved current script.
- Body is raw `audio/wav` or `audio/mpeg`, not multipart or JSON. `Content-Length` is required; browsers set it from the selected file.
- **WAV:** RIFF PCM16, one channel, 24,000 Hz; maximum request size 172,865,536 bytes (including up to 65,536 bytes of header).
- **MP3:** MPEG-1/2/2.5 Layer III with a valid frame sync or ID3 container; maximum request size 144,065,536 bytes (enough for 3,600 seconds at 320 kbps). Mono 96–128 kbps is recommended for narration.
- Duration must be positive and at most 3,600 seconds for both formats (MP3 near the cap allows a tiny validation slack for frame-scan rounding). No duration query/body is accepted; the server derives it from validated audio (WAV data chunk; MP3 Xing/Info gapless metadata when present (including LAME/Lavc/Lavf encoder delay and padding at tag+21..23), otherwise a streaming MPEG-1/2/2.5 Layer III frame scan).
- Server-chosen unique R2 key `productions/{id}/audio-{scriptVersion}-{uuid}.wav` or `.mp3`, immutable cache policy and conditional creation. The stored asset records size, duration, script version, timestamp, MIME type and `source: "upload"`.
- Changed script/production versions fail attachment rather than marking obsolete audio complete. No fabricated generation job is required.

`POST /api/agent/productions/:id/assets/audio/bind` accepts the same formats via allowlisted R2 keys: `uploads/<uuid>.wav|mp3` or `productions/{id}/audio-<scriptVersion>-<uuid>.wav|mp3` for the current production and script.

`DELETE /api/agent/productions/:id/assets/audio?version=N` detaches audio with the same scopes and stage policy. It does not remove immutable bytes. Cover detach follows the same rule. Asset changes after approval additionally need `productions:reopen`; approval scope alone is not enough.

## Other media

- Cover upload: raw PNG/JPEG/WebP, matching Content-Type and validated signature, at most 8 MiB.
- Generic `POST /api/agent/storage`: raw PNG/JPEG/WebP or complete 24 kHz mono PCM16 WAV, at most 25 MiB. The server chooses `uploads/<UUID>`, never a caller-supplied overwrite key. This operation does not attach a production asset.
- `POST /api/agent/bumpers?name=...&position=intro|outro`: PCM WAV at most 30 seconds and 3 MiB. Versioned metadata updates preserve its key; catalogue deletion preserves R2 bytes. The website does not mix bumpers into recordings.
- The learning column (`learning`) uses intro catalogue copy **这里是慢慢学会的每日手冲，我们一起看看今天冲了什么** and keeps outro copy **明天同一时间见** unless owners replace the WAV through **设置 → 贴片** or `PUT /api/agent/bumpers/:id`. Re-upload intro audio separately when the spoken line must change.

## Voice reference previews

Gemini comparison samples are served from immutable R2 keys `reference/voices/<Voice>.wav` on `https://f.no.mt` (for example `Charon.wav`, `Kore.wav`). The studio **品牌外观 → 音色预览** section plays these files in-admin with the shared `AudioPlayer`; it does not call providers or enqueue generation.

ElevenLabs pairs use the same fixed transcript and style prompt as historical comparisons. Upload optional WAVs to `reference/voices/elevenlabs-<Name>.wav` (for example `elevenlabs-George.wav`) to enable playback; until then the UI shows a placeholder. Storage cleanup treats the entire `reference/` prefix as protected brand material.

## Player

`apps/web/src/components/AudioPlayer.tsx` is shared by public episode pages, production assets, bumpers and storage previews. A hidden HTML audio element is the playback engine; browser-native controls are not shown.

The player supports play/pause, elapsed/total time, pointer/touch drag and keyboard seeking, volume/mute, playback speed, loading and retry. Cover images are non-draggable. Changing the source resets playback; starting another instance pauses the previous one. Admin compact mode uses Basalt tokens in both themes; the public player retains the listening room's visual identity.

R2 responses support HEAD, ETag/Last-Modified preconditions and one byte range, returning 206 or 416 as appropriate. Seek acceptance uses real browser playback with Range-enabled synthetic WAV files rather than merely asserting slider appearance. A record without audio shows an explicit manuscript-only state.

## Preservation and cleanup

Existing valid recordings, approvals and publication history survive retirement of generation state. Migration 0015 retains only allowlisted media provenance, not conversations, credentials or provider configuration. Reserved `images/` and `reference/` objects, referenced media and uploads younger than 24 hours remain protected from cleanup. Detach is not delete; see [operations](operations.md) for physical deletion limits.
