-- Migration: 005_v1_core_schema.sql
-- Idempotent schema for Consus v1 core doc workflow state

CREATE TABLE IF NOT EXISTS parked_questions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  context TEXT,
  question TEXT NOT NULL,
  parked_workflow_id TEXT,
  callback_url TEXT,
  multica_issue_id TEXT,
  resolved INTEGER DEFAULT 0,
  answer TEXT,
  answered_by TEXT,
  answered_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS doc_edits (
  id TEXT PRIMARY KEY,
  repo TEXT NOT NULL,
  file_path TEXT NOT NULL,
  content TEXT NOT NULL,
  edited_by TEXT NOT NULL,
  committed_to_disk INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fired_tickets (
  id TEXT PRIMARY KEY,
  edit_id TEXT NOT NULL REFERENCES doc_edits(id),
  multica_issue_id TEXT NOT NULL,
  target_repo TEXT NOT NULL,
  fired_by TEXT NOT NULL,
  fired_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_parked_questions_resolved ON parked_questions(resolved);
CREATE INDEX IF NOT EXISTS idx_doc_edits_repo_path ON doc_edits(repo, file_path);
CREATE INDEX IF NOT EXISTS idx_fired_tickets_edit ON fired_tickets(edit_id);
