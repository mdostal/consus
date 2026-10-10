#!/usr/bin/env node
/**
 * PANT-960: starts a throwaway Consus for the Playwright checks — a temp
 * database, and one empty repo directory per project name, registered via
 * the usual CONSUS_PROJECTS_CONFIG file. Never touches a real repo or
 * database.
 *
 * Project names come from, in order:
 *  - CONSUS_E2E_PROJECTS_FROM=<base url>: GET <url>/api/projects on a running
 *    Consus (read-only) and mirror its project names, e.g. the hive instance;
 *  - CONSUS_E2E_PROJECTS=a,b,c;
 *  - a small built-in list.
 *
 * Harness/Pantheon env vars are stripped so nothing is dispatched anywhere.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.CONSUS_E2E_PORT ?? "18960";

async function projectNames() {
  const from = process.env.CONSUS_E2E_PROJECTS_FROM;
  if (from) {
    const res = await fetch(`${from.replace(/\/+$/, "")}/api/projects`);
    if (!res.ok) throw new Error(`GET ${from}/api/projects -> ${res.status}`);
    const body = await res.json();
    console.log(`[e2e] mirroring ${body.projects.length} project names from ${from}: ${body.projects.join(", ")}`);
    return body.projects;
  }
  if (process.env.CONSUS_E2E_PROJECTS) return process.env.CONSUS_E2E_PROJECTS.split(",").filter(Boolean);
  return ["alpha-web", "alpha-api", "beta-app", "beta-site", "scratch"];
}

const names = await projectNames();
const dir = mkdtempSync(join(tmpdir(), "consus-e2e-"));
const registry = {};
for (const name of names) {
  const repo = join(dir, "repos", name);
  mkdirSync(repo, { recursive: true });
  registry[name] = repo;
}
const projectsConfig = join(dir, "consus-projects.json");
writeFileSync(projectsConfig, JSON.stringify(registry, null, 2));

const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !/^(PANTHEON_|CONSUS_HARNESS|CONSUS_PANTHEON|CONSUS_WEBHOOK)/.test(key)),
);
Object.assign(env, {
  PORT: port,
  HOST: "127.0.0.1",
  CONSUS_DB_PATH: join(dir, "consus.sqlite"),
  CONSUS_PROJECTS_CONFIG: projectsConfig,
  CONSUS_ATTACHMENTS_DIR: join(dir, "attachments"),
});

const child = spawn(join(root, "node_modules/.bin/tsx"), [join(root, "server/index.ts")], {
  cwd: dir,
  env,
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
