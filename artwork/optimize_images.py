import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

root = Path(__file__).resolve().parent
manifest_path = root / "manifest.json"
manifest = json.loads(manifest_path.read_text())
for name, asset in manifest["assets"].items():
    source = root / asset["original"]
    if not source.exists():
        continue
    target = (root / asset["delivery"]).resolve()
    with Image.open(source) as image:
        image = image.convert("RGB")
        if name != "hero":
            image.thumbnail((768, 768), Image.Resampling.LANCZOS)
        image.save(target, "WEBP", quality=85, method=6)
        asset["delivery_dimensions"] = list(image.size)
    asset["original_bytes"] = source.stat().st_size
    asset["delivery_bytes"] = target.stat().st_size
    asset["original_sha256"] = hashlib.sha256(source.read_bytes()).hexdigest()
    asset["delivery_sha256"] = hashlib.sha256(target.read_bytes()).hexdigest()
    asset["generated_at_utc"] = datetime.fromtimestamp(source.stat().st_mtime, timezone.utc).isoformat()
    asset["optimization"] = {"library":"Pillow", "format":"WebP", "quality":85, "method":6}
    print(f"{name}: {asset['original_bytes']:,} bytes -> {asset['delivery_bytes']:,} bytes")
manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
