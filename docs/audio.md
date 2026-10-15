# Audio uploads and playback

Content generation and audio composition happen outside his.fm. The site stores validated finished recordings and bumper files, presents a custom player and tracks script-version provenance. It has no provider keys, generation endpoint, job queue or voice-selection settings. Narration guidance remains editable as `channel.prompts.narration`.

## Recording contract

`PUT /api/agent/productions/:id/assets/audio?version=N`

- Requires `productions:write` and `storage:write`, the current optimistic version and an approved current script.
- Body is raw `audio/wav`, not multipart or JSON. `Content-Length` is required; browsers set it from the selected file.
- RIFF WAV with PCM16, one channel, 24,000 Hz; duration must be positive and at most 1,800 seconds.
- Maximum request size: 86,465,536 bytes, including up to 65,536 bytes of header. No duration query/body is accepted; the server derives it from validated audio.
- Server-chosen unique R2 key, immutable cache policy and conditional creation. The stored asset records size, duration, script version, timestamp and `source: "upload"`.
- Changed script/production versions fail attachment rather than marking obsolete audio complete. No fabricated generation job is required.

`DELETE /api/agent/productions/:id/assets/audio?version=N` detaches audio with the same scopes and stage policy. It does not remove immutable bytes. Cover detach follows the same rule. Asset changes after approval additionally need `productions:reopen`; approval scope alone is not enough.

## Other media

- Cover upload: raw PNG/JPEG/WebP, matching Content-Type and validated signature, at most 8 MiB.
- Generic `POST /api/agent/storage`: raw PNG/JPEG/WebP or complete 24 kHz mono PCM16 WAV, at most 25 MiB. The server chooses `uploads/<UUID>`, never a caller-supplied overwrite key. This operation does not attach a production asset.
- `POST /api/agent/bumpers?name=...&position=intro|outro`: PCM WAV at most 30 seconds and 3 MiB. Versioned metadata updates preserve its key; catalogue deletion preserves R2 bytes. The website does not mix bumpers into recordings.

## Player

`apps/web/src/components/AudioPlayer.tsx` is shared by public episode pages, production assets, bumpers and storage previews. A hidden HTML audio element is the playback engine; browser-native controls are not shown.

The player supports play/pause, elapsed/total time, pointer/touch drag and keyboard seeking, volume/mute, playback speed, loading and retry. Cover images are non-draggable. Changing the source resets playback; starting another instance pauses the previous one. Admin compact mode uses Basalt tokens in both themes; the public player retains the listening room's visual identity.

R2 responses support HEAD, ETag/Last-Modified preconditions and one byte range, returning 206 or 416 as appropriate. Seek acceptance uses real browser playback with Range-enabled synthetic WAV files rather than merely asserting slider appearance. A record without audio shows an explicit manuscript-only state.

## Preservation and cleanup

Existing valid recordings, approvals and publication history survive retirement of generation state. Migration 0015 retains only allowlisted media provenance, not conversations, credentials or provider configuration. Reserved `images/` and `reference/` objects, referenced media and uploads younger than 24 hours remain protected from cleanup. Detach is not delete; see [operations](operations.md) for physical deletion limits.
