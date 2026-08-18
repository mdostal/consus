import { useEffect, useRef } from "react";

const TILE_SIZE = 128;
/** Fixed seed so the grain looks stable across re-renders instead of
 *  re-rolling (and visually "jumping") on every mount. Not cryptographic —
 *  just a small deterministic PRNG so we don't need a new dependency. */
function mulberry32(seed: number) {
  return function random() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Draws one seamless-ish cork-grain tile into the given canvas: a warm base
 * fill plus a scatter of small mottled dots/flecks in slightly darker and
 * lighter tones, approximating real cork's speckled texture. Reads its two
 * base colors from the currently-resolved --consus-* tokens (so it follows
 * the active theme automatically) rather than hardcoding a palette.
 */
function drawCorkTile(canvas: HTMLCanvasElement, baseColor: string, fleckColor: string): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return; // e.g. jsdom in tests, or an exotic environment with no 2d canvas support

  canvas.width = TILE_SIZE;
  canvas.height = TILE_SIZE;

  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);

  const random = mulberry32(0xc0f5);
  const fleckCount = 260;
  for (let i = 0; i < fleckCount; i++) {
    const x = random() * TILE_SIZE;
    const y = random() * TILE_SIZE;
    const r = 0.4 + random() * 1.6;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fleckColor;
    ctx.globalAlpha = 0.25 + random() * 0.35;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/**
 * Case Board's decorative touch beyond CSS color tokens: a canvas-drawn
 * cork-grain texture (generated at runtime, no image assets — per this
 * story's design decision), tiled as a fixed full-page background sitting
 * behind all content. Purpose-built for this app, not ported from the
 * exploratory case-board mockup (s1, consus-phase18).
 */
export function CaseBoardCorkTexture() {
  const tileRef = useRef<HTMLCanvasElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const tile = tileRef.current;
    const backdrop = backdropRef.current;
    if (!tile || !backdrop) return;

    function redraw() {
      if (!tile || !backdrop) return;
      const styles = getComputedStyle(document.documentElement);
      const baseColor = styles.getPropertyValue("--consus-bg-subtle").trim() || "#ece0c8";
      const fleckColor = styles.getPropertyValue("--consus-ink-muted").trim() || "#6b5a3e";

      drawCorkTile(tile, baseColor, fleckColor);

      try {
        const dataUrl = tile.toDataURL("image/png");
        backdrop.style.backgroundImage = `url(${dataUrl})`;
      } catch {
        // toDataURL can throw in unusual embedding contexts (e.g. a tainted
        // canvas) — the backdrop simply falls back to its plain token color.
      }
    }

    redraw();

    // The tokens this tile is drawn from change without this component ever
    // re-rendering (an explicit theme flip sets [data-theme] on <html>; an
    // OS-level scheme flip under "system" only changes what the
    // prefers-color-scheme media query resolves to) — watch both so the
    // cork's own base/fleck colors track the live theme instead of freezing
    // at whatever was active on mount.
    const observer = new MutationObserver(redraw);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-skin"] });

    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    media?.addEventListener?.("change", redraw);

    return () => {
      observer.disconnect();
      media?.removeEventListener?.("change", redraw);
    };
  }, []);

  return (
    <div
      ref={backdropRef}
      className="case-board-cork-texture"
      data-testid="case-board-cork-texture"
      aria-hidden="true"
    >
      <canvas ref={tileRef} className="case-board-cork-texture__tile" hidden />
    </div>
  );
}
