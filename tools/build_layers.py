#!/usr/bin/env python3
"""Cut the source illustration into rig-ready transparent layers.

    python3 tools/build_layers.py

Outputs:
    assets/layers/*.png   one PNG per body part, cropped to its bounds
    assets/rig.json       layout + pivot data consumed by the web rig
    assets/preview.png    flattened check render on a checkerboard
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import masks  # noqa: E402
import matte  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "source", "character.jpg")
OUT = os.path.join(ROOT, "assets", "layers")
SS = 4  # supersample factor for smooth polygon edges


def poly_mask(size, polys, erode=0, feather=0.0):
    """Antialiased mask from one or more polygons."""
    w, h = size
    big = Image.new("L", (w * SS, h * SS), 0)
    d = ImageDraw.Draw(big)
    for poly in polys:
        d.polygon([(x * SS, y * SS) for x, y in poly], fill=255)
    if erode:
        big = big.filter(ImageFilter.MinFilter(int(erode * SS) * 2 + 1))
    m = big.resize((w, h), Image.LANCZOS)
    if feather:
        m = m.filter(ImageFilter.GaussianBlur(feather))
    return m


def solid_mask(size, polys, erode=0):
    """Hard-edged source-resolution mask for opaque interiors.

    This is intentionally not supersampled: it only fills pixels well inside
    the hand-authored polygon, while the feathered poly_mask still owns the
    outer silhouette.
    """
    m = Image.new("L", size, 0)
    d = ImageDraw.Draw(m)
    for poly in polys:
        d.polygon(poly, fill=255)
    if erode:
        m = m.filter(ImageFilter.MinFilter(erode * 2 + 1))
    return m


def bbox_of(mask):
    return mask.getbbox()


def main():
    src = Image.open(SRC).convert("RGBA")
    size = src.size

    # Clip to a computed foreground matte; fall back to the hand polygon.
    raw = Image.open(SRC).convert("RGB")
    fg = matte.build_matte(np.asarray(raw, dtype=np.float32))
    silhouette = Image.fromarray((np.clip(fg, 0, 1) * 255).astype("uint8"))
    silhouette = silhouette.filter(ImageFilter.GaussianBlur(1.0))

    parts = {
        "cape": [masks.CAPE],
        "body": [masks.BODY],
        "arm_left": [masks.ARM_L],
        "cane": [masks.CANE],
        "arm_right": [masks.ARM_R],
        "head": [masks.HEAD],
        "hat": masks.HAT,
    }

    os.makedirs(OUT, exist_ok=True)
    rig = {
        "name": "Old Glory",
        "source": {"width": size[0], "height": size[1]},
        "pivots": {k: list(v) for k, v in masks.PIVOTS.items()},
        # Visible goggle glass, not the metal rim. The left ellipse is shifted
        # right and kept small because the beak covers the lower-left of that
        # lens; a lid drawn to these bounds cannot paint onto the mask fabric.
        "eyes": [
            {"cx": 402, "cy": 306, "rx": 24, "ry": 24},
            {"cx": 500, "cy": 310, "rx": 28, "ry": 28},
        ],
        "layers": [],
    }

    rendered = []

    for z, (layer_id, feather) in enumerate(masks.LAYERS, start=1):
        m = poly_mask(size, parts[layer_id], feather=feather)
        # Some layers must stay opaque in their interior even where the matte
        # mistakes pale cloth or a seam for smoke. This uses the hand polygon,
        # not the matte, and is applied after silhouette clipping so a bad
        # matte cannot punch a hole through it. Erosion keeps it well inside
        # the feathered outer edge.
        m = ImageChops.multiply(m, silhouette)
        solid_erode = masks.SOLID_CORE_ERODE.get(layer_id)
        if solid_erode:
            m = ImageChops.lighter(m, solid_mask(size, parts[layer_id], erode=solid_erode))
        layer = src.copy()
        layer.putalpha(m)
        bb = bbox_of(m)
        if not bb:
            raise SystemExit(f"empty layer: {layer_id}")
        crop = layer.crop(bb)
        crop.save(os.path.join(OUT, f"{layer_id}.png"))
        px, py = masks.PIVOTS.get(layer_id, (size[0] / 2, size[1] / 2))
        rig["layers"].append({
            "id": layer_id, "file": f"assets/layers/{layer_id}.png",
            "x": bb[0], "y": bb[1], "w": bb[2] - bb[0], "h": bb[3] - bb[1],
            "pivot": [px - bb[0], py - bb[1]],
            "z": z,
        })
        rendered.append((crop, bb))
        print(f"  {layer_id:10s} {bb[2]-bb[0]:4d}x{bb[3]-bb[1]:4d} at {bb[0]},{bb[1]}")

    with open(os.path.join(ROOT, "assets", "rig.json"), "w") as fh:
        json.dump(rig, fh, indent=2)

    # Check render: transparent PNG so the alpha edges are easy to inspect.
    sheet = Image.new("RGBA", size, (0, 0, 0, 0))
    for img, bb in rendered:
        sheet.alpha_composite(img, (bb[0], bb[1]))
    sheet.save(os.path.join(ROOT, "assets", "preview.png"))

    checker = Image.new("RGBA", size, (38, 38, 44, 255))
    c = ImageDraw.Draw(checker)
    for y in range(0, size[1], 32):
        for x in range(0, size[0], 32):
            if (x // 32 + y // 32) % 2 == 0:
                c.rectangle([x, y, x + 31, y + 31], fill=(58, 58, 66, 255))
    checker.alpha_composite(sheet)
    checker.convert("RGB").save("/tmp/opencode/layers_check.png")
    print("wrote assets/rig.json + assets/preview.png")


if __name__ == "__main__":
    main()
