import importlib.util
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parent
manifest = json.loads((root / "manifest.json").read_text())
name = sys.argv[1]
asset = manifest["assets"][name]
if asset.get("reference"):
    raise SystemExit("This asset requires a reference-image edit; see artwork/README.md.")
helper = Path.home() / "workspace/personal/workflow/agents/skills/agi-image-generation/scripts/generate.py"
spec = importlib.util.spec_from_file_location("sunburst_helper", helper)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.generate_image(
    (root / asset["prompt"]).read_text().strip(),
    str(root / asset["original"]),
    model=manifest["model"],
    size=asset["size"],
    quality=manifest["quality"],
)
