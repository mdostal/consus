import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { createKbEntry, saveKbDraft, getKbVersions, getKbDraftVersions } from "./store.js";
import { triggerApprovalPipeline } from "./pipeline.js";

describe("triggerApprovalPipeline", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigration(db);
    createKbEntry(db, { id: "kb-1", title: "Adopt React Flow", author: "mathew", content: "published v1" });
  });

  it("promotes a draft version to published and repoints current_version_id", () => {
    saveKbDraft(db, { id: "kb-1", author: "mathew", content: "submitted draft content" });
    const draft = getKbDraftVersions(db, "kb-1")[0];
    const before = db.prepare("SELECT current_version_id FROM kb_entries WHERE id = ?").get("kb-1") as {
      current_version_id: number;
    };

    const result = triggerApprovalPipeline(db, { id: "kb-1", versionId: draft.id, actor: "mathew" });

    expect(result.entryId).toBe("kb-1");
    expect(result.publishedVersionId).not.toBe(before.current_version_id);
    expect(result.phases).toEqual({ approve: true, phaseSplit: true, kb: true });
    expect(result.triggeredAt).toBeTruthy();

    const updatedEntry = db.prepare("SELECT current_version_id FROM kb_entries WHERE id = ?").get("kb-1") as {
      current_version_id: number;
    };
    expect(updatedEntry.current_version_id).toBe(result.publishedVersionId);

    const versions = getKbVersions(db, "kb-1");
    const published = versions.find((v) => v.id === result.publishedVersionId);
    expect(published?.state).toBe("published");
    expect(published?.content).toBe("submitted draft content");
    expect(published?.author).toBe("mathew");
  });

  it("leaves the original draft row untouched (append-only) after submit", () => {
    saveKbDraft(db, { id: "kb-1", author: "mathew", content: "submitted draft content" });
    const draft = getKbDraftVersions(db, "kb-1")[0];

    triggerApprovalPipeline(db, { id: "kb-1", versionId: draft.id, actor: "mathew" });

    const versions = getKbVersions(db, "kb-1");
    const draftRow = versions.find((v) => v.id === draft.id);
    expect(draftRow?.state).toBe("draft");
    expect(draftRow?.content).toBe("submitted draft content");
  });

  it("throws for an unknown kb_entry", () => {
    expect(() => triggerApprovalPipeline(db, { id: "does-not-exist", versionId: 1, actor: "mathew" })).toThrow(
      /kb_entry not found/,
    );
  });

  it("throws for an unknown or mismatched version id", () => {
    expect(() => triggerApprovalPipeline(db, { id: "kb-1", versionId: 9999, actor: "mathew" })).toThrow(
      /kb_version not found/,
    );
  });

  it("throws when the versionId belongs to a different kb_entry", () => {
    createKbEntry(db, { id: "kb-2", title: "Other entry", author: "mathew", content: "published v1" });
    saveKbDraft(db, { id: "kb-2", author: "mathew", content: "kb-2 draft" });
    const kb2Draft = getKbDraftVersions(db, "kb-2")[0];

    expect(() => triggerApprovalPipeline(db, { id: "kb-1", versionId: kb2Draft.id, actor: "mathew" })).toThrow(
      /kb_version not found/,
    );
  });

  it("does not state-gate an already-published versionId — id+kb_entry_id match is the only lookup, per the story's acceptance criteria (no 'must be draft' criterion is listed)", () => {
    const publishedEntry = db.prepare("SELECT current_version_id FROM kb_entries WHERE id = ?").get("kb-1") as {
      current_version_id: number;
    };

    expect(() =>
      triggerApprovalPipeline(db, { id: "kb-1", versionId: publishedEntry.current_version_id, actor: "mathew" }),
    ).not.toThrow();
  });
});
