/**
 * first-cut-trust t1e-consus-project-guard, against the real server wiring
 * (buildServer). The attack it closes (pantheon-v2 t1b review-2 finding 1):
 * POST /api/projects {path: "/pantheon-secrets"} with no token, then
 * GET /api/docs/content?repo=...&path=<token file>, read back as root.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../index.js";

const TOKEN = "operator-token-for-tests";
const SECRET = "PANTHEON_OPERATOR_TOKEN=do-not-leak";

function makeRepo(dir: string, doc = "# Brief\n\ncontent"): string {
  mkdirSync(join(dir, ".pHive", "planning"), { recursive: true });
  writeFileSync(join(dir, ".pHive", "planning", "brief.md"), doc);
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

interface Fixture {
  work: string;
  roots: string;
  secrets: string;
  outside: string;
  configPath: string;
  repos: Record<string, string>;
}

function fixture(): Fixture {
  const work = realpathSync(mkdtempSync(join(tmpdir(), "consus-guard-")));
  const roots = join(work, "repos");
  const secrets = join(work, "pantheon-secrets");
  const outside = join(work, "elsewhere");
  mkdirSync(roots, { recursive: true });
  mkdirSync(secrets, { recursive: true });
  writeFileSync(join(secrets, "x.md"), SECRET);
  makeRepo(outside);
  makeRepo(join(roots, "alpha"));
  return { work, roots, secrets, outside, configPath: join(work, "consus-projects.json"), repos: {} };
}

function build(f: Fixture, operatorToken?: () => Promise<string | undefined>): FastifyInstance {
  return buildServer({
    dbPath: join(f.work, "consus.sqlite"),
    repos: f.repos,
    projectsConfigPath: f.configPath,
    attachmentsDir: join(f.work, "attachments"),
    webRoot: join(f.work, "no-web"),
    discoveryRoots: [f.roots],
    protectedDirs: [f.secrets],
    operatorToken,
  });
}

const register = (app: FastifyInstance, body: object, headers: Record<string, string> = {}) =>
  app.inject({ method: "POST", url: "/api/projects", payload: body, headers });

describe("POST /api/projects under Pantheon (operator token set)", () => {
  let f: Fixture;
  let app: FastifyInstance;

  beforeEach(async () => {
    f = fixture();
    app = build(f, async () => TOKEN);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    rmSync(f.work, { recursive: true, force: true });
  });

  it("answers 401 without a token, and registers and persists nothing", async () => {
    const res = await register(app, { name: "alpha", path: join(f.roots, "alpha") });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toMatch(/X-Pantheon-Operator-Token/);
    expect(f.repos).toEqual({});
    expect(existsSync(f.configPath)).toBe(false);
  });

  it("answers 401 for a wrong token", async () => {
    const res = await register(app, { name: "alpha", path: join(f.roots, "alpha") }, { "x-pantheon-operator-token": "nope" });
    expect(res.statusCode).toBe(401);
    expect(f.repos).toEqual({});
  });

  it("registers a path inside the discovery roots with the token (header or Bearer)", async () => {
    const res = await register(app, { name: "alpha", path: join(f.roots, "alpha") }, { "x-pantheon-operator-token": TOKEN });
    expect(res.statusCode).toBe(201);
    expect(f.repos).toEqual({ alpha: join(f.roots, "alpha") });

    makeRepo(join(f.roots, "beta"));
    const bearer = await register(app, { name: "beta", path: join(f.roots, "beta") }, { authorization: `Bearer ${TOKEN}` });
    expect(bearer.statusCode).toBe(201);
  });

  it("refuses a path outside the discovery roots even with the token (403)", async () => {
    const res = await register(app, { name: "out", path: f.outside }, { "x-pantheon-operator-token": TOKEN });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/outside CONSUS_DISCOVERY_ROOTS/);
    expect(f.repos).toEqual({});
  });

  it("refuses the secrets dir, a dir inside it, and a dir containing it, even with the token (403)", async () => {
    mkdirSync(join(f.secrets, "caller"));
    for (const path of [f.secrets, join(f.secrets, "caller"), f.work, "/"]) {
      const res = await register(app, { name: "s", path }, { "x-pantheon-operator-token": TOKEN });
      expect(res.statusCode, path).toBe(403);
    }
    expect(f.repos).toEqual({});
  });

  it("refuses the secrets dir even when it sits inside a discovery root", async () => {
    const app2 = buildServer({
      dbPath: join(f.work, "consus2.sqlite"),
      repos: {},
      projectsConfigPath: join(f.work, "p2.json"),
      attachmentsDir: join(f.work, "attachments2"),
      webRoot: join(f.work, "no-web"),
      discoveryRoots: [f.work],
      protectedDirs: [f.secrets],
      operatorToken: async () => TOKEN,
    });
    await app2.ready();
    try {
      const res = await register(app2, { name: "s", path: f.secrets }, { "x-pantheon-operator-token": TOKEN });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toMatch(/protected directory/);
    } finally {
      await app2.close();
    }
  });

  it("refuses a symlink inside a discovery root that points at the secrets dir or outside the roots", async () => {
    symlinkSync(f.secrets, join(f.roots, "sneaky"));
    symlinkSync(f.outside, join(f.roots, "away"));
    const sneaky = await register(app, { name: "sneaky", path: join(f.roots, "sneaky") }, { "x-pantheon-operator-token": TOKEN });
    const away = await register(app, { name: "away", path: join(f.roots, "away") }, { "x-pantheon-operator-token": TOKEN });
    expect(sneaky.statusCode).toBe(403);
    expect(away.statusCode).toBe(403);
    expect(f.repos).toEqual({});
  });

  it("answers 503 when Consus can't resolve the token itself (fail closed)", async () => {
    const app2 = build({ ...f, repos: {} }, async () => undefined);
    await app2.ready();
    try {
      const res = await register(app2, { name: "alpha", path: join(f.roots, "alpha") }, { "x-pantheon-operator-token": TOKEN });
      expect(res.statusCode).toBe(503);
    } finally {
      await app2.close();
    }
  });

  it("closes the review-2 chain: the secrets file can't be read back through docs/content", async () => {
    const reg = await register(app, { name: "s", path: f.secrets });
    expect(reg.statusCode).toBe(401);
    const read = await app.inject({ method: "GET", url: "/api/docs/content?repo=s&path=x.md" });
    expect(read.statusCode).toBe(404);
    expect(read.body).not.toContain("do-not-leak");
  });

  it("discover offers only candidates registration would accept", async () => {
    symlinkSync(f.secrets, join(f.roots, "sneaky"));
    writeFileSync(join(f.secrets, ".git"), "");
    const res = await app.inject({ method: "GET", url: "/api/projects/discover" });
    expect(res.statusCode).toBe(200);
    expect(res.json().candidates.map((c: { name: string }) => c.name)).toEqual(["alpha"]);
  });

  it("fs/list stays inside the discovery roots and starts at the first one", async () => {
    const start = await app.inject({ method: "GET", url: "/api/fs/list" });
    expect(start.statusCode).toBe(200);
    expect(start.json().path).toBe(f.roots);

    const out = await app.inject({ method: "GET", url: `/api/fs/list?path=${encodeURIComponent(f.work)}` });
    expect(out.statusCode).toBe(403);
  });
});

describe("POST /api/projects standalone (no operator token configured)", () => {
  let f: Fixture;
  let app: FastifyInstance;

  beforeEach(async () => {
    f = fixture();
    app = build(f);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    rmSync(f.work, { recursive: true, force: true });
  });

  it("still registers any directory without a token, roots or not (consus-phase25 behavior)", async () => {
    const res = await register(app, { name: "out", path: f.outside });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(readFileSync(f.configPath, "utf-8"))).toEqual({ out: f.outside });
  });

  it("still refuses the secrets dir and anything containing it", async () => {
    expect((await register(app, { name: "s", path: f.secrets })).statusCode).toBe(403);
    expect((await register(app, { name: "w", path: f.work })).statusCode).toBe(403);
  });

  it("fs/list is unconfined except for the secrets dir", async () => {
    expect((await app.inject({ method: "GET", url: `/api/fs/list?path=${encodeURIComponent(f.work)}` })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/fs/list?path=${encodeURIComponent(f.secrets)}` })).statusCode).toBe(403);
  });
});

describe("persisted projects that predate the guard", () => {
  it("drops a project that is or contains the secrets dir at startup, keeps the rest", async () => {
    const f = fixture();
    f.repos = { leak: f.secrets, root: f.work, alpha: join(f.roots, "alpha"), out: f.outside };
    const app = build(f, async () => TOKEN);
    await app.ready();
    try {
      expect(Object.keys(f.repos).sort()).toEqual(["alpha", "out"]);
      const read = await app.inject({ method: "GET", url: "/api/docs/content?repo=leak&path=x.md" });
      expect(read.statusCode).toBe(404);
    } finally {
      await app.close();
      rmSync(f.work, { recursive: true, force: true });
    }
  });
});

describe("symlinks inside a registered project", () => {
  let f: Fixture;
  let repo: string;
  let app: FastifyInstance;

  beforeEach(async () => {
    f = fixture();
    repo = join(f.roots, "alpha");
    // A checkout can carry symlinks (git stores them).
    symlinkSync(join(f.secrets, "x.md"), join(repo, ".pHive", "planning", "leak.md"));
    symlinkSync(f.secrets, join(repo, "docs"));
    mkdirSync(join(repo, ".pHive", "design", "topic"), { recursive: true });
    writeFileSync(join(f.secrets, "pic.png"), SECRET);
    symlinkSync(join(f.secrets, "pic.png"), join(repo, ".pHive", "design", "topic", "v1.png"));
    // An epic.yaml symlinked to YAML outside the project.
    writeFileSync(join(f.outside, "epic.yaml"), "name: outside-epic\ntitle: outside-title\n");
    mkdirSync(join(repo, ".pHive", "epics", "e1"), { recursive: true });
    symlinkSync(join(f.outside, "epic.yaml"), join(repo, ".pHive", "epics", "e1", "epic.yaml"));
    // An in-repo symlink is fine.
    symlinkSync(join(repo, ".pHive", "planning", "brief.md"), join(repo, ".pHive", "planning", "alias.md"));
    f.repos = { alpha: repo };
    app = build(f, async () => TOKEN);
    await app.ready();
    const ingest = await app.inject({ method: "POST", url: "/api/projects/alpha/ingest" });
    expect(ingest.statusCode).toBe(200);
  });

  afterEach(async () => {
    await app.close();
    rmSync(f.work, { recursive: true, force: true });
  });

  it("docs/content refuses a symlink that points outside the project (400), and never returns its content", async () => {
    for (const path of [".pHive/planning/leak.md", "docs/x.md"]) {
      const res = await app.inject({ method: "GET", url: `/api/docs/content?repo=alpha&path=${encodeURIComponent(path)}` });
      expect(res.statusCode, path).toBe(400);
      expect(res.body).not.toContain("do-not-leak");
    }
  });

  it("docs/content still serves a symlink that stays inside the project", async () => {
    const res = await app.inject({ method: "GET", url: "/api/docs/content?repo=alpha&path=.pHive/planning/alias.md" });
    expect(res.statusCode).toBe(200);
    expect(res.json().content).toContain("# Brief");
  });

  it("the scan never indexes an outside symlink, so search and the doc list never surface it", async () => {
    const docs = await app.inject({ method: "GET", url: "/api/docs?project=alpha" });
    expect(docs.body).not.toContain("leak.md");
    expect(docs.body).not.toContain("docs/x.md");
    const search = await app.inject({ method: "GET", url: "/api/docs/search?q=do-not-leak" });
    expect(search.json().results).toEqual([]);
  });

  it("export/doc, design-assets and docs/resolve refuse it too", async () => {
    const exp = await app.inject({ method: "GET", url: "/api/export/doc?repo=alpha&path=.pHive/planning/leak.md&format=md" });
    expect(exp.statusCode).toBe(400);
    expect(exp.body).not.toContain("do-not-leak");

    const asset = await app.inject({ method: "GET", url: "/api/design-assets?repo=alpha&path=.pHive/design/topic/v1.png" });
    expect(asset.statusCode).toBe(400);
    expect(asset.body).not.toContain("do-not-leak");

    const resolved = await app.inject({ method: "GET", url: `/api/docs/resolve?text=${encodeURIComponent("see .pHive/planning/leak.md")}` });
    expect(resolved.json().candidates).toEqual([{ candidate: ".pHive/planning/leak.md", resolved: false }]);
  });

  it("the diagram cascade never reads an epic.yaml that points outside the project", async () => {
    const res = await app.inject({ method: "GET", url: "/api/diagrams?repo=alpha" });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("outside-epic");
    expect(res.body).not.toContain("outside-title");
  });

  it("docs/content never serves a non-doc file inside the project, such as a checkout's .env", async () => {
    writeFileSync(join(repo, ".env"), SECRET);
    writeFileSync(join(repo, "notes.txt"), SECRET);
    for (const path of [".env", "notes.txt"]) {
      const res = await app.inject({ method: "GET", url: `/api/docs/content?repo=alpha&path=${encodeURIComponent(path)}` });
      expect(res.statusCode, path).toBe(400);
      expect(res.body).not.toContain("do-not-leak");
    }
  });
});
