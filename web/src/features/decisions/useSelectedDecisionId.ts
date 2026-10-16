import { useCallback, useEffect, useState } from "react";

/** Reads a query param straight off `window.location`, never cached — the
 *  source of truth is the URL itself. */
function readParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

/** Rewrites the query string in place (`replaceState`, never `pushState`):
 *  each entry in `changes` sets that param, or deletes it when null. */
function writeParams(changes: Record<string, string | null>): void {
  const params = new URLSearchParams(window.location.search);
  for (const [name, value] of Object.entries(changes)) {
    if (value === null) params.delete(name);
    else params.set(name, value);
  }
  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  window.history.replaceState(window.history.state, "", nextUrl);
}

/**
 * One query param kept in React state: read on mount, re-read on
 * back/forward (`popstate`), written by the returned setter. `set` takes
 * extra params to change in the same history entry, e.g. clearing
 * `?selected=` while setting `?survey=`.
 */
function useUrlParam(name: string): [string | null, (value: string | null, also?: Record<string, string | null>) => void] {
  const [value, setValue] = useState<string | null>(() => readParam(name));

  useEffect(() => {
    function onPopState() {
      setValue(readParam(name));
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [name]);

  const set = useCallback(
    (next: string | null, also: Record<string, string | null> = {}) => {
      writeParams({ ...also, [name]: next });
      setValue(next);
    },
    [name],
  );

  return [value, set];
}

/**
 * `?survey=<id>` for the Decisions two-pane layout (consus#211): opens one
 * survey directly, the way `?selected=` opens one decision. Selecting a
 * survey clears `?selected=` so the link names exactly one thing; `null`
 * removes the param.
 */
export function useSelectedSurveyId(): [string | null, (id: string | null) => void] {
  const [surveyId, set] = useUrlParam("survey");
  const select = useCallback((id: string | null) => set(id, id === null ? {} : { selected: null }), [set]);
  return [surveyId, select];
}

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
  const [selectedId, set] = useUrlParam("selected");
  const select = useCallback((id: string) => set(id), [set]);
  return [selectedId, select];
}
