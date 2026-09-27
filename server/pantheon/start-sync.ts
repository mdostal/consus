import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { openDb } from "../db/connection.js";
import { PantheonResultPuller } from "../harness/pantheon-result-puller.js";
import { PantheonQuestionPuller } from "./question-puller.js";

export interface PantheonSyncOptions {
  dbPath: string;
  pantheonUrl: string;
  /** Poll interval for both pullers. Defaults to 60s. */
  intervalMs?: number;
  /** Injectable for tests; defaults to the global fetch. */
  fetch?: typeof globalThis.fetch;
}

export interface PantheonSyncHandles {
  resultPuller: PantheonResultPuller;
  questionPuller: PantheonQuestionPuller;
  resultPullerDb: Database.Database;
  questionPullerDb: Database.Database;
}

/**
 * Pantheon-mode startup wiring (CONSUS_HARNESS=pantheon): starts the change
 * result puller and the question puller, each on its own DB handle, and
 * registers an onClose hook that clears both intervals and closes both
 * handles. Extracted from server/index.ts so it can be unit-tested without
 * going through the process-entrypoint path.
 */
export function startPantheonSync(app: FastifyInstance, opts: PantheonSyncOptions): PantheonSyncHandles {
  const intervalMs = opts.intervalMs ?? 60_000;

  const resultPullerDb = openDb(opts.dbPath);
  const resultPuller = new PantheonResultPuller(opts.pantheonUrl, resultPullerDb, opts.fetch);
  const resultPullerHandle = resultPuller.start(intervalMs);

  const questionPullerDb = openDb(opts.dbPath);
  const questionPuller = new PantheonQuestionPuller(opts.pantheonUrl, questionPullerDb, opts.fetch);
  const questionPullerHandle = questionPuller.start(intervalMs);

  app.addHook("onClose", async () => {
    clearInterval(resultPullerHandle);
    clearInterval(questionPullerHandle);
    resultPullerDb.close();
    questionPullerDb.close();
  });

  return { resultPuller, questionPuller, resultPullerDb, questionPullerDb };
}
