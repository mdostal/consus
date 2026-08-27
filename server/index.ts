import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { openDb } from "./db/connection.js";
import { runMigration } from "./db/migrate.js";
import { registerDocRoutes } from "./routes/docs.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerFsRoutes } from "./routes/fs.js";
import { registerKbRoutes } from "./routes/kb.js";
import { registerArtifactLinkRoutes } from "./routes/artifact-links.js";
import { registerDecisionRoutes } from "./routes/decisions.js";
import { registerInteractionRoutes } from "./routes/interactions.js";
import { registerProposalRoutes } from "./routes/proposals.js";
import { registerDiagramRoutes } from "./routes/diagrams.js";
import { registerAuditTrailRoutes } from "./routes/audit-trail.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerAttachmentRoutes } from "./routes/attachments.js";
import { loadProjectRegistry } from "./config/project-registry.js";
import { StdioHarnessTransport, NOOP_HARNESS_TRANSPORT, type HarnessTransport } from "./harness/transport.js";
import { createStorageAdapter } from "./storage/index.js";

/** The built web SPA (`vite.config.ts`'s `build.outDir: "../dist-web"`)
 *  always sits as a sibling of this module's own compiled location
 *  (`dist-server/index.js` -> `../dist-web`) regardless of the process's
 *  cwd at invocation time — resolving from `import.meta.url` rather than
 *  `process.cwd()` keeps this correct whether started via `npm start`
 *  (cwd = repo root) or a container's `WORKDIR` (see mdostal/consus#105). */
const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../dist-web");

export interface BuildServerOptions {
  dbPath: string;
  /** repo name -> absolute path on disk, scanned for generated docs */
  repos?: Record<string, string>;
  /** Where `repos` is persisted when a project is registered via
   *  `POST /api/projects` (server/routes/projects.ts), so it survives a
   *  restart. Mirrors `CONSUS_PROJECTS_CONFIG`'s default. */
  projectsConfigPath?: string;
  /** Generic agent-harness dispatch for the propose-a-change mechanism
   *  (server/proposals/store.ts). No specific system by default. */
  transport?: HarnessTransport;
  /** Overrides WEB_ROOT — test-only seam so the static-serving behavior
   *  (mdostal/consus#105) can be exercised hermetically against a real
   *  temp directory rather than depending on this repo's actual built
   *  dist-web/ happening to be present on disk at test time. Production
   *  callers (the isMain block below) never pass this. */
  webRoot?: string;
  /** Local-disk directory attachments are stored under (server/storage/).
   *  Mirrors dbPath's default-plus-env-override convention — the isMain
   *  block below resolves CONSUS_ATTACHMENTS_DIR before calling buildServer,
   *  and this default keeps every other buildServer() caller (tests, etc.)
   *  working unchanged without needing to pass it explicitly. */
  attachmentsDir?: string;
}

export function buildServer({
  dbPath,
  repos = {},
  transport = NOOP_HARNESS_TRANSPORT,
  webRoot = WEB_ROOT,
  attachmentsDir = ".pHive/attachments",
  projectsConfigPath = ".pHive/consus-projects.json",
}: BuildServerOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  const db = openDb(dbPath);
  runMigration(db);

  const storageAdapter = createStorageAdapter({ baseDir: attachmentsDir });

  registerDocRoutes(app, { db, repos });
  registerProjectRoutes(app, { db, repos, projectsConfigPath });
  registerFsRoutes(app, {});
  registerKbRoutes(app, { db });
  registerArtifactLinkRoutes(app, { db });
  registerDecisionRoutes(app, { db });
  registerInteractionRoutes(app, { db });
  registerProposalRoutes(app, { db, transport });
  registerDiagramRoutes(app, { db, repos });
  registerAuditTrailRoutes(app, { db });
  registerEventRoutes(app, { db, repos, transport });
  registerAttachmentRoutes(app, { db, storageAdapter });

  // Serves the built web SPA (mdostal/consus#105 — previously GET / was a
  // bare 404, so none of the app's own UI was ever reachable through this
  // server, only the bare JSON API under /api/*). Conditional on the build
  // actually existing so `buildServer()` stays safe to call in tests/dev
  // contexts that never ran `npm run build:web` — matches this repo's
  // existing tolerant-existsSync convention (e.g. project-registry.ts).
  if (existsSync(webRoot)) {
    void app.register(fastifyStatic, { root: webRoot });

    // No client-side router exists in the SPA today (confirmed: no
    // react-router-dom, no <Route>/<BrowserRouter> in App.tsx — every view
    // lives at "/" with query-string state), so a literal path-based
    // deep link isn't a real case yet. Still added defensively per #105's
    // own suggested fix, and to future-proof against that changing: any
    // GET that isn't a real static asset and isn't an API/health route
    // falls back to index.html instead of a bare 404.
    app.setNotFoundHandler((request, reply) => {
      const isApiRoute = request.url.startsWith("/api/") || request.url === "/health";
      if (request.method !== "GET" || isApiRoute) {
        reply.code(404).send({ error: "Not Found" });
        return;
      }
      reply.sendFile("index.html");
    });
  }

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
  const attachmentsDir = process.env.CONSUS_ATTACHMENTS_DIR ?? ".pHive/attachments";
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

  const app = buildServer({ dbPath, repos, transport, attachmentsDir, projectsConfigPath });
  app.listen({ port, host }).then(() => {
    // eslint-disable-next-line no-console
    console.log(`Consus server listening on :${port} (db: ${dbPath})`);
  });
}
