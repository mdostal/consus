import Fastify, { type FastifyInstance } from "fastify";
import { Command } from "commander";
import { openDb } from "./db/connection.js";
import { runMigration } from "./db/migrate.js";
import { registerDocRoutes } from "./routes/docs.js";
import { registerKbRoutes } from "./routes/kb.js";
import { registerArtifactLinkRoutes } from "./routes/artifact-links.js";
import { registerDecisionRoutes } from "./routes/decisions.js";
import { registerAttachmentRoutes } from "./routes/attachments.js";
import { registerDiagramRoutes } from "./routes/diagrams.js";
import { loadProjectRegistry } from "./config/project-registry.js";
import { HttpMulticaClient, type MulticaClient } from "./adapters/multica/client.js";
import { createStorageAdapter, type StorageAdapter } from "./storage/index.js";

export type ConsusMode = "standalone" | "plugin";

export interface PantheonPluginLifecycle {
  onStart?: (app: FastifyInstance) => void | Promise<void>;
  onStop?: () => void | Promise<void>;
}

export interface PantheonPluginContext {
  lifecycle?: PantheonPluginLifecycle;
}

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

const STANDALONE_MULTICA_CLIENT: MulticaClient = {
  async writeComment() {
    return { ok: false, error: "Multica writes are unavailable in standalone mode" };
  },
  async listIssues() {
    return { ok: true, issues: [] };
  },
  async getIssue() {
    return { ok: false, error: "Multica issue fetch is unavailable in standalone mode" };
  },
  async updateIssueStatus() {
    return { ok: false, error: "Multica status updates are unavailable in standalone mode" };
  },
  async unblockIssue() {
    return { ok: false, error: "Multica unblock is unavailable in standalone mode" };
  },
};

export interface BuildServerOptions {
  dbPath: string;
  mode?: ConsusMode;
  /** repo name -> absolute path on disk, scanned for generated docs */
  repos?: Record<string, string>;
  /** live Multica adapter for GET /api/decisions; falls back to a stub that always 503s */
  client?: MulticaClient;
  /** JSONL audit file for POST /api/decisions/:key/iterate + GET /api/log */
  decisionLogPath?: string;
  storageAdapter?: StorageAdapter;
  pluginContext?: PantheonPluginContext;
}

export function buildServer({
  dbPath,
  mode = "standalone",
  repos = {},
  client = mode === "standalone" ? STANDALONE_MULTICA_CLIENT : UNCONFIGURED_MULTICA_CLIENT,
  decisionLogPath,
  storageAdapter,
  pluginContext,
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

  if (mode === "plugin") {
    app.addHook("onReady", async () => {
      await pluginContext?.lifecycle?.onStart?.(app);
    });
  }

  const healthHandler = async () => {
    const row = db.prepare("SELECT 1 AS ok").get() as { ok: number } | undefined;
    return {
      status: "ok",
      mode,
      sqlite: row?.ok === 1 ? "connected" : "unreachable",
    };
  };
  app.get("/health", healthHandler);
  // /healthz alias — the probe path convention several Pantheon load
  // balancers/orchestrators default to.
  app.get("/healthz", healthHandler);

  app.addHook("onClose", async () => {
    if (mode === "plugin") {
      await pluginContext?.lifecycle?.onStop?.();
    }
    db.close();
  });

  return app;
}

function parseMode(value: string): ConsusMode {
  if (value === "standalone" || value === "plugin") return value;
  throw new Error(`Invalid Consus mode: ${value}. Expected "standalone" or "plugin".`);
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

export interface RuntimeConfig {
  port: number;
  mode: ConsusMode;
  dbPath: string;
  projectsConfigPath: string;
}

export function parseRuntimeConfig(argv: string[], env: NodeJS.ProcessEnv): RuntimeConfig {
  const program = new Command();
  program
    .exitOverride()
    .allowUnknownOption(false)
    .option("--mode <mode>", "Run mode: standalone | plugin", env.CONSUS_MODE ?? "standalone")
    .option("--port <port>", "Port for the Consus HTTP server", env.PORT ?? "8722")
    .option("--db-path <path>", "SQLite database path", env.CONSUS_DB_PATH ?? ".pHive/consus.sqlite")
    .option(
      "--projects-config <path>",
      "Project registry JSON path",
      env.CONSUS_PROJECTS_CONFIG ?? ".pHive/consus-projects.json",
    );
  program.parse(argv, { from: "node" });
  const opts = program.opts<{ mode: string; port: string; dbPath: string; projectsConfig: string }>();
  return {
    mode: parseMode(opts.mode),
    port: parsePort(opts.port),
    dbPath: opts.dbPath,
    projectsConfigPath: opts.projectsConfig,
  };
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
  const { port, mode, dbPath, projectsConfigPath } = parseRuntimeConfig(process.argv, process.env);
  const repos = loadProjectRegistry(projectsConfigPath, process.cwd());
  const client = mode === "plugin" ? buildMulticaClientFromEnv(process.env) : STANDALONE_MULTICA_CLIENT;
  const app = buildServer({ dbPath, mode, repos, client });
  app.listen({ port, host: "0.0.0.0" }).then(() => {
    // eslint-disable-next-line no-console
    console.log(`Consus server listening on :${port} (mode: ${mode}, db: ${dbPath})`);
  });
}
