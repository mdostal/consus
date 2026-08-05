import type Database from "better-sqlite3";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { ingestQuestion, type Question } from "./index.js";

/**
 * AC1's live ingestion transport: Minerva pushes one JSON-RPC-shaped line
 * per question ({method:"ingestQuestion", params:Question}, mirroring the
 * ABI convention transport.ts already uses for the outbound direction) and
 * this process persists it via the same ingestQuestion() the unit tests
 * exercise, then acks with an {ok,result}/{ok:false,...} line so Minerva
 * knows the write landed. Malformed lines never crash the listener — Minerva
 * keeps sending on the same stdio pipe for the rest of the session.
 */
export function runStdioListener(
  db: Database.Database,
  { input = process.stdin, output = process.stdout }: { input?: Readable; output?: Writable } = {},
): void {
  const rl = createInterface({ input });

  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let method: string | undefined;
    let params: Question | undefined;
    try {
      ({ method, params } = JSON.parse(trimmed) as { method?: string; params?: Question });
    } catch {
      output.write(JSON.stringify({ ok: false, recoverable: false, code: "INTERNAL_ERROR", message: "malformed JSON" }) + "\n");
      return;
    }

    if (method !== "ingestQuestion" || !params) {
      output.write(
        JSON.stringify({ ok: false, recoverable: false, code: "UNKNOWN_METHOD", message: `unknown: ${method}` }) + "\n",
      );
      return;
    }

    try {
      ingestQuestion(db, params);
      output.write(JSON.stringify({ ok: true, result: { id: params.id } }) + "\n");
    } catch (err) {
      output.write(
        JSON.stringify({
          ok: false,
          recoverable: false,
          code: "INTERNAL_ERROR",
          message: err instanceof Error ? err.message : String(err),
        }) + "\n",
      );
    }
  });
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const { openDb } = await import("../../db/connection.js");
  const { runMigration } = await import("../../db/migrate.js");
  const dbPath = process.env.CONSUS_DB_PATH ?? ".pHive/consus.sqlite";
  const db = openDb(dbPath);
  runMigration(db);
  runStdioListener(db);
}
