# his.fm voice comparison

Single-speaker Mandarin launch announcement for his.fm, an AI sharing channel for developers.

Uses `gemini-3.8-flash-tts` through the Gemini Interactions REST API. Google announced Gemini 3.8 Flash TTS and Flash-Lite TTS on September 23, 2026.

## Generate

Requires Python 3. No third-party packages.

Set `GEMINI_API_KEY` in the environment or in the ignored local `.env` file, then run:

```sh
python3 generate.py Kore Zephyr Puck Charon Aoede Orus
```

Every voice reads the same `script.txt` with the same delivery direction, targeting approximately 20 seconds. Duration varies naturally by voice; output is not truncated or time-stretched. WAV files and request metadata are written to the ignored `output/` directory. Existing files for the selected voices are overwritten.

The curated voice descriptions are Kore (firm), Zephyr (bright), Puck (upbeat), Charon (informative), Aoede (breezy), and Orus (firm). These describe the voices, not separate performance prompts.

## Sources

- [Google announcement](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-8-text-to-speech/)
- [Speech generation documentation](https://ai.google.dev/gemini-api/docs/speech-generation)

The API key and generated audio are excluded from Git. Never put credentials in source files or request metadata.
