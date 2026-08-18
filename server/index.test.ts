import { describe, it, expect, afterAll } from "vitest";
import { existsSync, unlinkSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildServer } from "./index.js";

describe("GET /health", () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "consus-test-")), "consus.sqlite");

  afterAll(() => {
    if (existsSync(dbPath)) {
      unlinkSync(dbPath);
    }
  });

  it("returns 200 with a JSON body confirming SQLite connectivity", async () => {
    const app = buildServer({ dbPath });

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe("ok");
    expect(body.sqlite).toBe("connected");

    await app.close();
  });
});

describe("static web SPA serving (mdostal/consus#105)", () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "consus-test-")), "consus.sqlite");
  const webRoot = mkdtempSync(join(tmpdir(), "consus-dist-web-"));
  writeFileSync(join(webRoot, "index.html"), "<!doctype html><html><body>consus</body></html>");
  mkdirSync(join(webRoot, "assets"));
  writeFileSync(join(webRoot, "assets", "app.js"), "console.log('app');");

  afterAll(() => {
    if (existsSync(dbPath)) unlinkSync(dbPath);
  });

  it("serves index.html at GET / when a built web root exists", async () => {
    const app = buildServer({ dbPath, webRoot });

    const response = await app.inject({ method: "GET", url: "/" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("consus");

    await app.close();
  });

  it("serves a real built asset file directly", async () => {
    const app = buildServer({ dbPath, webRoot });

    const response = await app.inject({ method: "GET", url: "/assets/app.js" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("console.log");

    await app.close();
  });

  it("falls back to index.html for an unrecognized GET path (SPA fallback), not a bare 404", async () => {
    const app = buildServer({ dbPath, webRoot });

    const response = await app.inject({ method: "GET", url: "/some/deep/link" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("consus");

    await app.close();
  });

  it("still returns a real JSON 404 for an unmatched /api/* route, not the SPA fallback", async () => {
    const app = buildServer({ dbPath, webRoot });

    const response = await app.inject({ method: "GET", url: "/api/this-route-does-not-exist" });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe("Not Found");
    expect(response.body).not.toContain("<!doctype html>");

    await app.close();
  });

  it("does not register static serving at all when no web root exists (e.g. a fresh checkout before npm run build:web)", async () => {
    const app = buildServer({ dbPath, webRoot: join(webRoot, "definitely-does-not-exist") });

    const response = await app.inject({ method: "GET", url: "/" });

    // No static plugin registered and no SPA-fallback notFoundHandler installed —
    // Fastify's own default 404 behavior applies, same as before this story.
    expect(response.statusCode).toBe(404);

    await app.close();
  });
});
