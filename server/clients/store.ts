import type Database from "better-sqlite3";

/** PANT-960: the optional client (group) a project belongs to. Several repos
 *  usually belong to one client, so the web UI can switch by client instead of
 *  by repo. NULL = ungrouped, which behaves exactly as before. */
export type ProjectClients = Record<string, string | null>;

export interface ClientGroup {
  name: string;
  projects: string[];
}

export interface GroupedProjects {
  clients: ClientGroup[];
  ungrouped: string[];
}

const MAX_CLIENT_LENGTH = 80;

/** Normalizes a client value from a request body: a non-empty string is
 *  trimmed and kept, null/"" clears it. Anything else is invalid and returns
 *  `undefined` so the route can 400. */
export function parseClientInput(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_CLIENT_LENGTH) return undefined;
  return trimmed;
}

/** Client per registered project; a project with no row maps to null. */
export function getProjectClients(db: Database.Database, projects: string[]): ProjectClients {
  const rows = db.prepare("SELECT project, client FROM project_clients").all() as Array<{
    project: string;
    client: string;
  }>;
  const byProject = new Map(rows.map((r) => [r.project, r.client]));
  return Object.fromEntries(projects.map((p) => [p, byProject.get(p) ?? null]));
}

export function setProjectClient(db: Database.Database, project: string, client: string | null): void {
  if (client === null) {
    db.prepare("DELETE FROM project_clients WHERE project = ?").run(project);
    return;
  }
  db.prepare(
    `INSERT INTO project_clients (project, client, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(project) DO UPDATE SET client = excluded.client, updated_at = excluded.updated_at`,
  ).run(project, client, new Date().toISOString());
}

/** Groups projects by client, both sorted by name (case-insensitive), with
 *  ungrouped projects kept separately in registry order. */
export function groupProjectsByClient(clients: ProjectClients): GroupedProjects {
  const groups = new Map<string, string[]>();
  const ungrouped: string[] = [];
  for (const [project, client] of Object.entries(clients)) {
    if (!client) {
      ungrouped.push(project);
      continue;
    }
    const list = groups.get(client) ?? [];
    list.push(project);
    groups.set(client, list);
  }
  const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });
  return {
    clients: [...groups.entries()]
      .sort(([a], [b]) => byName(a, b))
      .map(([name, projects]) => ({ name, projects: projects.sort(byName) })),
    ungrouped,
  };
}
