/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { runMigration } from "../db/migrate.js";
import { registerInteractionRoutes } from "./interactions.js";

// consus#198 regression: a test that posts a verdict without injecting
// `pantheonApiUrl` / `fetch` must never reach the Pantheon decision bridge,
// even when the parent environment exports PANTHEON_API_URL (the agent
// runtime sets it to the live core-api). vitest.setup.ts clears it.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const THIS_FILE = relative(ROOT, fileURLToPath(import.meta.url));
const CHILD_FLAG = "CONSUS_BRIDGE_ISOLATION_CHILD";

describe("consus#198: tests never reach the live Pantheon bridge", () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigration(db);
    app = Fastify();
    // Deliberately no pantheonApiUrl / fetch override — the unstubbed shape
    // that filed PANT-952/953.
    registerInteractionRoutes(app, { db });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    vi.restoreAllMocks();
  });

  it("clears PANTHEON_API_URL before any test runs", () => {
    expect(process.env.PANTHEON_API_URL).toBe("");
  });

  it("records a verdict without calling fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO items (id, type, title, status, created_at, updated_at) VALUES ('dec-iso', 'decision', 'Isolated', 'open', ?, ?)",
    ).run(now, now);

    const res = await app.inject({
      method: "POST",
      url: "/api/decisions/dec-iso/verdict",
      payload: { verdict: { kind: "accepted" } },
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(res.statusCode).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // Re-runs this file in a child vitest whose parent env points
  // PANTHEON_API_URL at a local recorder, proving the setup file (not this
  // process's own env) keeps the verdict POST off the network.
  it.skipIf(process.env[CHILD_FLAG])(
    "makes no network call even when the parent env sets PANTHEON_API_URL",
    async () => {
      const hits: string[] = [];
      const recorder: Server = createServer((req, res) => {
        hits.push(`${req.method} ${req.url}`);
        res.writeHead(202, { "Content-Type": "application/json" }).end("{}");
      });
      await new Promise<void>((r) => recorder.listen(0, "127.0.0.1", r));
      const { port } = recorder.address() as AddressInfo;

      try {
        const child = spawn(
          process.execPath,
          [join(ROOT, "node_modules/vitest/vitest.mjs"), "run", THIS_FILE],
          {
            cwd: ROOT,
            env: { ...process.env, PANTHEON_API_URL: `http://127.0.0.1:${port}`, [CHILD_FLAG]: "1" },
          },
        );
        let out = "";
        child.stdout.on("data", (d) => (out += d));
        child.stderr.on("data", (d) => (out += d));
        const code = await new Promise<number | null>((r) => child.on("close", r));

        expect(code, out).toBe(0);
        expect(hits).toEqual([]);
      } finally {
        await new Promise((r) => recorder.close(r));
      }
    },
    60_000,
  );
});
