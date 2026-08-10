import Fastify, { type FastifyInstance } from "fastify";
import { openDb } from "./db/connection.js";
import { runMigration } from "./db/migrate.js";
import { registerDocRoutes } from "./routes/docs.js";
import { registerKbRoutes } from "./routes/kb.js";
import { registerArtifactLinkRoutes } from "./routes/artifact-links.js";
import { registerDecisionRoutes } from "./routes/decisions.js";
import { registerAttachmentRoutes } from "./routes/attachments.js";
import { registerDiagramRoutes } from "./routes/diagrams.js";
import { registerEpicRoutes } from "./routes/epics.js";
import { loadProjectRegistry } from "./config/project-registry.js";
import { HttpMulticaClient, type MulticaClient } from "./adapters/multica/client.js";
import { createStorageAdapter, type StorageAdapter } from "./storage/index.js";

/** Used when no MulticaClient is configured — GET /api/decisions surfaces a
 *  clear 503 instead of the server failing to boot or silently skipping sync. */
const UNCONFIGURED_MULTICA_CLIENT: MulticaClient = {
  async writeComment() {
    return { ok: false, error: "Multica client not configured" };
  },
  async listIssues() {
    return { ok: false, error: "Multica client not configured" };
  },
  async getIssue() {
    return { ok: false, error: "Multica client not configured" };
  },
  async updateIssueStatus() {
    return { ok: false, error: "Multica client not configured" };
  },
  async unblockIssue() {
    return { ok: false, error: "Multica client not configured" };
  },
};

export interface BuildServerOptions {
  dbPath: string;
  /** repo name -> absolute path on disk, scanned for generated docs */
  repos?: Record<string, string>;
  /** live Multica adapter for GET /api/decisions; falls back to a stub that always 503s */
  client?: MulticaClient;
  /** JSONL audit file for POST /api/decisions/:key/iterate + GET /api/log */
  decisionLogPath?: string;
  storageAdapter?: StorageAdapter;
}

export function buildServer({
  dbPath,
  repos = {},
  client = UNCONFIGURED_MULTICA_CLIENT,
  decisionLogPath,
  storageAdapter,
}: BuildServerOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  const db = openDb(dbPath);
  runMigration(db);
  
  const finalStorageAdapter = storageAdapter || createStorageAdapter({ type: 'filesystem', baseDir: '.pHive/attachments' });

  registerDocRoutes(app, { db, repos });
  registerKbRoutes(app, { db });
  registerArtifactLinkRoutes(app, { db });
  registerDecisionRoutes(app, { db, client, decisionLogPath });
  registerAttachmentRoutes(app, { db, storageAdapter: finalStorageAdapter });
  registerDiagramRoutes(app, { db, client, repos });
  registerEpicRoutes(app, { db, client, repos });

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

function buildMulticaClientFromEnv(env: NodeJS.ProcessEnv): MulticaClient {
  const serverUrl = env.MULTICA_SERVER_URL;
  const workspaceId = env.MULTICA_WORKSPACE_ID;
  if (!serverUrl || !workspaceId) {
    // eslint-disable-next-line no-console
    console.warn(
      "[multica] MULTICA_SERVER_URL / MULTICA_WORKSPACE_ID not set — GET /api/decisions will 503 until configured",
    );
    return UNCONFIGURED_MULTICA_CLIENT;
  }
  try {
    return new HttpMulticaClient({ serverUrl, workspaceId, token: env.MULTICA_TOKEN });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn(`[multica] failed to construct client (${message}) — GET /api/decisions will 503 until fixed`);
    return UNCONFIGURED_MULTICA_CLIENT;
  }
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const port = Number(process.env.PORT ?? 8722);
  const dbPath = process.env.CONSUS_DB_PATH ?? ".pHive/consus.sqlite";
  const projectsConfigPath = process.env.CONSUS_PROJECTS_CONFIG ?? ".pHive/consus-projects.json";
  const repos = loadProjectRegistry(projectsConfigPath, process.cwd());
  const client = buildMulticaClientFromEnv(process.env);
  const app = buildServer({ dbPath, repos, client });
  app.listen({ port, host: "0.0.0.0" }).then(() => {
    // eslint-disable-next-line no-console
    console.log(`Consus server listening on :${port} (db: ${dbPath})`);
  });
}
