import { describe, it, expect, afterEach } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

/**
 * AC1, "verify that transport is live": there is no HTTP POST-create-decision
 * route — ingestion only happens over the Minerva stdio adapter. Every other
 * test in this repo calls ingestQuestion() as a plain function; this is the
 * one that actually spawns the listener as its own process and talks to it
 * over real stdin/stdout, the way Minerva does in production.
 */
describe("Minerva stdio adapter — live process", () => {
  let child: ChildProcessWithoutNullStreams | undefined;
  let dbPath: string;

  afterEach(() => {
    child?.kill();
    if (dbPath && existsSync(dbPath)) {
      rmSync(join(dbPath, ".."), { recursive: true, force: true });
    }
  });

  it("ingests a real dostal:decision-request/v1 payload end-to-end into items + human_requests", async () => {
    const dir = mkdtempSync(join(tmpdir(), "consus-stdio-e2e-"));
    dbPath = join(dir, "consus.sqlite");

    child = spawn(
      process.execPath,
      [join(process.cwd(), "node_modules/.bin/tsx"), join(process.cwd(), "server/adapters/minerva/stdio-listener.ts")],
      { env: { ...process.env, CONSUS_DB_PATH: dbPath }, stdio: ["pipe", "pipe", "pipe"] },
    );

    const rl = createInterface({ input: child.stdout });
    const nextLine = () =>
      new Promise<string>((resolve) => rl.once("line", resolve));

    const decisionPayload = {
      version: "dostal:decision-request/v1" as const,
      title: "Adopt the never-park contract for blocking questions?",
      context: "e2e probe for PAN-7546",
      options: [
        { id: "A", title: "Adopt now", tradeoffs: "faster but less review" },
        { id: "B", title: "Pilot first", tradeoffs: "slower but safer" },
      ],
      recommended: "B",
    };

    const question = {
      id: "e2e-q-1",
      text: decisionPayload.title,
      channel: "architecture",
      reason: "e2e probe",
      status: "open",
      decisionPayload,
    };

    child.stdin.write(JSON.stringify({ method: "ingestQuestion", params: question }) + "\n");

    const ack = JSON.parse(await nextLine());
    expect(ack).toEqual({ ok: true, result: { id: "e2e-q-1" } });

    rl.close();
    child.kill();
    child = undefined;

    const db = new Database(dbPath, { readonly: true });
    const item = db
      .prepare("SELECT id, type, status, decision_payload FROM items WHERE id = ?")
      .get("human_request:e2e-q-1") as { id: string; type: string; status: string; decision_payload: string } | undefined;
    const humanRequest = db
      .prepare("SELECT minerva_question_id, text, channel, status FROM human_requests WHERE minerva_question_id = ?")
      .get("e2e-q-1") as { minerva_question_id: string; text: string; channel: string; status: string } | undefined;
    db.close();

    expect(item).toBeDefined();
    expect(item!.type).toBe("human_request");
    expect(item!.status).toBe("open");
    expect(JSON.parse(item!.decision_payload)).toEqual(decisionPayload);

    expect(humanRequest).toEqual({
      minerva_question_id: "e2e-q-1",
      text: decisionPayload.title,
      channel: "architecture",
      status: "open",
    });
  });

  it("acks unknown methods without crashing the listener", async () => {
    const dir = mkdtempSync(join(tmpdir(), "consus-stdio-e2e-"));
    dbPath = join(dir, "consus.sqlite");

    child = spawn(
      process.execPath,
      [join(process.cwd(), "node_modules/.bin/tsx"), join(process.cwd(), "server/adapters/minerva/stdio-listener.ts")],
      { env: { ...process.env, CONSUS_DB_PATH: dbPath }, stdio: ["pipe", "pipe", "pipe"] },
    );

    const rl = createInterface({ input: child.stdout });
    const nextLine = () => new Promise<string>((resolve) => rl.once("line", resolve));

    child.stdin.write(JSON.stringify({ method: "bogus", params: {} }) + "\n");
    const rejectAck = JSON.parse(await nextLine());
    expect(rejectAck.ok).toBe(false);
    expect(rejectAck.code).toBe("UNKNOWN_METHOD");

    child.stdin.write(
      JSON.stringify({
        method: "ingestQuestion",
        params: { id: "e2e-q-2", text: "still alive?", channel: "general", reason: null, status: "open" },
      }) + "\n",
    );
    const secondAck = JSON.parse(await nextLine());
    expect(secondAck).toEqual({ ok: true, result: { id: "e2e-q-2" } });

    rl.close();
  });
});
