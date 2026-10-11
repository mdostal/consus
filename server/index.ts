import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { openDb } from "./db/connection.js";
import { runMigration } from "./db/migrate.js";
import { registerDocRoutes } from "./routes/docs.js";
import { registerNewDocRoutes } from "./routes/new-docs.js";
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
import { registerDesignAssetRoutes } from "./routes/design-assets.js";
import { registerSurveyRoutes } from "./routes/surveys.js";
import { registerQuestionRoutes } from "./routes/questions.js";
import { registerMetricsRoutes } from "./routes/metrics.js";
import { registerThreadRoutes } from "./routes/threads.js";
import { HarnessThreadNotifier, selectThreadNotifier, type ThreadNotifier } from "./threads/notifier.js";
import { registerSendOutRoutes } from "./routes/send-out.js";
import { registerInboxRoutes } from "./routes/inbox.js";
import { loadProjectRegistry } from "./config/project-registry.js";
import { StdioHarnessTransport, FileHarnessTransport, WebhookHarnessTransport, NOOP_HARNESS_TRANSPORT, transportName, type HarnessTransport } from "./harness/transport.js";
import { isSyncDegraded } from "./pantheon/sync-status.js";
import { createStorageAdapter } from "./storage/index.js";

/** The built web SPA (`vite.config.ts`'s `build.outDir: "../dist-web"`)
 *  always sits as a sibling of this module's own compiled location
 *  (`dist-server/index.js` -> `../dist-web`) regardless of the process's
 *  cwd at invocation time — resolving from `import.meta.url` rather than
 *  `process.cwd()` keeps this correct whether started via `npm start`
 *  (cwd = repo root) or a container's `WORKDIR` (see mdostal/consus#105). */
const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../dist-web");

/** Selects the correct HarnessTransport based on environment variables.
 *  Extracted for unit testability (server/harness/transport-selection.test.ts).
 *
 *  Priority order (mutually exclusive transports, first match wins):
 *    1. CONSUS_HARNESS=webhook   — generic webhook (requires CONSUS_HARNESS_WEBHOOK_URL)
 *    2. CONSUS_HARNESS_FILE_DIR  — standalone file transport (s9)
 *    3. CONSUS_HARNESS_COMMAND   — stdio transport (legacy/custom harness)
 *    4. (default)                — NOOP (proposals fail immediately with NO_ADAPTER)
 *
 *  CONSUS_HARNESS=pantheon was removed (PANT-969, PANT-813 Q1=B): Pantheon
 *  receives proposals through the webhook transport and pushes results to
 *  POST /api/proposals/:id/result. It now fails at startup rather than
 *  silently falling back to another transport.
 */
export function selectHarnessTransport(env: {
  CONSUS_HARNESS?: string;
  CONSUS_HARNESS_WEBHOOK_URL?: string;
  CONSUS_HARNESS_FILE_DIR?: string;
  CONSUS_HARNESS_COMMAND?: string;
  CONSUS_HARNESS_ARGS?: string;
}): HarnessTransport {
  if (env.CONSUS_HARNESS === "pantheon") {
    throw new Error(
      "CONSUS_HARNESS=pantheon was removed; use CONSUS_HARNESS=webhook with CONSUS_HARNESS_WEBHOOK_URL pointing at Pantheon core-api's /api/feed/changes/webhook?origin=consus",
    );
  }
  if (env.CONSUS_HARNESS === "webhook") {
    if (!env.CONSUS_HARNESS_WEBHOOK_URL) {
      throw new Error("CONSUS_HARNESS_WEBHOOK_URL is required when CONSUS_HARNESS=webhook");
    }
    if (!URL.canParse(env.CONSUS_HARNESS_WEBHOOK_URL)) {
      throw new Error(`CONSUS_HARNESS_WEBHOOK_URL is not a valid URL: ${env.CONSUS_HARNESS_WEBHOOK_URL}`);
    }
    return new WebhookHarnessTransport(env.CONSUS_HARNESS_WEBHOOK_URL);
  }
  if (env.CONSUS_HARNESS_FILE_DIR) {
    return new FileHarnessTransport(env.CONSUS_HARNESS_FILE_DIR);
  }
  if (env.CONSUS_HARNESS_COMMAND) {
    return new StdioHarnessTransport(
      env.CONSUS_HARNESS_COMMAND,
      env.CONSUS_HARNESS_ARGS ? env.CONSUS_HARNESS_ARGS.split(",") : [],
    );
  }
  return NOOP_HARNESS_TRANSPORT;
}

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
  /** s3 (consus-phase25-project-registration-ux): extra candidate root
   *  directories for `GET /api/projects/discover` (server/routes/
   *  projects.ts), sourced from `CONSUS_DISCOVERY_ROOTS` — comma-separated
   *  absolute paths, split the same way CONSUS_HARNESS_ARGS is below.
   *  Empty by default. */
  discoveryRoots?: string[];
  /** Clock for GET /api/metrics's age fields — test-only seam. */
  now?: () => Date;
  /** Outbound side of agent threads (PANT-962). Defaults to handing thread
   *  messages to `transport`; the isMain block below swaps in the
   *  CONSUS_THREAD_WEBHOOK_URL webhook when that is set. */
  threadNotifier?: ThreadNotifier;
  /** Base URL for the replyUrl in outbound thread events
   *  (CONSUS_PUBLIC_URL). Unset: derived from each request's host. */
  publicUrl?: string;
  /** Pantheon core-api base URL for the outbound answer, verdict and
   *  needs-context pushes (server/pantheon/). Defaults to PANTHEON_API_URL;
   *  only decides whether /health and GET /api/metrics report their sync
   *  status — each route still resolves its own URL. */
  pantheonApiUrl?: string;
}

export function buildServer({
  dbPath,
  repos = {},
  transport = NOOP_HARNESS_TRANSPORT,
  webRoot = WEB_ROOT,
  attachmentsDir = ".pHive/attachments",
  projectsConfigPath = ".pHive/consus-projects.json",
  discoveryRoots = [],
  now,
  threadNotifier,
  publicUrl,
  pantheonApiUrl = process.env.PANTHEON_API_URL,
}: BuildServerOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  const db = openDb(dbPath);
  runMigration(db);

  const storageAdapter = createStorageAdapter({ baseDir: attachmentsDir });

  registerDocRoutes(app, { db, repos });
  registerNewDocRoutes(app, { db, repos, transport });
  registerProjectRoutes(app, { db, repos, projectsConfigPath, discoveryRoots });
  registerFsRoutes(app, {});
  registerKbRoutes(app, { db });
  registerArtifactLinkRoutes(app, { db });
  registerDecisionRoutes(app, { db });
  registerInteractionRoutes(app, { db });
  registerProposalRoutes(app, { db, transport });
  registerDiagramRoutes(app, { db, repos });
  registerSendOutRoutes(app, { db, repos, transport });
  registerAuditTrailRoutes(app, { db });
  registerEventRoutes(app, { db, repos, transport });
  registerAttachmentRoutes(app, { db, storageAdapter });
  registerDesignAssetRoutes(app, { repos });
  registerSurveyRoutes(app, { db });
  registerQuestionRoutes(app, { db });
  registerInboxRoutes(app, { db, repos });
  const activeTransport = transportName(transport);
  registerThreadRoutes(app, {
    db,
    notifier: threadNotifier ?? new HarnessThreadNotifier(transport, activeTransport),
    publicUrl,
  });
  const pantheonPush = Boolean(pantheonApiUrl);
  registerMetricsRoutes(app, { db, repos, transport: activeTransport, pantheonPush, now });

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
      // PANT-809: additive only — status/sqlite and the 200 stay unchanged
      // for the Tauri sidecar and Pantheon compose healthchecks.
      transport: activeTransport,
      degraded: pantheonPush && isSyncDegraded(db),
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
  // s3 (consus-phase25-project-registration-ux): comma-separated absolute
  // paths, same split convention as CONSUS_HARNESS_ARGS below. Feeds
  // GET /api/projects/discover's candidate-root resolution.
  const discoveryRoots = process.env.CONSUS_DISCOVERY_ROOTS
    ? process.env.CONSUS_DISCOVERY_ROOTS.split(",")
    : [];

  // Harness dispatch — see selectHarnessTransport() for priority order.
  const transport = selectHarnessTransport(process.env);

  // Agent threads (PANT-962): CONSUS_THREAD_WEBHOOK_URL, else the harness above.
  const threadNotifier = selectThreadNotifier(process.env, transport, transportName(transport));
  const publicUrl = process.env.CONSUS_PUBLIC_URL?.trim() || undefined;

  const app = buildServer({
    dbPath,
    repos,
    transport,
    attachmentsDir,
    projectsConfigPath,
    discoveryRoots,
    threadNotifier,
    publicUrl,
  });

  app.listen({ port, host }).then(() => {
    // eslint-disable-next-line no-console
    console.log(`Consus server listening on :${port} (db: ${dbPath})`);
    // PANT-807: one redelivery pass over the question-answer outbox at
    // startup (no timer — later retries go through the same endpoint).
    if (process.env.PANTHEON_API_URL) {
      void app
        .inject({ method: "POST", url: "/api/questions/redeliver" })
        .then((res) => console.log(`[startup] question redelivery: ${res.body}`))
        .catch((err: unknown) => console.warn("[startup] question redelivery failed", err));
    }
  });
}
