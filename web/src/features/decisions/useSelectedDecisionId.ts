import { useCallback, useEffect, useState } from "react";

/** Reads the current `?selected=` value straight off `window.location`,
 *  never cached — the source of truth is the URL itself. */
function readSelectedFromLocation(): string | null {
  return new URLSearchParams(window.location.search).get("selected");
}

/**
 * Hand-rolled `?selected=<id>` URL sync for the Decisions two-pane layout.
 * No router library exists in this codebase (no react-router-dom, no
 * <Route>/<BrowserRouter>), so this wraps URLSearchParams + window.history
 * directly instead of adding a new dependency.
 *
 * - Initial value is read once from `window.location.search` on mount.
 * - `select(id)` writes the new value via `window.history.replaceState`
 *   (never `pushState`) so clicking through many decisions doesn't spam
 *   browser history with one entry per row click.
 * - A `popstate` listener keeps the returned value in sync with browser
 *   back/forward navigation.
 *
 * Returns `[selectedId, select]` — `selectedId` is `null` when `?selected=`
 * is absent; callers are responsible for falling back to a sane default
 * (this hook makes no assumption about which decision that should be, and
 * never rewrites the URL on its own).
 */
export function useSelectedDecisionId(): [string | null, (id: string) => void] {
  const [selectedId, setSelectedId] = useState<string | null>(() => readSelectedFromLocation());

  useEffect(() => {
    function onPopState() {
      setSelectedId(readSelectedFromLocation());
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const select = useCallback((id: string) => {
    const params = new URLSearchParams(window.location.search);
    params.set("selected", id);
    const nextUrl = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", nextUrl);
    setSelectedId(id);
  }, []);

  return [selectedId, select];
}
