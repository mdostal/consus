import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import type { HarnessTransport } from "../harness/transport.js";
import {
  listEvents,
  updateEventStatus,
  getEvent,
  setEventProposalId,
  type EventStatus,
  type ListEventsFilters,
} from "../events/store.js";
import { docItemIdFor } from "./docs.js";
import { proposeChange } from "../proposals/store.js";

export interface EventRoutesOptions {
  db: Database.Database;
  /** repo name -> absolute path on disk. Not read from directly by this
   *  route (it never touches the filesystem), but kept in the Options
   *  shape for the same reason docs.ts's route takes it — this route
   *  upserts a target items row the same way GET /api/docs/content does. */
  repos: Record<string, string>;
  /** The propose route calls proposeChange(), which requires a
   *  HarnessTransport to dispatch to — the same one registerProposalRoutes
   *  already takes. */
  transport: HarnessTransport;
}

const ALLOWED_STATUSES: EventStatus[] = ["new", "in_progress", "done", "dismissed"];
const ALLOWED_SORTS = ["detected_at", "status", "project"] as const;
const ALLOWED_ORDERS = ["asc", "desc"] as const;

interface EventsQuerystring {
  project?: string;
  status?: string;
  sort?: string;
  order?: string;
}

interface ValidatedQuery {
  ok: true;
  filters: ListEventsFilters;
}
interface InvalidQuery {
  ok: false;
  error: string;
}

/** Validates the shared GET /api/events / GET /api/events/history
 *  querystring shape against the same allow-lists listEvents itself
 *  enforces internally — done here too so a bad value gets a clear 400
 *  instead of relying on listEvents' own internal defaulting/throwing. */
function validateEventsQuery(query: EventsQuerystring): ValidatedQuery | InvalidQuery {
  const { project, status, sort, order } = query;

  if (status !== undefined && !ALLOWED_STATUSES.includes(status as EventStatus)) {
    return { ok: false, error: `invalid status: ${status}` };
  }
  if (sort !== undefined && !ALLOWED_SORTS.includes(sort as (typeof ALLOWED_SORTS)[number])) {
    return { ok: false, error: `invalid sort: ${sort}` };
  }
  if (order !== undefined && !ALLOWED_ORDERS.includes(order as (typeof ALLOWED_ORDERS)[number])) {
    return { ok: false, error: `invalid order: ${order}` };
  }

  return {
    ok: true,
    filters: {
      project,
      status: status as EventStatus | undefined,
      sort: sort as ListEventsFilters["sort"],
      order: order as ListEventsFilters["order"],
    },
  };
}

interface UpdateStatusBody {
  status?: string;
}

interface ProposeBody {
  description?: string;
  requestedBy?: string;
}

/**
 * The HTTP surface over p14-1's server/events/store.ts and p14-2's
 * detection pipeline. GET /api/events + GET /api/events/history are thin
 * adapters over listEvents; PATCH .../status is a thin adapter over
 * updateEventStatus; POST .../propose is the "graduate an event into a
 * real proposal" seam — reuses proposeChange() unmodified.
 */
export function registerEventRoutes(app: FastifyInstance, { db, transport }: EventRoutesOptions): void {
  app.get<{ Querystring: EventsQuerystring }>("/api/events", async (request, reply) => {
    const validated = validateEventsQuery(request.query);
    if (!validated.ok) {
      return reply.code(400).send({ error: validated.error });
    }
    return listEvents(db, validated.filters);
  });

  app.get<{ Querystring: EventsQuerystring }>("/api/events/history", async (request, reply) => {
    const validated = validateEventsQuery(request.query);
    if (!validated.ok) {
      return reply.code(400).send({ error: validated.error });
    }
    return listEvents(db, { ...validated.filters, archived: true });
  });

  app.patch<{ Params: { id: string }; Body: UpdateStatusBody }>(
    "/api/events/:id/status",
    async (request, reply) => {
      const { id } = request.params;
      const { status } = request.body ?? {};

      if (!status || !ALLOWED_STATUSES.includes(status as EventStatus)) {
        return reply.code(400).send({ error: `status must be one of: ${ALLOWED_STATUSES.join(", ")}` });
      }

      const updated = updateEventStatus(db, id, status as EventStatus);
      if (!updated) {
        return reply.code(404).send({ error: `event not found: ${id}` });
      }

      return updated;
    },
  );

  app.post<{ Params: { id: string }; Body: ProposeBody }>("/api/events/:id/propose", async (request, reply) => {
    const { id } = request.params;
    const { description, requestedBy } = request.body ?? {};

    // Step 1: look up the event. 404 if not found.
    const event = getEvent(db, id);
    if (!event) {
      return reply.code(404).send({ error: `event not found: ${id}` });
    }

    // Step 2: no diff means nothing to propose. This must happen before any
    // write — no items upsert, no proposeChange call — so a rejected
    // request leaves no partial state behind.
    if (!event.diff) {
      return reply.code(400).send({ error: "event has no diff; nothing to propose" });
    }

    if (!description || !requestedBy) {
      return reply.code(400).send({ error: "description and requestedBy are both required" });
    }

    // Step 3: upsert a target tracking item for the event's source doc,
    // the exact same shape GET /api/docs/content already upserts.
    const itemId = docItemIdFor(event.source_repo, event.source_path);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO items (id, type, title, status, source_repo, source_ref, created_at, updated_at)
       VALUES (?, 'doc', ?, 'active', ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
    ).run(itemId, event.source_path, event.source_repo, event.source_path, now, now);

    // Step 4: call the existing, unmodified proposeChange.
    const result = await proposeChange(db, transport, {
      itemId,
      targetType: "doc",
      diff: event.diff,
      description,
      requestedBy,
    });
    if (!result.ok) {
      return reply.code(400).send({ error: result.error });
    }

    // Step 5: record the new proposal's id back onto the event row.
    const updatedEvent = setEventProposalId(db, id, result.proposalId);

    // Step 6: return the updated event alongside the created proposal.
    const proposalRow = db.prepare("SELECT * FROM proposals WHERE id = ?").get(result.proposalId);
    return { event: updatedEvent, proposal: proposalRow };
  });
}
