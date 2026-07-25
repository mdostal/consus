import Fastify, { type FastifyInstance } from "fastify";
import { openDb } from "./db/connection.js";
import { runMigration } from "./db/migrate.js";
import { registerDocRoutes } from "./routes/docs.js";

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
  const dbPath = process.env.DELPHI_DB_PATH ?? ".pHive/delphi.sqlite";
  const repos = { delphi: process.cwd() };
  const app = buildServer({ dbPath, repos });
  app.listen({ port, host: "0.0.0.0" }).then(() => {
    // eslint-disable-next-line no-console
    console.log(`Delphi server listening on :${port} (db: ${dbPath})`);
  });
}
