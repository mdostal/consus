import type Database from "better-sqlite3";
import { pullQuestions } from "./question-adapter.js";

/**
 * Polls Pantheon's question feed on an interval and imports new question
 * tickets as surveys. Mirrors the PantheonResultPuller pattern.
 * Activated when CONSUS_HARNESS=pantheon (same gate as the change puller).
 */
export class PantheonQuestionPuller {
  constructor(
    private readonly pantheonApiUrl: string,
    private readonly db: Database.Database,
    private readonly fetchImpl?: typeof globalThis.fetch,
  ) {}

  async poll(): Promise<void> {
    try {
      await pullQuestions(this.db, { pantheonApiUrl: this.pantheonApiUrl, fetch: this.fetchImpl });
    } catch (err) {
      console.error("[question-puller] poll failed", err);
    }
  }

  start(intervalMs: number): ReturnType<typeof setInterval> {
    return setInterval(() => void this.poll(), intervalMs);
  }
}
