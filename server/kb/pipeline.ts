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
 * Explicitly fires the approve -> phase-split -> KB pipeline for a draft
 * version. Only the Submit endpoint may call this — Save must never import
 * or invoke this module, so a mocked pipeline that is never called proves
 * isolation in tests.
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

  const version = db
    .prepare("SELECT * FROM kb_versions WHERE id = ? AND kb_entry_id = ?")
    .get(versionId, id) as KbVersionRow | undefined;
  if (!version) {
    throw new Error(`kb_version not found: ${versionId} for entry ${id}`);
  }

  // approve -> phase-split -> KB: promoting the draft content to a new
  // published kb_versions row is the "KB" phase; approve/phase-split have no
  // separate systems to call into yet, so they are recorded as fired
  // no-op hooks for downstream consumers to attach to later.
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
