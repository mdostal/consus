#!/usr/bin/env python3
"""Generate app/src-tauri/icons/icon-source.png from the approved Abstract
Mark brand concept (.pHive/brand/logo-concepts.yaml), replacing the old
placeholder (a generic hub-and-spoke graph on indigo, consus-phase26-desktop-app
s4-app-icons.yaml) named in branding/brand-guide.html's own text as due for
replacement now that a real brand exists (consus-phase30-brand-theme-integration).

Mechanism confirmed from the original s4-app-icons pass (commit 70042e9): a
Python-generated source mark, supersampled at high resolution then downsampled
for clean edges, piped through `cargo tauri icon` to derive every platform
size. This script reuses that exact mechanism -- only the source mark changes.
Unlike the masthead's theme-aware BrandMark.tsx (web/src/theme/BrandMark.tsx),
an OS-level app icon is not inside a themed UI surface and stays fixed
regardless of the operator's active skin/theme -- same convention as every
other real app icon -- so this renders the Abstract Mark with its own fixed
brand hexes (Granary Indigo background, Parchment mark), not CSS tokens.

Requires cairosvg (rasterizes the exact same SVG path data as
logo-concepts.yaml's abstract-mark concept, byte-identical geometry) --
on this machine cairo itself is a Homebrew install whose dylib isn't on the
default search path, hence the DYLD_FALLBACK_LIBRARY_PATH re-exec below.

Usage: python3 scripts/generate-brand-icon.py
Output: app/src-tauri/icons/icon-source.png (1024x1024)
"""
import os
import subprocess
import sys

# Re-exec with the Homebrew lib path so cairocffi can dlopen libcairo on this
# machine, without requiring the operator to export it manually every time.
if "DYLD_FALLBACK_LIBRARY_PATH" not in os.environ:
    os.environ["DYLD_FALLBACK_LIBRARY_PATH"] = "/opt/homebrew/lib:/usr/local/lib"
    os.execvpe(sys.executable, [sys.executable] + sys.argv, os.environ)

import cairosvg  # noqa: E402
from PIL import Image  # noqa: E402

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PATH = os.path.join(REPO_ROOT, "app", "src-tauri", "icons", "icon-source.png")

# Fixed brand hexes -- an OS icon is not a themed UI surface, stays constant.
GRANARY_INDIGO = "#362B6B"
PARCHMENT = "#FAF7F0"

FINAL_SIZE = 1024
SUPERSAMPLE = 4  # render at 4x, downsample with LANCZOS for clean anti-aliased edges
RENDER_SIZE = FINAL_SIZE * SUPERSAMPLE
CORNER_RADIUS_FRACTION = 0.18  # Apple app-icon-template convention

# The mark itself: byte-identical path data to .pHive/brand/logo-concepts.yaml's
# "abstract-mark" concept, viewBox 0 0 120 120 -- only fills swapped to the
# fixed brand hexes above (the source YAML already uses these same hexes for
# its own inline preview, so this is a color-for-color match, not a guess).
MARK_SVG = f"""
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="{RENDER_SIZE}" height="{RENDER_SIZE}">
  <rect x="0" y="0" width="120" height="120" rx="{120 * CORNER_RADIUS_FRACTION}" fill="{GRANARY_INDIGO}"/>
  <path d="M60,14 C76,14 86,38 86,60 C86,82 76,106 60,106 C44,106 34,82 34,60 C34,38 44,14 60,14 Z" fill="{PARCHMENT}"/>
  <path d="M60,26 Q68,60 60,94" fill="none" stroke="{GRANARY_INDIGO}" stroke-width="5" stroke-linecap="round" opacity="0.85"/>
  <circle cx="60" cy="76" r="8" fill="{GRANARY_INDIGO}"/>
</svg>
"""


def main():
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)

    png_bytes = cairosvg.svg2png(bytestring=MARK_SVG.encode("utf-8"), output_width=RENDER_SIZE, output_height=RENDER_SIZE)
    supersampled_path = OUT_PATH + ".supersampled.png"
    with open(supersampled_path, "wb") as f:
        f.write(png_bytes)

    img = Image.open(supersampled_path).convert("RGBA")
    img = img.resize((FINAL_SIZE, FINAL_SIZE), Image.LANCZOS)
    img.save(OUT_PATH, "PNG")
    os.remove(supersampled_path)

    print(f"wrote {OUT_PATH} ({FINAL_SIZE}x{FINAL_SIZE}, supersampled {SUPERSAMPLE}x then downsampled)")


if __name__ == "__main__":
    main()
