import { describe, expect, it } from "vitest";
import {
  TEMPLATE_IDS,
  fillPlaceholders,
  getSections,
  loadTemplate,
  parseFrontmatter,
  renderTemplateHTML,
} from "../lib/templates.js";

describe("template registry", () => {
  it("exposes the design-discussion and decision-record templates", () => {
    expect(TEMPLATE_IDS).toEqual(["design-discussion", "decision-record"]);
  });

  it("rejects unknown template ids", () => {
    expect(() => loadTemplate("not-a-template")).toThrow(/Unknown template/);
  });
});

describe("design-discussion template", () => {
  const raw = loadTemplate("design-discussion");

  it("declares design-discussion frontmatter", () => {
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter.type).toBe("design-discussion");
  });

  it("has all standard sections present: Goal, Approach, Risks, Open Questions", () => {
    const headings = getSections(raw).map((section) => section.heading);
    expect(headings).toEqual(["Goal", "Approach", "Risks", "Open Questions"]);
  });

  it("fills {{TITLE}}, {{AUTHOR}}, {{DATE}} placeholders and leaves none behind", () => {
    const filled = fillPlaceholders(raw, { TITLE: "Cache eviction", AUTHOR: "Ada", DATE: "2026-08-08" });

    expect(filled).toContain("title: Cache eviction");
    expect(filled).toContain("author: Ada");
    expect(filled).toContain("date: 2026-08-08");
    expect(filled).not.toMatch(/\{\{(TITLE|AUTHOR|DATE)\}\}/);
  });
});

describe("decision-record template", () => {
  const raw = loadTemplate("decision-record");

  it("declares decision-record frontmatter", () => {
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter.type).toBe("decision-record");
  });

  it("follows ADR format: Status, Context, Decision, Consequences", () => {
    const headings = getSections(raw).map((section) => section.heading);
    expect(headings).toEqual(["Status", "Context", "Decision", "Consequences"]);
  });
});

describe("renderTemplateHTML", () => {
  it("marks every design-discussion section as an editing region keyed by its slug", () => {
    const html = renderTemplateHTML("design-discussion", { TITLE: "Cache eviction" });
    const regions = [...html.matchAll(/data-editable="([^"]+)"/g)].map((match) => match[1]);

    expect(regions).toEqual(["goal", "approach", "risks", "open-questions"]);
  });

  it("marks every decision-record section as an editing region keyed by its slug", () => {
    const html = renderTemplateHTML("decision-record", { TITLE: "Use SQLite for kb store" });
    const regions = [...html.matchAll(/data-editable="([^"]+)"/g)].map((match) => match[1]);

    expect(regions).toEqual(["status", "context", "decision", "consequences"]);
  });

  it("converts each section's markdown body into HTML inside its own region", () => {
    const html = renderTemplateHTML("design-discussion", { TITLE: "Cache eviction" });

    expect(html).toContain('<section data-editable="goal">');
    expect(html).toMatch(/<h2>Goal<\/h2>/);
    expect(html).toContain("What are we trying to accomplish?");
  });
});
