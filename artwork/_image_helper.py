import os
import sys
from pathlib import Path


def resolve_image_helper() -> Path:
    raw = os.environ.get("HISFM_IMAGE_HELPER", "").strip()
    helper = (
        Path(raw).expanduser()
        if raw
        else (
            Path.home() / ".agents/skills/system0-image-generation-gpt/scripts/generate.py"
        ).resolve()
    )
    if not helper.is_file():
        if raw:
            sys.exit(f"HISFM_IMAGE_HELPER does not point to a file: {helper}")
        sys.exit(
            "system0-image-generation-gpt helper not found at "
            "~/.agents/skills/system0-image-generation-gpt/scripts/generate.py; "
            "set HISFM_IMAGE_HELPER or install system0 skills. See artwork/README.md."
        )
    return helper
