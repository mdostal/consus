import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
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
