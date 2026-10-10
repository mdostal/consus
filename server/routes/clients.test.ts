import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildServer } from "../index.js";

/** PANT-960: client grouping + cross-client inbox over the real server. */
describe("project clients and inbox routes", () => {
  let dir: string;
  let app: FastifyInstance;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "consus-clients-"));
    for (const name of ["flayr", "venues", "consus"]) {
      mkdtempSync(join(dir, `${name}-`));
    }
    app = buildServer({
      dbPath: ":memory:",
      repos: { flayr: join(dir, "flayr"), venues: join(dir, "venues"), consus: join(dir, "consus") },
      projectsConfigPath: join(dir, "projects.json"),
      webRoot: join(dir, "no-web"),
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function setClient(project: string, client: unknown) {
    return app.inject({ method: "PATCH", url: `/api/projects/${project}`, payload: { client } });
  }

  it("sets a client per project and groups them in GET /api/clients", async () => {
    expect((await setClient("flayr", " Firefly ")).json()).toEqual({ project: "flayr", client: "Firefly" });
    await setClient("venues", "Firefly");

    const projects = (await app.inject({ method: "GET", url: "/api/projects" })).json();
    expect(projects.clients).toEqual({ flayr: "Firefly", venues: "Firefly", consus: null });

    const clients = (await app.inject({ method: "GET", url: "/api/clients" })).json();
    expect(clients).toEqual({
      clients: [{ name: "Firefly", projects: ["flayr", "venues"] }],
      ungrouped: ["consus"],
    });
  });

  it("clears a client with null or an empty string", async () => {
    await setClient("flayr", "Firefly");
    expect((await setClient("flayr", "")).json()).toEqual({ project: "flayr", client: null });
    const projects = (await app.inject({ method: "GET", url: "/api/projects" })).json();
    expect(projects.clients.flayr).toBeNull();
  });

  it("rejects unknown projects and bad client values", async () => {
    expect((await setClient("nope", "Firefly")).statusCode).toBe(404);
    expect((await setClient("flayr", 7)).statusCode).toBe(400);
    const missing = await app.inject({ method: "PATCH", url: "/api/projects/flayr", payload: {} });
    expect(missing.statusCode).toBe(400);
  });

  it("accepts an optional client on POST /api/projects", async () => {
    const repo = mkdtempSync(join(dir, "game-"));
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "game-library", path: repo, client: "Firefly" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().client).toBe("Firefly");

    const bad = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "other", path: repo, client: ["x"] },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("serves the inbox, filters by client, and clears a reply once seen or answered", async () => {
    await setClient("flayr", "Firefly");
    await setClient("consus", "Pantheon");
    const payload = {
      version: "dostal:decision-request/v1",
      title: "Ship it?",
      context: "",
      options: [
        { id: "A", title: "Yes", tradeoffs: "" },
        { id: "B", title: "No", tradeoffs: "" },
      ],
      recommended: "A",
    };
    for (const [id, repo] of [["q-flayr", "flayr"], ["q-consus", "consus"]]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/decisions",
        payload: { id, title: `Ship ${repo}?`, source_repo: repo, decision_payload: payload },
      });
      expect(res.statusCode).toBe(201);
    }

    const inboxFor = async (qs = "") =>
      (await app.inject({ method: "GET", url: `/api/inbox${qs}` })).json().items as Array<{
        kind: string;
        itemId: string;
        client: string | null;
        repo: string | null;
      }>;

    expect((await inboxFor()).map((i) => [i.kind, i.itemId, i.repo, i.client]).sort()).toEqual([
      ["question", "q-consus", "consus", "Pantheon"],
      ["question", "q-flayr", "flayr", "Firefly"],
    ]);
    expect((await inboxFor("?client=Firefly")).map((i) => i.itemId)).toEqual(["q-flayr"]);
    expect(await inboxFor("?client=Nobody")).toEqual([]);

    // Commenting through the UI route marks the thread seen, so the
    // poster's own comment never comes back as a "new reply".
    const posted = await app.inject({
      method: "POST",
      url: "/api/items/q-consus/comments",
      payload: { author: "operator", body: "Need more context" },
    });
    expect(posted.statusCode).toBe(201);
    expect((await inboxFor()).filter((i) => i.kind === "reply")).toEqual([]);

    // Answering a question removes it from the inbox and does not leave a reply behind.
    const verdict = await app.inject({
      method: "POST",
      url: "/api/decisions/q-flayr/verdict",
      payload: { verdict: { kind: "accepted" } },
    });
    expect(verdict.statusCode).toBe(200);
    expect(await inboxFor("?client=Firefly")).toEqual([]);

    const seen = await app.inject({ method: "POST", url: "/api/inbox/seen", payload: { itemId: "q-consus" } });
    expect(seen.json()).toEqual({ itemId: "q-consus", seen: true });
    expect((await app.inject({ method: "POST", url: "/api/inbox/seen", payload: { itemId: "missing" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/inbox/seen", payload: {} })).statusCode).toBe(400);
  });
});
