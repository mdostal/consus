import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export interface WorkflowRoutesOptions {
  db: Database.Database;
}

interface ParkRequestBody {
  agent_name: string;
  workflow_type: string;
  parked_state: unknown;
  question_text: string;
}

export function registerWorkflowRoutes(
  app: FastifyInstance,
  { db }: WorkflowRoutesOptions
): void {
  app.post<{ Body: ParkRequestBody }>("/api/workflows/park", async (request, reply) => {
    const { agent_name, workflow_type, parked_state, question_text } = request.body;

    if (!agent_name || !workflow_type || !parked_state || !question_text) {
      reply.code(400);
      return { error: "Missing required fields" };
    }

    const workflowId = randomUUID();
    const questionId = randomUUID();
    const itemId = `item_${randomUUID()}`;
    const timestamp = new Date().toISOString();

    const parkedStateStr = typeof parked_state === "string" 
      ? parked_state 
      : JSON.stringify(parked_state);

    const insertWorkflow = db.prepare(`
      INSERT INTO parked_workflows (id, agent_name, workflow_type, parked_state, status, question_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertItem = db.prepare(`
      INSERT INTO items (id, type, title, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertHumanRequest = db.prepare(`
      INSERT INTO human_requests (item_id, minerva_question_id, text, channel, status, agent_name)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const runTransaction = db.transaction(() => {
      insertWorkflow.run(
        workflowId,
        agent_name,
        workflow_type,
        parkedStateStr,
        "parked",
        questionId,
        timestamp,
        timestamp
      );

      insertItem.run(
        itemId,
        "human_request",
        `Question from ${agent_name}`,
        "pending",
        timestamp,
        timestamp
      );

      insertHumanRequest.run(
        itemId,
        questionId,
        question_text,
        "minerva",
        "pending",
        agent_name
      );
    });

    runTransaction();

    return { id: workflowId, status: "parked" };
  });

  app.get<{ Params: { id: string } }>("/api/workflows/:id/status", async (request, reply) => {
    const { id } = request.params;

    const workflow = db.prepare(`
      SELECT status, question_id
      FROM parked_workflows
      WHERE id = ?
    `).get(id) as { status: string; question_id: string } | undefined;

    if (!workflow) {
      reply.code(404);
      return { error: "Workflow not found" };
    }

    const humanRequest = db.prepare(`
      SELECT answer
      FROM human_requests
      WHERE minerva_question_id = ?
    `).get(workflow.question_id) as { answer: string | null } | undefined;

    let answer = null;
    let currentStatus = workflow.status;

    // Check if answered
    if (humanRequest && humanRequest.answer) {
      answer = humanRequest.answer;
      currentStatus = "resumed";

      // Ideally we'd update the DB to 'resumed', but returning the correct state is primarily required.
      // Acceptance criteria: "Given a workflow's question has been answered, when Minerva polls GET /api/workflows/:id/status, then it receives {status: 'resumed', question_id, answer: '<human answer>'}"
      if (workflow.status === 'parked') {
         db.prepare(`UPDATE parked_workflows SET status = 'resumed', updated_at = ? WHERE id = ?`)
           .run(new Date().toISOString(), id);
      }
    }

    return {
      status: currentStatus,
      question_id: workflow.question_id,
      answer
    };
  });
}
