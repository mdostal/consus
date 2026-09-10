import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { runMigration } from "../../db/migrate.js";
import { synthesizeBrandManifestDecision, LOGO_CONCEPTS_MANIFEST_PATH } from "./brand-manifest.js";

interface ItemRow {
  id: string;
  type: string;
  title: string;
  status: string;
  source_repo: string | null;
  source_ref: string | null;
  decision_payload: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

const VALID_MANIFEST = `
version: dostal:concept-selection/v1
title: "Consus brand: select the logo concept direction"
context: "Five logo concepts were produced for Consus's first real brand system."
concepts:
  - id: geo
    name: Geometric
    description: Sharp angular mark.
    preview:
      kind: svg
      markup: "<svg><rect width=\\"10\\" height=\\"10\\"/></svg>"
  - id: script
    name: Script
    description: Flowing wordmark.
    preview:
      kind: svg
      markup: "<svg><path d=\\"M0 0\\"/></svg>"
`;

function itemRow(db: Database.Database, id: string): ItemRow | undefined {
  return db.prepare("SELECT * FROM items WHERE id = ?").get(id) as ItemRow | undefined;
}

describe("synthesizeBrandManifestDecision (s4-manifest-decision-synthesis)", () => {
  let repoDir: string;
  let db: Database.Database;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "consus-brand-manifest-"));
    mkdirSync(join(repoDir, ".pHive", "brand"), { recursive: true });
    db = new Database(":memory:");
    runMigration(db);
  });

  afterEach(() => {
    db.close();
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("returns false and creates nothing when the manifest is entirely absent", () => {
    const result = synthesizeBrandManifestDecision(db, { repoName: "repo", repoPath: repoDir });
    expect(result).toBe(false);
    expect(db.prepare("SELECT COUNT(*) AS n FROM items").get()).toEqual({ n: 0 });
  });

  it("creates a real items row carrying a dostal:concept-selection/v1 payload from a valid manifest", () => {
    writeFileSync(join(repoDir, LOGO_CONCEPTS_MANIFEST_PATH), VALID_MANIFEST);

    const result = synthesizeBrandManifestDecision(db, { repoName: "repo", repoPath: repoDir });
    expect(result).toBe(true);

    const id = `decision:repo:${LOGO_CONCEPTS_MANIFEST_PATH}`;
    const row = itemRow(db, id);
    expect(row).toBeDefined();
    expect(row?.type).toBe("decision");
    expect(row?.title).toBe("Consus brand: select the logo concept direction");
    expect(row?.decided_at).toBeNull();

    const payload = JSON.parse(row!.decision_payload!);
    expect(payload.version).toBe("dostal:concept-selection/v1");
    expect(payload.concepts).toHaveLength(2);
    expect(payload.concepts[0]).toEqual({
      id: "geo",
      name: "Geometric",
      description: "Sharp angular mark.",
      preview: { kind: "svg", markup: '<svg><rect width="10" height="10"/></svg>' },
    });
  });

  it("uses the same decision:<repo>:<file_path> id scheme every other doc-derived decision uses", () => {
    writeFileSync(join(repoDir, LOGO_CONCEPTS_MANIFEST_PATH), VALID_MANIFEST);
    synthesizeBrandManifestDecision(db, { repoName: "myrepo", repoPath: repoDir });

    const expectedId = `decision:myrepo:${LOGO_CONCEPTS_MANIFEST_PATH}`;
    expect(itemRow(db, expectedId)).toBeDefined();
  });

  it("re-scanning an unchanged manifest does not create a duplicate item", () => {
    writeFileSync(join(repoDir, LOGO_CONCEPTS_MANIFEST_PATH), VALID_MANIFEST);
    synthesizeBrandManifestDecision(db, { repoName: "repo", repoPath: repoDir });
    synthesizeBrandManifestDecision(db, { repoName: "repo", repoPath: repoDir });
    synthesizeBrandManifestDecision(db, { repoName: "repo", repoPath: repoDir });

    const rows = db.prepare("SELECT id FROM items").all() as Array<{ id: string }>;
    expect(rows).toHaveLength(1);
  });

  it("re-scanning after the decision has already been decided does not reopen or duplicate it", () => {
    writeFileSync(join(repoDir, LOGO_CONCEPTS_MANIFEST_PATH), VALID_MANIFEST);
    synthesizeBrandManifestDecision(db, { repoName: "repo", repoPath: repoDir });

    const id = `decision:repo:${LOGO_CONCEPTS_MANIFEST_PATH}`;
    db.prepare("UPDATE items SET decided_at = ? WHERE id = ?").run("2026-09-10T00:00:00.000Z", id);

    const result = synthesizeBrandManifestDecision(db, { repoName: "repo", repoPath: repoDir });
    expect(result).toBe(true);

    const rows = db.prepare("SELECT id FROM items").all() as Array<{ id: string }>;
    expect(rows).toHaveLength(1);

    const row = itemRow(db, id);
    expect(row?.decided_at).toBe("2026-09-10T00:00:00.000Z");
  });

  it("degrades gracefully (no crash, no decision created) on malformed YAML", () => {
    writeFileSync(join(repoDir, LOGO_CONCEPTS_MANIFEST_PATH), "concepts: [this is: not: valid: yaml");

    const result = synthesizeBrandManifestDecision(db, { repoName: "repo", repoPath: repoDir });
    expect(result).toBe(false);
    expect(db.prepare("SELECT COUNT(*) AS n FROM items").get()).toEqual({ n: 0 });
  });

  it("degrades gracefully when concepts is empty", () => {
    writeFileSync(
      join(repoDir, LOGO_CONCEPTS_MANIFEST_PATH),
      'version: dostal:concept-selection/v1\ntitle: "t"\ncontext: "c"\nconcepts: []\n',
    );

    const result = synthesizeBrandManifestDecision(db, { repoName: "repo", repoPath: repoDir });
    expect(result).toBe(false);
    expect(db.prepare("SELECT COUNT(*) AS n FROM items").get()).toEqual({ n: 0 });
  });

  it("degrades gracefully when a concept entry is missing required fields", () => {
    writeFileSync(
      join(repoDir, LOGO_CONCEPTS_MANIFEST_PATH),
      [
        "version: dostal:concept-selection/v1",
        'title: "t"',
        'context: "c"',
        "concepts:",
        "  - id: geo",
        "    description: no name or preview",
      ].join("\n"),
    );

    const result = synthesizeBrandManifestDecision(db, { repoName: "repo", repoPath: repoDir });
    expect(result).toBe(false);
    expect(db.prepare("SELECT COUNT(*) AS n FROM items").get()).toEqual({ n: 0 });
  });

  it("degrades gracefully when title/context are missing", () => {
    writeFileSync(
      join(repoDir, LOGO_CONCEPTS_MANIFEST_PATH),
      [
        "version: dostal:concept-selection/v1",
        "concepts:",
        "  - id: geo",
        "    name: Geometric",
        "    description: Sharp angular mark.",
        "    preview:",
        "      kind: svg",
        '      markup: "<svg/>"',
      ].join("\n"),
    );

    const result = synthesizeBrandManifestDecision(db, { repoName: "repo", repoPath: repoDir });
    expect(result).toBe(false);
    expect(db.prepare("SELECT COUNT(*) AS n FROM items").get()).toEqual({ n: 0 });
  });

  describe("real backfilled manifest (this story's own deliverable)", () => {
    // repoPath resolves to the real consus checkout, three levels up from this
    // test file (server/adapters/doc-scanner/brand-manifest.test.ts) — the
    // same dirname(fileURLToPath(import.meta.url)) convention already used by
    // index.test.ts's "real scan against this repo" test.
    const testDir = dirname(fileURLToPath(import.meta.url));
    const realRepoPath = resolve(testDir, "..", "..", "..");

    it("a real scan of this repo creates a real, pending concept-selection decision with all 5 concepts", () => {
      expect(existsSync(join(realRepoPath, LOGO_CONCEPTS_MANIFEST_PATH))).toBe(true);

      const result = synthesizeBrandManifestDecision(db, { repoName: "consus", repoPath: realRepoPath });
      expect(result).toBe(true);

      const id = `decision:consus:${LOGO_CONCEPTS_MANIFEST_PATH}`;
      const row = itemRow(db, id);
      expect(row).toBeDefined();
      expect(row?.decided_at).toBeNull();
      expect(row?.title).toBe("Consus brand: select the logo concept direction");

      const payload = JSON.parse(row!.decision_payload!);
      expect(payload.version).toBe("dostal:concept-selection/v1");
      expect(payload.context).toBe(
        "Five logo concepts were produced for Consus's first real brand system, grounded in the name's own mythology (granary + secret counsel). Pick the direction to build on.",
      );

      const ids = payload.concepts.map((c: { id: string }) => c.id);
      expect(ids).toEqual(["pure-wordmark", "wordmark-symbol", "monogram", "abstract-mark", "badge-seal"]);

      // Every concept's SVG markup must appear verbatim (byte-for-byte) as a
      // substring of the real brand-guide.html -- confirms no regeneration/
      // paraphrasing crept in, including the monogram's arc-path fix.
      const brandGuideHtml = readFileSync(join(realRepoPath, ".pHive", "brand", "brand-guide.html"), "utf-8");
      for (const concept of payload.concepts as Array<{ id: string; preview: { kind: string; markup: string } }>) {
        expect(concept.preview.kind).toBe("svg");
        expect(brandGuideHtml).toContain(concept.preview.markup);
      }

      // The monogram specifically must be the FIXED arc-path version (not the
      // old circle+rect hack) -- confirms the exact SVG the operator approved
      // this session, not a stale/regressed variant.
      const monogram = payload.concepts.find((c: { id: string }) => c.id === "monogram");
      expect(monogram.preview.markup).toContain(
        'd="M 101.57,36 A 48,48 0 1 0 101.57,84"',
      );
      expect(monogram.preview.markup).not.toContain("<rect");
    });

    it("re-scanning this real repo twice stays idempotent (exactly one item)", () => {
      synthesizeBrandManifestDecision(db, { repoName: "consus", repoPath: realRepoPath });
      synthesizeBrandManifestDecision(db, { repoName: "consus", repoPath: realRepoPath });

      const rows = db.prepare("SELECT id FROM items").all() as Array<{ id: string }>;
      expect(rows).toHaveLength(1);
    });
  });
});
