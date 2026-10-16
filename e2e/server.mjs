#!/usr/bin/env node
// PANT-965: the server the Playwright checks run against. Builds a small
// fixture repo (a markdown doc with mermaid fences and a standalone .mmd
// diagram), registers it as project "demo", and starts the built server
// (dist-server + dist-web) on E2E_PORT with the file harness transport, so
// every proposal lands as a JSON file under e2e/.fixture/handoffs/ for the
// tests to read. Also registers a few empty projects for the client-switcher
// check (PANT-960). Never talks to Pantheon. Requires `npm run build` first.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const FIXTURE_DIR = join(ROOT, "e2e", ".fixture");
const REPO_DIR = join(FIXTURE_DIR, "demo-repo");
const PORT = process.env.E2E_PORT ?? "18965";

for (const built of ["dist-server/index.js", "dist-web/index.html"]) {
  if (!existsSync(join(ROOT, built))) {
    console.error(`[e2e] ${built} is missing — run \`npm run build\` first`);
    process.exit(1);
  }
}

rmSync(FIXTURE_DIR, { recursive: true, force: true });
mkdirSync(join(REPO_DIR, "docs", "diagrams"), { recursive: true });

writeFileSync(
  join(REPO_DIR, "docs", "architecture.md"),
  [
    "# Demo architecture",
    "",
    "```mermaid",
    "flowchart LR",
    "  web[Web app] --> api[API]",
    "```",
    "",
    "A broken diagram, to check the error shows:",
    "",
    "```mermaid",
    "flowchart LR",
    "  this is -- not valid ((",
    "```",
    "",
  ].join("\n"),
);
writeFileSync(
  join(REPO_DIR, "docs", "diagrams", "system.mmd"),
  ["flowchart TD", "  client[Client] --> api[API]", "  api --> db[(Database)]", ""].join("\n"),
);
// PANT-960: more projects for the client-switcher check, each an empty repo
// directory. E2E_PROJECTS_FROM=<base url> mirrors a running Consus's project
// names instead (a read-only GET /api/projects, e.g. the hive instance).
async function extraProjectNames() {
  const from = process.env.E2E_PROJECTS_FROM;
  if (!from) return ["alpha-web", "beta-app", "scratch"];
  const res = await fetch(`${from.replace(/\/+$/, "")}/api/projects`);
  if (!res.ok) throw new Error(`GET ${from}/api/projects -> ${res.status}`);
  const { projects } = await res.json();
  console.log(`[e2e] mirroring ${projects.length} project names from ${from}: ${projects.join(", ")}`);
  return projects;
}

const registry = { demo: REPO_DIR };
for (const name of await extraProjectNames()) {
  if (name in registry) continue;
  const dir = join(FIXTURE_DIR, "repos", name);
  mkdirSync(dir, { recursive: true });
  registry[name] = dir;
}
writeFileSync(join(FIXTURE_DIR, "projects.json"), JSON.stringify(registry, null, 2));

const env = {
  ...process.env,
  PORT,
  HOST: "127.0.0.1",
  CONSUS_DB_PATH: join(FIXTURE_DIR, "consus.sqlite"),
  CONSUS_PROJECTS_CONFIG: join(FIXTURE_DIR, "projects.json"),
  CONSUS_ATTACHMENTS_DIR: join(FIXTURE_DIR, "attachments"),
  CONSUS_HARNESS_FILE_DIR: join(FIXTURE_DIR, "handoffs"),
  // Never reach a real harness or the live Pantheon bridge from a test run.
  CONSUS_HARNESS: "",
  CONSUS_HARNESS_COMMAND: "",
  PANTHEON_API_URL: "",
};

const child = spawn(process.execPath, [join(ROOT, "dist-server", "index.js")], { env, stdio: "inherit" });
const stop = () => child.kill("SIGTERM");
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
child.on("exit", (code) => process.exit(code ?? 0));
