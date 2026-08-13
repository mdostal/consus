import { describe, it, expect, afterAll } from "vitest";
import { existsSync, unlinkSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { buildServer } from "./index.js";

describe("GET /health", () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "consus-test-")), "consus.sqlite");

  afterAll(() => {
    if (existsSync(dbPath)) {
      unlinkSync(dbPath);
    }
  });

  it("returns 200 with a JSON body confirming SQLite connectivity", async () => {
    const app = buildServer({ dbPath });

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe("ok");
    expect(body.sqlite).toBe("connected");

    await app.close();
  });
});

describe("buildServer — archivePaths backfill", () => {
  it("imports the archive when archivePaths is supplied, and is a no-op when omitted", async () => {
    const dir = mkdtempSync(join(tmpdir(), "consus-archive-wiring-"));
    const dbPath = join(dir, "consus.sqlite");
    const auditPath = join(dir, "audit.jsonl");
    const kbPath = join(dir, "kb.jsonl");
    writeFileSync(
      auditPath,
      JSON.stringify({
        ts: "2026-07-20T00:00:00Z",
        actor: "you",
        itemId: "item-x",
        identifier: "DOS-1",
        action: "select-option",
        statusFrom: "todo",
        statusTo: "done",
        rationale: "r",
        version: 1,
      }) + "\n",
    );
    writeFileSync(kbPath, "");

    const app = buildServer({ dbPath, archivePaths: { auditPath, kbPath } });
    await app.close();

    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare("SELECT COUNT(*) AS n FROM items WHERE id = 'delphi-archive:item-x'").get() as {
      n: number;
    };
    expect(row.n).toBe(1);
    db.close();
  });
});
