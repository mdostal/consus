-- Migration: 004_add_diagrams_table.sql
-- Idempotent schema definition for diagram caching

CREATE TABLE IF NOT EXISTS diagrams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id TEXT,
  diagram_type TEXT NOT NULL,
  mermaid_source TEXT NOT NULL,
  cached_at TEXT NOT NULL,
  UNIQUE(repo_id, diagram_type)
);
