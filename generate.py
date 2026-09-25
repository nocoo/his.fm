import argparse
import base64
import io
import json
import os
from pathlib import Path
import urllib.error
import urllib.request
import wave

ROOT = Path(__file__).resolve().parent
VOICES = ("Kore", "Zephyr", "Puck", "Charon", "Aoede", "Orus")
MODEL = "gemini-3.8-flash-tts"


def generate(voice, key):
    payload = {
        "model": MODEL,
        "input": [{"type": "user_input", "content": [{
            "type": "text",
            "text": (ROOT / "script.txt").read_text().strip(),
            "annotations": [{"type": "speech_metadata", "style":
                "Friendly podcast announcement, natural conversational delivery, "
                "brisk pace, approximately 20 seconds."}],
        }]}],
        "response_format": {"type": "audio"},
        "generation_config": {"speech_config": [{"voice": voice}]},
    }
    request = urllib.request.Request(
        "https://generativelanguage.googleapis.com/v1beta/interactions",
        data=json.dumps(payload).encode(),
        headers={"x-goog-api-key": key, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        detail = error.read().decode().replace(key, "[REDACTED]")
        raise SystemExit(f"调用失败（HTTP {error.code}）：{detail}") from None
    blocks = [content for step in result.get("steps", [])
              if step.get("type") == "model_output"
              for content in step.get("content", [])
              if content.get("type") == "audio"]
    if not blocks:
        raise SystemExit("响应没有音频，请检查模型权限或响应结构。")
    audio = base64.b64decode(blocks[-1]["data"], validate=True)
    with wave.open(io.BytesIO(audio)) as wav:
        duration = wav.getnframes() / wav.getframerate()
        if duration <= 0:
            raise SystemExit("生成音频为空。")
    output = ROOT / "output"
    output.mkdir(exist_ok=True)
    (output / f"{voice}.wav").write_bytes(audio)
    metadata = {"model": MODEL, "voice": voice, "duration_seconds": duration,
                "interaction_id": result.get("id"), "request": payload}
    (output / f"{voice}.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2))
    print(f"已生成 {voice}：{duration:.2f} 秒 → output/{voice}.wav", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("voices", nargs="*", choices=VOICES, default=list(VOICES))
    args = parser.parse_args()
    key = os.environ.get("GEMINI_API_KEY")
    if not key and (ROOT / ".env").exists():
        key = next((line.split("=", 1)[1].strip()
                    for line in (ROOT / ".env").read_text().splitlines()
                    if line.startswith("GEMINI_API_KEY=")), None)
    if not key:
        raise SystemExit("请在 .env 或环境变量中设置 GEMINI_API_KEY。")
    for voice in args.voices:
        generate(voice, key)
