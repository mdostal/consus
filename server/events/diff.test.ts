import { describe, it, expect } from "vitest";
import { computeLineDiff } from "./diff.js";

describe("computeLineDiff", () => {
  it("emits every line unchanged (no-op) for identical input", () => {
    const text = "line one\nline two\nline three";
    expect(computeLineDiff(text, text)).toBe("  line one\n  line two\n  line three");
  });

  it("emits every content line as an addition when the original is empty and the edited content shares a leading blank line (typical doc shape)", () => {
    // "".split("\n") is one blank-string element, not zero — with markdown's
    // usual "# heading\n\nbody" shape, that phantom blank line matches the
    // edited content's own blank line after the heading, so every *real*
    // line of content still comes through as a pure "+ " addition.
    const edited = "# Heading\n\nbody line one\nbody line two";
    expect(computeLineDiff("", edited)).toBe("+ # Heading\n  \n+ body line one\n+ body line two");
  });

  it("emits a leading empty deletion before the additions when the edited content has no matching blank line (inherited split(\"\\n\") quirk, faithfully ported from the client algorithm)", () => {
    const edited = "line one\nline two";
    expect(computeLineDiff("", edited)).toBe("- \n+ line one\n+ line two");
  });

  it("emits every line as a deletion when the edited content is empty, plus a trailing empty addition for the same split(\"\\n\") reason", () => {
    const original = "line one\nline two";
    expect(computeLineDiff(original, "")).toBe("- line one\n- line two\n+ ");
  });

  it("interleaves additions, deletions, and unchanged lines for a mixed edit", () => {
    const original = "keep\nremove me\nkeep too";
    const edited = "keep\nadded\nkeep too";

    const result = computeLineDiff(original, edited);

    expect(result).toBe("  keep\n- remove me\n+ added\n  keep too");
  });
});
