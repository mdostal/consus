/**
 * Theme-aware design tokens (REQ-15). The actual CSS custom-property values
 * live in tokens.css (loaded once by the app shell); this module exports
 * the semantic token *names* so components reference one source of truth
 * instead of hardcoding var(--...) strings everywhere.
 */
export const tokens = {
  color: {
    bg: "var(--delphi-bg)",
    bgSubtle: "var(--delphi-bg-subtle)",
    ink: "var(--delphi-ink)",
    inkMuted: "var(--delphi-ink-muted)",
    accent: "var(--delphi-accent)",
    good: "var(--delphi-good)",
    warn: "var(--delphi-warn)",
    bad: "var(--delphi-bad)",
    line: "var(--delphi-line)",
  },
} as const;
