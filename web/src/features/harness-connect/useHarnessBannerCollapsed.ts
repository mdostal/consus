import { useCallback, useState } from "react";

/** Namespaced "consus:" prefix, matching useThemePreference's/
 *  useSkinPreference's own convention — distinct from both of those keys. */
export const HARNESS_BANNER_COLLAPSED_STORAGE_KEY = "consus:harness-banner-collapsed";

/** Reads the stored collapse state, defaulting to expanded (false) for a
 *  fresh install or a corrupt/unrecognized stored value — an operator who
 *  has never seen the banner should see it at least once. Never throws;
 *  localStorage can be unavailable (private browsing, disabled storage). */
function readStored(): boolean {
  try {
    return window.localStorage.getItem(HARNESS_BANNER_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function persist(collapsed: boolean): void {
  try {
    window.localStorage.setItem(HARNESS_BANNER_COLLAPSED_STORAGE_KEY, collapsed ? "true" : "false");
  } catch {
    // best-effort — a failed write must never break the app
  }
}

/**
 * Persists HarnessConnectBanner's collapsed/expanded state across reloads
 * (s1, consus-phase19) — mirrors useThemePreference.ts's/
 * useSkinPreference.ts's exact localStorage-hook pattern: a namespaced
 * key, try/catch around every localStorage access so a failure never
 * throws, read once on mount. "Collapse it after the first time, not
 * disappear forever" (design-discussion.md) — this hook only ever tracks
 * collapsed vs. expanded, never a one-way dismissal.
 */
export function useHarnessBannerCollapsed(): {
  collapsed: boolean;
  setCollapsed: (next: boolean) => void;
} {
  const [collapsed, setCollapsedState] = useState<boolean>(() => readStored());

  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next);
    persist(next);
  }, []);

  return { collapsed, setCollapsed };
}
