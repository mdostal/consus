import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import { registerDesignAssetRoutes, resolveDesignAssetPath, DesignAssetPathEscapesRootError } from "./design-assets.js";

// A minimal, valid 1x1 PNG — real bytes, not just a placeholder string, so
// the served Content-Type/body actually round-trip a real image.
const PNG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000a4944415478da6360000002000155a89f720000000049454e44ae426082",
  "hex",
);

describe("GET /api/design-assets", () => {
  let repoDir: string;
  let app: FastifyInstance;

  beforeEach(async () => {
    repoDir = mkdtempSync(join(tmpdir(), "consus-repo-design-"));
    mkdirSync(join(repoDir, ".pHive", "design", "my-topic"), { recursive: true });
    writeFileSync(join(repoDir, ".pHive", "design", "my-topic", "v1.png"), PNG_BYTES);
    writeFileSync(join(repoDir, ".pHive", "design", "my-topic", "brief.md"), "# Brief\n");
    // A secret file living just outside .pHive/design/ (a sibling under
    // .pHive/) — the traversal test below tries to reach this.
    mkdirSync(join(repoDir, ".pHive", "secrets"), { recursive: true });
    writeFileSync(join(repoDir, ".pHive", "secrets", "top-secret.png"), PNG_BYTES);

    app = Fastify();
    registerDesignAssetRoutes(app, { repos: { consus: repoDir } });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("serves a real PNG under .pHive/design/<topic>/ with the correct content-type — confirmed via an actual HTTP fetch", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/design-assets?repo=consus&path=${encodeURIComponent(join(".pHive", "design", "my-topic", "v1.png"))}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-disposition"]).toBe("inline");
    expect(Buffer.compare(res.rawPayload, PNG_BYTES)).toBe(0);
  });

  it("404s for an unknown repo", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/design-assets?repo=nope&path=${encodeURIComponent(join(".pHive", "design", "my-topic", "v1.png"))}`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("404s for a path that doesn't exist on disk", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/design-assets?repo=consus&path=${encodeURIComponent(join(".pHive", "design", "my-topic", "missing.png"))}`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("400s for a disallowed file extension (mime allowlist)", async () => {
    writeFileSync(join(repoDir, ".pHive", "design", "my-topic", "notes.txt"), "hello");
    const res = await app.inject({
      method: "GET",
      url: `/api/design-assets?repo=consus&path=${encodeURIComponent(join(".pHive", "design", "my-topic", "notes.txt"))}`,
    });
    expect(res.statusCode).toBe(400);
  });

  it("400s a path-traversal attempt reaching a sibling directory just outside .pHive/design/", async () => {
    const traversal = join(".pHive", "design", "..", "secrets", "top-secret.png");
    const res = await app.inject({
      method: "GET",
      url: `/api/design-assets?repo=consus&path=${encodeURIComponent(traversal)}`,
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).error).toMatch(/escapes \.pHive\/design root/);
  });

  it("400s a classic ../../ traversal attempt reaching outside the repo entirely", async () => {
    const traversal = join(".pHive", "design", "my-topic", "..", "..", "..", "..", "..", "etc", "passwd");
    const res = await app.inject({
      method: "GET",
      url: `/api/design-assets?repo=consus&path=${encodeURIComponent(traversal)}`,
    });
    // Extension allowlist rejects this before the path-safety check even
    // runs (passwd has no image extension) — still a 400, and still never
    // reads the file. Confirmed distinctly below via resolveDesignAssetPath
    // directly with an image extension to isolate the path-safety check.
    expect(res.statusCode).toBe(400);
  });

  it("path safety: an absolute-looking traversal with an image extension is still rejected", async () => {
    const traversal = join(".pHive", "design", "my-topic", "..", "..", "secrets", "top-secret.png");
    const res = await app.inject({
      method: "GET",
      url: `/api/design-assets?repo=consus&path=${encodeURIComponent(traversal)}`,
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).error).toMatch(/escapes \.pHive\/design root/);
  });
});

describe("resolveDesignAssetPath", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = mktempRepo();
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  function mktempRepo(): string {
    return mkdtempSync(join(tmpdir(), "consus-repo-design-unit-"));
  }

  it("resolves a genuine path under .pHive/design/", () => {
    const resolved = resolveDesignAssetPath(repoDir, join(".pHive", "design", "topic", "v1.png"));
    expect(resolved).toBe(join(repoDir, ".pHive", "design", "topic", "v1.png"));
  });

  it("throws DesignAssetPathEscapesRootError for a path resolving outside .pHive/design/", () => {
    expect(() => resolveDesignAssetPath(repoDir, join(".pHive", "planning", "prd.md"))).toThrow(
      DesignAssetPathEscapesRootError,
    );
  });

  it("throws for a sibling directory that merely shares .pHive/design's string prefix (e.g. .pHive/design-secret/)", () => {
    expect(() =>
      resolveDesignAssetPath(repoDir, join(".pHive", "design-secret", "leak.png")),
    ).toThrow(DesignAssetPathEscapesRootError);
  });
});
