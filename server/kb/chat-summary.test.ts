import { describe, it, expect } from "vitest";
import { summarizeChat } from "./chat-summary.js";

describe("summarizeChat (REQ-25)", () => {
  it("returns null for an empty thread", () => {
    expect(summarizeChat([])).toBeNull();
  });

  it("produces an author-labeled digest with a message count", () => {
    const summary = summarizeChat([
      { author: "alice", body: "should we ship this?" },
      { author: "bob", body: "yes, looks good" },
    ]);

    expect(summary).toContain("2 messages");
    expect(summary).toContain("alice: should we ship this?");
    expect(summary).toContain("bob: yes, looks good");
  });

  it("uses singular 'message' for a single comment", () => {
    const summary = summarizeChat([{ author: "alice", body: "lgtm" }]);
    expect(summary).toContain("1 message)");
    expect(summary).not.toContain("1 messages");
  });

  it("preserves comment order in the digest", () => {
    const summary = summarizeChat([
      { author: "alice", body: "first" },
      { author: "bob", body: "second" },
      { author: "alice", body: "third" },
    ]);

    expect(summary!.indexOf("first")).toBeLessThan(summary!.indexOf("second"));
    expect(summary!.indexOf("second")).toBeLessThan(summary!.indexOf("third"));
  });

  it("caps the digest at 900 characters", () => {
    const longBody = "x".repeat(2000);
    const summary = summarizeChat([{ author: "alice", body: longBody }]);

    expect(summary!.length).toBe(900);
  });
});
