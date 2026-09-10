import type Database from "better-sqlite3";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { load as parseYaml } from "js-yaml";
import { classifyItem } from "../../decision-contract/classifier.js";
import { BRAND_ROOT } from "./index.js";

/**
 * s4-manifest-decision-synthesis (consus-phase29-brand-decision-review):
 * closes the gap identified this session — "we have the output already
 * (a real, approved set of logo concepts sitting in brand-guide.html), now
 * i just need to make the decision" — by letting a doc-scanner-indexed
 * artifact auto-become a real decision, instead of only a reviewable
 * doc_changed/decision_needed *event* (server/events/detect.ts).
 *
 * `.pHive/brand/logo-concepts.yaml` is the manifest format this synthesizes
 * from: a top-level object shaped like a `dostal:concept-selection/v1`
 * payload (`title`, `context`, `concepts[]`) minus the `version` field
 * (fixed here, never trusted from the file) — see docs/api-reference.md for
 * the full format. `concepts[]` conforms exactly to s2's
 * ConceptSelectionPayload `concepts[]` shape
 * (server/decision-contract/parser.ts / web/src/features/decisions/
 * answer-shapes/types.ts): `{ id, name, description, preview: { kind:
 * "svg", markup } }`.
 */

export const LOGO_CONCEPTS_MANIFEST_FILE = "logo-concepts.yaml";

/** Repo-relative path to the manifest, e.g. `.pHive/brand/logo-concepts.yaml`
 *  (OS-specific separator, matching every other doc-scanner path convention
 *  in this codebase — see server/adapters/doc-scanner/index.ts's BRAND_ROOT
 *  and deriveEpicAndPhase). */
export const LOGO_CONCEPTS_MANIFEST_PATH = join(BRAND_ROOT, LOGO_CONCEPTS_MANIFEST_FILE);

interface ManifestConceptPreview {
  kind: "svg";
  markup: string;
}

interface ManifestConcept {
  id: string;
  name: string;
  description: string;
  preview: ManifestConceptPreview;
}

interface BrandManifestPayload {
  version: "dostal:concept-selection/v1";
  title: string;
  context: string;
  concepts: ManifestConcept[];
}

function isValidConcept(candidate: unknown): candidate is ManifestConcept {
  if (!candidate || typeof candidate !== "object") return false;
  const c = candidate as Record<string, unknown>;
  if (typeof c.id !== "string" || !c.id) return false;
  if (typeof c.name !== "string" || !c.name) return false;
  if (typeof c.description !== "string" || !c.description) return false;
  const preview = c.preview as Record<string, unknown> | undefined;
  if (!preview || typeof preview !== "object") return false;
  if (preview.kind !== "svg") return false;
  if (typeof preview.markup !== "string" || !preview.markup) return false;
  return true;
}

/**
 * Structural validation only, same defensive posture as every other
 * optional scan input in this codebase (e.g. doc-scanner's walk() catching
 * a missing directory, git-ref.ts degrading on an unresolvable ref) — a
 * missing/malformed manifest degrades to `null` (no decision synthesized),
 * never a thrown error that could abort the surrounding scan.
 */
function parseManifest(raw: unknown): BrandManifestPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.title !== "string" || !m.title.trim()) return null;
  if (typeof m.context !== "string" || !m.context.trim()) return null;
  if (!Array.isArray(m.concepts) || m.concepts.length < 1) return null;
  if (!m.concepts.every(isValidConcept)) return null;

  return {
    version: "dostal:concept-selection/v1",
    title: m.title,
    context: m.context,
    concepts: m.concepts,
  };
}

/**
 * decisionItemIdFor's exact `decision:<repo>:<file_path>` namespace (see
 * server/events/detect.ts) reused verbatim, keyed off the manifest's own
 * repo-relative path — the same dedupe guarantee every other doc-derived
 * decision already has: re-scanning resolves to the same id, never a
 * duplicate row.
 */
function brandManifestItemId(repoName: string): string {
  return `decision:${repoName}:${LOGO_CONCEPTS_MANIFEST_PATH}`;
}

/**
 * Reads `.pHive/brand/logo-concepts.yaml` (if present) and, when it parses
 * to a valid concept-selection manifest, creates (or idempotently refreshes)
 * a real `items` row carrying a `dostal:concept-selection/v1` decision_payload
 * built from its contents — the concrete mechanism behind this story's
 * acceptance: after a scan, the operator can open Consus and actually decide
 * "monogram, selected" on real content already on disk.
 *
 * Called once per project immediately after scanRepo, from the same
 * detectEvents entrypoint every scan route (`POST /api/projects`,
 * `POST /api/projects/:project/ingest`, `POST /api/projects/scan-all`)
 * already invokes identically (server/events/detect.ts) — no separate
 * wiring needed per route.
 *
 * Idempotent and side-effect-free on any of: no manifest on disk, a
 * manifest that fails to parse as YAML, or a manifest whose shape doesn't
 * match `concepts[]`'s required fields — returns `false` without touching
 * `items` in every such case. An already-existing item at this id (whether
 * still open or already decided) has its `decision_payload`/`updated_at`
 * refreshed from the manifest's current contents (mirroring
 * decisionItemIdFor's own ON CONFLICT behavior) but is never re-inserted as
 * a second row and never has `decided_at` cleared — a decided brand
 * decision stays decided across every future re-scan.
 */
export function synthesizeBrandManifestDecision(
  db: Database.Database,
  { repoName, repoPath }: { repoName: string; repoPath: string },
): boolean {
  const absPath = join(repoPath, LOGO_CONCEPTS_MANIFEST_PATH);
  if (!existsSync(absPath)) return false;

  let raw: unknown;
  try {
    const content = readFileSync(absPath, "utf-8");
    raw = parseYaml(content);
  } catch {
    // Malformed YAML (bad syntax) or an unreadable file — degrade
    // gracefully, no crash, no decision created.
    return false;
  }

  const payload = parseManifest(raw);
  if (!payload) return false;

  const itemId = brandManifestItemId(repoName);
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO items (id, type, title, status, source_repo, source_ref, decision_payload, created_at, updated_at)
     VALUES (@id, 'decision', @title, 'active', @repo, @path, @decision_payload, @now, @now)
     ON CONFLICT(id) DO UPDATE SET decision_payload = excluded.decision_payload, updated_at = excluded.updated_at`,
  ).run({
    id: itemId,
    title: payload.title,
    repo: repoName,
    path: LOGO_CONCEPTS_MANIFEST_PATH,
    decision_payload: JSON.stringify(payload),
    now,
  });

  classifyItem(db, itemId);

  return true;
}
