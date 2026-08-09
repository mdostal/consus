import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { createKbEntry, saveKbDraft, getKbVersions } from "./store.js";
import { triggerApprovalPipeline } from "./pipeline.js";

describe("triggerApprovalPipeline", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigration(db);
    createKbEntry(db, { id: "kb-1", title: "Adopt React Flow", author: "mathew", content: "published v1" });
  });

  it("promotes a draft version to published and repoints current_version_id", () => {
    const draft = saveKbDraft(db, { id: "kb-1", author: "mathew", content: "submitted draft content" });
    const before = db.prepare("SELECT current_version_id FROM kb_entries WHERE id = ?").get("kb-1") as {
      current_version_id: number;
    };

    const result = triggerApprovalPipeline(db, { id: "kb-1", versionId: draft.id, actor: "mathew" });

    expect(result.entryId).toBe("kb-1");
    expect(result.publishedVersionId).not.toBe(before.current_version_id);
    expect(result.phases).toEqual({ approve: true, phaseSplit: true, kb: true });

    const versions = getKbVersions(db, "kb-1");
    const published = versions.find((v) => v.id === result.publishedVersionId);
    expect(published?.state).toBe("published");
    expect(published?.content).toBe("submitted draft content");
    expect(published?.author).toBe("mathew");
  });

  it("leaves the original draft row untouched (append-only) after submit", () => {
    const draft = saveKbDraft(db, { id: "kb-1", author: "mathew", content: "submitted draft content" });

    triggerApprovalPipeline(db, { id: "kb-1", versionId: draft.id, actor: "mathew" });

    const versions = getKbVersions(db, "kb-1");
    const draftRow = versions.find((v) => v.id === draft.id);
    expect(draftRow?.state).toBe("draft");
    expect(draftRow?.content).toBe("submitted draft content");
  });

  it("throws for an unknown kb_entry", () => {
    expect(() => triggerApprovalPipeline(db, { id: "does-not-exist", versionId: 1, actor: "mathew" })).toThrow(
      "kb_entry not found: does-not-exist",
    );
  });

  it("throws for an unknown or mismatched version id", () => {
    expect(() => triggerApprovalPipeline(db, { id: "kb-1", versionId: 9999, actor: "mathew" })).toThrow(
      /kb_version not found/,
    );
  });
});
