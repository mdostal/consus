import type Database from "better-sqlite3";

export interface CachedDiagram {
  repo_id: string | null;
  diagram_type: string;
  mermaid_source: string;
  cached_at: string;
  docs_fingerprint: string | null;
}

export function getCachedDiagram(
  db: Database.Database,
  repoId: string | null,
  diagramType: string
): CachedDiagram | undefined {
  if (repoId === null) {
    return db
      .prepare("SELECT * FROM diagrams WHERE repo_id IS NULL AND diagram_type = ?")
      .get(diagramType) as CachedDiagram | undefined;
  }
  return db
    .prepare("SELECT * FROM diagrams WHERE repo_id = ? AND diagram_type = ?")
    .get(repoId, diagramType) as CachedDiagram | undefined;
}

export function setCachedDiagram(
  db: Database.Database,
  repoId: string | null,
  diagramType: string,
  mermaidSource: string,
  docsFingerprint: string | null = null
): void {
  const now = new Date().toISOString();

  if (repoId === null) {
    const existing = db
      .prepare("SELECT 1 FROM diagrams WHERE repo_id IS NULL AND diagram_type = ?")
      .get(diagramType);

    if (existing) {
      db.prepare(
        "UPDATE diagrams SET mermaid_source = ?, cached_at = ?, docs_fingerprint = ? WHERE repo_id IS NULL AND diagram_type = ?"
      ).run(mermaidSource, now, docsFingerprint, diagramType);
    } else {
      db.prepare(
        "INSERT INTO diagrams (repo_id, diagram_type, mermaid_source, cached_at, docs_fingerprint) VALUES (NULL, ?, ?, ?, ?)"
      ).run(diagramType, mermaidSource, now, docsFingerprint);
    }
  } else {
    const existing = db
      .prepare("SELECT 1 FROM diagrams WHERE repo_id = ? AND diagram_type = ?")
      .get(repoId, diagramType);

    if (existing) {
      db.prepare(
        "UPDATE diagrams SET mermaid_source = ?, cached_at = ?, docs_fingerprint = ? WHERE repo_id = ? AND diagram_type = ?"
      ).run(mermaidSource, now, docsFingerprint, repoId, diagramType);
    } else {
      db.prepare(
        "INSERT INTO diagrams (repo_id, diagram_type, mermaid_source, cached_at, docs_fingerprint) VALUES (?, ?, ?, ?, ?)"
      ).run(repoId, diagramType, mermaidSource, now, docsFingerprint);
    }
  }
}

export function invalidateDiagram(
  db: Database.Database,
  repoId: string | null,
  diagramType: string
): void {
  if (repoId === null) {
    db.prepare("DELETE FROM diagrams WHERE repo_id IS NULL AND diagram_type = ?").run(diagramType);
  } else {
    db.prepare("DELETE FROM diagrams WHERE repo_id = ? AND diagram_type = ?").run(repoId, diagramType);
  }
}
