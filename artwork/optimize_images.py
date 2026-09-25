import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

root = Path(__file__).resolve().parent
manifest_path = root / "manifest.json"
manifest = json.loads(manifest_path.read_text())
for name, asset in manifest["assets"].items():
    if len(sys.argv) > 1 and name not in sys.argv[1:]:
        continue
    source = root / asset["original"]
    if not source.exists():
        continue
    if "derivatives" in asset:
        with Image.open(source) as original:
            for derivative in asset["derivatives"]:
                image = original.convert("RGB")
                if "crop" in derivative:
                    image = image.crop(derivative["crop"])
                image.thumbnail(derivative["dimensions"], Image.Resampling.LANCZOS)
                assert list(image.size) == derivative["dimensions"]
                target = (root / derivative["path"]).resolve()
                image.save(target, "WEBP", **asset["optimization"]["options"])
                derivative["bytes"] = target.stat().st_size
                derivative["sha256"] = hashlib.sha256(target.read_bytes()).hexdigest()
                print(f"{target.name}: {image.size}, {derivative['bytes']:,} bytes")
        asset["original_bytes"] = source.stat().st_size
        asset["original_sha256"] = hashlib.sha256(source.read_bytes()).hexdigest()
        continue
    target = (root / asset["delivery"]).resolve()
    with Image.open(source) as image:
        image = image.convert("RGB")
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
