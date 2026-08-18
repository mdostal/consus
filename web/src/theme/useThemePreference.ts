import { useCallback, useEffect, useState } from "react";

export type ThemePreference = "light" | "dark" | "system";

/** Namespaced so it can never collide with any other localStorage key this
 *  app (or a browser extension) might use — "consus:" prefix, distinct from
 *  the skin preference's own key. */
export const THEME_STORAGE_KEY = "consus:theme-preference";

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

/** Reads the stored preference, defaulting to "system" (today's unchanged
 *  prefers-color-scheme-only behavior) for a fresh install or a corrupt/
 *  unrecognized stored value. Never throws — localStorage can be
 *  unavailable (private browsing, disabled storage). */
function readStored(): ThemePreference {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(raw) ? raw : "system";
  } catch {
    return "system";
  }
}

/** Applies (or clears) the [data-theme] attribute on the document root.
 *  "system" removes the attribute entirely so the bare :root /
 *  prefers-color-scheme pattern in tokens.css takes over, unguarded. */
export function applyThemeToDocument(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", preference);
  }
}

function persist(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // best-effort — a failed write must never break the app
  }
}

/**
 * Resolves and persists the operator's manual light/dark/system theme
 * choice (s1, consus-phase18). "system" is the default and matches today's
 * unmodified prefers-color-scheme behavior; "light"/"dark" is an explicit
 * override that beats the OS default in both directions (tokens.css's
 * [data-theme="dark"] rule, and the :not([data-theme="light"]) guard on the
 * OS-driven dark media query).
 *
 * A best-effort inline bootstrap script in index.html applies the stored
 * preference to the document root before first paint (avoiding a flash of
 * the wrong theme); this hook re-applies it on mount (idempotent, and the
 * only path in non-browser-navigation contexts like tests) and on every
 * explicit change.
 */
export function useThemePreference(): { preference: ThemePreference; setPreference: (next: ThemePreference) => void } {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => readStored());

  useEffect(() => {
    applyThemeToDocument(preference);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    persist(next);
  }, []);

  return { preference, setPreference };
}
