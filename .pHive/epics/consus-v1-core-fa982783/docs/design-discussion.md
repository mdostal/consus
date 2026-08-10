# Design Discussion: Consus v1 Core

**Epic:** consus-v1-core-fa982783  
**Date:** 2026-08-09  
**Scale Assessment:** Medium

## §0 Prelude

### Goal

Implement the two foundational flows that transform Consus from a read-only decision viewer into an active human-in-the-loop surface for the Pantheon's multi-agent workflows:

1. **FLOW 1 — Minerva question-park → answer → resume:** When Minerva (or any god) hits a blocking question during planning/kickoff, it parks the work and posts the question to Consus. The human answers in Consus, the answer flows back via Multica, and the parked agent resumes from where it left off.

2. **FLOW 2 — Editable docs → fire ticket:** Living docs (design-discussion, spec, research) in .pHive are editable in the Consus UI. The human edits the doc, hits "fire," and Consus creates a Multica ticket with the doc as context. The hive plugin picks up the ticket and executes the change.

### Success Criteria

- Minerva can park a blocking question, creating a Consus question item visible in the UI
- Human can answer the question in Consus, writing back to Multica
- Minerva resumes execution when the answer is available
- Human can edit living docs content in Consus UI
- Edits persist to SQLite (required) and optionally to .pHive disk (configurable)
- "Fire" action creates a Multica issue with doc content + metadata for hive plugin pickup
- Tests cover both flows (question round-trip, doc edit-fire-build)

## §1 Proposed Approach

### Flow 1: Question-Park → Answer → Resume

**Minerva-side (out of epic scope but documented for contract):**
- On blocking question, POST to new Consus endpoint: `POST /api/questions` with payload:
  ```json
  {
    "agent_id": "minerva-abc123",
    "agent_name": "Minerva",
    "context": "planning epic XYZ",
    "question": "Should auth use JWT or session cookies?",
    "parked_workflow_id": "wf-456",
    "callback_url": "http://minerva-harness/resume/wf-456"  // optional
  }
  ```
- Consus creates:
  - Local SQLite row in `parked_questions` table
  - Multica issue with `label: hive:question` and body containing the question
  - Returns `{question_id: "q-789", multica_issue_id: "multica:abc"}`
- Minerva polls or subscribes (design choice below)

**Consus-side:**
- New route: `GET /api/questions` — lists open parked questions (unresolved)
- New route: `POST /api/questions/:id/answer` — human submits answer
  - Writes answer as Multica comment on the linked issue
  - Marks question resolved in local SQLite
  - Optionally calls Minerva callback URL if provided (or Minerva polls)
- UI: question inbox view (similar to decisions view but filtered to `hive:question` label)

**Resume protocol options:**
1. **Polling (simple):** Minerva checks Multica issue status every 30s, resumes when comment with answer appears
2. **Webhook (robust):** Multica webhook → Consus → calls Minerva callback URL
3. **Hybrid:** Consus POST answer also writes to a resume queue Minerva reads

**Recommendation:** Start with polling (option 1) — webhook requires Multica server config outside Consus scope. Hybrid is v2 optimization.

### Flow 2: Editable Docs → Fire Ticket

**Doc editing:**
- New route: `PUT /api/docs/content` with payload:
  ```json
  {
    "repo": "consus",
    "path": ".pHive/epics/xyz/docs/design-discussion.md",
    "content": "<full markdown content>",
    "commit_to_disk": false  // optional, default false
  }
  ```
- Backend:
  - Validates repo+path exist
  - Writes content to new `doc_edits` SQLite table with fields:
    - `id`, `repo`, `file_path`, `content`, `edited_by`, `edited_at`, `committed_to_disk`
  - If `commit_to_disk: true`, also writes to actual .pHive file (requires repo path resolution)
  - Returns `{edit_id: "e-123", committed: true|false}`

**Fire action:**
- New route: `POST /api/docs/:edit_id/fire` with payload:
  ```json
  {
    "actor": "mathew",
    "target_repo": "mdostal/consus",  // where to file the Multica issue
    "title": "Implement auth flow per updated design-discussion",  // optional, derived from doc if missing
    "context_note": "See design-discussion.md §3 for full spec"  // optional
  }
  ```
- Backend:
  - Reads `doc_edits` row
  - Creates Multica issue with:
    - Title from request or derived from doc path
    - Body: full markdown content from edit + context note
    - Labels: `hive:doc-driven`, `hive:repo:<target_repo>`
    - Link to original .pHive file path in description
  - Writes `fired_tickets` table entry linking edit_id → multica_issue_id
  - Returns `{multica_issue_id: "multica:xyz", ticket_url: "..."}`

**Hive plugin contract (out of scope):**
- Plugin already polls Multica for issues
- Recognizes `hive:doc-driven` label → reads doc content from issue body
- Passes to `/plan` or `/execute` depending on doc type (design-discussion → /plan, spec → /execute)

### UI Changes

**New views:**
1. **Question Inbox** (`/questions`) — table of parked questions with answer textarea
2. **Doc Editor** (`/docs/:repo/:path/edit`) — markdown editor with Save + Fire buttons
3. **Fire History** (`/docs/fired`) — audit log of fired tickets with status

**Existing view updates:**
- `/docs` list — add "Edit" button per doc row
- `/decisions` — no changes (questions are separate view)

### Data Model

**New SQLite tables:**

```sql
-- Parked questions from agents
CREATE TABLE parked_questions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  context TEXT,
  question TEXT NOT NULL,
  parked_workflow_id TEXT,
  callback_url TEXT,
  multica_issue_id TEXT,
  resolved BOOLEAN DEFAULT 0,
  answer TEXT,
  answered_by TEXT,
  answered_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Doc edits (transient or committed)
CREATE TABLE doc_edits (
  id TEXT PRIMARY KEY,
  repo TEXT NOT NULL,
  file_path TEXT NOT NULL,
  content TEXT NOT NULL,
  edited_by TEXT NOT NULL,
  committed_to_disk BOOLEAN DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Fired tickets linking edits to Multica issues
CREATE TABLE fired_tickets (
  id TEXT PRIMARY KEY,
  edit_id TEXT NOT NULL REFERENCES doc_edits(id),
  multica_issue_id TEXT NOT NULL,
  target_repo TEXT NOT NULL,
  fired_by TEXT NOT NULL,
  fired_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

### API Summary

**New endpoints:**
- `POST /api/questions` — create parked question (called by Minerva)
- `GET /api/questions` — list open questions
- `POST /api/questions/:id/answer` — submit answer, resume workflow
- `PUT /api/docs/content` — save doc edit
- `POST /api/docs/:edit_id/fire` — create Multica ticket from edit

**Existing endpoints (no changes):**
- `GET /api/docs` — list docs (add edit_id if latest edit exists)
- `GET /api/docs/content` — read doc content (return latest edit if exists, else disk version)
- `GET /api/decisions` — list decisions (unchanged)

## §2 Key Design Decisions

### Decision 1: Doc persistence — SQLite-first vs disk-first

**Options:**
- **A:** All edits to SQLite only, .pHive files unchanged unless explicit commit
- **B:** All edits write-through to .pHive files immediately
- **C:** Hybrid (current proposal) — SQLite always, disk optionally

**Choice:** C (hybrid)  
**Rationale:** 
- SQLite-first gives transient editing without git noise
- Disk commit enables sharing edits across team via git
- Single-operator v1 doesn't need CRDTs, can afford simple "last write wins"
- Matches "optionally commit to .pHive" from requirement

### Decision 2: Resume protocol — polling vs webhook

**Options:**
- **A:** Minerva polls Multica issue status every 30s
- **B:** Multica webhook → Consus → callback to Minerva
- **C:** Consus maintains resume queue, Minerva polls Consus endpoint

**Choice:** A (polling) for v1  
**Rationale:**
- Zero external dependencies (webhook needs Multica server config)
- Simple to implement (Minerva already has issue-fetch logic)
- 30s latency acceptable for blocking questions (not realtime chat)
- v2 can upgrade to webhook when Multica integration deepens

### Decision 3: Fire granularity — full doc vs diff vs section

**Options:**
- **A:** Fire creates one ticket with full doc content
- **B:** Fire creates one ticket per changed section
- **C:** Fire sends diff since last fire

**Choice:** A (full doc)  
**Rationale:**
- Hive planner already decomposes large context (that's its job)
- Sending full doc preserves all cross-references
- Simpler implementation (no diff calculation)
- Human can add context_note to guide planner if needed

### Decision 4: Question vs decision — same table or separate?

**Options:**
- **A:** Extend existing `items` table with `type: 'question'`
- **B:** New `parked_questions` table (current proposal)

**Choice:** B (separate table)  
**Rationale:**
- Questions have unique fields (parked_workflow_id, callback_url) not relevant to decisions
- Separate lifecycle (questions auto-resolve on answer, decisions need approval)
- Cleaner query logic (no type filtering needed)
- Future: questions might merge into items table if unified inbox makes sense

## §3 Risks & Mitigations

### Risk 1: Minerva harness not yet implemented

**Severity:** High  
**Impact:** Flow 1 has no caller until Minerva integration is built  
**Mitigation:**
- Build Consus API first (endpoints testable independently)
- Mock Minerva POST in integration tests
- Document Minerva contract clearly for separate story
- Flow 2 (doc editing) is independently valuable

### Risk 2: Multica rate limits on comment writes

**Severity:** Low  
**Impact:** High-frequency answer posting might hit limits  
**Mitigation:**
- Multica client already has 20s timeout
- Single-operator v1 unlikely to hit limits
- If needed: add retry-with-backoff (client.ts already structured for it)

### Risk 3: Doc edit conflicts (concurrent Consus edit + disk commit by agent)

**Severity:** Medium  
**Impact:** Human edits in Consus overwritten by agent commit to .pHive  
**Mitigation:**
- v1: document "don't edit in Consus while agent is running on same doc"
- Show last_scanned_at timestamp in doc list so human knows if stale
- v2: content hashing + merge conflict UI

### Risk 4: Fired ticket not picked up by hive plugin

**Severity:** Medium  
**Impact:** Human fires doc, nothing happens  
**Mitigation:**
- Use existing `hive:*` label pattern plugin already recognizes
- Link to Multica issue in response so human can verify it was created
- Fire history view shows status (open/in-progress/closed) for audit

## §4 Open Questions

### Q1: Should question answers be rich (markdown) or plain text?

**Context:** Current iterate endpoint sends markdown with agent mentions.  
**Options:** 
- Plain text only (simple textarea)
- Markdown (matches iterate pattern, enables formatting)

**Recommendation:** Markdown — reuse existing comment composition logic, humans can format explanations.

### Q2: Should doc editor support live preview?

**Context:** Markdown editing is friendlier with side-by-side preview.  
**Effort:** Medium (need markdown renderer on frontend).  
**Decision:** Not MVP — ship plain textarea, add preview in v2 if users request.

### Q3: What happens if human fires same doc twice without editing?

**Context:** Idempotency — should we dedupe or allow multiple tickets?  
**Options:**
- Block if content hash unchanged since last fire
- Allow (maybe human wants to retry with different context_note)

**Recommendation:** Allow — add warning in UI "This doc was last fired 2 hours ago, create another ticket?" but don't hard-block.

### Q4: Should Consus validate that target_repo exists before firing?

**Context:** Typo in target_repo creates orphaned ticket.  
**Effort:** Low (check repos config map).  
**Decision:** Yes — return 400 if target_repo not in configured repos list.

## §5 Dependencies

### Internal
- SQLite schema migration (add 3 new tables)
- Multica client (reuse existing)
- Doc-scanner adapter (reuse for reading .pHive files)

### External
- Multica server must be running
- Multica workspace configured with appropriate labels
- Minerva harness implements question-posting (separate epic)
- Hive plugin recognizes `hive:doc-driven` label (assume exists or add small patch)

### Deferred to Follow-On
- Minerva question-posting integration (separate epic)
- Hive plugin doc-driven ticket handler (may already exist, verify)
- Webhook-based resume (v2 optimization)
- Rich markdown editor with preview (v2 UX improvement)
- Conflict detection for concurrent edits (v2 robustness)

## §6 Testing Strategy

### Unit Tests
- Question CRUD (create, list, answer)
- Doc edit persistence (SQLite + optional disk write)
- Fire ticket Multica integration (mock client)
- Schema migrations run cleanly

### Integration Tests
- Question round-trip: POST question → GET list → POST answer → verify Multica comment
- Doc edit-fire-build: PUT doc → POST fire → verify Multica issue created
- Doc read with pending edit (returns SQLite version, not disk version)

### E2E Tests (Playwright)
- Navigate to /questions, answer a question
- Navigate to /docs, edit a doc, save, fire
- Verify fired ticket appears in Multica (requires Multica test instance)

## §7 Rollout Plan

### Phase 1: Backend API (stories 1-4)
- Schema migration
- Question endpoints
- Doc edit endpoints
- Fire endpoint
- All unit + integration tests green

### Phase 2: Frontend UI (stories 5-7)
- Question inbox view
- Doc editor view
- Fire history view

### Phase 3: Integration (story 8)
- E2E tests with real Multica instance
- Verify hive plugin recognizes fired tickets
- Document Minerva integration contract

## §8 Scale Assessment

**Recommendation: Medium**

**Justification:**
- Multi-file changes (new routes, new tables, new UI views)
- Cross-stack (backend API + frontend React)
- Integration complexity (Multica, future Minerva)
- But: builds on existing patterns (Multica client, doc-scanner, SQLite schema)
- Not large: no multi-system migration, no long-horizon refactor

**Routing:** Proceed to story decomposition (Phase C) with `--lite` flag honored (no H/V planning, no structured outline).
