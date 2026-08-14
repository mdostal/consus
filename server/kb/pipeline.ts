import type Database from "better-sqlite3";
import { createKbEntry, type KbVersionRow } from "./store.js";

export interface SubmitPipelineInput {
  id: string;
  versionId: number;
  actor: string;
}

export interface SubmitPipelineResult {
  entryId: string;
  publishedVersionId: number;
  phases: {
    approve: boolean;
    phaseSplit: boolean;
    kb: boolean;
  };
  triggeredAt: string;
}

/**
 * Submit half of REQ-17 ("Save != Submit"): promotes a saved draft
 * kb_versions row to published by calling the existing, unmodified
 * createKbEntry() — the same publish path a direct create already goes
 * through, so publish behavior (conflict handling, versioning) can't drift
 * between "immediate publish" and "submit a draft" callers.
 *
 * approve/phaseSplit have no separate systems to call into in this
 * codebase yet, so (matching the ported archive module) they're recorded
 * as fired no-op flags for downstream consumers to attach to later, not
 * implemented as real steps. Only this module may import from store.ts in
 * this direction — store.ts (the save/draft path) has zero dependency on
 * pipeline.ts (the submit path); see the grep-based isolation check in
 * store.test.ts.
 */
export function triggerApprovalPipeline(
  db: Database.Database,
  { id, versionId, actor }: SubmitPipelineInput,
): SubmitPipelineResult {
  const entry = db.prepare("SELECT title, source_repo FROM kb_entries WHERE id = ?").get(id) as
    | { title: string; source_repo: string | null }
    | undefined;
  if (!entry) {
    throw new Error(`kb_entry not found: ${id}`);
  }

  // Look up by id AND kb_entry_id, to catch a versionId that exists but
  // belongs to a different kb_entry.
  const version = db
    .prepare("SELECT * FROM kb_versions WHERE id = ? AND kb_entry_id = ?")
    .get(versionId, id) as KbVersionRow | undefined;
  if (!version) {
    throw new Error(`kb_version not found: ${versionId} for entry ${id}`);
  }

  // The draft row itself is never touched here — createKbEntry() only ever
  // appends a new published kb_versions row and repoints
  // current_version_id, leaving the original draft row (append-only) as a
  // historical record.
  createKbEntry(db, {
    id,
    title: entry.title,
    author: actor,
    content: version.content,
    sourceRepo: entry.source_repo,
  });

  const updated = db.prepare("SELECT current_version_id FROM kb_entries WHERE id = ?").get(id) as {
    current_version_id: number;
  };

  return {
    entryId: id,
    publishedVersionId: updated.current_version_id,
    phases: { approve: true, phaseSplit: true, kb: true },
    triggeredAt: new Date().toISOString(),
  };
}
