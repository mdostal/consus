/**
 * s3 (consus-phase28-interaction-completeness): a single end-to-end pass
 * through the full pipeline this story adds — scan disk -> query the
 * feature-grouped docs API -> read a design doc's rendered content -> fetch
 * the wireframe image that doc's markdown references — against one
 * realistic fixture directory shaped exactly like the Hive `/design`
 * skill's real output (hive/references/wireframe-protocol.md): an
 * `index.yaml` registry, a `brief.md` that references its own wireframe
 * image via ordinary markdown syntax, and a real (non-placeholder) PNG.
 *
 * The narrower unit-level cases (extension allowlist, path-traversal
 * negatives, the no-.pHive/design/-directory no-op, etc.) live in
 * ./design-assets.test.ts and ../adapters/doc-scanner/index.test.ts — this
 * file exists specifically to prove the whole chain actually connects, not
 * just each link in isolation.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { runMigration } from "../db/migrate.js";
import { scanRepo } from "../adapters/doc-scanner/index.js";
import { registerDocRoutes } from "./docs.js";
import { registerDesignAssetRoutes } from "./design-assets.js";

const PNG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000a4944415478da6360000002000155a89f720000000049454e44ae426082",
  "hex",
);

describe("design wireframe pipeline — scan -> features API -> doc content -> image asset (end-to-end)", () => {
  let repoDir: string;
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    repoDir = mkdtempSync(join(tmpdir(), "consus-repo-design-e2e-"));

    // A real .pHive/epics/<epic>/ feature already exists for "checkout-flow"...
    mkdirSync(join(repoDir, ".pHive", "epics", "checkout-flow", "docs"), { recursive: true });
    writeFileSync(
      join(repoDir, ".pHive", "epics", "checkout-flow", "docs", "architecture.md"),
      "# Checkout Flow Architecture\n\nExisting code doc, unrelated to design.\n",
    );

    // ...and the Hive /design skill has produced a matching design topic,
    // shaped exactly like skills/design/SKILL.md step 5/6 describe:
    // v1.png + wireframe.f0 + brief.md + selected.txt, plus the
    // .pHive/design/index.yaml registry entry.
    const topicDir = join(repoDir, ".pHive", "design", "checkout-flow");
    mkdirSync(topicDir, { recursive: true });
    writeFileSync(
      join(topicDir, "brief.md"),
      [
        "# Checkout Flow — Wireframe Brief",
        "",
        "## Layout",
        "Single-column checkout form with an order summary sidebar.",
        "",
        "![Selected wireframe rendition](v1.png)",
        "",
      ].join("\n"),
    );
    writeFileSync(join(topicDir, "v1.png"), PNG_BYTES);
    writeFileSync(join(topicDir, "wireframe.f0"), "{}");
    writeFileSync(join(topicDir, "selected.txt"), "1");
    writeFileSync(
      join(repoDir, ".pHive", "design", "index.yaml"),
      [
        'updated_at: "2026-09-06T00:00:00Z"',
        "briefs:",
        "  - topic: checkout-flow",
        "    surface_kind: screen",
        '    brief_path: ".pHive/design/checkout-flow/brief.md"',
        '    wireframe_path: ".pHive/design/checkout-flow/wireframe.f0"',
        "    export_paths:",
        '      - ".pHive/design/checkout-flow/v1.png"',
        "    selected_rendition: 1",
        "    source: standalone",
        '    created_at: "2026-09-06T00:00:00Z"',
        "",
      ].join("\n"),
    );

    db = new Database(":memory:");
    runMigration(db);
    scanRepo(db, { repoName: "consus", repoPath: repoDir });

    app = Fastify();
    const repos = { consus: repoDir };
    registerDocRoutes(app, { db, repos });
    registerDesignAssetRoutes(app, { repos });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("scans the design topic into doc_index, folds it into the matching feature, serves its content, and serves the wireframe it references", async () => {
    // 1. GET /api/docs/features: the design doc shows up under the
    // "checkout-flow" feature, alongside the pre-existing code doc.
    const featuresRes = await app.inject({ method: "GET", url: "/api/docs/features?project=consus" });
    expect(featuresRes.statusCode).toBe(200);
    const featuresBody = featuresRes.json();

    const feature = featuresBody.features.find((f: { epic: string }) => f.epic === "checkout-flow");
    expect(feature).toBeDefined();
    expect(feature.docCount).toBe(2);
    const paths = feature.docs.map((d: { file_path: string }) => d.file_path).sort();
    expect(paths).toEqual([
      join(".pHive", "design", "checkout-flow", "brief.md"),
      join(".pHive", "epics", "checkout-flow", "docs", "architecture.md"),
    ]);

    // 2. GET /api/docs/content: the design doc's real markdown content is
    // readable live off disk, including its wireframe image reference.
    const briefPath = join(".pHive", "design", "checkout-flow", "brief.md");
    const contentRes = await app.inject({
      method: "GET",
      url: `/api/docs/content?repo=consus&path=${encodeURIComponent(briefPath)}`,
    });
    expect(contentRes.statusCode).toBe(200);
    const contentBody = contentRes.json();
    expect(contentBody.format).toBe("md");
    expect(contentBody.content).toContain("![Selected wireframe rendition](v1.png)");

    // 3. The client resolves that relative "v1.png" reference against the
    // doc's own directory (web/src/features/docs/designAssets.ts's
    // resolveDesignImageSrc) to the repo-relative path GET /api/design-assets
    // expects — confirmed here by fetching that exact resolved path for
    // real and getting the real PNG bytes back.
    const resolvedImagePath = join(".pHive", "design", "checkout-flow", "v1.png");
    const imageRes = await app.inject({
      method: "GET",
      url: `/api/design-assets?repo=consus&path=${encodeURIComponent(resolvedImagePath)}`,
    });
    expect(imageRes.statusCode).toBe(200);
    expect(imageRes.headers["content-type"]).toBe("image/png");
    expect(Buffer.compare(imageRes.rawPayload, PNG_BYTES)).toBe(0);

    // 4. The design topic's own registry file (index.yaml) and non-doc
    // artifacts (wireframe.f0, selected.txt) were never indexed as docs —
    // only .md/.html artifacts are.
    const allFeatureDocPaths = featuresBody.features.flatMap((f: { docs: Array<{ file_path: string }> }) =>
      f.docs.map((d) => d.file_path),
    );
    expect(allFeatureDocPaths).not.toContain(join(".pHive", "design", "index.yaml"));
    expect(allFeatureDocPaths).not.toContain(join(".pHive", "design", "checkout-flow", "wireframe.f0"));
    expect(allFeatureDocPaths).not.toContain(join(".pHive", "design", "checkout-flow", "v1.png"));
  });
});
