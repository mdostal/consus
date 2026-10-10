import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSelectedClient } from "./useSelectedClient";

/** project -> client (null = ungrouped), from GET /api/projects's `clients`. */
export type ProjectClients = Record<string, string | null>;

export interface ClientScopeValue {
  /** The selected client, or null for "All clients". */
  client: string | null;
  setClient: (client: string | null) => void;
  /** Every client name in use, sorted. */
  clients: string[];
  projectClients: ProjectClients;
  /** Whether a project (or an item's repo) belongs to the selected client.
   *  Always true under "All clients"; a repo-less item only shows there. */
  inScope: (project: string | null | undefined) => boolean;
  /** Re-reads the project -> client map, e.g. after a client is edited. */
  reload: () => void;
}

/** Sorted, de-duplicated client names in a project -> client map. */
export function clientNames(projectClients: ProjectClients): string[] {
  const names = new Set(Object.values(projectClients).filter((c): c is string => !!c));
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/** Pure scope check behind `inScope`, exported for tests. */
export function projectInClient(
  projectClients: ProjectClients,
  client: string | null,
  project: string | null | undefined,
): boolean {
  if (client === null) return true;
  if (!project) return false;
  return projectClients[project] === client;
}

const ALL: ClientScopeValue = {
  client: null,
  setClient: () => {},
  clients: [],
  projectClients: {},
  inScope: () => true,
  reload: () => {},
};

const ClientScopeContext = createContext<ClientScopeValue>(ALL);

/** Outside a provider (e.g. a section rendered alone in a test) every
 *  project is in scope, which is today's unscoped behavior. */
export function useClientScope(): ClientScopeValue {
  return useContext(ClientScopeContext);
}

/**
 * PANT-960: the header client switcher's state, shared with every section
 * that lists projects or their items. Loads the project -> client map from
 * GET /api/projects once (and on `reload`); a remembered client that no
 * longer exists falls back to "All clients" rather than an empty view.
 */
export function ClientScopeProvider({ children }: { children: ReactNode }) {
  const [stored, setClient] = useSelectedClient();
  const [projectClients, setProjectClients] = useState<ProjectClients | null>(null);

  const reload = useCallback(() => {
    fetch("/api/projects")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((body: { clients?: ProjectClients }) => setProjectClients(body?.clients ?? {}))
      .catch(() => {
        // best-effort — without the map the app just stays unscoped
        setProjectClients({});
      });
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const value = useMemo<ClientScopeValue>(() => {
    const map = projectClients ?? {};
    const clients = clientNames(map);
    // Until the map loads, keep the remembered client so the first render
    // doesn't flash "All clients"; once loaded, drop one that no longer exists.
    const client = stored !== null && (projectClients === null || clients.includes(stored)) ? stored : null;
    return {
      client,
      setClient,
      clients,
      projectClients: map,
      inScope: (project) => projectClients === null || projectInClient(map, client, project),
      reload,
    };
  }, [stored, setClient, projectClients, reload]);

  return <ClientScopeContext.Provider value={value}>{children}</ClientScopeContext.Provider>;
}
