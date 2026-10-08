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
  /** Start the change result puller. Defaults to true. */
  results?: boolean;
  /** Start the question puller. Defaults to true. */
  questions?: boolean;
  /** Injectable for tests; defaults to the global fetch. */
  fetch?: typeof globalThis.fetch;
}

/** A puller that was not started has null for both its puller and its DB handle. */
export interface PantheonSyncHandles {
  resultPuller: PantheonResultPuller | null;
  questionPuller: PantheonQuestionPuller | null;
  resultPullerDb: Database.Database | null;
  questionPullerDb: Database.Database | null;
}

/**
 * Pantheon-mode startup wiring (CONSUS_HARNESS=pantheon): starts the change
 * result puller and/or the question puller (both by default), each on its own
 * DB handle, and registers an onClose hook that clears the started intervals
 * and closes their handles. Extracted from server/index.ts so it can be unit-tested without
 * going through the process-entrypoint path.
 */
export function startPantheonSync(app: FastifyInstance, opts: PantheonSyncOptions): PantheonSyncHandles {
  const intervalMs = opts.intervalMs ?? 60_000;

  const handles: PantheonSyncHandles = {
    resultPuller: null,
    questionPuller: null,
    resultPullerDb: null,
    questionPullerDb: null,
  };
  const intervals: ReturnType<typeof setInterval>[] = [];

  if (opts.results ?? true) {
    handles.resultPullerDb = openDb(opts.dbPath);
    handles.resultPuller = new PantheonResultPuller(opts.pantheonUrl, handles.resultPullerDb, opts.fetch);
    intervals.push(handles.resultPuller.start(intervalMs));
  }

  if (opts.questions ?? true) {
    handles.questionPullerDb = openDb(opts.dbPath);
    handles.questionPuller = new PantheonQuestionPuller(opts.pantheonUrl, handles.questionPullerDb, opts.fetch);
    intervals.push(handles.questionPuller.start(intervalMs));
  }

  app.addHook("onClose", async () => {
    for (const handle of intervals) clearInterval(handle);
    handles.resultPullerDb?.close();
    handles.questionPullerDb?.close();
  });

  return handles;
}
