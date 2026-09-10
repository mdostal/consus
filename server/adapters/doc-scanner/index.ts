import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

export interface DocIndexRow {
  id: number;
  repo: string;
  epic: string | null;
  phase: string | null;
  file_path: string;
  content_hash: string;
  last_scanned_at: string;
}

export interface ScanOptions {
  repoName: string;
  repoPath: string;
}

export const DOC_EXTENSIONS = new Set([".md", ".html"]);
export const SCAN_ROOTS = [join(".pHive", "planning"), join(".pHive", "epics")];

/**
 * Repo-level "overview" docs (s1 of consus-phase27-feature-doc-review-ui):
 * top-level README/VISION plus a repo-root docs/ tree. These are always
 * tagged epic: null, phase: "overview" — a new, reserved phase value
 * distinct from "planning" (which specifically means .pHive/planning/*
 * content, derived below by deriveEpicAndPhase). Deliberately kept OUT of
 * SCAN_ROOTS itself: SCAN_ROOTS is also imported by ./git-ref.ts, whose
 * isUnderScanRoots() (and its test) specifically assert README.md at repo
 * root is NOT a scan-root match for that ref-aware git plumbing — folding
 * these in there would silently change that unrelated module's behavior.
 */
export const OVERVIEW_ROOT_FILES = ["README.md", "VISION.md"];
export const OVERVIEW_ROOT_DIR = "docs";

/**
 * Design/wireframe docs (s3 of consus-phase28-interaction-completeness): the
 * Hive `/design` skill's output directory, `.pHive/design/<topic>/`,
 * registered per-topic in `.pHive/design/index.yaml`
 * (hive/references/wireframe-protocol.md). Every markdown artifact under a
 * topic directory (brief.md, accessibility-constraints.md, etc. — the
 * topic's `.f0`/`.png` wireframe files are naturally excluded already, since
 * DOC_EXTENSIONS only matches .md/.html) is indexed tagged `phase: "design"`
 * — a new reserved value distinct from "planning"/"overview" — and
 * `epic: <topic name>`, derived straight from the directory name exactly
 * like `.pHive/epics/<epic>/**` already does below in deriveEpicAndPhase.
 * That intentionally lets a design topic whose name matches a real feature
 * epic fold into that feature's existing doc group (server/routes/docs.ts's
 * GET /api/docs/features already includes every row with a non-null epic in
 * its owning feature's bucket, regardless of phase — no route change
 * needed).
 *
 * Deliberately kept OUT of SCAN_ROOTS itself, same rationale as
 * OVERVIEW_ROOT_DIR above: SCAN_ROOTS also backs ./git-ref.ts's
 * isUnderScanRoots() or ref-aware git plumbing, and design docs weren't part
 * of its (already-tested) contract.
 */
export const DESIGN_ROOT = join(".pHive", "design");

/**
 * Brand docs (s1 of consus-phase29-brand-decision-review): the Hive
 * `/brand-system` skill's output directory, `.pHive/brand/`. Repo-wide, not
 * tied to a single feature/epic — mirrors OVERVIEW_ROOT_* exactly, tagged
 * `phase: "brand"` (a new reserved value distinct from "planning"/
 * "overview"/"design") and `epic: null`, always, never derived from path
 * structure. Only `brand-guide.html` (and any future .md docs) match —
 * DOC_EXTENSIONS only matches .md/.html, so `brand-system.yaml` sitting
 * alongside it (structured data consumed directly by later stories'
 * manifest-synthesis logic, not a human-readable doc) is naturally excluded
 * by construction, no special-casing needed.
 *
 * Deliberately kept OUT of SCAN_ROOTS itself, same rationale as
 * OVERVIEW_ROOT_DIR/DESIGN_ROOT above: SCAN_ROOTS also backs ./git-ref.ts's
 * isUnderScanRoots() for ref-aware git plumbing, and brand docs weren't part
 * of its (already-tested) contract.
 */
export const BRAND_ROOT = join(".pHive", "brand");

function walk(dir: string): string[] {
  let out: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out = out.concat(walk(full));
    } else if (DOC_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf(".")))) {
      out.push(full);
    }
  }
  return out;
}

function deriveEpicAndPhase(relPath: string): { epic: string | null; phase: string | null } {
  const parts = relPath.split(sep);
  // parts[0] === ".pHive"
  if (parts[1] === "planning") {
    return { epic: null, phase: "planning" };
  }
  if (parts[1] === "epics" && parts.length >= 4) {
    return { epic: parts[2], phase: parts[3] };
  }
  return { epic: null, phase: null };
}

/**
 * Finds repo-root README.md/VISION.md (if present) plus every doc under a
 * repo-root docs/ tree (if present), following the same tolerant-existsSync
 * convention used elsewhere in this codebase (e.g. project-registry.ts,
 * server/index.ts's WEB_ROOT check) — a repo with none of these simply
 * yields no files, never an error. docs/ recursion reuses walk(), the same
 * directory-walk convention SCAN_ROOTS already uses for .pHive/epics/**.
 */
function walkOverviewFiles(repoPath: string): string[] {
  const rootFiles = OVERVIEW_ROOT_FILES.map((name) => join(repoPath, name)).filter((absPath) =>
    existsSync(absPath),
  );
  return rootFiles.concat(walk(join(repoPath, OVERVIEW_ROOT_DIR)));
}

/**
 * Finds every .md/.html artifact under .pHive/design/**, if that directory
 * exists at all. Reuses walk() unchanged (the same directory-walk
 * convention as .pHive/epics/** and the overview docs/** tree above) — a
 * repo with no .pHive/design/ directory yields no files, no error, matching
 * this story's "purely additive, zero regression" acceptance criterion.
 */
function walkDesignFiles(repoPath: string): string[] {
  return walk(join(repoPath, DESIGN_ROOT));
}

/**
 * Derives a design doc's epic tag from its path: `.pHive/design/<topic>/...`
 * -> `<topic>`. Returns null for a stray file directly under .pHive/design/
 * itself (no topic segment) rather than guessing.
 */
function deriveDesignTopic(relPath: string): string | null {
  const parts = relPath.split(sep);
  // parts[0] === ".pHive", parts[1] === "design"
  return parts.length >= 4 ? parts[2] : null;
}

/**
 * Finds every .md/.html artifact under .pHive/brand/, if that directory
 * exists at all. Reuses walk() unchanged (the same directory-walk
 * convention as .pHive/epics/**, the overview docs/** tree, and
 * .pHive/design/** above) — a repo with no .pHive/brand/ directory (the
 * common case for any repo without a brand pass) yields no files, no error,
 * matching this story's "purely additive, zero regression" acceptance
 * criterion.
 */
function walkBrandFiles(repoPath: string): string[] {
  return walk(join(repoPath, BRAND_ROOT));
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function scanRepo(db: Database.Database, { repoName, repoPath }: ScanOptions): void {
  const now = new Date().toISOString();
  const upsert = db.prepare(`
    INSERT INTO doc_index (repo, epic, phase, file_path, content_hash, last_scanned_at)
    VALUES (@repo, @epic, @phase, @file_path, @content_hash, @last_scanned_at)
    ON CONFLICT(repo, file_path) DO UPDATE SET
      epic = excluded.epic,
      phase = excluded.phase,
      content_hash = excluded.content_hash,
      last_scanned_at = excluded.last_scanned_at
    WHERE doc_index.content_hash != excluded.content_hash
  `);

  const files = SCAN_ROOTS.flatMap((root) => walk(join(repoPath, root)));
  const overviewFiles = walkOverviewFiles(repoPath);

  for (const absPath of files) {
    const relPath = relative(repoPath, absPath);
    const content = readFileSync(absPath, "utf-8");
    const { epic, phase } = deriveEpicAndPhase(relPath);

    upsert.run({
      repo: repoName,
      epic,
      phase,
      file_path: relPath,
      content_hash: hashContent(content),
      last_scanned_at: now,
    });
  }

  // Repo-level overview docs (README.md/VISION.md/docs/**) are always
  // epic: null, phase: "overview" — a fixed, reserved tag distinct from
  // "planning" (see OVERVIEW_ROOT_FILES's doc comment above), never derived
  // from path structure the way .pHive/epics/** docs are.
  for (const absPath of overviewFiles) {
    const relPath = relative(repoPath, absPath);
    const content = readFileSync(absPath, "utf-8");

    upsert.run({
      repo: repoName,
      epic: null,
      phase: "overview",
      file_path: relPath,
      content_hash: hashContent(content),
      last_scanned_at: now,
    });
  }

  // Design/wireframe docs (.pHive/design/<topic>/**, s3 of
  // consus-phase28-interaction-completeness) — always phase: "design", with
  // epic derived from the topic directory name (see deriveDesignTopic
  // above). A file directly under .pHive/design/ with no topic segment is
  // skipped rather than indexed with a null/guessed epic.
  for (const absPath of walkDesignFiles(repoPath)) {
    const relPath = relative(repoPath, absPath);
    const epic = deriveDesignTopic(relPath);
    if (epic === null) continue;

    const content = readFileSync(absPath, "utf-8");

    upsert.run({
      repo: repoName,
      epic,
      phase: "design",
      file_path: relPath,
      content_hash: hashContent(content),
      last_scanned_at: now,
    });
  }

  // Brand docs (.pHive/brand/**, s1 of consus-phase29-brand-decision-review)
  // — always epic: null, phase: "brand", the same repo-wide, fixed-tag
  // convention as the overview docs above (never derived from path
  // structure the way .pHive/epics/** or .pHive/design/** docs are).
  for (const absPath of walkBrandFiles(repoPath)) {
    const relPath = relative(repoPath, absPath);
    const content = readFileSync(absPath, "utf-8");

    upsert.run({
      repo: repoName,
      epic: null,
      phase: "brand",
      file_path: relPath,
      content_hash: hashContent(content),
      last_scanned_at: now,
    });
  }
}

export function queryDocIndex(db: Database.Database, repoName: string): DocIndexRow[] {
  return db
    .prepare(
      "SELECT * FROM doc_index WHERE repo = ? ORDER BY epic IS NOT NULL, epic, phase, file_path",
    )
    .all(repoName) as DocIndexRow[];
}

/**
 * Thrown when `relFilePath` resolves outside `repoPath` — a path-traversal
 * attempt (e.g. `../../../../etc/passwd`) rather than a genuine doc path.
 */
export class DocPathEscapesRepoError extends Error {
  constructor(relFilePath: string) {
    super(`path escapes repo root: ${relFilePath}`);
    this.name = "DocPathEscapesRepoError";
  }
}

export function readDocContent(repoPath: string, relFilePath: string): { content: string; format: "md" | "html" } {
  const absPath = resolve(repoPath, relFilePath);

  // SECURITY: the boundary check must happen before any filesystem call,
  // and a plain startsWith(repoPath) is NOT sufficient — it would let
  // repoPath "/repos/foo" incorrectly accept a path resolving into the
  // sibling "/repos/foobar/secret.md", since "/repos/foobar".startsWith(
  // "/repos/foo") is true. Requiring the path.sep suffix (or an exact
  // match) closes that gap. Mirrors the identical, already-established
  // pattern in ../gitdocs/index.ts's resolveInRepos — this function is the
  // one place both that caller and every route (GET /api/docs/content,
  // GET /api/docs/search) ultimately read working-tree doc content through,
  // so the check belongs here, not duplicated per-caller.
  const withinRepoRoot = absPath === repoPath || absPath.startsWith(repoPath + sep);
  if (!withinRepoRoot) {
    throw new DocPathEscapesRepoError(relFilePath);
  }

  const content = readFileSync(absPath, "utf-8");
  const format = relFilePath.endsWith(".html") ? "html" : "md";
  return { content, format };
}
