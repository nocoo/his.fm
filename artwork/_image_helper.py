import os
import sys
from pathlib import Path


def resolve_image_helper() -> Path:
    raw = os.environ.get("HISFM_IMAGE_HELPER", "").strip()
    if not raw:
        sys.exit(
            "Set HISFM_IMAGE_HELPER to the absolute path of your Workflow "
            "agi-image-generation helper (generate.py). See artwork/README.md."
        )
    helper = Path(raw).expanduser()
    if not helper.is_file():
        sys.exit(f"HISFM_IMAGE_HELPER does not point to a file: {helper}")
    return helper
