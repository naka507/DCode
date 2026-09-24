#!/usr/bin/env python3
"""Derive the renderer brand assets from the design exports.

`src/renderer/assets/brand/` and the two mascot pairs are derived files, and the
derivation is not cosmetic: `styles/chat-shell.css` shows the `-dark` asset on
the dark theme and the `-light` asset on the light theme, and `BrandLogo.vue`
swaps the same way. The dark theme's surfaces are dark, so its variant has to
carry *light* art. Deriving the pair by inversion instead of by hand is what
keeps them complementary.

The design exports (`logo.png`, `home.png`, `mascot.gif`) are local files, not
repository content — see the "Local design-source exports" section of
`.gitignore`. Pass the directory that holds them.

`build/icon_1024.png` is emitted too, because `scripts/make-icon.py` treats it
as its read-only source of truth and refuses to write it.

Run: python3 scripts/make-brand-marks.py <source-dir>
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
ASSETS = ROOT / "src" / "renderer" / "assets"
BRAND = ASSETS / "brand"

ICON_MASTER = 1024
MARK = 192
MASCOT = 200

# The mascot source is dark line art on a light ground. Treating darkness as
# opacity keeps the drawing's own fills, which keying out the background colour
# would erase: a pixel at or below this luminance is line, one above it is
# ground. The threshold is applied before and after the resize, so the shipped
# frames are strictly binary and carry no partially transparent pixels.
GROUND_LUMINANCE = 128


def invert_keep_alpha(image: Image.Image) -> Image.Image:
    """Invert RGB and leave the alpha channel alone."""
    red, green, blue, alpha = image.convert("RGBA").split()
    return Image.merge(
        "RGBA",
        (ImageOps.invert(red), ImageOps.invert(green), ImageOps.invert(blue), alpha),
    )


def flattened(animation: Image.Image) -> Image.Image:
    """The current frame composited onto the artwork's light ground.

    `convert("RGB")` on a palette GIF maps each index straight to its palette
    colour and drops the transparency index, so a source that marks its ground
    transparent with a *dark* entry — which is exactly what this script's own
    writer does, index 0 being both black and transparent — converts to a solid
    dark rectangle and every pixel then reads as line art. Compositing onto the
    ground first makes a transparent entry contribute ground.
    """
    rgba = animation.convert("RGBA")
    ground = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
    return Image.alpha_composite(ground, rgba).convert("RGB")


def mascot_masks(animation: Image.Image) -> list[Image.Image]:
    """One binary ink mask per frame, resized to the shipped size."""
    masks = []
    for index in range(animation.n_frames):
        animation.seek(index)
        mask = (
            flattened(animation)
            .convert("L")
            .point(lambda value: 255 if value < GROUND_LUMINANCE else 0)
            .resize((MASCOT, MASCOT), Image.LANCZOS)
        )
        # Resizing interpolates, so re-threshold to keep the mask binary: the
        # written frames have no partially transparent pixels at all.
        masks.append(mask.point(lambda value: 255 if value >= GROUND_LUMINANCE else 0))
    return masks


def ink_colour(animation: Image.Image, mask: Image.Image) -> tuple[int, int, int]:
    """The artwork's own line colour, sampled from the first frame."""
    animation.seek(0)
    sample = flattened(animation).resize((MASCOT, MASCOT), Image.LANCZOS)
    lines = [
        sample.getpixel((x, y))
        for y in range(MASCOT)
        for x in range(MASCOT)
        if mask.getpixel((x, y)) == 255
    ]
    if not lines:
        raise ValueError(
            "the mascot export has no line art at this threshold; "
            f"every pixel is at or above luminance {GROUND_LUMINANCE}"
        )
    count = len(lines)
    return tuple(sorted(pixel[channel] for pixel in lines)[count // 2] for channel in range(3))


def write_animation(
    path: Path,
    masks: list[Image.Image],
    colour: tuple[int, int, int],
    duration: int,
) -> None:
    """Write a GIF whose ground is transparent and whose art is one flat colour.

    Only two palette entries are used. Pillow still writes a full 256-entry
    global colour table, so the entries above index 1 are unused fillers.

    `transparency` and `background` are both pinned to index 0 on purpose.
    Pillow defaults the logical-screen background index to 0 when it is not
    given, so leaving it implicit would make "the transparent entry is also the
    background entry" a coincidence of two independent zeros rather than a
    property of this writer — and a reader that honours the background could
    then paint a stray colour behind the art.
    """
    frames = []
    for mask in masks:
        frame = Image.new("P", (MASCOT, MASCOT), 0)
        frame.putpalette([0, 0, 0, *colour] + [0, 0, 0] * 254)
        frame.paste(1, mask)
        frames.append(frame)
    frames[0].save(
        path,
        save_all=True,
        append_images=frames[1:],
        transparency=0,
        background=0,
        disposal=2,
        duration=duration,
        loop=0,
    )


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(
            f"usage: python3 scripts/{Path(__file__).name} <source-dir>"
        )

    source = Path(sys.argv[1])
    exports = {
        name: source / name for name in ("logo.png", "home.png", "mascot.gif")
    }
    missing = [str(path) for path in exports.values() if not path.is_file()]
    if missing:
        raise FileNotFoundError("missing design export(s): " + ", ".join(missing))

    BRAND.mkdir(parents=True, exist_ok=True)
    BUILD.mkdir(parents=True, exist_ok=True)
    written = []

    def save(image: Image.Image, path: Path) -> None:
        image.save(path)
        written.append(path)

    with Image.open(exports["logo.png"]) as opened:
        logo = opened.convert("RGBA")
    with Image.open(exports["home.png"]) as opened:
        home = opened.convert("RGBA")

    # `make-icon.py` reads this and must not write it.
    save(logo.resize((ICON_MASTER, ICON_MASTER), Image.LANCZOS), BUILD / "icon_1024.png")

    save(logo.resize((MARK, MARK), Image.LANCZOS), BRAND / "logo-dark.png")
    save(
        invert_keep_alpha(logo).resize((MARK, MARK), Image.LANCZOS),
        BRAND / "logo-light.png",
    )

    save(home.resize((MASCOT, MASCOT), Image.LANCZOS), ASSETS / "home-mascot-still-dark.png")
    save(
        invert_keep_alpha(home).resize((MASCOT, MASCOT), Image.LANCZOS),
        ASSETS / "home-mascot-still-light.png",
    )

    with Image.open(exports["mascot.gif"]) as animation:
        duration = animation.info.get("duration") or 30
        masks = mascot_masks(animation)
        line = ink_colour(animation, masks[0])
        inverted = tuple(255 - channel for channel in line)

        # The dark theme displays `-dark`, so that asset carries the light art.
        write_animation(ASSETS / "home-mascot-dark.gif", masks, inverted, duration)
        written.append(ASSETS / "home-mascot-dark.gif")
        write_animation(ASSETS / "home-mascot-light.gif", masks, line, duration)
        written.append(ASSETS / "home-mascot-light.gif")

    print(f"used {source}")
    for path in written:
        print(f"wrote {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
