import Fastify, { type FastifyInstance } from "fastify";
import { openDb } from "./db/connection.js";
import { runMigration } from "./db/migrate.js";
import { registerDocRoutes } from "./routes/docs.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerKbRoutes } from "./routes/kb.js";
import { registerArtifactLinkRoutes } from "./routes/artifact-links.js";
import { registerDecisionRoutes } from "./routes/decisions.js";
import { registerInteractionRoutes } from "./routes/interactions.js";
import { registerProposalRoutes } from "./routes/proposals.js";
import { registerDiagramRoutes } from "./routes/diagrams.js";
import { registerAuditTrailRoutes } from "./routes/audit-trail.js";
import { registerEventRoutes } from "./routes/events.js";
import { loadProjectRegistry } from "./config/project-registry.js";
import { StdioHarnessTransport, NOOP_HARNESS_TRANSPORT, type HarnessTransport } from "./harness/transport.js";

export interface BuildServerOptions {
  dbPath: string;
  /** repo name -> absolute path on disk, scanned for generated docs */
  repos?: Record<string, string>;
  /** Generic agent-harness dispatch for the propose-a-change mechanism
   *  (server/proposals/store.ts). No specific system by default. */
  transport?: HarnessTransport;
}

export function buildServer({
  dbPath,
  repos = {},
  transport = NOOP_HARNESS_TRANSPORT,
}: BuildServerOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  const db = openDb(dbPath);
  runMigration(db);

  registerDocRoutes(app, { db, repos });
  registerProjectRoutes(app, { db, repos });
  registerKbRoutes(app, { db });
  registerArtifactLinkRoutes(app, { db });
  registerDecisionRoutes(app, { db });
  registerInteractionRoutes(app, { db });
  registerProposalRoutes(app, { db, transport });
  registerDiagramRoutes(app, { db, repos });
  registerAuditTrailRoutes(app, { db });
  registerEventRoutes(app, { db, repos, transport });

  app.get("/health", async () => {
    const row = db.prepare("SELECT 1 AS ok").get() as { ok: number } | undefined;
    return {
      status: "ok",
      sqlite: row?.ok === 1 ? "connected" : "unreachable",
    };
  });

  app.addHook("onClose", async () => {
    db.close();
  });

  return app;
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const port = Number(process.env.PORT ?? 8722);
  // Defaults to loopback-only so standalone/local-dev behavior is unchanged
  // for anyone not setting HOST. Containerized deploys (where 127.0.0.1
  // means the container's own loopback, unreachable from outside) set
  // HOST=0.0.0.0 explicitly — see mdostal/consus#100.
  const host = process.env.HOST ?? "127.0.0.1";
  const dbPath = process.env.CONSUS_DB_PATH ?? ".pHive/consus.sqlite";
  const projectsConfigPath = process.env.CONSUS_PROJECTS_CONFIG ?? ".pHive/consus-projects.json";
  const repos = loadProjectRegistry(projectsConfigPath, process.cwd());

  // Harness dispatch (the propose-a-change mechanism) is opt-in and
  // system-agnostic — a plain configured command, nothing hardcoded.
  const transport =
    process.env.CONSUS_HARNESS_COMMAND
      ? new StdioHarnessTransport(
          process.env.CONSUS_HARNESS_COMMAND,
          process.env.CONSUS_HARNESS_ARGS ? process.env.CONSUS_HARNESS_ARGS.split(",") : [],
        )
      : NOOP_HARNESS_TRANSPORT;

  const app = buildServer({ dbPath, repos, transport });
  app.listen({ port, host }).then(() => {
    // eslint-disable-next-line no-console
    console.log(`Consus server listening on :${port} (db: ${dbPath})`);
  });
}
