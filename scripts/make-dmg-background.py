#!/usr/bin/env python3
"""Derive the macOS DMG window plates from a source artwork export.

`build/dmg-background.png` is not just decoration. electron-builder reads its
pixel size with `sips` and uses it as the Finder window size, then pairs it with
`build/dmg-background@2x.png` through `tiffutil -cathidpicheck` for retina
displays. So the two plates must be exactly 720x500 and 1440x1000: a plate of
another size silently resizes the window away from the icon coordinates in
`package.json`'s `build.dmg.contents`, and a missing or non-2x companion drops
retina rendering.

The source artwork is a design export, not a repository file; see the "Local
design-source exports" section of `.gitignore` for the same convention.

Run: python3 scripts/make-dmg-background.py <source-image>
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"

# Logical 1x coordinates. Keep in sync with package.json build.dmg.
WIDTH = 720
HEIGHT = 500
SCALE = 2


def cover(artwork: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Center-crop to the target aspect ratio, then resize.

    Cropping rather than stretching keeps a source export that is not already
    1.44:1 from distorting the icon row the Finder draws on top of it.
    """
    target = size[0] / size[1]
    source = artwork.width / artwork.height
    if source > target:
        width = round(artwork.height * target)
        left = (artwork.width - width) // 2
        artwork = artwork.crop((left, 0, left + width, artwork.height))
    elif source < target:
        height = round(artwork.width / target)
        top = (artwork.height - height) // 2
        artwork = artwork.crop((0, top, artwork.width, top + height))
    return artwork.resize(size, Image.LANCZOS)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(f"usage: python3 scripts/{Path(__file__).name} <source-image>")

    source = Path(sys.argv[1])
    if not source.is_file():
        raise FileNotFoundError(f"source artwork is missing: {source}")

    # Composite onto an opaque ground rather than dropping the alpha band, so a
    # source with transparency does not leak whatever colour its encoder stored
    # under the transparent pixels into the plate.
    with Image.open(source) as opened:
        rgba = opened.convert("RGBA")
    artwork = Image.alpha_composite(
        Image.new("RGBA", rgba.size, (255, 255, 255, 255)), rgba
    ).convert("RGB")

    BUILD.mkdir(parents=True, exist_ok=True)
    retina = cover(artwork, (WIDTH * SCALE, HEIGHT * SCALE))
    retina_path = BUILD / "dmg-background@2x.png"
    retina.save(retina_path, format="PNG", optimize=True)

    # Downscale the retina plate rather than the source, so the two files are
    # the same picture at exactly 2x and 1x.
    one_x_path = BUILD / "dmg-background.png"
    retina.resize((WIDTH, HEIGHT), Image.LANCZOS).save(
        one_x_path, format="PNG", optimize=True
    )

    print(f"used {source} ({artwork.width}x{artwork.height})")
    print(f"wrote {one_x_path} ({WIDTH}x{HEIGHT})")
    print(f"wrote {retina_path} ({WIDTH * SCALE}x{HEIGHT * SCALE})")


if __name__ == "__main__":
    main()
