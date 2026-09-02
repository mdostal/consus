import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { scanRepo } from "../adapters/doc-scanner/index.js";
import { registerDocRoutes } from "./docs.js";

describe("GET /api/docs", () => {
  let repoDir: string;
  let otherRepoDir: string;
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    repoDir = mkdtempSync(join(tmpdir(), "consus-repo-"));
    mkdirSync(join(repoDir, ".pHive", "planning"), { recursive: true });
    writeFileSync(join(repoDir, ".pHive", "planning", "prd.md"), "# PRD\n\nhello world");

    otherRepoDir = mkdtempSync(join(tmpdir(), "consus-other-repo-"));
    mkdirSync(join(otherRepoDir, ".pHive", "planning"), { recursive: true });
    writeFileSync(join(otherRepoDir, ".pHive", "planning", "architecture.md"), "# Architecture\n\nother project doc");

    db = new Database(":memory:");
    runMigration(db);
    scanRepo(db, { repoName: "consus", repoPath: repoDir });
    scanRepo(db, { repoName: "other-project", repoPath: otherRepoDir });

    app = Fastify();
    registerDocRoutes(app, { db, repos: { consus: repoDir, "other-project": otherRepoDir } });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(otherRepoDir, { recursive: true, force: true });
  });

  it("lists docs grouped by repo/epic/phase across every configured project by default", async () => {
    const res = await app.inject({ method: "GET", url: "/api/docs" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.consus).toBeDefined();
    expect(body.consus.planning).toBeDefined();
    expect(body["other-project"]).toBeDefined();
  });

  it("scopes to a single project via ?project=, excluding every other project (REQ-27)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/docs?project=consus" });
    const body = res.json();

    expect(body.consus).toBeDefined();
    expect(body["other-project"]).toBeUndefined();
  });

  it("returns formatted content for a specific doc", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/docs/content?repo=consus&path=${encodeURIComponent(join(".pHive", "planning", "prd.md"))}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.format).toBe("md");
    expect(body.content).toContain("hello world");
  });

  it("rejects a path that escapes the repo root (path traversal) with 400, never reading outside the repo", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/docs/content?repo=consus&path=${encodeURIComponent("../../../../../../etc/passwd")}`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/escapes repo root/);
  });

  it("rejects a path that escapes into a sibling repo directory with the same name prefix, not just '..'", async () => {
    // otherRepoDir's basename may not literally prefix-match repoDir's, but this
    // exercises the same boundary-check code path a same-prefix sibling would hit.
    const res = await app.inject({
      method: "GET",
      url: `/api/docs/content?repo=consus&path=${encodeURIComponent(join("..", "other-repo-doesnt-exist", "secret.md"))}`,
    });
    expect([400, 404]).toContain(res.statusCode);
    if (res.statusCode === 400) {
      expect(res.json().error).toMatch(/escapes repo root/);
    }
  });

  it("returns 404 (not 500) for a genuinely missing file within the repo root", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/docs/content?repo=consus&path=${encodeURIComponent(join(".pHive", "planning", "nope.md"))}`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("upserts a target item for the doc so a propose-a-change action always has something to target (s5)", async () => {
    const path = join(".pHive", "planning", "prd.md");
    const res = await app.inject({
      method: "GET",
      url: `/api/docs/content?repo=consus&path=${encodeURIComponent(path)}`,
    });
    const body = res.json();

    expect(body.itemId).toBeTruthy();
    const row = db.prepare("SELECT type, source_repo FROM items WHERE id = ?").get(body.itemId) as {
      type: string;
      source_repo: string;
    };
    expect(row.type).toBe("doc");
    expect(row.source_repo).toBe("consus");

    // idempotent — reopening doesn't duplicate the item
    await app.inject({ method: "GET", url: `/api/docs/content?repo=consus&path=${encodeURIComponent(path)}` });
    const count = db.prepare("SELECT COUNT(*) AS n FROM items WHERE id = ?").get(body.itemId) as { n: number };
    expect(count.n).toBe(1);
  });
});

describe("GET /api/docs/features", () => {
  let repoDir: string;
  let otherRepoDir: string;
  let db: Database.Database;
  let app: FastifyInstance;
  let repos: Record<string, string>;

  beforeEach(async () => {
    repoDir = mkdtempSync(join(tmpdir(), "consus-repo-"));
    // Two docs in one epic, one doc in another epic, plus a .pHive/planning
    // doc (epic=null, phase='planning' — belongs in neither bucket) and
    // repo-root overview docs (epic=null, phase='overview', from s1).
    mkdirSync(join(repoDir, ".pHive", "epics", "epic-a", "design"), { recursive: true });
    mkdirSync(join(repoDir, ".pHive", "epics", "epic-a", "stories"), { recursive: true });
    mkdirSync(join(repoDir, ".pHive", "epics", "epic-b", "design"), { recursive: true });
    mkdirSync(join(repoDir, ".pHive", "planning"), { recursive: true });
    writeFileSync(join(repoDir, ".pHive", "epics", "epic-a", "design", "design.md"), "# Epic A design");
    writeFileSync(join(repoDir, ".pHive", "epics", "epic-a", "stories", "s1.md"), "# Epic A story");
    writeFileSync(join(repoDir, ".pHive", "epics", "epic-b", "design", "design.md"), "# Epic B design");
    writeFileSync(join(repoDir, ".pHive", "planning", "prd.md"), "# PRD");
    writeFileSync(join(repoDir, "README.md"), "# repo readme");
    writeFileSync(join(repoDir, "VISION.md"), "# repo vision");

    otherRepoDir = mkdtempSync(join(tmpdir(), "consus-other-repo-"));
    mkdirSync(join(otherRepoDir, ".pHive", "epics", "epic-c", "design"), { recursive: true });
    writeFileSync(join(otherRepoDir, ".pHive", "epics", "epic-c", "design", "design.md"), "# Epic C design");
    writeFileSync(join(otherRepoDir, "README.md"), "# other readme");

    db = new Database(":memory:");
    runMigration(db);
    scanRepo(db, { repoName: "consus", repoPath: repoDir });
    scanRepo(db, { repoName: "other-project", repoPath: otherRepoDir });

    repos = { consus: repoDir, "other-project": otherRepoDir };
    app = Fastify();
    registerDocRoutes(app, { db, repos });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(otherRepoDir, { recursive: true, force: true });
  });

  it("groups docs by epic with a docCount and docs array, and buckets phase='overview' rows separately", async () => {
    const res = await app.inject({ method: "GET", url: "/api/docs/features?project=consus" });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.features).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ epic: "epic-a", docCount: 2 }),
        expect.objectContaining({ epic: "epic-b", docCount: 1 }),
      ]),
    );
    expect(body.features).toHaveLength(2);

    const epicA = body.features.find((f: { epic: string }) => f.epic === "epic-a");
    expect(epicA.docs).toHaveLength(2);
    expect(epicA.docs.sort((a: { file_path: string }, b: { file_path: string }) => a.file_path.localeCompare(b.file_path))).toEqual([
      expect.objectContaining({ file_path: join(".pHive", "epics", "epic-a", "design", "design.md") }),
      expect.objectContaining({ file_path: join(".pHive", "epics", "epic-a", "stories", "s1.md") }),
    ]);

    // Each doc entry matches GET /api/docs's own per-doc field list.
    for (const doc of epicA.docs) {
      expect(Object.keys(doc).sort()).toEqual(["content_hash", "file_path", "last_scanned_at"]);
    }
  });

  it("returns a real, non-empty overview[] bucket containing README.md and VISION.md, separate from features[]", async () => {
    const res = await app.inject({ method: "GET", url: "/api/docs/features?project=consus" });
    const body = res.json();

    const overviewPaths = body.overview.map((d: { file_path: string }) => d.file_path).sort();
    expect(overviewPaths).toEqual(["README.md", "VISION.md"]);

    // .pHive/planning/prd.md (epic=null, phase='planning') belongs in
    // neither features[] nor overview[] — it's out of scope for this
    // endpoint's reshape.
    const allFeatureDocPaths = body.features.flatMap((f: { docs: Array<{ file_path: string }> }) =>
      f.docs.map((d) => d.file_path),
    );
    expect(allFeatureDocPaths).not.toContain(join(".pHive", "planning", "prd.md"));
    expect(overviewPaths).not.toContain(join(".pHive", "planning", "prd.md"));
  });

  it("scopes to a single project via ?project=, excluding every other project's docs", async () => {
    const res = await app.inject({ method: "GET", url: "/api/docs/features?project=consus" });
    const body = res.json();

    const epics = body.features.map((f: { epic: string }) => f.epic);
    expect(epics).not.toContain("epic-c");
  });

  it("scopes across every registered repo by default when no ?project= is given", async () => {
    const res = await app.inject({ method: "GET", url: "/api/docs/features" });
    const body = res.json();

    const epics = body.features.map((f: { epic: string }) => f.epic).sort();
    expect(epics).toEqual(["epic-a", "epic-b", "epic-c"]);

    const overviewPaths = body.overview.map((d: { file_path: string }) => d.file_path);
    expect(overviewPaths.filter((p: string) => p === "README.md")).toHaveLength(2);
  });

  it("excludes a repo's docs from features[]/overview[] when it's present in doc_index but absent from the registry (s5, orphaned Portunus data)", async () => {
    // Simulates the real bug found against this repo's own .pHive/consus.sqlite:
    // a repo scanned in the past, then deregistered (dropped from
    // consus-projects.json / the `repos` map passed to registerDocRoutes),
    // whose doc_index rows nonetheless linger untouched.
    const orphanRepoDir = mkdtempSync(join(tmpdir(), "consus-orphan-repo-"));
    mkdirSync(join(orphanRepoDir, ".pHive", "epics", "epic-orphan", "design"), { recursive: true });
    writeFileSync(join(orphanRepoDir, ".pHive", "epics", "epic-orphan", "design", "design.md"), "# Orphan design");
    writeFileSync(join(orphanRepoDir, "README.md"), "# orphan readme");

    try {
      // Scanned into doc_index...
      scanRepo(db, { repoName: "orphan-project", repoPath: orphanRepoDir });
      // ...but NOT added to the `repos` map the running app was built with —
      // i.e. deregistered (or never (re-)registered) from the app's point of
      // view, even though doc_index still has its rows.
      expect(repos["orphan-project"]).toBeUndefined();

      const excludedRes = await app.inject({ method: "GET", url: "/api/docs/features" });
      const excludedBody = excludedRes.json();
      expect(excludedBody.features.map((f: { epic: string }) => f.epic)).not.toContain("epic-orphan");
      // The orphan repo contributed a README.md too, but consus + other-project
      // already contribute one README.md each — assert via count (still
      // exactly 2, not 3) rather than presence, since presence alone can't
      // distinguish "orphan's README excluded" from "some registered repo's".
      const readmeCount = excludedBody.overview.filter((d: { file_path: string }) => d.file_path === "README.md").length;
      expect(readmeCount).toBe(2);

      // The underlying doc_index rows are untouched by this exclusion — a
      // query-time filter, never a destructive prune (s5's design decision).
      const orphanRowCount = (
        db.prepare("SELECT COUNT(*) AS n FROM doc_index WHERE repo = ?").get("orphan-project") as { n: number }
      ).n;
      expect(orphanRowCount).toBeGreaterThan(0);

      // Re-registering it — mutating the same `repos` object in place, the
      // way POST /api/projects does, with NO further scanRepo() call — makes
      // its already-scanned docs reappear immediately.
      repos["orphan-project"] = orphanRepoDir;

      const reincludedRes = await app.inject({ method: "GET", url: "/api/docs/features" });
      const reincludedBody = reincludedRes.json();
      expect(reincludedBody.features.map((f: { epic: string }) => f.epic)).toContain("epic-orphan");
      const readmeCountAfter = reincludedBody.overview.filter((d: { file_path: string }) => d.file_path === "README.md").length;
      expect(readmeCountAfter).toBe(3);

      // Still the same doc_index row count for orphan-project — reappearing
      // required no re-scan and no row mutation whatsoever.
      const orphanRowCountAfter = (
        db.prepare("SELECT COUNT(*) AS n FROM doc_index WHERE repo = ?").get("orphan-project") as { n: number }
      ).n;
      expect(orphanRowCountAfter).toBe(orphanRowCount);
    } finally {
      delete repos["orphan-project"];
      rmSync(orphanRepoDir, { recursive: true, force: true });
    }
  });

  it("doesn't duplicate or drop any doc_index row compared to GET /api/docs for the same repo", async () => {
    const [featuresRes, docsRes] = await Promise.all([
      app.inject({ method: "GET", url: "/api/docs/features?project=consus" }),
      app.inject({ method: "GET", url: "/api/docs?project=consus" }),
    ]);
    const featuresBody = featuresRes.json();
    const docsBody = docsRes.json();

    const featuresTotal =
      featuresBody.features.reduce((sum: number, f: { docCount: number }) => sum + f.docCount, 0) +
      featuresBody.overview.length;

    const docsTotal = Object.values(docsBody.consus).reduce(
      (sum: number, phaseGroup: unknown) => sum + (phaseGroup as unknown[]).length,
      0,
    );

    // consus has one doc (.pHive/planning/prd.md) that's out of scope for
    // /api/docs/features (epic=null, phase='planning') — every other row
    // must appear in exactly one of features[]/overview[].
    expect(docsTotal).toBe(featuresTotal + 1);
  });
});

describe("GET /api/docs/content?ref=", () => {
  let repoDir: string;
  let db: Database.Database;
  let app: FastifyInstance;
  let firstCommitSha: string;

  beforeEach(async () => {
    repoDir = mkdtempSync(join(tmpdir(), "consus-gitrepo-"));
    execFileSync("git", ["init"], { cwd: repoDir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: repoDir });

    mkdirSync(join(repoDir, ".pHive", "planning"), { recursive: true });
    writeFileSync(join(repoDir, ".pHive", "planning", "prd.md"), "# PRD v1\n\noriginal content");
    execFileSync("git", ["add", "."], { cwd: repoDir });
    execFileSync("git", ["commit", "-m", "v1"], { cwd: repoDir });
    firstCommitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir, encoding: "utf-8" }).trim();

    writeFileSync(join(repoDir, ".pHive", "planning", "prd.md"), "# PRD v2\n\nupdated content");
    execFileSync("git", ["add", "."], { cwd: repoDir });
    execFileSync("git", ["commit", "-m", "v2"], { cwd: repoDir });

    db = new Database(":memory:");
    runMigration(db);
    scanRepo(db, { repoName: "consus", repoPath: repoDir });

    app = Fastify();
    registerDocRoutes(app, { db, repos: { consus: repoDir } });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("returns the ref's historical content and echoes ref back, when a valid ref is given", async () => {
    const path = join(".pHive", "planning", "prd.md");
    const res = await app.inject({
      method: "GET",
      url: `/api/docs/content?repo=consus&path=${encodeURIComponent(path)}&ref=${firstCommitSha}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.content).toContain("original content");
    expect(body.content).not.toContain("updated content");
    expect(body.ref).toBe(firstCommitSha);
  });

  it("returns current working-tree content, not the ref field, when ref is omitted", async () => {
    const path = join(".pHive", "planning", "prd.md");
    const res = await app.inject({
      method: "GET",
      url: `/api/docs/content?repo=consus&path=${encodeURIComponent(path)}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.content).toContain("updated content");
    expect(body.ref).toBeUndefined();
  });

  it("returns a clean 400/404 (not a 500) for an invalid/nonexistent ref", async () => {
    const path = join(".pHive", "planning", "prd.md");
    const res = await app.inject({
      method: "GET",
      url: `/api/docs/content?repo=consus&path=${encodeURIComponent(path)}&ref=not-a-real-ref`,
    });
    expect([400, 404]).toContain(res.statusCode);
    const body = res.json();
    expect(body.error).toBeTruthy();
  });
});

describe("GET /api/docs/resolve", () => {
  let repoDir: string;
  let otherRepoDir: string;
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    repoDir = mkdtempSync(join(tmpdir(), "consus-repo-"));
    mkdirSync(join(repoDir, ".pHive", "planning"), { recursive: true });
    writeFileSync(join(repoDir, ".pHive", "planning", "prd.md"), "# PRD\n\nhello world");

    otherRepoDir = mkdtempSync(join(tmpdir(), "consus-other-repo-"));
    mkdirSync(join(otherRepoDir, ".pHive", "planning"), { recursive: true });
    writeFileSync(join(otherRepoDir, ".pHive", "planning", "architecture.md"), "# Architecture\n\nother project doc");

    db = new Database(":memory:");
    runMigration(db);
    scanRepo(db, { repoName: "consus", repoPath: repoDir });
    scanRepo(db, { repoName: "other-project", repoPath: otherRepoDir });

    app = Fastify();
    registerDocRoutes(app, { db, repos: { consus: repoDir, "other-project": otherRepoDir } });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(otherRepoDir, { recursive: true, force: true });
  });

  it("resolves a real cross-repo candidate to the configured repo that has it", async () => {
    const text = "see .pHive/planning/architecture.md for the rationale";
    const res = await app.inject({ method: "GET", url: `/api/docs/resolve?text=${encodeURIComponent(text)}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.candidates).toEqual([
      { candidate: ".pHive/planning/architecture.md", resolved: true, repo: "other-project", path: ".pHive/planning/architecture.md" },
    ]);
  });

  it("reports a candidate that doesn't exist in any configured repo as unresolved, with a 200 (not a 500, not dropped)", async () => {
    const text = "see .pHive/planning/does-not-exist.md for details";
    const res = await app.inject({ method: "GET", url: `/api/docs/resolve?text=${encodeURIComponent(text)}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.candidates).toEqual([{ candidate: ".pHive/planning/does-not-exist.md", resolved: false }]);
  });
});

describe("GET /api/docs/search", () => {
  let repoDir: string;
  let otherRepoDir: string;
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    repoDir = mkdtempSync(join(tmpdir(), "consus-repo-"));
    mkdirSync(join(repoDir, ".pHive", "planning"), { recursive: true });
    writeFileSync(join(repoDir, ".pHive", "planning", "roadmap.md"), "# Plans\n\nnothing special here");

    otherRepoDir = mkdtempSync(join(tmpdir(), "consus-other-repo-"));
    mkdirSync(join(otherRepoDir, ".pHive", "planning"), { recursive: true });
    writeFileSync(
      join(otherRepoDir, ".pHive", "planning", "architecture.md"),
      "# Architecture\n\nthis mentions decision-request somewhere in the body",
    );

    db = new Database(":memory:");
    runMigration(db);
    scanRepo(db, { repoName: "consus", repoPath: repoDir });
    scanRepo(db, { repoName: "other-project", repoPath: otherRepoDir });

    app = Fastify();
    registerDocRoutes(app, { db, repos: { consus: repoDir, "other-project": otherRepoDir } });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(otherRepoDir, { recursive: true, force: true });
  });

  it("matches on repo name via a case-insensitive path/repo substring, tagging matched with 'path'", async () => {
    // "other-project" repo name contains "other"; "consus" doesn't.
    const res = await app.inject({ method: "GET", url: "/api/docs/search?q=other-proj" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({
      repo: "other-project",
      file_path: join(".pHive", "planning", "architecture.md"),
      matched: ["path"],
    });
  });

  it("matches a file_path substring case-insensitively (query 'ROADMAP' matches roadmap.md)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/docs/search?q=ROADMAP" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({
      repo: "consus",
      file_path: join(".pHive", "planning", "roadmap.md"),
      matched: ["path"],
    });
  });

  it("matches on live file content when repo/file_path don't contain the query, tagging matched with 'content' only", async () => {
    const res = await app.inject({ method: "GET", url: "/api/docs/search?q=decision-request" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({
      repo: "other-project",
      file_path: join(".pHive", "planning", "architecture.md"),
      matched: ["content"],
    });
  });

  it("appears exactly once, with matched containing both 'path' and 'content', when a doc matches both dimensions", async () => {
    const res = await app.inject({ method: "GET", url: "/api/docs/search?q=architecture" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // "architecture" is in the file_path (path match) AND in the file
    // content via the "# Architecture" heading (case-insensitive content match).
    const matches = body.results.filter(
      (r: { repo: string; file_path: string }) =>
        r.repo === "other-project" && r.file_path === join(".pHive", "planning", "architecture.md"),
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].matched.sort()).toEqual(["content", "path"]);
  });

  it("scopes both the path-match and content-match dimensions to a single project via ?project=", async () => {
    // "decision-request" only lives in other-project's content; scoping the
    // search to consus must suppress it on both dimensions, not just one.
    const res = await app.inject({ method: "GET", url: "/api/docs/search?q=decision-request&project=consus" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results).toEqual([]);

    // Sanity check: the same query against the actual owning project still matches.
    const res2 = await app.inject({
      method: "GET",
      url: "/api/docs/search?q=decision-request&project=other-project",
    });
    const body2 = res2.json();
    expect(body2.results).toHaveLength(1);
    expect(body2.results[0].repo).toBe("other-project");

    // Also verify project scoping suppresses a path match from the other repo.
    const res3 = await app.inject({ method: "GET", url: "/api/docs/search?q=other-proj&project=consus" });
    const body3 = res3.json();
    expect(body3.results).toEqual([]);
  });

  it("returns 400 when q is missing", async () => {
    const res = await app.inject({ method: "GET", url: "/api/docs/search" });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when q is an empty string", async () => {
    const res = await app.inject({ method: "GET", url: "/api/docs/search?q=" });
    expect(res.statusCode).toBe(400);
  });

  it("returns 200 with an empty results array (not a 404) when nothing matches", async () => {
    const res = await app.inject({ method: "GET", url: "/api/docs/search?q=nonexistent-string-xyz" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results).toEqual([]);
  });

  it("still returns 200 and skips only the content dimension when a doc_index row's file has been deleted from disk", async () => {
    const deletedPath = join(repoDir, ".pHive", "planning", "gone.md");
    writeFileSync(deletedPath, "# Gone\n\nsome ephemeral content only findable while it exists");
    scanRepo(db, { repoName: "consus", repoPath: repoDir });
    rmSync(deletedPath, { force: true });

    // Path match should still work off the stale index row.
    const pathRes = await app.inject({ method: "GET", url: "/api/docs/search?q=gone.md" });
    expect(pathRes.statusCode).toBe(200);
    const pathBody = pathRes.json();
    expect(pathBody.results).toHaveLength(1);
    expect(pathBody.results[0]).toMatchObject({
      repo: "consus",
      file_path: join(".pHive", "planning", "gone.md"),
      matched: ["path"],
    });

    // A content-only query against the now-deleted file's content must not
    // error the whole request — it simply can't match via content anymore.
    const contentRes = await app.inject({ method: "GET", url: "/api/docs/search?q=ephemeral" });
    expect(contentRes.statusCode).toBe(200);
    const contentBody = contentRes.json();
    expect(contentBody.results).toEqual([]);
  });
});

describe("GET /api/docs/diff", () => {
  let repoDir: string;
  let db: Database.Database;
  let app: FastifyInstance;
  const sharedPath = join(".pHive", "planning", "shared.md");
  const unchangedPath = join(".pHive", "planning", "unchanged.md");

  beforeEach(async () => {
    // Deliberately no branch named "main" exists anywhere in this fixture —
    // this repo's *real* default branch is "dev" (mirroring Consus's own
    // repo, whose integration branch is "dev" not "main"), simulated by
    // faking a local refs/remotes/origin/HEAD symref the same way `git
    // clone` would set one up, without needing an actual network remote.
    // If the route implementation ever hardcodes "main" as the default
    // base, every "base omitted" test below would 400 (unresolvable ref)
    // instead of 200, since "main" never exists in this fixture.
    repoDir = mkdtempSync(join(tmpdir(), "consus-diffrepo-"));
    execFileSync("git", ["init", "-q", "-b", "dev"], { cwd: repoDir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: repoDir });

    mkdirSync(join(repoDir, ".pHive", "planning"), { recursive: true });
    writeFileSync(join(repoDir, sharedPath), "# shared v1 (dev)\n");
    writeFileSync(join(repoDir, unchangedPath), "# unchanged\n");
    execFileSync("git", ["add", "."], { cwd: repoDir });
    execFileSync("git", ["commit", "-q", "-m", "dev init"], { cwd: repoDir });

    execFileSync("git", ["update-ref", "refs/remotes/origin/dev", "refs/heads/dev"], { cwd: repoDir });
    execFileSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/dev"], { cwd: repoDir });

    // other-base branches from dev, and feature/x branches from other-base
    // (a linear dev -> other-base -> feature/x chain) so the two candidate
    // bases (dev vs. other-base) have genuinely different merge-bases with
    // feature/x, and therefore genuinely different `-` sides in a
    // triple-dot diff (`base...ref` diffs against the merge-base commit,
    // not literally "base's current tip" — a sibling-branch fixture would
    // make both bases resolve to the same merge-base and defeat this test).
    execFileSync("git", ["checkout", "-q", "-b", "other-base"], { cwd: repoDir });
    writeFileSync(join(repoDir, sharedPath), "# shared v3 (other-base)\n");
    execFileSync("git", ["add", "."], { cwd: repoDir });
    execFileSync("git", ["commit", "-q", "-m", "other-base change"], { cwd: repoDir });

    execFileSync("git", ["checkout", "-q", "-b", "feature/x"], { cwd: repoDir });
    writeFileSync(join(repoDir, sharedPath), "# shared v2 (feature/x)\n");
    execFileSync("git", ["add", "."], { cwd: repoDir });
    execFileSync("git", ["commit", "-q", "-m", "feature change"], { cwd: repoDir });

    execFileSync("git", ["checkout", "-q", "dev"], { cwd: repoDir });

    db = new Database(":memory:");
    runMigration(db);
    scanRepo(db, { repoName: "consus", repoPath: repoDir });

    app = Fastify();
    registerDocRoutes(app, { db, repos: { consus: repoDir } });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("defaults base to the project's real default branch (not a hardcoded 'main') and returns a non-null diff", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/docs/diff?repo=consus&path=${encodeURIComponent(sharedPath)}&ref=feature/x`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.diff).not.toBeNull();
    expect(body.diff).toContain("shared v1 (dev)");
    expect(body.diff).toContain("shared v2 (feature/x)");
  });

  it("returns diff: null (200, not an error) when the doc is byte-identical on both refs", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/docs/diff?repo=consus&path=${encodeURIComponent(unchangedPath)}&ref=feature/x`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.diff).toBeNull();
  });

  it("returns 404 with a clear error when path doesn't exist at the given ref at all", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/docs/diff?repo=consus&path=${encodeURIComponent(join(".pHive", "planning", "nope.md"))}&ref=feature/x`,
    });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error).toBeTruthy();
  });

  it("returns 400 (not 500) when ref doesn't resolve locally", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/docs/diff?repo=consus&path=${encodeURIComponent(sharedPath)}&ref=no-such-branch`,
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBeTruthy();
  });

  it("computes the diff against an explicit ?base= instead of the project's default when one is given", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/docs/diff?repo=consus&path=${encodeURIComponent(sharedPath)}&ref=feature/x&base=other-base`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.diff).not.toBeNull();
    expect(body.diff).toContain("shared v3 (other-base)");
    expect(body.diff).not.toContain("shared v1 (dev)");
  });

  it("returns 404 for an unknown repo", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/docs/diff?repo=nope&path=${encodeURIComponent(sharedPath)}&ref=feature/x`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 telling the operator to pass base explicitly when the default branch can't be auto-resolved", async () => {
    // A fresh repo with no origin/HEAD symref configured at all (no `git
    // clone`, no manual symref setup) — resolveDefaultBranch degrades to
    // null rather than guessing "main", and the route must degrade to a
    // clear 400 rather than silently guessing too.
    const noOriginRepo = mkdtempSync(join(tmpdir(), "consus-diffrepo-noorigin-"));
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: noOriginRepo });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: noOriginRepo });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: noOriginRepo });
    mkdirSync(join(noOriginRepo, ".pHive", "planning"), { recursive: true });
    writeFileSync(join(noOriginRepo, sharedPath), "# shared\n");
    execFileSync("git", ["add", "."], { cwd: noOriginRepo });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: noOriginRepo });

    const noOriginDb = new Database(":memory:");
    runMigration(noOriginDb);
    scanRepo(noOriginDb, { repoName: "no-origin", repoPath: noOriginRepo });
    const noOriginApp = Fastify();
    registerDocRoutes(noOriginApp, { db: noOriginDb, repos: { "no-origin": noOriginRepo } });
    await noOriginApp.ready();

    try {
      const res = await noOriginApp.inject({
        method: "GET",
        url: `/api/docs/diff?repo=no-origin&path=${encodeURIComponent(sharedPath)}&ref=main`,
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBeTruthy();
    } finally {
      await noOriginApp.close();
      noOriginDb.close();
      rmSync(noOriginRepo, { recursive: true, force: true });
    }
  });
});
