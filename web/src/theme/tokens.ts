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
} as const;
