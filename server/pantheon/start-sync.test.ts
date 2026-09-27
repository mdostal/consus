/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import { runMigration } from "../db/migrate.js";
import { openDb } from "../db/connection.js";
import { startPantheonSync } from "./start-sync.js";

const PANTHEON_URL = "https://pantheon.example.com";
const INTERVAL_MS = 1_000;

let dir: string;
let dbPath: string;
let app: FastifyInstance;

beforeEach(() => {
  vi.useFakeTimers();
  dir = mkdtempSync(join(tmpdir(), "consus-pantheon-sync-"));
  dbPath = join(dir, "consus.sqlite");
  const migrateDb = openDb(dbPath);
  runMigration(migrateDb);
  migrateDb.close();
  app = Fastify();
});

afterEach(async () => {
  await app.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function okFetch() {
  return vi.fn(async (url: string | URL | Request) => {
    const body = String(url).includes("/api/feed/questions") ? { questions: [] } : { changes: [] };
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

describe("startPantheonSync", () => {
  it("starts both pullers on the given interval, each on its own open DB handle", async () => {
    const fetchMock = okFetch();
    const handles = startPantheonSync(app, { dbPath, pantheonUrl: PANTHEON_URL, intervalMs: INTERVAL_MS, fetch: fetchMock });

    expect(handles.resultPullerDb).not.toBe(handles.questionPullerDb);
    expect(handles.resultPullerDb.open).toBe(true);
    expect(handles.questionPullerDb.open).toBe(true);
    expect(vi.getTimerCount()).toBe(2);

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    const urls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(urls.some((u) => u.startsWith(`${PANTHEON_URL}/api/feed/changes`))).toBe(true);
    expect(urls.some((u) => u.startsWith(`${PANTHEON_URL}/api/feed/questions`))).toBe(true);
  });

  it("app.close() clears both intervals and closes both DB handles", async () => {
    const fetchMock = okFetch();
    const handles = startPantheonSync(app, { dbPath, pantheonUrl: PANTHEON_URL, intervalMs: INTERVAL_MS, fetch: fetchMock });
    await app.ready();

    await app.close();

    expect(vi.getTimerCount()).toBe(0);
    expect(handles.resultPullerDb.open).toBe(false);
    expect(handles.questionPullerDb.open).toBe(false);

    fetchMock.mockClear();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 5);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("catches and logs poll failures instead of throwing, and keeps polling", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const fetchMock = vi.fn().mockRejectedValue(new Error("pantheon down"));
      startPantheonSync(app, { dbPath, pantheonUrl: PANTHEON_URL, intervalMs: INTERVAL_MS, fetch: fetchMock });

      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(INTERVAL_MS);

      // Both pullers fetched on both ticks despite every fetch rejecting.
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(errorSpy).toHaveBeenCalledWith("[question-puller] poll failed", expect.any(Error));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});
