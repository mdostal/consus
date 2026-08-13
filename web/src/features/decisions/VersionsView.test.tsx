import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { VersionsView } from "./VersionsView";

describe("VersionsView", () => {
  it("shows the original content with an empty state when there are no prior iterate-requests, not an error", () => {
    render(<VersionsView originalContent="Ship v1?" entries={[]} />);

    expect(screen.getByText("Ship v1?")).toBeInTheDocument();
    expect(screen.getByText(/no iterate requests yet/i)).toBeInTheDocument();
  });

  it("lists each iterate-request (prompt, scope, timestamp, agent) alongside the original content", () => {
    render(
      <VersionsView
        originalContent="Ship v1?"
        entries={[
          {
            log_id: "log-1",
            timestamp: "2026-08-13T00:00:00Z",
            actor: "mathew",
            prompt: "redo the summary",
            scope: { section: "risks" },
            agent: { id: "a-1", name: "researcher" },
            comment_id: "c-1",
            status_set: null,
            previous_status: null,
          },
        ]}
      />,
    );

    expect(screen.getByText("Ship v1?")).toBeInTheDocument();
    expect(screen.getByText(/redo the summary/)).toBeInTheDocument();
    expect(screen.getByText(/researcher/)).toBeInTheDocument();
    expect(screen.getByText(/section: risks/)).toBeInTheDocument();
  });

  it("does NOT render a diff/comparison UI — REQ-18 is explicitly out of scope here", () => {
    const { container } = render(
      <VersionsView
        originalContent="Ship v1?"
        entries={[
          {
            log_id: "log-1",
            timestamp: "2026-08-13T00:00:00Z",
            actor: "mathew",
            prompt: "p",
            scope: null,
            agent: null,
            comment_id: "c-1",
            status_set: null,
            previous_status: null,
          },
        ]}
      />,
    );

    expect(container.querySelector("[data-diff]")).toBeNull();
    expect(container.querySelector(".diff")).toBeNull();
  });
});
