import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { OPERATOR_TOKEN_HEADER } from "../adapters/pantheon/operator-token.js";

/**
 * Inbound check of Pantheon's operator token on Consus's sensitive routes
 * (first-cut-trust t1e-consus-project-guard).
 *
 * In Pantheon, Consus runs as root, mounts the shared secrets volume and sits
 * on a network the agent runtimes share. Registering a project used to need
 * nothing, so an agent could register any directory and read files back
 * through GET /api/docs/content. Registration now needs the operator token,
 * the same one core-api checks (header X-Pantheon-Operator-Token, or
 * `Authorization: Bearer <token>`), compared in constant time.
 *
 * `resolveToken` is undefined for a standalone install (no Pantheon
 * configured): the guard then lets every request through, as before. When it
 * is set: no token gives 401 without a lookup, a token that doesn't match
 * gives 401, and a token Consus can't resolve itself gives 503 (fail closed).
 * The token is never logged.
 */
export type OperatorTokenResolver = () => Promise<string | undefined>;

export type RouteGuard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

/** The token a request presents, from the header or a Bearer authorization. */
export function presentedOperatorToken(request: FastifyRequest): string | undefined {
  const header = request.headers[OPERATOR_TOKEN_HEADER.toLowerCase()];
  if (typeof header === "string" && header.trim()) return header.trim();
  const auth = request.headers.authorization;
  if (typeof auth === "string" && /^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, "").trim() || undefined;
  return undefined;
}

function tokensMatch(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A Fastify preHandler that requires the operator token, or a no-op when `resolveToken` is undefined. */
export function operatorTokenGuard(resolveToken: OperatorTokenResolver | undefined): RouteGuard {
  return async (request, reply) => {
    if (!resolveToken) return;
    const route = `${request.method} ${request.routeOptions?.url ?? request.url.split("?")[0]}`;
    const given = presentedOperatorToken(request);
    if (!given) {
      console.warn(`[consus] ${route}: no operator token; refused (401)`);
      await reply.code(401).send({ error: `${route} needs Pantheon's operator token (${OPERATOR_TOKEN_HEADER})` });
      return reply;
    }
    let expected: string | undefined;
    try {
      expected = await resolveToken();
    } catch {
      expected = undefined;
    }
    if (!expected) {
      console.warn(`[consus] ${route}: operator token unavailable; refused (503)`);
      await reply.code(503).send({ error: "operator token not available to Consus; refusing" });
      return reply;
    }
    if (!tokensMatch(expected, given)) {
      console.warn(`[consus] ${route}: invalid operator token; refused (401)`);
      await reply.code(401).send({ error: "invalid operator token" });
      return reply;
    }
  };
}
