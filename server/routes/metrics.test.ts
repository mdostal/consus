/**
 * @vitest-environment node
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../index.js";
import { openDb } from "../db/connection.js";
import { runMigration } from "../db/migrate.js";
import { PantheonHarnessTransport, FileHarnessTransport } from "../harness/transport.js";
import { PantheonQuestionPuller } from "../pantheon/question-puller.js";
import { PantheonResultPuller } from "../harness/pantheon-result-puller.js";
import { recordSyncSuccess } from "../pantheon/sync-status.js";

const NOW = new Date("2026-09-27T12:00:00.000Z");
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000).toISOString();

let dir: string;
let dbPath: string;
let app: FastifyInstance | undefined;

function setup() {
  dir = mkdtempSync(join(tmpdir(), "consus-metrics-"));
  dbPath = join(dir, "consus.sqlite");
}

afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function seed() {
  const db = openDb(dbPath);
  runMigration(db);
  const item = db.prepare(
    `INSERT INTO items (id, type, title, status, created_at, updated_at, decision_payload, decided_at)
     VALUES (?, 'decision_request', ?, ?, ?, ?, ?, ?)`,
  );
  item.run("d-open-old", "old", "open", ago(7200), ago(7200), "{}", null);
  item.run("d-open-new", "new", "open", ago(60), ago(60), "{}", null);
  item.run("d-decided", "done", "decided", ago(99999), ago(10), "{}", ago(10));
  item.run("plain", "not a decision", "open", ago(99999), ago(99999), null, null);

  const proposal = db.prepare(
    `INSERT INTO proposals (id, item_id, target_type, diff, description, status, requested_by, requested_at, resolved_at)
     VALUES (?, 'd-open-old', 'doc', '', '', ?, 'me', ?, ?)`,
  );
  proposal.run("p-pending-old", "pending", ago(3600), null);
  proposal.run("p-pending-new", "pending", ago(30), null);
  proposal.run("p-failed-recent", "failed", ago(5000), ago(4000));
  proposal.run("p-failed-old", "failed", ago(200000), ago(100000));
  proposal.run("p-applied-recent-1", "applied", ago(5000), ago(100));
  proposal.run("p-applied-recent-2", "applied", ago(5000), ago(200));
  proposal.run("p-applied-old", "applied", ago(200000), ago(90000));

  const event = db.prepare(
    `INSERT INTO events (id, project, trigger_kind, source_repo, source_path, content_hash, composed_prompt, status, detected_at, status_updated_at)
     VALUES (?, 'consus', 'doc_changed', 'consus', 'a.md', 'h', 'p', ?, ?, ?)`,
  );
  ["new", "new", "new", "in_progress", "done", "dismissed"].forEach((s, i) => event.run(`e${i}`, s, ago(10), ago(10)));

  const doc = db.prepare(
    "INSERT INTO doc_index (repo, file_path, content_hash, last_scanned_at) VALUES (?, ?, 'h', ?)",
  );
  doc.run("consus", "a.md", ago(500));
  doc.run("consus", "b.md", ago(500));
  doc.run("other", "c.md", ago(500));
  db.prepare("INSERT INTO project_ingests (repo, last_ingest_at) VALUES (?, ?)").run("consus", ago(300));
  db.close();
}

describe("GET /api/metrics", () => {
  it("returns zeros/nulls on an empty DB and lists registered-but-unscanned projects", async () => {
    setup();
    app = buildServer({ dbPath, repos: { consus: "/repo/consus" }, now: () => NOW });

    const res = await app.inject({ method: "GET", url: "/api/metrics" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      generated_at: NOW.toISOString(),
      decisions: { open: 0, oldest_open_age_seconds: null },
      proposals: { pending: 0, oldest_pending_age_seconds: null, failed_24h: 0, applied_24h: 0 },
      events: { pending: 0, in_review: 0 },
      projects: [{ name: "consus", last_ingest_at: null, doc_count: 0 }],
      harness: { transport: "noop" },
    });
  });

  it("computes every number from a seeded DB", async () => {
    setup();
    seed();
    app = buildServer({ dbPath, repos: { consus: "/repo/consus", fresh: "/repo/fresh" }, now: () => NOW });

    const res = await app.inject({ method: "GET", url: "/api/metrics" });

    expect(res.json()).toEqual({
      generated_at: NOW.toISOString(),
      decisions: { open: 2, oldest_open_age_seconds: 7200 },
      proposals: { pending: 2, oldest_pending_age_seconds: 3600, failed_24h: 1, applied_24h: 2 },
      events: { pending: 3, in_review: 1 },
      projects: [
        { name: "consus", last_ingest_at: ago(300), doc_count: 2 },
        { name: "fresh", last_ingest_at: null, doc_count: 0 },
        { name: "other", last_ingest_at: null, doc_count: 1 },
      ],
      harness: { transport: "noop" },
    });
  });

  it("reports the active transport name and omits pantheon outside pantheon mode", async () => {
    setup();
    app = buildServer({ dbPath, transport: new FileHarnessTransport(join(dir, "handoffs")) });

    const body = (await app.inject({ method: "GET", url: "/api/metrics" })).json();
    const health = (await app.inject({ method: "GET", url: "/health" })).json();

    expect(body.harness).toEqual({ transport: "file" });
    expect(body.pantheon).toBeUndefined();
    expect(health).toEqual({ status: "ok", sqlite: "connected", transport: "file", degraded: false });
  });
});

describe("pantheon mode sync status", () => {
  it("a throwing fetch sets degraded on /health and fills pantheon.last_error; a later success clears it", async () => {
    setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    app = buildServer({ dbPath, transport: new PantheonHarnessTransport("https://pantheon.example.com") });

    const before = (await app.inject({ method: "GET", url: "/health" })).json();
    expect(before).toEqual({ status: "ok", sqlite: "connected", transport: "pantheon", degraded: false });

    // Pullers run on their own handle, as startPantheonSync wires them.
    const pullerDb = openDb(dbPath);
    const throwing = vi.fn().mockRejectedValue(new Error("pantheon down"));
    await new PantheonQuestionPuller("https://pantheon.example.com", pullerDb, throwing).poll();

    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: "ok", sqlite: "connected", transport: "pantheon", degraded: true });

    const { pantheon } = (await app.inject({ method: "GET", url: "/api/metrics" })).json();
    expect(pantheon.degraded).toBe(true);
    expect(pantheon.last_error).toBe("pantheon down");
    expect(pantheon.last_error_direction).toBe("question_pull");
    expect(pantheon.directions.question_pull).toMatchObject({ last_error: "pantheon down", failing: true, last_success_at: null });
    expect(pantheon.directions.result_pull).toEqual({
      last_success_at: null,
      last_failure_at: null,
      last_error: null,
      failing: false,
    });

    // A later successful poll of the same direction clears degraded; the error stays visible.
    recordSyncSuccess(pullerDb, "question_pull", new Date(Date.now() + 1000));
    const recovered = (await app.inject({ method: "GET", url: "/health" })).json();
    expect(recovered.degraded).toBe(false);
    const after = (await app.inject({ method: "GET", url: "/api/metrics" })).json();
    expect(after.pantheon.last_error).toBe("pantheon down");
    pullerDb.close();
  });

  it("records result_pull failures on non-2xx and success on a good poll", async () => {
    setup();
    app = buildServer({ dbPath, transport: new PantheonHarnessTransport("https://pantheon.example.com") });
    const pullerDb = openDb(dbPath);

    const bad = vi.fn().mockResolvedValue(new Response("nope", { status: 503 }));
    await new PantheonResultPuller("https://pantheon.example.com", pullerDb, bad).poll();
    let { pantheon } = (await app.inject({ method: "GET", url: "/api/metrics" })).json();
    expect(pantheon.directions.result_pull).toMatchObject({ last_error: "Pantheon changes fetch failed: 503", failing: true });

    const good = vi.fn().mockResolvedValue(new Response(JSON.stringify({ changes: [] }), { status: 200 }));
    await new PantheonResultPuller("https://pantheon.example.com", pullerDb, good).poll();
    ({ pantheon } = (await app.inject({ method: "GET", url: "/api/metrics" })).json());
    expect(pantheon.directions.result_pull.failing).toBe(false);
    expect(pantheon.degraded).toBe(false);
    pullerDb.close();
  });
});
