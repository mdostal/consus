#!/usr/bin/env python3
"""Generate app/src-tauri/icons/icon-source.png from the approved Monogram
brand concept (.pHive/brand/logo-concepts.yaml) -- THE CONCEPT THE OPERATOR
ACTUALLY SELECTED via a real recorded verdict in Consus's own decision UI
({"kind":"concept_selected","conceptId":"monogram"}, audit_log id 3,
2026-09-10T21:02:01.823Z). Replaces the old placeholder (a generic
hub-and-spoke graph on indigo, consus-phase26-desktop-app s4-app-icons.yaml).

Corrected same-day (consus-phase30 hotfix): the epic's first pass used the
"Abstract Mark" concept instead, reasoning from a sub-recommendation in
logo-concepts.yaml's own text ("holds up at 16px... candidate for the dock
icon") -- but that overrode the operator's actual already-recorded choice
without asking. Found live when the operator opened the shipped app and
didn't get the icon they picked.

Operator-confirmed split (immediately after the above fix): Abstract Mark
is intentionally kept for the in-UI masthead glyph (BrandMark.tsx) --
compact small-size use is exactly what that concept was recommended for --
while this script's output (dock icon, app bundle icon, favicon) uses
Monogram, the operator's actual chosen standalone identity. Two different
concepts on two different surfaces, both deliberate, not an inconsistency.

Mechanism confirmed from the original s4-app-icons pass (commit 70042e9): a
Python-generated source mark, supersampled at high resolution then downsampled
for clean edges, piped through `cargo tauri icon` to derive every platform
size. This script reuses that exact mechanism -- only the source mark changes.
Unlike the masthead's theme-aware BrandMark.tsx (web/src/theme/BrandMark.tsx),
an OS-level app icon is not inside a themed UI surface and stays fixed
regardless of the operator's active skin/theme -- same convention as every
other real app icon -- so this renders the Monogram with the exact fixed
hexes brand-guide.html itself used to present it to the operator when they
made the selection (Parchment background, Granary Indigo ring, Threshing
Gold kernel) -- not a reinterpretation.

Requires cairosvg (rasterizes the exact same SVG path data as
logo-concepts.yaml's monogram concept, byte-identical geometry) -- on this
machine cairo itself is a Homebrew install whose dylib isn't on the default
search path, hence the DYLD_FALLBACK_LIBRARY_PATH re-exec below.

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
# Byte-identical to the exact hexes logo-concepts.yaml/brand-guide.html used
# to present the Monogram concept to the operator when they selected it.
GRANARY_INDIGO = "#362B6B"
THRESHING_GOLD = "#9C6316"
PARCHMENT = "#FAF7F0"

FINAL_SIZE = 1024
SUPERSAMPLE = 4  # render at 4x, downsample with LANCZOS for clean anti-aliased edges
RENDER_SIZE = FINAL_SIZE * SUPERSAMPLE
CORNER_RADIUS_FRACTION = 0.18  # Apple app-icon-template convention

# The mark itself: byte-identical path data to .pHive/brand/logo-concepts.yaml's
# "monogram" concept, viewBox 0 0 120 120 (an open "C" arc wrapped around the
# grain-kernel glyph) -- the fills are the same fixed brand hexes the source
# YAML already uses for its own inline preview, a color-for-color match, not
# a guess. Parchment background (not a dark field) -- matches exactly how the
# operator saw and selected this concept in brand-guide.html/Consus's own UI.
MARK_SVG = f"""
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="{RENDER_SIZE}" height="{RENDER_SIZE}">
  <rect x="0" y="0" width="120" height="120" rx="{120 * CORNER_RADIUS_FRACTION}" fill="{PARCHMENT}"/>
  <path d="M 101.57,36 A 48,48 0 1 0 101.57,84" fill="none" stroke="{GRANARY_INDIGO}" stroke-width="9" stroke-linecap="round"/>
  <g transform="translate(60,60) scale(0.62) translate(-60,-60)">
    <path d="M60,14 C76,14 86,38 86,60 C86,82 76,106 60,106 C44,106 34,82 34,60 C34,38 44,14 60,14 Z" fill="{THRESHING_GOLD}"/>
    <path d="M60,26 Q68,60 60,94" fill="none" stroke="{PARCHMENT}" stroke-width="5" stroke-linecap="round" opacity="0.85"/>
    <circle cx="60" cy="76" r="8" fill="{PARCHMENT}"/>
  </g>
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
