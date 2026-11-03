#!/usr/bin/env python3
"""Fail when background can show through the hat's opaque core.

The source painting has a smoky fringe, so the outer edge of each cutout is
allowed to be soft. The crown and brim interiors are not: they must be solid
cloth. This checks a 16 px-eroded core of the hand-authored HAT polygons in
both the hat layer and the flattened preview.

    python3 tools/check_alpha.py

Exit status is 1 when the hat core is not effectively opaque.
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import masks  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIN_MEAN_ALPHA = 0.995
MIN_COMPONENT_PX = 32
CORE_EROSION = 16
ALPHA_HOLE = 230


def hat_core() -> np.ndarray:
    """Binary source-space mask: HAT union eroded by CORE_EROSION pixels."""
    mask = Image.new("L", (masks.W, masks.H), 0)
    draw = ImageDraw.Draw(mask)
    for poly in masks.HAT:
        draw.polygon(poly, fill=255)
    mask = mask.filter(ImageFilter.MinFilter(CORE_EROSION * 2 + 1))
    return np.asarray(mask) > 0


def source_alpha(path: str, layer: dict | None = None) -> np.ndarray:
    """Alpha in 1024x1536 source space, optionally placing a cropped layer."""
    im = Image.open(path).convert("RGBA")
    if layer is None:
        if im.size != (masks.W, masks.H):
            raise SystemExit(f"{path}: expected {masks.W}x{masks.H}, got {im.size}")
        return np.asarray(im.getchannel("A"))
    canvas = Image.new("L", (masks.W, masks.H), 0)
    canvas.paste(im.getchannel("A"), (layer["x"], layer["y"]))
    return np.asarray(canvas)


def report(label: str, alpha: np.ndarray, core: np.ndarray) -> bool:
    values = alpha[core]
    mean = float(values.mean()) / 255.0
    bad = (alpha < ALPHA_HOLE) & core
    structure = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], dtype=bool)
    labels, count = ndimage.label(bad, structure=structure)
    components = []
    for index in range(1, count + 1):
        ys, xs = np.nonzero(labels == index)
        if len(xs) >= MIN_COMPONENT_PX:
            components.append((len(xs), int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())))

    print(f"{label}: core {int(core.sum())} px, mean alpha {mean:.4f}, "
          f"alpha<{ALPHA_HOLE} components >= {MIN_COMPONENT_PX} px: {len(components)}")
    for area, x0, y0, x1, y1 in sorted(components, reverse=True):
        print(f"  {area:5d} px at x{x0}-{x1}, y{y0}-{y1}")
    ok = mean >= MIN_MEAN_ALPHA and not components
    print(f"  {'PASS' if ok else 'FAIL'}: mean >= {MIN_MEAN_ALPHA:.3f} and no opaque-core holes")
    return ok


def main() -> int:
    rig_path = os.path.join(ROOT, "assets", "rig.json")
    with open(rig_path, encoding="utf-8") as fh:
        rig = json.load(fh)
    hat = next((l for l in rig["layers"] if l["id"] == "hat"), None)
    if hat is None:
        raise SystemExit("rig.json has no hat layer")

    core = hat_core()
    checks = [
        ("hat layer", source_alpha(os.path.join(ROOT, hat["file"]), hat)),
        ("preview", source_alpha(os.path.join(ROOT, "assets", "preview.png"))),
    ]
    results = [report(label, alpha, core) for label, alpha in checks]
    return 0 if all(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
