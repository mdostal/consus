/**
 * Theme-aware design tokens (REQ-15). The actual CSS custom-property values
 * live in tokens.css (loaded once by the app shell); this module exports
 * the semantic token *names* so components reference one source of truth
 * instead of hardcoding var(--...) strings everywhere.
 */
export const tokens = {
  color: {
    bg: "var(--consus-bg)",
    bgSubtle: "var(--consus-bg-subtle)",
    ink: "var(--consus-ink)",
    inkMuted: "var(--consus-ink-muted)",
    accent: "var(--consus-accent)",
    good: "var(--consus-good)",
    warn: "var(--consus-warn)",
    bad: "var(--consus-bad)",
    line: "var(--consus-line)",
  },
  /** Per-skin type stack (consus-phase18/s1) — body copy vs. UI chrome
   *  vs. monospace/code each resolve independently so a skin can go
   *  monospace-forward in its chrome without forcing every doc/decision
   *  body of text into a code font. */
  font: {
    body: "var(--consus-font-body)",
    ui: "var(--consus-font-ui)",
    mono: "var(--consus-font-mono)",
  },
  /** Per-skin corner treatment — Drafting Table's sharp linework vs. Case
   *  Board's organic corners — expressed as a scale multiplier consumed by
   *  every `border-radius: calc(<base>px * var(--consus-radius-scale, 1))`
   *  declaration, rather than duplicating every radius value per skin. */
  radiusScale: "var(--consus-radius-scale, 1)",
  /** Consumed by the diagram editor (s2+): "straight" (Drafting
   *  Table/Harness) vs. "organic" (Case Board) edge curve style. */
  edgeStyle: "var(--consus-edge-style)",
} as const;
