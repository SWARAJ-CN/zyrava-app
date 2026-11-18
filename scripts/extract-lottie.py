#!/usr/bin/env python3
"""Extract dotLottie JSON, retaining raster assets as native-compatible data URIs.

Usage: python3 scripts/extract-lottie.py input.lottie output.json
The dotLottie `e` flag does not guarantee that `p` contains image bytes: some
archives use e=1 with an images/ file. Android's JSON player cannot resolve that.
"""
import argparse
import base64
import json
import mimetypes
from pathlib import PurePosixPath, Path
import zipfile


def extract(source, target):
    with zipfile.ZipFile(source) as archive:
        animations = [name for name in archive.namelist()
                      if name.startswith("animations/") and name.endswith(".json")]
        if len(animations) != 1:
            raise ValueError("Expected a single animation in the archive")
        animation = json.loads(archive.read(animations[0]))
        for asset in animation.get("assets", []):
            image = asset.get("p")
            if not image or image.startswith("data:"):
                continue
            candidates = [asset.get("u", "") + image, image,
                          "images/" + str(PurePosixPath(image).name)]
            image_path = next((name for name in candidates if name in archive.namelist()), None)
            if image_path is None:
                raise ValueError(f"Missing image in archive: {image}")
            mime = mimetypes.guess_type(image_path)[0]
            if mime not in ("image/png", "image/jpeg", "image/webp"):
                raise ValueError(f"Unsupported raster asset: {image_path}")
            asset.update(p=f"data:{mime};base64," + base64.b64encode(archive.read(image_path)).decode("ascii"),
                         u="", e=1)
        Path(target).write_text(json.dumps(animation, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    parser.add_argument("target")
    args = parser.parse_args()
    extract(args.source, args.target)
