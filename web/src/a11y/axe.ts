import { configureAxe } from "vitest-axe";

/**
 * Shared axe runner for jsdom component tests (PANT-812). color-contrast is
 * off because jsdom does no layout or painting: axe can only ever report it
 * as "incomplete" there, and trying makes it hit jsdom's unimplemented
 * canvas API on every run. Contrast stays a real-browser check.
 */
export const axe = configureAxe({
  rules: {
    "color-contrast": { enabled: false },
  },
});
