import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import type {
  CbaPayload,
  DecisionPayload,
  EditProposalPayload,
  FeatureSelectionPayload,
  FreeTextPayload,
  RankingPayload,
  RatingPayload,
} from "../decision-contract/parser.js";
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
  survey_id: string | null;
}

interface CreateDecisionBody {
  id?: string;
  title?: string;
  source_repo?: string;
  decision_payload?:
    | DecisionPayload
    | FeatureSelectionPayload
    | EditProposalPayload
    | CbaPayload
    | FreeTextPayload
    | RatingPayload
    | RankingPayload;
  survey_id?: string;
}

/** Structural validation only — this route stores what a caller supplies, it
 *  never composes a decision_payload itself. Returns the first problem found,
 *  or null when the payload is well-formed. */
function validateDecisionPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return "decision_payload is required";
  }
  const p = payload as {
    version?: string;
    features?: unknown[];
    options?: Array<{ id?: string; option?: unknown; cost?: unknown; benefit?: unknown }>;
    recommended?: string;
    original?: unknown;
    proposed?: unknown;
    prompt?: unknown;
    scale?: { min?: unknown; max?: unknown; labels?: unknown };
    items?: Array<{ id?: unknown; label?: unknown }>;
  };
  if (p.version === "dostal:free-text/v1") {
    if (typeof p.prompt !== "string" || !p.prompt.trim()) {
      return "decision_payload.prompt must be a non-empty string";
    }
    return null;
  }
  if (p.version === "dostal:rating/v1") {
    if (typeof p.prompt !== "string" || !p.prompt.trim()) {
      return "decision_payload.prompt must be a non-empty string";
    }
    const scale = p.scale;
    if (!scale || typeof scale.min !== "number" || typeof scale.max !== "number" || scale.min >= scale.max) {
      return "decision_payload.scale must have numeric min/max with min less than max";
    }
    return null;
  }
  if (p.version === "dostal:ranking/v1") {
    if (typeof p.prompt !== "string" || !p.prompt.trim()) {
      return "decision_payload.prompt must be a non-empty string";
    }
    if (!Array.isArray(p.items) || p.items.length < 1) {
      return "decision_payload.items must have at least 1 entry";
    }
    const malformed = p.items.some((item) => typeof item.id !== "string" || typeof item.label !== "string");
    if (malformed) {
      return "decision_payload.items entries must each have id and label strings";
    }
    return null;
  }
  if (p.version === "dostal:feature-selection/v1") {
    if (!Array.isArray(p.features) || p.features.length < 1) {
      return "decision_payload.features must have at least 1 entry";
    }
    return null;
  }
  if (p.version === "dostal:edit-proposal/v1") {
    if (typeof p.original !== "string" || typeof p.proposed !== "string") {
      return "decision_payload.original and decision_payload.proposed must both be strings";
    }
    return null;
  }
  if (p.version === "dostal:cba/v1") {
    if (!Array.isArray(p.options) || p.options.length < 1) {
      return "decision_payload.options must have at least 1 entry";
    }
    const malformed = p.options.some(
      (o) => typeof o.option !== "string" || typeof o.cost !== "string" || typeof o.benefit !== "string",
    );
    if (malformed) {
      return "decision_payload.options entries must each have option, cost, and benefit strings";
    }
    return null;
  }
  if (p.version !== "dostal:decision-request/v1") {
    return `decision_payload.version must be one of "dostal:decision-request/v1", "dostal:feature-selection/v1", "dostal:edit-proposal/v1", "dostal:cba/v1", "dostal:free-text/v1", "dostal:rating/v1", "dostal:ranking/v1"`;
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
 *
 * `?survey=<id>` (s5-survey-grouping) further filters to items belonging to
 * a specific survey (survey_id = ?). Composes with `?all=1` and `?branch=`.
 */
export function registerDecisionRoutes(app: FastifyInstance, { db }: DecisionRoutesOptions): void {
  app.get<{ Querystring: { all?: string; branch?: string; survey?: string } }>("/api/decisions", async (request) => {
    const includeDecided = request.query?.all === "1" || request.query?.all === "true";
    const branch = request.query?.branch;
    const survey = request.query?.survey;

    const baseSql = includeDecided
      ? "SELECT id, type, title, status, source_repo, source_body, decided_at, decision_payload, decision_type, triage_bucket, source_branch, survey_id FROM items WHERE decision_payload IS NOT NULL ORDER BY (decided_at IS NULL) DESC, updated_at DESC, created_at ASC"
      : "SELECT id, type, title, status, source_repo, source_body, decided_at, decision_payload, decision_type, triage_bucket, source_branch, survey_id FROM items WHERE decision_payload IS NOT NULL AND decided_at IS NULL ORDER BY created_at ASC";

    let sql = baseSql;
    const params: unknown[] = [];

    if (branch) {
      sql = sql.replace(" ORDER BY", " AND source_branch = ? ORDER BY");
      params.push(branch);
    }

    if (survey) {
      sql = sql.replace(" ORDER BY", " AND survey_id = ? ORDER BY");
      params.push(survey);
    }

    const rows = (db.prepare(sql).all(...params) as ItemRow[]);

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
    const { id, title, source_repo: sourceRepo, decision_payload: decisionPayload, survey_id: surveyId } = request.body ?? {};

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

    if (surveyId) {
      const surveyExists = db.prepare("SELECT id FROM surveys WHERE id = ?").get(surveyId);
      if (!surveyExists) {
        return reply.code(400).send({ error: `survey not found: ${surveyId}` });
      }
    }

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO items (id, type, title, status, source_repo, created_at, updated_at, decision_payload, survey_id)
       VALUES (?, 'decision_request', ?, 'open', ?, ?, ?, ?, ?)`,
    ).run(id, title, sourceRepo ?? null, now, now, JSON.stringify(decisionPayload), surveyId ?? null);

    classifyItem(db, id);

    const row = db
      .prepare(
        "SELECT id, type, title, status, source_repo, source_body, decided_at, decision_payload, decision_type, triage_bucket, survey_id FROM items WHERE id = ?",
      )
      .get(id) as ItemRow;

    return reply.code(201).send({
      ...row,
      decision_payload: row.decision_payload ? JSON.parse(row.decision_payload) : null,
    });
  });
}

