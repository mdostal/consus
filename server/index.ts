import { existsSync } from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import { openDb } from "./db/connection.js";
import { runMigration } from "./db/migrate.js";
import { importMulticaArchive } from "./db/import-multica-archive.js";
import { registerDocRoutes } from "./routes/docs.js";
import { registerKbRoutes } from "./routes/kb.js";
import { registerArtifactLinkRoutes } from "./routes/artifact-links.js";
import { registerDecisionRoutes } from "./routes/decisions.js";
import { registerInteractionRoutes } from "./routes/interactions.js";
import { loadProjectRegistry } from "./config/project-registry.js";
import {
  HttpMulticaClient,
  resolveMulticaServerUrl,
  resolveMulticaWorkspaceId,
  type MulticaClient,
} from "./adapters/multica/client.js";

/** Used when no client is supplied (tests, CI) — never throws, never makes a
 *  network call. Production wiring (isMain below) always supplies a real one. */
const NOOP_MULTICA_CLIENT: MulticaClient = {
  writeComment: async () => ({ ok: false, error: "Multica client not configured" }),
  listIssues: async () => ({ ok: true, issues: [] }),
};

export interface BuildServerOptions {
  dbPath: string;
  /** repo name -> absolute path on disk, scanned for generated docs */
  repos?: Record<string, string>;
  client?: MulticaClient;
  /** One-time (idempotent) historical backfill — omit entirely for tests/other
   *  installs; only this repo's own preserved archive should be passed here. */
  archivePaths?: { auditPath: string; kbPath: string };
}

export function buildServer({
  dbPath,
  repos = {},
  client = NOOP_MULTICA_CLIENT,
  archivePaths,
}: BuildServerOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  const db = openDb(dbPath);
  runMigration(db);

  if (archivePaths) {
    const backfill = importMulticaArchive(db, archivePaths);
    if (backfill.auditRowsImported > 0 || backfill.kbRowsImported > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[archive-import] backfilled ${backfill.auditRowsImported} audit rows, ${backfill.kbRowsImported} KB rows`,
      );
    }
  }

  registerDocRoutes(app, { db, repos });
  registerKbRoutes(app, { db });
  registerArtifactLinkRoutes(app, { db });
  registerDecisionRoutes(app, { db, client });
  registerInteractionRoutes(app, { db });

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
  const dbPath = process.env.CONSUS_DB_PATH ?? ".pHive/consus.sqlite";
  const projectsConfigPath = process.env.CONSUS_PROJECTS_CONFIG ?? ".pHive/consus-projects.json";
  const repos = loadProjectRegistry(projectsConfigPath, process.cwd());

  let client: MulticaClient = NOOP_MULTICA_CLIENT;
  try {
    client = new HttpMulticaClient({
      serverUrl: resolveMulticaServerUrl(),
      workspaceId: resolveMulticaWorkspaceId(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn(`[multica] not configured — decisions queue will be local-only: ${message}`);
  }

  // This repo's own preserved Multica archive only, per
  // s2-historical-backfill-importer — skip silently when absent (other
  // repos' Consus installs won't have this file).
  const archiveDir = process.env.CONSUS_MULTICA_ARCHIVE_DIR ?? ".pHive/imports/multica-archive";
  const auditPath = `${archiveDir}/delphi-audit.jsonl`;
  const kbPath = `${archiveDir}/delphi-knowledgebase.jsonl`;
  const archivePaths = existsSync(auditPath) && existsSync(kbPath) ? { auditPath, kbPath } : undefined;

  const app = buildServer({ dbPath, repos, client, archivePaths });
  app.listen({ port, host: "0.0.0.0" }).then(() => {
    // eslint-disable-next-line no-console
    console.log(`Consus server listening on :${port} (db: ${dbPath})`);
  });
}
