import Fastify, { type FastifyInstance } from "fastify";
import { openDb } from "./db/connection.js";
import { runMigration } from "./db/migrate.js";
import { registerDocRoutes } from "./routes/docs.js";
import { registerKbRoutes } from "./routes/kb.js";
import { registerArtifactLinkRoutes } from "./routes/artifact-links.js";
import { registerDecisionRoutes } from "./routes/decisions.js";
import { loadProjectRegistry } from "./config/project-registry.js";

export interface BuildServerOptions {
  dbPath: string;
  /** repo name -> absolute path on disk, scanned for generated docs */
  repos?: Record<string, string>;
}

export function buildServer({ dbPath, repos = {} }: BuildServerOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  const db = openDb(dbPath);
  runMigration(db);

  registerDocRoutes(app, { db, repos });
  registerKbRoutes(app, { db });
  registerArtifactLinkRoutes(app, { db });
  registerDecisionRoutes(app, { db });

  const healthHandler = async () => {
    const row = db.prepare("SELECT 1 AS ok").get() as { ok: number } | undefined;
    return {
      status: "ok",
      sqlite: row?.ok === 1 ? "connected" : "unreachable",
    };
  };
  app.get("/health", healthHandler);
  // /healthz alias — the probe path convention several Pantheon load
  // balancers/orchestrators default to.
  app.get("/healthz", healthHandler);

  app.addHook("onClose", async () => {
    db.close();
  });

  return app;
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const port = Number(process.env.PORT ?? 8722);
  const dbPath = process.env.CONSUS_DB_PATH ?? ".pHive/consus.sqlite";
  const projectsConfigPath = process.env.CONSUS_PROJECTS_CONFIG ?? ".pHive/consus-projects.json";
  const repos = loadProjectRegistry(projectsConfigPath, process.cwd());
  const app = buildServer({ dbPath, repos });
  app.listen({ port, host: "0.0.0.0" }).then(() => {
    // eslint-disable-next-line no-console
    console.log(`Consus server listening on :${port} (db: ${dbPath})`);
  });
}
