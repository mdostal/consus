/**
 * @vitest-environment node
 *
 * The webhook harness end to end: Consus listens on a real port, the
 * receiver is a real HTTP server, and the receiver reports back through
 * POST /api/proposals/:id/result exactly as an external harness would.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { runMigration } from "../db/migrate.js";
import { registerProposalRoutes } from "./proposals.js";
import { WebhookHarnessTransport } from "../harness/transport.js";

describe("webhook harness — propose, deliver, report back, redeliver", () => {
  let db: Database.Database;
  let consus: FastifyInstance;
  let consusUrl: string;
  let hook: Server;
  let received: Array<{ method: string; params: { proposalId: string } & Record<string, unknown> }>;
  /** What the receiver answers with next; flip it to simulate an outage. */
  let hookStatus: number;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigration(db);
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO items (id, type, title, status, source_repo, created_at, updated_at) VALUES (?, 'diagram', 'd', 'active', 'consus', ?, ?)",
    ).run("diagram:consus", now, now);

    received = [];
    hookStatus = 202;
    hook = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        received.push(JSON.parse(raw));
        res.writeHead(hookStatus).end(hookStatus === 202 ? "" : "receiver down");
      });
    });
    await new Promise<void>((r) => hook.listen(0, "127.0.0.1", r));
    const hookUrl = `http://127.0.0.1:${(hook.address() as AddressInfo).port}/consus`;

    consus = Fastify();
    registerProposalRoutes(consus, { db, transport: new WebhookHarnessTransport(hookUrl) });
    consusUrl = await consus.listen({ port: 0, host: "127.0.0.1" });
  });

  afterEach(async () => {
    await consus.close();
    hook.closeAllConnections();
    await new Promise((r) => hook.close(r));
    db.close();
  });

  async function propose() {
    const res = await fetch(`${consusUrl}/api/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itemId: "diagram:consus",
        targetType: "diagram",
        diff: "+ node X",
        description: "add node X",
        requestedBy: "mathew",
      }),
    });
    expect(res.status).toBe(201);
    return (await res.json()) as Record<string, unknown>;
  }

  it("delivers the proposal and accepts the receiver's result over HTTP", async () => {
    const proposal = await propose();
    expect(proposal).toMatchObject({ status: "pending", delivery_error: null });
    expect(received).toEqual([
      {
        method: "proposeChange",
        params: {
          proposalId: proposal.id,
          itemId: "diagram:consus",
          targetType: "diagram",
          diff: "+ node X",
          description: "add node X",
          sourceRepo: "consus",
        },
      },
    ]);

    const res = await fetch(`${consusUrl}/api/proposals/${received[0].params.proposalId}/result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "applied" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "applied", applied_diff: "+ node X" });
  });

  it("records a delivery failure on the proposal, then redelivers it by hand", async () => {
    hookStatus = 503;
    const proposal = await propose();
    expect(proposal).toMatchObject({
      status: "failed",
      delivery_error: "INTERNAL_ERROR: HTTP 503: receiver down",
      failure_reason: "INTERNAL_ERROR: HTTP 503: receiver down",
    });
    expect(received).toHaveLength(1);

    hookStatus = 202;
    const retry = await fetch(`${consusUrl}/api/proposals/${proposal.id}/redeliver`, { method: "POST" });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ status: "pending", delivery_error: null, failure_reason: null });
    expect(received).toHaveLength(2);
    expect(received[1]).toEqual(received[0]);

    // Delivered now, so there's nothing left to redeliver.
    const again = await fetch(`${consusUrl}/api/proposals/${proposal.id}/redeliver`, { method: "POST" });
    expect(again.status).toBe(409);
    expect(received).toHaveLength(2);
  });

  it("redeliver 404s for an unknown proposal", async () => {
    const res = await fetch(`${consusUrl}/api/proposals/nope/redeliver`, { method: "POST" });
    expect(res.status).toBe(404);
  });
});
