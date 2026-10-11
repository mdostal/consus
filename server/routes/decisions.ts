import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import type {
  CbaPayload,
  ConceptSelectionPayload,
  DecisionPayload,
  EditProposalPayload,
  FeatureSelectionPayload,
  FreeTextPayload,
  RankingPayload,
  RatingPayload,
} from "../decision-contract/parser.js";
import { validateDocPointer, validateResearchSections } from "../decision-contract/parser.js";
import { closeOpenItems } from "../kb/store.js";
import { classifyItem } from "../decision-contract/classifier.js";
import { nativeContextCount } from "../decision-contract/supporting-material.js";
import { requestNeedsContext } from "../pantheon/needs-context.js";

export interface DecisionRoutesOptions {
  db: Database.Database;
  /** Pantheon core-api base URL. When set (or PANTHEON_API_URL env var is set), creating a
   *  decision with no supporting material fires a one-time `decision:needs-context` event. */
  pantheonApiUrl?: string;
  /** Override the fetch implementation — used in tests to capture event calls. */
  fetch?: typeof globalThis.fetch;
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
  needs_context_requested_at: string | null;
  supporting_material_count: number;
}

/**
 * PANT-919: how much supporting material (live attachments + artifact links)
 * an item carries, computed in the list query so the web shell can flag a
 * decision or survey member that was shipped with no context at all, without
 * an extra per-item round trip. Soft-deleted attachments don't count. No
 * ORDER BY inside, so the " ORDER BY" splice points below stay unambiguous.
 * Native context in the payload (sourced research, a doc pointer) is added on
 * top by nativeContextCount — see supportingMaterialCount.
 */
const SUPPORTING_MATERIAL_COUNT_SQL =
  "((SELECT COUNT(*) FROM attachments a WHERE a.item_id = items.id AND a.deleted_at IS NULL) + " +
  "(SELECT COUNT(*) FROM artifact_links l WHERE l.item_id = items.id)) AS supporting_material_count";

/** Attachments + artifact links (SQL) plus sourced research and a doc pointer (payload). */
function supportingMaterialCount(sqlCount: number, payload: unknown): number {
  return sqlCount + nativeContextCount(payload);
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
    | RankingPayload
    | ConceptSelectionPayload;
  survey_id?: string;
}

interface EditContextBody {
  research?: unknown;
  doc?: unknown;
  context?: unknown;
  actor?: unknown;
}

interface CloseItemBody {
  reason?: unknown;
  actor?: unknown;
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
    concepts?: Array<{
      id?: unknown;
      name?: unknown;
      description?: unknown;
      preview?: { kind?: unknown; markup?: unknown };
    }>;
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
  if (p.version === "dostal:concept-selection/v1") {
    if (!Array.isArray(p.concepts) || p.concepts.length < 1) {
      return "decision_payload.concepts must have at least 1 entry";
    }
    const malformed = p.concepts.some(
      (c) =>
        typeof c.id !== "string" ||
        !c.id ||
        typeof c.name !== "string" ||
        !c.name ||
        typeof c.description !== "string" ||
        !c.preview ||
        typeof c.preview !== "object" ||
        c.preview.kind !== "svg" ||
        typeof c.preview.markup !== "string",
    );
    if (malformed) {
      return "decision_payload.concepts entries must each have id, name, description, and a preview with kind \"svg\" and markup string";
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
    return `decision_payload.version must be one of "dostal:decision-request/v1", "dostal:feature-selection/v1", "dostal:edit-proposal/v1", "dostal:cba/v1", "dostal:free-text/v1", "dostal:rating/v1", "dostal:ranking/v1", "dostal:concept-selection/v1"`;
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
 * never resurface). Items with status 'closed' (a Pantheon question ticket
 * closed upstream via POST /api/questions/:ticket/close) are excluded too.
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
export function registerDecisionRoutes(
  app: FastifyInstance,
  { db, pantheonApiUrl, fetch: fetchImpl }: DecisionRoutesOptions,
): void {
  app.get<{ Querystring: { all?: string; branch?: string; survey?: string } }>("/api/decisions", async (request) => {
    const includeDecided = request.query?.all === "1" || request.query?.all === "true";
    const branch = request.query?.branch;
    const survey = request.query?.survey;

    const baseSql = includeDecided
      ? `SELECT id, type, title, status, source_repo, source_body, decided_at, decision_payload, decision_type, triage_bucket, source_branch, survey_id, needs_context_requested_at, ${SUPPORTING_MATERIAL_COUNT_SQL} FROM items WHERE decision_payload IS NOT NULL ORDER BY (decided_at IS NULL) DESC, updated_at DESC, created_at ASC`
      : `SELECT id, type, title, status, source_repo, source_body, decided_at, decision_payload, decision_type, triage_bucket, source_branch, survey_id, needs_context_requested_at, ${SUPPORTING_MATERIAL_COUNT_SQL} FROM items WHERE decision_payload IS NOT NULL AND decided_at IS NULL AND status != 'closed' ORDER BY created_at ASC`;

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

      const payload = row.decision_payload ? JSON.parse(row.decision_payload) : null;
      return {
        ...row,
        decision_type: decisionType,
        triage_bucket: triageBucket,
        decision_payload: payload,
        supporting_material_count: supportingMaterialCount(row.supporting_material_count, payload),
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
   *
   * PANT-938: warn-only readiness. A decision with no supporting material is
   * still created, never blocked or hidden; with PANTHEON_API_URL set it also fires a
   * one-time `decision:needs-context` event (requestNeedsContext) that never
   * delays or fails this response.
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

    const materialRow = db
      .prepare(`SELECT ${SUPPORTING_MATERIAL_COUNT_SQL} FROM items WHERE id = ?`)
      .get(id) as { supporting_material_count: number };
    const materialCount = supportingMaterialCount(materialRow.supporting_material_count, decisionPayload);
    const bridgeBase = pantheonApiUrl ?? process.env.PANTHEON_API_URL;
    if (materialCount === 0 && bridgeBase) {
      requestNeedsContext(db, id, { pantheonApiUrl: bridgeBase, fetch: fetchImpl ?? globalThis.fetch });
    }

    const row = db
      .prepare(
        "SELECT id, type, title, status, source_repo, source_body, decided_at, decision_payload, decision_type, triage_bucket, survey_id, needs_context_requested_at FROM items WHERE id = ?",
      )
      .get(id) as ItemRow;

    return reply.code(201).send({
      ...row,
      decision_payload: row.decision_payload ? JSON.parse(row.decision_payload) : null,
      supporting_material_count: materialCount,
    });
  });

  /**
   * PANT-937: lets an agent fix or fill a decision's context after creation —
   * replaces whichever of `research`, `doc` and `context` the body carries in
   * decision_payload (`doc: null` removes the pointer). Only while the item is
   * unanswered: once a verdict has decided it (decided_at set) the context the
   * human answered against is frozen, so this is a 409. One audit_log row
   * (`field: "decision_context"`) records the edited fields before and after.
   */
  app.patch<{ Params: { id: string }; Body: EditContextBody }>(
    "/api/decisions/:id/context",
    async (request, reply) => {
      const { id } = request.params;
      const body = request.body ?? {};
      const { actor } = body;

      if (typeof actor !== "string" || !actor) {
        return reply.code(400).send({ error: "actor is required" });
      }
      const fields = (["research", "doc", "context"] as const).filter((f) => body[f] !== undefined);
      if (fields.length === 0) {
        return reply.code(400).send({ error: "at least one of research, doc, context is required" });
      }

      const item = db.prepare("SELECT decided_at, decision_payload FROM items WHERE id = ?").get(id) as
        | { decided_at: string | null; decision_payload: string | null }
        | undefined;
      if (!item || !item.decision_payload) {
        return reply.code(404).send({ error: `decision not found: ${id}` });
      }
      if (item.decided_at) {
        return reply.code(409).send({ error: "decision is already answered; its context can no longer be edited" });
      }

      const shapeError =
        (body.research !== undefined ? validateResearchSections(body.research) : null) ??
        (body.doc !== undefined && body.doc !== null ? validateDocPointer(body.doc) : null) ??
        (body.context !== undefined && typeof body.context !== "string" ? "context must be a string" : null);
      if (shapeError) {
        return reply.code(422).send({ error: shapeError });
      }

      const payload = JSON.parse(item.decision_payload) as Record<string, unknown>;
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const field of fields) {
        before[field] = payload[field] ?? null;
        after[field] = body[field];
        if (body[field] === null) delete payload[field];
        else payload[field] = body[field];
      }
      const payloadError = validateDecisionPayload(payload);
      if (payloadError) {
        return reply.code(422).send({ error: payloadError });
      }

      const now = new Date().toISOString();
      db.transaction(() => {
        db.prepare("UPDATE items SET decision_payload = ?, updated_at = ? WHERE id = ?").run(
          JSON.stringify(payload),
          now,
          id,
        );
        db.prepare(
          "INSERT INTO audit_log (item_id, actor, field, old_value, new_value, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(id, actor, "decision_context", JSON.stringify(before), JSON.stringify(after), now);
      })();

      const row = db
        .prepare(
          `SELECT id, type, title, status, source_repo, source_body, decided_at, decision_payload, decision_type, triage_bucket, source_branch, survey_id, needs_context_requested_at, ${SUPPORTING_MATERIAL_COUNT_SQL} FROM items WHERE id = ?`,
        )
        .get(id) as ItemRow;
      return reply.code(200).send({
        ...row,
        decision_payload: payload,
        supporting_material_count: supportingMaterialCount(row.supporting_material_count, payload),
      });
    },
  );

  /**
   * PANT-937: the generic close — what POST /api/questions/:ticket/close does
   * for Pantheon-linked surveys, for any decision or survey. `:id` is an item
   * id (closes that one decision) or, failing that, a survey id (closes every
   * open member). Nothing is deleted; decided or already-closed items are left
   * alone, so a repeat call is a 200 no-op with `closed_item_ids: []`.
   */
  app.post<{ Params: { id: string }; Body: CloseItemBody }>("/api/items/:id/close", async (request, reply) => {
    const { id } = request.params;
    const { reason, actor } = request.body ?? {};

    if (typeof reason !== "string" || !reason.trim()) {
      return reply.code(400).send({ error: "reason is required" });
    }
    if (typeof actor !== "string" || !actor) {
      return reply.code(400).send({ error: "actor is required" });
    }

    let kind: "item" | "survey";
    let itemIds: string[];
    if (db.prepare("SELECT id FROM items WHERE id = ?").get(id)) {
      kind = "item";
      itemIds = [id];
    } else if (db.prepare("SELECT id FROM surveys WHERE id = ?").get(id)) {
      kind = "survey";
      itemIds = (
        db.prepare("SELECT id FROM items WHERE survey_id = ? ORDER BY created_at ASC").all(id) as Array<{ id: string }>
      ).map((r) => r.id);
    } else {
      return reply.code(404).send({ error: `no decision or survey with id: ${id}` });
    }

    const closedItemIds = closeOpenItems(db, itemIds, actor, `Closed: ${reason.trim()}`);
    return reply.code(200).send({ id, kind, closed_item_ids: closedItemIds });
  });
}

