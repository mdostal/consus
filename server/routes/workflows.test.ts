import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { registerWorkflowRoutes } from "./workflows.js";
import { randomUUID } from "node:crypto";

describe("Workflow Routes", () => {
  let app: FastifyInstance;
  let db: Database.Database;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigration(db);
    app = Fastify();
    registerWorkflowRoutes(app, { db });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("should park a workflow and create associated records", async () => {
    const payload = {
      agent_name: "test-agent",
      workflow_type: "research",
      parked_state: { step: 2 },
      question_text: "What is the meaning of life?"
    };

    const response = await app.inject({
      method: "POST",
      url: "/api/workflows/park",
      payload
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("parked");

    // Verify DB records
    const workflow = db.prepare("SELECT * FROM parked_workflows WHERE id = ?").get(body.id) as any;
    expect(workflow).toBeDefined();
    expect(workflow.agent_name).toBe("test-agent");
    expect(workflow.parked_state).toBe(JSON.stringify({ step: 2 }));
    expect(workflow.status).toBe("parked");
    expect(workflow.question_id).toBeDefined();

    const humanRequest = db.prepare("SELECT * FROM human_requests WHERE minerva_question_id = ?").get(workflow.question_id) as any;
    expect(humanRequest).toBeDefined();
    expect(humanRequest.text).toBe("What is the meaning of life?");
    expect(humanRequest.status).toBe("pending");
    expect(humanRequest.channel).toBe("minerva");
  });

  it("should return 400 if required fields are missing", async () => {
    const payload = {
      agent_name: "test-agent"
      // missing others
    };

    const response = await app.inject({
      method: "POST",
      url: "/api/workflows/park",
      payload
    });

    expect(response.statusCode).toBe(400);
  });

  it("should return 404 for missing workflow status", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/workflows/missing-id/status"
    });

    expect(response.statusCode).toBe(404);
  });

  it("should poll parked status for unanswered workflow", async () => {
    const parkRes = await app.inject({
      method: "POST",
      url: "/api/workflows/park",
      payload: {
        agent_name: "test-agent",
        workflow_type: "research",
        parked_state: "state",
        question_text: "Question?"
      }
    });
    const { id } = parkRes.json();

    const pollRes = await app.inject({
      method: "GET",
      url: `/api/workflows/${id}/status`
    });

    expect(pollRes.statusCode).toBe(200);
    const pollBody = pollRes.json();
    expect(pollBody.status).toBe("parked");
    expect(pollBody.answer).toBeNull();
    expect(pollBody.question_id).toBeDefined();
  });

  it("should return resumed status when answer is provided", async () => {
    const parkRes = await app.inject({
      method: "POST",
      url: "/api/workflows/park",
      payload: {
        agent_name: "test-agent",
        workflow_type: "research",
        parked_state: "state",
        question_text: "Question?"
      }
    });
    const { id } = parkRes.json();
    const workflow = db.prepare("SELECT question_id FROM parked_workflows WHERE id = ?").get(id) as any;

    // Simulate human answering
    db.prepare("UPDATE human_requests SET answer = ?, status = 'answered' WHERE minerva_question_id = ?").run(
      "42",
      workflow.question_id
    );

    const pollRes = await app.inject({
      method: "GET",
      url: `/api/workflows/${id}/status`
    });

    expect(pollRes.statusCode).toBe(200);
    const pollBody = pollRes.json();
    expect(pollBody.status).toBe("resumed");
    expect(pollBody.answer).toBe("42");

    // Next poll should also be resumed
    const pollRes2 = await app.inject({
      method: "GET",
      url: `/api/workflows/${id}/status`
    });
    expect(pollRes2.json().status).toBe("resumed");
  });
});
