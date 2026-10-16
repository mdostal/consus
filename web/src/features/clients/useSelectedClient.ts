import { useCallback, useState } from "react";

/** Namespaced "consus:" prefix, matching useSkinPreference's convention. */
export const SELECTED_CLIENT_STORAGE_KEY = "consus:selected-client";

/** The last selected client in this browser, or null for "All clients".
 *  Never throws; localStorage can be unavailable. */
function readStored(): string | null {
  try {
    return window.localStorage.getItem(SELECTED_CLIENT_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

function persist(client: string | null): void {
  try {
    if (client === null) window.localStorage.removeItem(SELECTED_CLIENT_STORAGE_KEY);
    else window.localStorage.setItem(SELECTED_CLIENT_STORAGE_KEY, client);
  } catch {
    // best-effort — a failed write must never break the app
  }
}

/** PANT-960: remembers the header client switcher's choice per browser. */
export function useSelectedClient(): [string | null, (client: string | null) => void] {
  const [client, setClientState] = useState<string | null>(() => readStored());

  const setClient = useCallback((next: string | null) => {
    setClientState(next);
    persist(next);
  }, []);

  return [client, setClient];
}
