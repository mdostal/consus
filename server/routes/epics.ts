import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import type { MulticaClient } from "../adapters/multica/client.js";
import { composeEpicDocs } from "../features/living-docs/compose.js";

export interface EpicsRoutesOptions {
  db: Database.Database;
  client: MulticaClient;
  repos?: Record<string, string>;
}

export function registerEpicsRoutes(
  app: FastifyInstance,
  { client, repos = {} }: EpicsRoutesOptions
): void {
  app.get<{ Params: { epic_id: string } }>(
    "/api/epics/:epic_id/docs",
    async (request, reply) => {
      const epicId = request.params.epic_id;
      // In a real app we'd resolve the correct repo path for the epic.
      // Assuming single target repo or fallback for now.
      const repoPath = Object.values(repos)[0] || process.cwd();

      try {
        const view = await composeEpicDocs(client, epicId, repoPath);
        return view;
      } catch (err) {
        request.log.error(err);
        reply.code(500);
        return { error: "Failed to compose epic docs" };
      }
    }
  );
}
