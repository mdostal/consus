import { describe, it, expect } from "vitest";
import { diffText } from "./textDiff";

describe("diffText", () => {
  it("returns a single equal part when texts are identical", () => {
    const parts = diffText("hello world", "hello world");
    expect(parts).toEqual([{ type: "equal", value: "hello world" }]);
  });

  it("detects a pure addition", () => {
    const parts = diffText("hello world", "hello brave world");
    expect(parts).toEqual([
      { type: "equal", value: "hello " },
      { type: "added", value: "brave " },
      { type: "equal", value: "world" },
    ]);
  });

  it("detects a pure removal", () => {
    const parts = diffText("hello brave world", "hello world");
    expect(parts).toEqual([
      { type: "equal", value: "hello " },
      { type: "removed", value: "brave " },
      { type: "equal", value: "world" },
    ]);
  });

  it("detects a replacement as removed+added", () => {
    const parts = diffText("the cat sat", "the dog sat");
    expect(parts).toEqual([
      { type: "equal", value: "the " },
      { type: "removed", value: "cat" },
      { type: "added", value: "dog" },
      { type: "equal", value: " sat" },
    ]);
  });

  it("handles fully disjoint texts", () => {
    const parts = diffText("abc", "xyz");
    expect(parts).toEqual([
      { type: "removed", value: "abc" },
      { type: "added", value: "xyz" },
    ]);
  });

  it("handles an empty oldText", () => {
    const parts = diffText("", "new content");
    expect(parts).toEqual([{ type: "added", value: "new content" }]);
  });

  it("handles an empty newText", () => {
    const parts = diffText("old content", "");
    expect(parts).toEqual([{ type: "removed", value: "old content" }]);
  });
});
