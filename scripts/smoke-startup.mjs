#!/usr/bin/env node
// Startup smoke check (mdostal/consus#193 / PANT-922).
//
// Consus crash-looped on every deploy with
//
//   node::RemoveEnvironmentCleanupHook ... Assertion failed: (env) != nullptr
//
// better-sqlite3 < 13 wraps statements in node::ObjectWrap; on Node 24 its
// destructor looks the Environment up through the *current* context, so a GC
// that finalizes a dropped prepared statement from a V8 foreground task
// (incremental marking finished while the event loop is idle) has no context
// and aborts the process. Unit tests never see it — vitest workers don't sit
// idle long enough — so this runs the real thing:
//
//   1. GC-finalizer probe: bursts of dropped prepared statements + garbage
//      with idle gaps, against the installed better-sqlite3 (the exact
//      pattern that aborts on an affected build).
//   2. Built server (dist-server/index.js), started twice against the same
//      DB directory — a cold start, then a restart onto the now-persistent
//      DB, like a redeploy onto the consus-data volume — in Pantheon mode
//      with an unreachable PANTHEON_API_URL, so the startup question
//      redelivery and both pullers run. Each boot must answer /health, take
//      some API traffic, then stay up while idle.
//
// Fails on any native assertion / fatal error output, a SIGABRT, or an
// unexpected exit. Requires `npm run build` first.
//
// Usage: node scripts/smoke-startup.mjs [--idle-ms N]

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_ENTRY = join(ROOT, "dist-server/index.js");
const NATIVE_FAILURE = /Assertion failed|Native stack trace|FATAL ERROR|Fatal error in|Segmentation fault/;

const idleArg = process.argv.indexOf("--idle-ms");
const IDLE_MS = idleArg > -1 ? Number(process.argv[idleArg + 1]) : 8_000;

function fail(msg) {
  console.error(`[smoke] FAIL: ${msg}`);
  process.exit(1);
}

/** Runs a child to completion, collecting output. */
function run(args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, ...opts });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("exit", (code, signal) => resolve({ code, signal, out }));
  });
}

async function gcFinalizerProbe() {
  const require = createRequire(join(ROOT, "package.json"));
  const bsqlPath = require.resolve("better-sqlite3");
  const bsqlVersion = require("better-sqlite3/package.json").version;
  const probe = `
    const Database = require(${JSON.stringify(bsqlPath)});
    const db = new Database(":memory:");
    db.exec("create table t (a)");
    let rounds = 0;
    function burst() {
      let keep = [];
      for (let i = 0; i < 5000; i++) keep.push(db.prepare("select a from t where a = ?"));
      let junk = [];
      for (let i = 0; i < 50000; i++) junk.push({ i, s: "x" + i });
      keep = null;
      junk = null;
      if (++rounds < 40) setTimeout(burst, 20);
      else console.log("rounds=" + rounds);
    }
    burst();
  `;
  const res = await run(["-e", probe]);
  const label = `GC-finalizer probe (better-sqlite3 ${bsqlVersion}, node ${process.version})`;
  if (res.signal || res.code !== 0 || NATIVE_FAILURE.test(res.out) || !/rounds=40/.test(res.out)) {
    fail(`${label} died (code=${res.code} signal=${res.signal})\n${res.out}`);
  }
  console.log(`[smoke] ok: ${label}`);
}

async function waitForHealth(base, child, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) return false;
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok && (await res.json()).sqlite === "connected") return true;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function bootServer(dataDir, port, label) {
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      CONSUS_DB_PATH: join(dataDir, "consus.sqlite"),
      CONSUS_PROJECTS_CONFIG: join(dataDir, "consus-projects.json"),
      CONSUS_ATTACHMENTS_DIR: join(dataDir, "attachments"),
      CONSUS_HARNESS: "pantheon",
      // Unreachable on purpose: startup redelivery and pullers must fail soft.
      PANTHEON_API_URL: "http://127.0.0.1:9",
    },
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const died = () => `${label}: server exited (code=${child.exitCode} signal=${child.signalCode})\n${out}`;

  const base = `http://127.0.0.1:${port}`;
  if (!(await waitForHealth(base, child, 20_000))) {
    child.kill("SIGKILL");
    fail(child.exitCode !== null || child.signalCode !== null ? died() : `${label}: /health never came up\n${out}`);
  }

  // Some real prepared-statement traffic, then go idle so V8 finishes GC
  // from an idle task — the window the deploy crash loop died in.
  for (let i = 0; i < 50; i++) {
    for (const path of ["/health", "/api/projects", "/api/surveys"]) {
      await fetch(`${base}${path}`).then((r) => r.arrayBuffer()).catch(() => {});
    }
  }
  await new Promise((r) => setTimeout(r, IDLE_MS));

  if (child.exitCode !== null || child.signalCode !== null) fail(died());
  if (NATIVE_FAILURE.test(out)) {
    child.kill("SIGKILL");
    fail(`${label}: native failure in server output\n${out}`);
  }

  const exited = new Promise((r) => child.on("exit", r));
  child.kill("SIGTERM");
  await exited;
  if (NATIVE_FAILURE.test(out)) fail(`${label}: native failure at shutdown\n${out}`);
  console.log(`[smoke] ok: ${label}`);
}

if (!existsSync(SERVER_ENTRY)) fail(`${SERVER_ENTRY} missing — run \`npm run build\` first`);

await gcFinalizerProbe();

const dataDir = mkdtempSync(join(tmpdir(), "consus-smoke-"));
try {
  const port = 18_000 + Math.floor(Math.random() * 2_000);
  await bootServer(dataDir, port, "cold start (fresh DB)");
  await bootServer(dataDir, port, "restart onto existing DB");
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
console.log("[smoke] startup smoke passed");
