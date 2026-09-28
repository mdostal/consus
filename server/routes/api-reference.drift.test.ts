/**
 * @vitest-environment node
 *
 * Doc-drift guard (PANT-811): every route registered in server/routes/*.ts
 * must have a heading in docs/api-reference.md, so the "a harness author
 * can use Consus from this doc alone" promise fails CI the moment a new
 * route ships undocumented, instead of drifting silently.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROUTES_DIR = dirname(fileURLToPath(import.meta.url));
const API_REFERENCE = join(ROUTES_DIR, "../../docs/api-reference.md");

// `app.<method>` followed (lazily, across newlines and any `<{...}>` generic)
// by the first string-literal argument that starts with "/".
const ROUTE_RE = /\bapp\.(get|post|put|patch|delete)\b[\s\S]*?\(\s*["'`](\/[^"'`]*)["'`]/g;

// A heading like "### `GET /api/docs?project=<name>`" — query string dropped.
const HEADING_RE = /^#{2,6}\s+`(GET|POST|PUT|PATCH|DELETE)\s+([^`?\s]+)[^`]*`/gm;

function extractRoutes(source: string): string[] {
  return Array.from(source.matchAll(ROUTE_RE), (m) => `${m[1].toUpperCase()} ${m[2]}`);
}

function extractDocumentedRoutes(markdown: string): Set<string> {
  return new Set(Array.from(markdown.matchAll(HEADING_RE), (m) => `${m[1]} ${m[2]}`));
}

function undocumentedRoutes(routes: string[], markdown: string): string[] {
  const documented = extractDocumentedRoutes(markdown);
  return routes.filter((r) => !documented.has(r));
}

function registeredRoutes(): string[] {
  return readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .flatMap((f) => extractRoutes(readFileSync(join(ROUTES_DIR, f), "utf8")));
}

describe("docs/api-reference.md route coverage", () => {
  const routes = registeredRoutes();
  const markdown = readFileSync(API_REFERENCE, "utf8");

  it("finds the registered routes (sanity check on the parser)", () => {
    expect(routes.length).toBeGreaterThan(40);
    expect(routes).toContain("GET /api/decisions");
    // A multi-line registration (generic on one line, path on the next).
    expect(routes).toContain("POST /api/decisions/:id/verdict");
  });

  it("documents every route registered in server/routes/*.ts", () => {
    expect(undocumentedRoutes(routes, markdown)).toEqual([]);
  });

  it("flags a route whose heading is removed from api-reference.md", () => {
    const stripped = markdown.replace(/^### `POST \/api\/decisions\/:id\/verdict`.*$/m, "");
    expect(stripped).not.toEqual(markdown);
    expect(undocumentedRoutes(routes, stripped)).toEqual(["POST /api/decisions/:id/verdict"]);
  });

  it("ignores query strings in headings", () => {
    expect(extractDocumentedRoutes("### `GET /api/docs?project=<name>`\n")).toEqual(new Set(["GET /api/docs"]));
  });
});
