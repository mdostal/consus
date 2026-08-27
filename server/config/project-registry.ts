import { existsSync, readFileSync, writeFileSync } from "node:fs";

export type ProjectRegistry = Record<string, string>;

/**
 * REQ-27 foundation: config-driven project -> repo-path map, replacing v1's
 * hardcoded single-repo `{ consus: process.cwd() }`. Backward compatible:
 * no config file present behaves exactly like v1 (a single "consus" project
 * mapped to cwd).
 */
export function loadProjectRegistry(configPath: string, cwd: string): ProjectRegistry {
  if (!existsSync(configPath)) {
    return { consus: cwd };
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    // eslint-disable-next-line no-console
    console.warn(`[project-registry] malformed config at ${configPath} — falling back to default`);
    return { consus: cwd };
  }

  const registry: ProjectRegistry = {};
  for (const [name, path] of Object.entries(raw)) {
    if (typeof path !== "string") continue;
    if (!existsSync(path)) {
      // eslint-disable-next-line no-console
      console.warn(`[project-registry] project "${name}" path does not exist, skipping: ${path}`);
      continue;
    }
    registry[name] = path;
  }
  return registry;
}

export function listProjects(registry: ProjectRegistry): string[] {
  return Object.keys(registry);
}

/** Persists the full registry back to `configPath` (pretty-printed JSON),
 *  used by `POST /api/projects` so a newly-added project survives a server
 *  restart the same way one hand-edited into the file would. */
export function saveProjectRegistry(configPath: string, registry: ProjectRegistry): void {
  writeFileSync(configPath, `${JSON.stringify(registry, null, 2)}\n`);
}
