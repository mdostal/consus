import { describe, it, expect } from "vitest";
import { splitIntoSections } from "./sections";

describe("splitIntoSections", () => {
  it("splits at h1 boundaries", () => {
    const content = "# One\nfirst body\n# Two\nsecond body";
    expect(splitIntoSections(content)).toEqual(["# One\nfirst body\n", "# Two\nsecond body"]);
  });

  it("splits at h2 boundaries", () => {
    const content = "## One\nfirst body\n## Two\nsecond body";
    expect(splitIntoSections(content)).toEqual(["## One\nfirst body\n", "## Two\nsecond body"]);
  });

  it("splits at h3 boundaries", () => {
    const content = "### One\nfirst body\n### Two\nsecond body";
    expect(splitIntoSections(content)).toEqual(["### One\nfirst body\n", "### Two\nsecond body"]);
  });

  it("splits at mixed h1-h3 boundaries", () => {
    const content = "# Title\nintro\n## Sub A\nbody a\n### Sub A.1\nbody a.1\n## Sub B\nbody b";
    expect(splitIntoSections(content)).toEqual([
      "# Title\nintro\n",
      "## Sub A\nbody a\n",
      "### Sub A.1\nbody a.1\n",
      "## Sub B\nbody b",
    ]);
  });

  it("does not split at h4-h6 boundaries", () => {
    const content = "# Title\nintro\n#### Detail\nnot a section boundary";
    expect(splitIntoSections(content)).toEqual(["# Title\nintro\n#### Detail\nnot a section boundary"]);
  });

  it("collapses a heading-less doc to a single section", () => {
    const content = "just some plain text\nwith multiple lines\nand no headings at all";
    expect(splitIntoSections(content)).toEqual([content]);
  });

  it("collapses empty content to a single (empty) section", () => {
    expect(splitIntoSections("")).toEqual([""]);
  });

  it("splits off leading non-heading text before the first heading as its own section", () => {
    // The heading boundary regex matches "# " at the start of any line, not
    // just the start of the string, so text preceding the first heading
    // becomes its own (heading-less) leading section.
    const content = "preamble text\n# First heading\nbody";
    expect(splitIntoSections(content)).toEqual(["preamble text\n", "# First heading\nbody"]);
  });

  // Known limitation (inherited from the archived reference implementation,
  // not introduced by this story — see sections.ts's docstring): this is a
  // naive regex split, not a real markdown parser, so a heading-like line
  // that appears inside a fenced code block is still treated as a section
  // boundary. This test documents that honest behavior rather than hiding it.
  it("over-splits on a heading-like line inside a fenced code block (known limitation)", () => {
    const content = "# Real heading\nSome intro text.\n```md\n# Not actually a heading\ncode body\n```\nmore text";
    const sections = splitIntoSections(content);

    // A real markdown-aware splitter would keep this as one section; the
    // naive regex instead splits inside the fence.
    expect(sections).toEqual([
      "# Real heading\nSome intro text.\n```md\n",
      "# Not actually a heading\ncode body\n```\nmore text",
    ]);
  });
});
