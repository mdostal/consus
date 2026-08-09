import { describe, it, expect } from "vitest";
import { splitIntoSections } from "./sections";

describe("splitIntoSections", () => {
  it("splits at each h1-h3 heading", () => {
    const content = "# Header 1\nSection 1 text\n## Header 2\nSection 2 text";
    expect(splitIntoSections(content)).toEqual(["# Header 1\nSection 1 text\n", "## Header 2\nSection 2 text"]);
  });

  it("returns the whole content as one section when there are no headings", () => {
    const content = "just plain text, no headings";
    expect(splitIntoSections(content)).toEqual([content]);
  });

  it("drops blank fragments", () => {
    const content = "\n\n# Header 1\nBody";
    expect(splitIntoSections(content)).toEqual(["# Header 1\nBody"]);
  });
});
