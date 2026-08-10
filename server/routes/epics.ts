import type { FastifyPluginAsync } from "fastify";
import { composeEpicDocs } from "../features/living-docs/compose.js";
import type { MulticaClient } from "../adapters/multica/client.js";

export interface EpicsPluginOptions {
  client: MulticaClient;
  repos: Record<string, string>;
}

export const epicsRoutes: FastifyPluginAsync<EpicsPluginOptions> = async (fastify, opts) => {
  fastify.get("/:id/docs", async (request, reply) => {
    const { id } = request.params as { id: string };
    // We assume default repo is "consus" or the first one available
    const repoPath = Object.values(opts.repos)[0] || process.cwd();
    
    const docs = await composeEpicDocs(id, opts.client, repoPath);
    if (!docs) {
      return reply.status(404).send({ error: "Epic not found in either source" });
    }
    return { docs };
  });
};
