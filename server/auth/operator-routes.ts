import type { FastifyInstance, onRouteHookHandler, preHandlerHookHandler } from "fastify";
import { operatorTokenGuard, type OperatorTokenResolver } from "./operator-token-guard.js";

/**
 * The routes only the operator may call when Consus runs under Pantheon
 * (pantheon-v2 first-cut-trust: t1e project guard, and the t2 review-3
 * follow-up).
 *
 * Pantheon registers Consus as a `liaison`: whatever answer Consus relays to
 * core-api is recorded as the operator's, `relayed_by: consus`. That only
 * holds if Consus itself made sure the operator gave it. So every route whose
 * effect is an answer, a verdict, a decision, a close, or anything Consus
 * relays to core-api under its own token needs Pantheon's operator token
 * (X-Pantheon-Operator-Token, or Authorization: Bearer), checked by
 * operatorTokenGuard: 401 without or with a wrong one, 503 when Consus can't
 * resolve it itself. A standalone install (no Pantheon) keeps them open.
 *
 * The browser UI sends no token, so under Pantheon these answer 401 there:
 * the operator answers in Janus, which goes through core-api with the
 * operator token (docs/api-reference.md, "Operator routes").
 *
 * Every other write route is listed in OPEN_WRITE_ROUTES with why it stays
 * open; server/routes/operator-routes.test.ts fails on a write route in
 * neither list.
 */
export interface OperatorRoute {
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  why: string;
}

export const OPERATOR_ROUTES: readonly OperatorRoute[] = [
  // Answers, verdicts, decisions, closes.
  { method: "POST", url: "/api/decisions/:id/verdict", why: "a verdict; relays consus.question.answered / consus.questions.submitted or consus.decision.decided to core-api" },
  { method: "POST", url: "/api/items/:id/decide", why: "a decision (KB status change)" },
  { method: "POST", url: "/api/items/:id/close", why: "closes a decision or a whole survey" },
  { method: "POST", url: "/api/questions/:ticket/close", why: "closes an imported question ticket's decisions" },
  { method: "POST", url: "/api/decisions", why: "files a decision; one with no material relays consus.decision.needs_context to core-api" },
  // Relays to core-api under Consus's token.
  { method: "POST", url: "/api/questions/redeliver", why: "resends recorded answers to core-api" },
  { method: "POST", url: "/api/proposals", why: "relays a proposed change to core-api, which files a change ticket" },
  { method: "POST", url: "/api/proposals/:id/redeliver", why: "resends a proposal to core-api" },
  { method: "POST", url: "/api/events/:id/propose", why: "relays a proposed change to core-api" },
  { method: "POST", url: "/api/docs/new", why: "relays a new-file proposal to core-api" },
  { method: "POST", url: "/api/items/:id/import", why: "relays an imported edit as a proposal to core-api" },
  { method: "POST", url: "/api/threads", why: "relays an operator message to core-api, which files or comments on a ticket" },
  { method: "POST", url: "/api/threads/:id/messages", why: "relays an operator message to core-api" },
  { method: "POST", url: "/api/threads/:id/redeliver", why: "resends an operator message to core-api" },
  // t1e-consus-project-guard.
  { method: "POST", url: "/api/projects", why: "registers a directory whose files Consus then serves" },
];

/** Write routes that stay open under Pantheon, and why: none answers, decides, closes or relays to core-api. */
export const OPEN_WRITE_ROUTES: Readonly<Record<string, string>> = {
  "POST /api/items/:id/comments": "a local comment; nothing leaves Consus",
  "PATCH /api/decisions/:id/context": "research context (core-api forwards it for runtime agents, with their caller id as actor)",
  "POST /api/items/:id/artifact-links": "supporting material (core-api forwards it for runtime agents)",
  "DELETE /api/items/:id/artifact-links/:linkId": "supporting material (core-api forwards it for runtime agents)",
  "POST /api/items/:id/attachments": "supporting material (core-api forwards it for runtime agents)",
  "DELETE /api/attachments/:id": "supporting material",
  "POST /api/questions/import": "core-api pushes a question ticket in",
  "POST /api/proposals/:id/result": "core-api pushes a proposal's result back",
  "POST /api/threads/:id/replies": "core-api pushes an agent's reply back",
  "POST /api/surveys": "groups decisions; answers nothing",
  "POST /api/inbox/seen": "read state",
  "PATCH /api/events/:id/status": "read state of a change event",
  "PUT /api/items/:id/claude-artifact": "records an artifact URL on an item",
  "PUT /api/kb-entries/:id": "local knowledge-base edit",
  "PUT /api/kb-entries/:id/draft": "local knowledge-base draft",
  "POST /api/kb-entries/:id/submit": "publishes a local knowledge-base draft; nothing leaves Consus",
  "PATCH /api/projects/:project": "sets a registered project's client label",
  "POST /api/projects/:project/ingest": "rescans a registered project",
  "POST /api/projects/scan-all": "rescans every registered project",
};

const key = (method: string, url: string) => `${method.toUpperCase()} ${url}`;
const GUARDED = new Set(OPERATOR_ROUTES.map((r) => key(r.method, r.url)));

/** True when `METHOD url` (a route pattern) is an operator route. */
export function isOperatorRoute(method: string, url: string): boolean {
  return GUARDED.has(key(method, url));
}

/**
 * Puts the operator-token guard in front of every OPERATOR_ROUTES entry
 * registered on `app` after this call. A no-op guard when `resolveToken` is
 * undefined (standalone).
 */
export function guardOperatorRoutes(app: FastifyInstance, resolveToken: OperatorTokenResolver | undefined): void {
  const guard = operatorTokenGuard(resolveToken) as preHandlerHookHandler;
  const onRoute: onRouteHookHandler = (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    if (!methods.some((m) => isOperatorRoute(m, route.url))) return;
    const existing = route.preHandler;
    route.preHandler = existing === undefined ? [guard] : [guard, ...(Array.isArray(existing) ? existing : [existing])];
  };
  app.addHook("onRoute", onRoute);
}
