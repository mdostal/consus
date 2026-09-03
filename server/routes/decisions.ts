import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import type { DecisionPayload, FeatureSelectionPayload } from "../decision-contract/parser.js";
import { classifyItem } from "../decision-contract/classifier.js";

export interface DecisionRoutesOptions {
  db: Database.Database;
}

interface ItemRow {
  id: string;
  type: string;
  title: string;
  status: string;
  source_repo: string | null;
  source_body: string | null;
  decided_at: string | null;
  decision_payload: string | null;
  decision_type: string | null;
  triage_bucket: string | null;
  source_branch: string | null;
}

interface CreateDecisionBody {
  id?: string;
  title?: string;
  source_repo?: string;
  decision_payload?: DecisionPayload | FeatureSelectionPayload;
}

/** Structural validation only — this route stores what a caller supplies, it
 *  never composes a decision_payload itself. Returns the first problem found,
 *  or null when the payload is well-formed. */
function validateDecisionPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return "decision_payload is required";
  }
  const p = payload as { version?: string; features?: unknown[]; options?: Array<{ id: string }>; recommended?: string };

  if (p.version === "dostal:feature-selection/v1") {
    if (!Array.isArray(p.features) || p.features.length === 0) {
      return "decision_payload.features must be a non-empty array";
    }
    return null;
  }

  if (p.version !== "dostal:decision-request/v1") {
    return `decision_payload.version must be "dostal:decision-request/v1" or "dostal:feature-selection/v1"`;
  }
  if (!Array.isArray(p.options) || p.options.length < 2) {
    return "decision_payload.options must have at least 2 entries";
  }
  if (!p.options.some((o) => o.id === p.recommended)) {
    return "decision_payload.recommended must match one of decision_payload.options[].id";
  }
  return null;
}

/**
 * REQ-28: the "list decisions" endpoint an agent-harness (and the Consus
 * web shell) needs — purely local. Consus has no live external data source;
 * items land in the `items` table via the KB store or the propose-a-change
 * mechanism, not a background sync.
 *
 * By default returns only the *open* queue — every item carrying a
 * decision_payload that hasn't been decided yet (decided_at IS NULL, the
 * same amnesia-fix rule REQ-08's decide flow enforces so decided items
 * never resurface).
 *
 * `?all=1` additionally returns already-decided items (decided_at NOT NULL) so
 * the shell can present a "Decided" section that stays reviewable.
 *
 * `?branch=<name>` (s2-branch-scoped-decisions) additionally restricts the
 * result to items whose source_branch exactly matches -- composes with
 * `?all=1` (an extra `AND source_branch = ?` appended to whichever base SQL
 * `all` already selected). When `branch` is absent, the base SQL strings
 * below are byte-identical to before this param existed -- no implicit
 * `source_branch IS NULL` filter is added, so today's unfiltered behavior
 * (every item matching the decision_payload/decided_at condition, regardless
 * of source_branch) is unchanged.
 */
export function registerDecisionRoutes(app: FastifyInstance, { db }: DecisionRoutesOptions): void {
  app.get<{ Querystring: { all?: string; branch?: string } }>("/api/decisions", async (request) => {
    const includeDecided = request.query?.all === "1" || request.query?.all === "true";
    const branch = request.query?.branch;

    const baseSql = includeDecided
      ? "SELECT id, type, title, status, source_repo, source_body, decided_at, decision_payload, decision_type, triage_bucket, source_branch FROM items WHERE decision_payload IS NOT NULL ORDER BY (decided_at IS NULL) DESC, updated_at DESC, created_at ASC"
      : "SELECT id, type, title, status, source_repo, source_body, decided_at, decision_payload, decision_type, triage_bucket, source_branch FROM items WHERE decision_payload IS NOT NULL AND decided_at IS NULL ORDER BY created_at ASC";

    const rows = branch
      ? (db.prepare(baseSql.replace(" ORDER BY", " AND source_branch = ? ORDER BY")).all(branch) as ItemRow[])
      : (db.prepare(baseSql).all() as ItemRow[]);

    return rows.map((row) => {
      // s1-wire-classifier-into-decisions-route: opportunistic backfill for
      // rows that predate this wiring (decision_type still null). Rows that
      // already carry a classification are returned as-is — no call, no
      // write, no reclassification on every list render.
      let decisionType = row.decision_type;
      let triageBucket = row.triage_bucket;
      if (decisionType === null) {
        const result = classifyItem(db, row.id);
        decisionType = result.decisionType;
        triageBucket = result.triageBucket;
      }

      return {
        ...row,
        decision_type: decisionType,
        triage_bucket: triageBucket,
        decision_payload: row.decision_payload ? JSON.parse(row.decision_payload) : null,
      };
    });
  });

  /**
   * s1-push-decision-endpoint: lets an outside agent/harness create a new
   * decision item — today's only other write paths (the KB store, the
   * propose-a-change mechanism) are Consus-internal. `id` is caller-supplied
   * and required, never server-generated: the calling agent is the one that
   * knows whether this is a genuinely new decision or the same one asked
   * twice, so a duplicate `id` is a 409, not a silent upsert.
   */
  app.post<{ Body: CreateDecisionBody }>("/api/decisions", async (request, reply) => {
    const { id, title, source_repo: sourceRepo, decision_payload: decisionPayload } = request.body ?? {};

    if (!id) {
      return reply.code(400).send({ error: "id is required" });
    }
    if (!title) {
      return reply.code(400).send({ error: "title is required" });
    }
    const payloadError = validateDecisionPayload(decisionPayload);
    if (payloadError) {
      return reply.code(400).send({ error: payloadError });
    }

    const existing = db.prepare("SELECT id FROM items WHERE id = ?").get(id);
    if (existing) {
      return reply.code(409).send({ error: `item already exists: ${id}` });
    }

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO items (id, type, title, status, source_repo, created_at, updated_at, decision_payload)
       VALUES (?, 'decision_request', ?, 'open', ?, ?, ?, ?)`,
    ).run(id, title, sourceRepo ?? null, now, now, JSON.stringify(decisionPayload));

    classifyItem(db, id);

    const row = db
      .prepare(
        "SELECT id, type, title, status, source_repo, source_body, decided_at, decision_payload, decision_type, triage_bucket FROM items WHERE id = ?",
      )
      .get(id) as ItemRow;

    return reply.code(201).send({
      ...row,
      decision_payload: row.decision_payload ? JSON.parse(row.decision_payload) : null,
    });
  });
}
