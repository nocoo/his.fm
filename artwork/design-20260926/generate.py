import importlib.util
import json
import sys
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent
HELPER = Path.home() / "workspace/personal/workflow/agents/skills/agi-image-generation/scripts/generate.py"
spec = importlib.util.spec_from_file_location("workflow_image_generation", HELPER)
workflow = importlib.util.module_from_spec(spec)
spec.loader.exec_module(workflow)


def generate(name):
    prompt = (ROOT / "prompts" / f"{name}.txt").read_text()
    output = ROOT / "originals" / f"{name}.png"
    if output.exists():
        print(f"保留已有原图：{name}", flush=True)
        return
    size = "1536x1024" if name.endswith("hero") else "1024x1024"
    request = {
        "model": "gpt-image-2.5-sunburst",
        "provider": "Azure OpenAI via the Workflow helper",
        "size": size,
        "quality": "high",
        "prompt": f"prompts/{name}.txt",
        "original": f"originals/{name}.png",
        "requested_at": datetime.now(timezone.utc).isoformat(),
        "status": "requested",
    }
    record = ROOT / "requests" / f"{name}.json"
    record.parent.mkdir(parents=True, exist_ok=True)
    if record.exists():
        request["previous_attempts"] = [json.loads(record.read_text())]
    record.write_text(json.dumps(request, indent=2) + "\n")
    print(f"开始生成：{name}", flush=True)
    try:
        workflow.generate_image(prompt, str(output), model=request["model"], size=size, quality="high")
        request["status"] = "generated"
    except (SystemExit, Exception) as error:
        request["status"] = "failed"
        request["error_type"] = type(error).__name__
        print(f"生成未完成：{name}（{type(error).__name__}: {str(error)[:250]}）", flush=True)
    request["finished_at"] = datetime.now(timezone.utc).isoformat()
    record.write_text(json.dumps(request, indent=2) + "\n")


if __name__ == "__main__":
    names = sys.argv[1:] or [f"{direction:02d}-{asset}" for direction in range(2, 9) for asset in ("hero", "01", "02", "03")]
    for name in names:
        generate(name)
    if any(not (ROOT / "originals" / f"{name}.png").exists() for name in names):
        sys.exit(1)
