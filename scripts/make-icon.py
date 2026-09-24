#!/usr/bin/env python3
"""Derive dcode platform icon resources from the canonical logo.

The tracked ``build/icon_1024.png`` file is the brand source of truth. This
script preserves that file and emits:

  build/icon.iconset/  - all macOS iconset sizes
  build/icon.icns      - via `iconutil` (macOS only)
  build/icon.ico       - multi-size Windows application icon
  build/icon.png       - 512px Windows/Linux package icon
  build/tray-icon-mac.png - transparent macOS template icon

Run: python3 scripts/make-icon.py
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
SOURCE = BUILD / "icon_1024.png"

BASE = 1024


def main() -> None:
    if not SOURCE.is_file():
        raise FileNotFoundError(f"canonical logo is missing: {SOURCE}")

    with Image.open(SOURCE) as source:
        master = source.convert("RGBA")
    if master.size != (BASE, BASE):
        raise ValueError(
            f"canonical logo must be {BASE}x{BASE}, got {master.width}x{master.height}"
        )

    BUILD.mkdir(parents=True, exist_ok=True)
    windows_icon = BUILD / "icon.ico"
    master.save(
        windows_icon,
        format="ICO",
        sizes=[
            (16, 16),
            (32, 32),
            (48, 48),
            (64, 64),
            (128, 128),
            (256, 256),
        ],
    )
    package_icon = BUILD / "icon.png"
    master.resize((512, 512), Image.LANCZOS).save(package_icon)

    # macOS menu bar icons are template images: the opaque pixels are tinted
    # by the system. The application icon has an opaque tile, so using it
    # directly would turn that tile into the tray silhouette. Derive the
    # dark mark as a transparent, monochrome image instead.
    tray_icon = master.convert("L")
    tray_alpha = ImageChops.multiply(
        tray_icon.point(
            lambda luminance: max(0, min(255, (160 - luminance) * 255 // 80))
        ),
        master.getchannel("A"),
    )
    # The source artwork also contains a soft outline around its tile. Keep
    # the known mark area so that outline cannot leak into the menu bar
    # template silhouette.
    mark_clip = Image.new("L", master.size, 0)
    mark_draw = ImageDraw.Draw(mark_clip)
    mark_draw.rectangle((120, 115, 850, 800), fill=255)
    mark_draw.rectangle((120, 115, 250, 250), fill=0)
    tray_alpha = ImageChops.multiply(tray_alpha, mark_clip)
    tray_icon_mac = Image.new("RGBA", master.size, (0, 0, 0, 0))
    tray_icon_mac.putalpha(tray_alpha)
    mark_bounds = tray_alpha.getbbox()
    if mark_bounds is None:
        raise ValueError("canonical logo does not contain a dark mark")
    mark = tray_icon_mac.crop(mark_bounds).resize((768, 768), Image.LANCZOS)
    tray_icon_mac = Image.new("RGBA", master.size, (0, 0, 0, 0))
    tray_icon_mac.paste(mark, (128, 128), mark)
    tray_icon_mac_path = BUILD / "tray-icon-mac.png"
    tray_icon_mac.save(tray_icon_mac_path)

    iconset = BUILD / "icon.iconset"
    if iconset.exists():
        shutil.rmtree(iconset)
    iconset.mkdir()
    sizes = [16, 32, 128, 256, 512]
    for sz in sizes:
        master.resize((sz, sz), Image.LANCZOS).save(iconset / f"icon_{sz}x{sz}.png")
        master.resize((sz * 2, sz * 2), Image.LANCZOS).save(
            iconset / f"icon_{sz}x{sz}@2x.png"
        )

    icns = BUILD / "icon.icns"
    # `iconutil` is macOS-only, so a Windows or Linux run would otherwise leave
    # `build/icon.icns` at whatever it was, silently shipping a stale macOS
    # icon. Pillow writes the same container from the same master instead.
    iconutil = shutil.which("iconutil")
    if iconutil is None:
        master.save(icns, format="ICNS")
        print(f"used {SOURCE}")
        print(f"wrote {windows_icon}")
        print(f"wrote {package_icon}")
        print(f"wrote {tray_icon_mac_path}")
        print(f"wrote {icns} (Pillow; iconutil is unavailable)")
        return

    subprocess.run(
        [iconutil, "-c", "icns", str(iconset), "-o", str(icns)], check=True
    )
    print(f"used {SOURCE}")
    print(f"wrote {windows_icon}")
    print(f"wrote {package_icon}")
    print(f"wrote {tray_icon_mac_path}")
    print(f"wrote {icns}")


if __name__ == "__main__":
    main()
