/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { PantheonQuestionPuller } from "./question-puller.js";

const PANTHEON_URL = "https://pantheon.example.com";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  runMigration(db);
});

afterEach(() => {
  db.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("PantheonQuestionPuller.poll", () => {
  it("fetches the pending decision-question feed via the injected fetch", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request) => new Response(JSON.stringify({ questions: [] }), { status: 200 }));
    await new PantheonQuestionPuller(PANTHEON_URL, db, fetchMock).poll();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      `${PANTHEON_URL}/api/feed/questions?status=pending&surface=decision`,
    );
  });

  it("swallows and logs a network failure instead of throwing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("network down");
    const puller = new PantheonQuestionPuller(PANTHEON_URL, db, vi.fn().mockRejectedValue(err));

    await expect(puller.poll()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith("[question-puller] poll failed", err);
  });

  it("swallows and logs a non-2xx response instead of throwing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const puller = new PantheonQuestionPuller(
      PANTHEON_URL,
      db,
      vi.fn(async () => new Response("{}", { status: 503 })),
    );

    await expect(puller.poll()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][1])).toContain("503");
  });
});

describe("PantheonQuestionPuller.start", () => {
  it("polls on every interval tick and stops once the returned handle is cleared", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ questions: [] }), { status: 200 }));
    const handle = new PantheonQuestionPuller(PANTHEON_URL, db, fetchMock).start(1_000);

    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    clearInterval(handle);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
