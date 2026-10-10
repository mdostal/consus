#!/usr/bin/env node
// PANT-965: the server the Playwright checks run against. Builds a small
// fixture repo (a markdown doc with mermaid fences and a standalone .mmd
// diagram), registers it as project "demo", and starts the built server
// (dist-server + dist-web) on E2E_PORT with the file harness transport, so
// every proposal lands as a JSON file under e2e/.fixture/handoffs/ for the
// tests to read. Never talks to Pantheon. Requires `npm run build` first.

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
writeFileSync(join(FIXTURE_DIR, "projects.json"), JSON.stringify({ demo: REPO_DIR }, null, 2));

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
