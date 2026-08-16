import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { scanRepo } from "../adapters/doc-scanner/index.js";
import { detectEvents } from "./detect.js";
import { listEvents } from "./store.js";

function snapshotHashes(db: Database.Database, repoName: string): Map<string, string> {
  const rows = db
    .prepare("SELECT file_path, content_hash FROM doc_index WHERE repo = ?")
    .all(repoName) as Array<{ file_path: string; content_hash: string }>;
  return new Map(rows.map((r) => [r.file_path, r.content_hash]));
}

/** Mirrors the exact sequencing routes/projects.ts's handlers use: snapshot
 *  before scanRepo, scanRepo, then detectEvents. */
function scanAndDetect(db: Database.Database, project: string, repoName: string, repoPath: string): number {
  const previousHashes = snapshotHashes(db, repoName);
  scanRepo(db, { repoName, repoPath });
  return detectEvents(db, { project, repoName, repoPath, previousHashes });
}

function decisionRequestDoc(payload: Record<string, unknown>): string {
  return ["# Decision", "", "```decision-request", JSON.stringify(payload), "```"].join("\n");
}

const SAMPLE_DECISION_PAYLOAD = {
  version: "dostal:decision-request/v1",
  title: "Pick a caching strategy",
  context: "We need to decide how to cache doc content.",
  options: [
    { id: "A", title: "In-memory LRU", tradeoffs: "fast, but per-process" },
    { id: "B", title: "Redis", tradeoffs: "shared, but another dependency" },
  ],
  recommended: "A",
};

function initGitRepo(repoDir: string): void {
  execFileSync("git", ["init"], { cwd: repoDir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: repoDir });
}

function commitAll(repoDir: string, message: string): void {
  execFileSync("git", ["add", "."], { cwd: repoDir });
  execFileSync("git", ["commit", "-m", message], { cwd: repoDir });
}

describe("detectEvents", () => {
  let repoDir: string;
  let db: Database.Database;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "consus-detect-"));
    mkdirSync(join(repoDir, ".pHive", "planning"), { recursive: true });
    db = new Database(":memory:");
    runMigration(db);
  });

  afterEach(() => {
    db.close();
    rmSync(repoDir, { recursive: true, force: true });
  });

  describe("doc_changed pass", () => {
    it("AC2: every doc in a repo with no prior doc_index rows produces a doc_changed event, previous_hash null, diff entirely additions", () => {
      writeFileSync(join(repoDir, ".pHive", "planning", "a.md"), "# A\n\nhello");
      writeFileSync(join(repoDir, ".pHive", "planning", "b.md"), "# B\n\nworld");

      const count = scanAndDetect(db, "proj", "repo", repoDir);

      expect(count).toBe(2);
      const events = listEvents(db, { project: "proj" }).filter((e) => e.trigger_kind === "doc_changed");
      expect(events).toHaveLength(2);
      for (const event of events) {
        expect(event.previous_hash).toBeNull();
        const lines = (event.diff ?? "").split("\n");
        expect(lines.length).toBeGreaterThan(0);
        // A brand-new file's diff never shows anything as removed — every
        // line is either an addition or (at most, for the incidental blank
        // line the LCS naturally lines up) unchanged context.
        for (const line of lines) {
          expect(line.startsWith("- ")).toBe(false);
        }
        expect(lines.some((line) => line.startsWith("+ "))).toBe(true);
      }
    });

    it("AC3: a re-scan with one doc changed and one untouched creates exactly one new doc_changed event, for the changed doc only, with previous_hash equal to its prior hash", () => {
      const changedPath = join(".pHive", "planning", "a.md");
      const untouchedPath = join(".pHive", "planning", "b.md");
      writeFileSync(join(repoDir, changedPath), "# A\n\noriginal");
      writeFileSync(join(repoDir, untouchedPath), "# B\n\nstays the same");

      scanAndDetect(db, "proj", "repo", repoDir);
      const priorHash = snapshotHashes(db, "repo").get(changedPath)!;

      writeFileSync(join(repoDir, changedPath), "# A\n\nedited content");
      const count = scanAndDetect(db, "proj", "repo", repoDir);

      expect(count).toBe(1);
      const docChangedEvents = listEvents(db, { project: "proj" }).filter((e) => e.trigger_kind === "doc_changed");
      // one from the initial scan (both were new) + one from the re-scan
      expect(docChangedEvents).toHaveLength(3);
      const rescanEvents = docChangedEvents.filter((e) => e.previous_hash !== null);
      expect(rescanEvents).toHaveLength(1);
      expect(rescanEvents[0].source_path).toBe(changedPath);
      expect(rescanEvents[0].previous_hash).toBe(priorHash);
      expect(docChangedEvents.some((e) => e.source_path === untouchedPath && e.previous_hash !== null)).toBe(false);
    });

    it("AC7: re-scanning an unchanged doc with no decision-request block creates zero events for it", () => {
      const path = join(".pHive", "planning", "a.md");
      writeFileSync(join(repoDir, path), "# A\n\nunchanging content");

      scanAndDetect(db, "proj", "repo", repoDir);
      const countAfterRescan = scanAndDetect(db, "proj", "repo", repoDir);

      expect(countAfterRescan).toBe(0);
      expect(listEvents(db, { project: "proj" })).toHaveLength(1);
    });

    describe("HEAD-based diff for changed files", () => {
      it("AC8: a real diff against HEAD's content is used when the repo is git, HEAD has the prior content, and HEAD differs from the new content", () => {
        const path = join(".pHive", "planning", "a.md");
        initGitRepo(repoDir);
        writeFileSync(join(repoDir, path), "# A\n\nversion one");
        commitAll(repoDir, "v1");

        scanAndDetect(db, "proj", "repo", repoDir);

        // Edit working tree without committing — HEAD still holds v1.
        writeFileSync(join(repoDir, path), "# A\n\nversion two");
        scanAndDetect(db, "proj", "repo", repoDir);

        const events = listEvents(db, { project: "proj" }).filter(
          (e) => e.trigger_kind === "doc_changed" && e.previous_hash !== null,
        );
        expect(events).toHaveLength(1);
        expect(events[0].diff).toContain("  # A");
        expect(events[0].diff).toContain("- version one");
        expect(events[0].diff).toContain("+ version two");
        expect(events[0].composed_prompt).toContain("content_hash changed since last scan");
        expect(events[0].composed_prompt).not.toContain("no prior content on record for comparison");
      });

      it("AC9a: falls back to a full-content diff, with the no-prior-content note, when the repo is not a git repository", () => {
        const path = join(".pHive", "planning", "a.md");
        writeFileSync(join(repoDir, path), "# A\n\nversion one");
        scanAndDetect(db, "proj", "repo", repoDir);

        writeFileSync(join(repoDir, path), "# A\n\nversion two");
        scanAndDetect(db, "proj", "repo", repoDir);

        const events = listEvents(db, { project: "proj" }).filter(
          (e) => e.trigger_kind === "doc_changed" && e.previous_hash !== null,
        );
        expect(events).toHaveLength(1);
        expect(events[0].diff).toBe("+ # A\n  \n+ version two");
        expect(events[0].composed_prompt).toContain("no prior content on record for comparison — showing current content");
      });

      it("AC9b: falls back to a full-content diff when the file is untracked in an otherwise-real git repo", () => {
        const path = join(".pHive", "planning", "a.md");
        initGitRepo(repoDir);
        // Nothing committed at all — the doc is untracked.
        writeFileSync(join(repoDir, path), "# A\n\nversion one");
        scanAndDetect(db, "proj", "repo", repoDir);

        writeFileSync(join(repoDir, path), "# A\n\nversion two");
        scanAndDetect(db, "proj", "repo", repoDir);

        const events = listEvents(db, { project: "proj" }).filter(
          (e) => e.trigger_kind === "doc_changed" && e.previous_hash !== null,
        );
        expect(events).toHaveLength(1);
        expect(events[0].diff).toBe("+ # A\n  \n+ version two");
        expect(events[0].composed_prompt).toContain("no prior content on record for comparison — showing current content");
      });

      it("AC9c: falls back to a full-content diff when HEAD's content already matches the new content (the change predates HEAD)", () => {
        const path = join(".pHive", "planning", "a.md");
        initGitRepo(repoDir);
        writeFileSync(join(repoDir, path), "# A\n\nversion one");
        commitAll(repoDir, "v1");
        scanAndDetect(db, "proj", "repo", repoDir);

        // Commit v2 to HEAD *before* rescanning doc_index — so by the time
        // detectEvents runs, HEAD already equals the new content, even
        // though doc_index's stored hash still reflects v1.
        writeFileSync(join(repoDir, path), "# A\n\nversion two");
        commitAll(repoDir, "v2");
        scanAndDetect(db, "proj", "repo", repoDir);

        const events = listEvents(db, { project: "proj" }).filter(
          (e) => e.trigger_kind === "doc_changed" && e.previous_hash !== null,
        );
        expect(events).toHaveLength(1);
        expect(events[0].diff).toBe("+ # A\n  \n+ version two");
        expect(events[0].composed_prompt).toContain("no prior content on record for comparison — showing current content");
      });
    });
  });

  describe("decision_needed pass", () => {
    it("AC4: creates exactly one decision_needed event with a real items row (matching payload, decided_at null); an unchanged re-scan creates zero more", () => {
      const path = join(".pHive", "planning", "decision.md");
      writeFileSync(join(repoDir, path), decisionRequestDoc(SAMPLE_DECISION_PAYLOAD));

      scanAndDetect(db, "proj", "repo", repoDir);

      const decisionEvents = listEvents(db, { project: "proj" }).filter((e) => e.trigger_kind === "decision_needed");
      expect(decisionEvents).toHaveLength(1);
      expect(decisionEvents[0].item_id).toBe(`decision:repo:${path}`);
      expect(decisionEvents[0].diff).toBeNull();
      expect(decisionEvents[0].previous_hash).toBeNull();

      const item = db
        .prepare("SELECT decision_payload, decided_at, type FROM items WHERE id = ?")
        .get(decisionEvents[0].item_id) as { decision_payload: string; decided_at: string | null; type: string };
      expect(item.type).toBe("decision");
      expect(item.decided_at).toBeNull();
      expect(JSON.parse(item.decision_payload)).toEqual(SAMPLE_DECISION_PAYLOAD);

      const countOnRescan = scanAndDetect(db, "proj", "repo", repoDir);
      expect(countOnRescan).toBe(0);
      expect(listEvents(db, { project: "proj" }).filter((e) => e.trigger_kind === "decision_needed")).toHaveLength(1);
    });

    it("decisionItemId ('decision:repo:path') never collides with docItemIdFor's namespace ('doc:repo:path')", () => {
      const path = join(".pHive", "planning", "decision.md");
      writeFileSync(join(repoDir, path), decisionRequestDoc(SAMPLE_DECISION_PAYLOAD));
      scanAndDetect(db, "proj", "repo", repoDir);

      const decisionEvent = listEvents(db, { project: "proj" }).find((e) => e.trigger_kind === "decision_needed")!;
      expect(decisionEvent.item_id).toBe(`decision:repo:${path}`);
      expect(decisionEvent.item_id?.startsWith("doc:")).toBe(false);

      // Simulate docs.ts's docItemIdFor upsert at the same repo+path — must
      // land at a distinct row, not collide with the decision item.
      const docItemId = `doc:repo:${path}`;
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO items (id, type, title, status, source_repo, source_ref, created_at, updated_at)
         VALUES (?, 'doc', ?, 'active', ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
      ).run(docItemId, path, "repo", path, now, now);

      const rows = db.prepare("SELECT id, type FROM items WHERE source_repo = ? AND source_ref = ?").all("repo", path) as Array<{
        id: string;
        type: string;
      }>;
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.type === "decision")!.id).toBe(decisionEvent.item_id);
      expect(rows.find((r) => r.type === "doc")!.id).toBe(docItemId);
    });

    it("AC5: a content change to an already-open decision_needed doc creates a second new event and leaves the first completely untouched", () => {
      const path = join(".pHive", "planning", "decision.md");
      writeFileSync(join(repoDir, path), decisionRequestDoc(SAMPLE_DECISION_PAYLOAD));
      scanAndDetect(db, "proj", "repo", repoDir);

      const first = listEvents(db, { project: "proj" }).find((e) => e.trigger_kind === "decision_needed")!;

      const redrafted = { ...SAMPLE_DECISION_PAYLOAD, title: "Pick a caching strategy (redrafted)" };
      writeFileSync(join(repoDir, path), decisionRequestDoc(redrafted));
      const count = scanAndDetect(db, "proj", "repo", repoDir);

      const decisionEvents = listEvents(db, { project: "proj" }).filter((e) => e.trigger_kind === "decision_needed");
      expect(decisionEvents).toHaveLength(2);
      expect(count).toBeGreaterThanOrEqual(1);

      const firstAfter = decisionEvents.find((e) => e.id === first.id)!;
      expect(firstAfter).toEqual(first);
    });

    it("AC6: a redrafted decision on an already-decided item creates a new event and does not reset decided_at", () => {
      const path = join(".pHive", "planning", "decision.md");
      writeFileSync(join(repoDir, path), decisionRequestDoc(SAMPLE_DECISION_PAYLOAD));
      scanAndDetect(db, "proj", "repo", repoDir);

      const itemId = `decision:repo:${path}`;
      const decidedAt = "2026-08-01T00:00:00.000Z";
      db.prepare("UPDATE items SET decided_at = ? WHERE id = ?").run(decidedAt, itemId);

      const redrafted = { ...SAMPLE_DECISION_PAYLOAD, title: "Pick a caching strategy (redrafted again)" };
      writeFileSync(join(repoDir, path), decisionRequestDoc(redrafted));
      const count = scanAndDetect(db, "proj", "repo", repoDir);

      expect(count).toBeGreaterThanOrEqual(1);
      const decisionEvents = listEvents(db, { project: "proj" }).filter((e) => e.trigger_kind === "decision_needed");
      expect(decisionEvents).toHaveLength(2);

      const item = db.prepare("SELECT decided_at, decision_payload FROM items WHERE id = ?").get(itemId) as {
        decided_at: string | null;
        decision_payload: string;
      };
      expect(item.decided_at).toBe(decidedAt);
      expect(JSON.parse(item.decision_payload).title).toBe(redrafted.title);
    });
  });

  describe("composePrompt content", () => {
    it("stores the composed_prompt at creation time on the event row, with the header/project-area section", () => {
      const path = join(".pHive", "planning", "a.md");
      writeFileSync(join(repoDir, path), "# A\n\nhello");
      scanAndDetect(db, "proj", "repo", repoDir);

      const event = listEvents(db, { project: "proj" })[0];
      expect(event.composed_prompt).toContain("# Event: doc_changed in proj — repo/");
      expect(event.composed_prompt).toContain("project: proj  repo: repo  path:");
    });

    it("omits the epic/phase line entirely when deriveEpicAndPhase returns both null (a file directly under .pHive/epics/, not nested under epic/phase dirs)", () => {
      mkdirSync(join(repoDir, ".pHive", "epics"), { recursive: true });
      const path = join(".pHive", "epics", "orphan.md");
      writeFileSync(join(repoDir, path), "# Orphan\n\nhello");
      scanAndDetect(db, "proj", "repo", repoDir);

      const event = listEvents(db, { project: "proj" })[0];
      expect(event.composed_prompt).not.toContain("epic/phase");
    });

    it("includes a phase-only epic/phase line for a .pHive/planning doc (epic null, phase 'planning')", () => {
      const path = join(".pHive", "planning", "a.md");
      writeFileSync(join(repoDir, path), "# A\n\nhello");
      scanAndDetect(db, "proj", "repo", repoDir);

      const event = listEvents(db, { project: "proj" })[0];
      expect(event.composed_prompt).toContain("epic/phase (if under .pHive/epics/**): phase: planning");
    });

    it("includes both epic and phase for a .pHive/epics/** doc", () => {
      mkdirSync(join(repoDir, ".pHive", "epics", "my-epic", "stories"), { recursive: true });
      const path = join(".pHive", "epics", "my-epic", "stories", "s1.md");
      writeFileSync(join(repoDir, path), "# Story\n\nhello");
      scanAndDetect(db, "proj", "repo", repoDir);

      const event = listEvents(db, { project: "proj" })[0];
      expect(event.composed_prompt).toContain("epic/phase (if under .pHive/epics/**): epic: my-epic, phase: stories");
    });
  });
});
