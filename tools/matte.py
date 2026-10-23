#!/usr/bin/env python3
"""Estimate a foreground matte without ML.

The backdrop is a smooth smoky gradient, so it can be reconstructed locally from
the pixels just outside the character (normalised convolution). Everything that
deviates from that plate, or that carries local texture, is foreground.
Dark cloth sitting on dark smoke is recovered by a luminance ramp, because the
only thing that actually has to disappear is the flat grey smoke.

    python3 tools/matte.py --preview
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import masks  # noqa: E402


def background_plate(rgb: np.ndarray, known: np.ndarray, sigma: float = 26.0) -> np.ndarray:
    """Fill the character area with a smooth interpolation of the backdrop."""
    k = known.astype(np.float32)
    num = np.stack(
        [ndimage.gaussian_filter(rgb[:, :, c] * k, sigma) for c in range(3)], axis=2
    )
    den = ndimage.gaussian_filter(k, sigma)[:, :, None]
    return num / np.maximum(den, 1e-6)


def smoothstep(x, lo, hi):
    t = np.clip((x - lo) / max(hi - lo, 1e-6), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def build_matte(rgb: np.ndarray, verbose: bool = False) -> np.ndarray:
    h, w, _ = rgb.shape
    poly = Image.new("L", (w, h), 0)
    ImageDraw.Draw(poly).polygon(masks.SILHOUETTE, fill=255)
    poly_m = np.array(poly) > 0

    # Work at quarter resolution: fast, and the plate is smooth anyway.
    scale = 4
    sw, sh = w // scale, h // scale
    small = np.asarray(
        Image.fromarray(rgb.astype(np.uint8)).resize((sw, sh), Image.LANCZOS), dtype=np.float32
    )
    known = (
        np.array(
            Image.fromarray((poly_m * 255).astype(np.uint8))
            .filter(ImageFilter.MinFilter(25))
            .resize((sw, sh), Image.NEAREST)
        )
        == 0
    )

    plate_s = background_plate(small, known)
    plate = np.asarray(
        Image.fromarray(np.clip(plate_s, 0, 255).astype(np.uint8)).resize((w, h), Image.BICUBIC),
        dtype=np.float32,
    )
    # Outside the character the plate must equal the image, so no seams appear.
    plate[known.repeat(scale, axis=0).repeat(scale, axis=1)] = 0.0

    diff = np.linalg.norm(rgb - plate, axis=2)
    diff = ndimage.gaussian_filter(diff, 1.2)

    grey = rgb.mean(axis=2)
    detail = np.abs(grey - ndimage.gaussian_filter(grey, 4.0))
    detail = ndimage.gaussian_filter(detail, 1.0)

    fg = (diff > 15.0) | (detail > 3.0)

    # Keep very dark pixels: black cloth / leather / cane on black smoke is
    # indistinguishable by colour, and it should stay solid.
    fg |= (grey < 52) & ndimage.binary_erosion(poly_m, iterations=3)

    fg &= ndimage.binary_dilation(poly_m, iterations=6)
    fg = ndimage.binary_opening(fg, structure=np.ones((3, 3)), iterations=2)

    # Fill only small enclosed holes (fabric gaps).
    holes = ndimage.binary_fill_holes(fg) & ~fg
    hl, hn = ndimage.label(holes)
    if hn:
        small_ = np.zeros(hn + 1, dtype=bool)
        small_[1:] = ndimage.sum(holes, hl, range(1, hn + 1)) < 2500
        fg = fg | small_[hl]

    lbl, n = ndimage.label(fg)
    if n > 1:
        sizes = ndimage.sum(fg, lbl, range(1, n + 1))
        fg = np.isin(lbl, np.nonzero(sizes > sizes.max() * 0.02)[0] + 1)

    fg = ndimage.binary_closing(fg, structure=np.ones((3, 3)), iterations=1)
    if verbose:
        print(f"  matte coverage {fg.mean() * 100:.1f}%")
    return ndimage.gaussian_filter(fg.astype(np.float32), 1.0)


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    src = Image.open(os.path.join(root, "assets", "source", "character.jpg")).convert("RGB")
    soft = build_matte(np.asarray(src, dtype=np.float32), verbose=True)
    if "--preview" in sys.argv:
        a = Image.fromarray((np.clip(soft, 0, 1) * 255).astype(np.uint8))
        out = src.convert("RGBA")
        out.putalpha(a)
        bg = Image.new("RGBA", out.size, (40, 40, 48, 255))
        bg.alpha_composite(out)
        bg.convert("RGB").resize((512, 768)).save("/tmp/opencode/cut_test.png")
        a.save("/tmp/opencode/matte.png")


if __name__ == "__main__":
    main()
