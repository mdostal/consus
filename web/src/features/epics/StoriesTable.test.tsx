import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoriesTable } from "./StoriesTable";

describe("StoriesTable", () => {
  it("renders story statuses, dependencies, and tracker links", () => {
    render(
      <StoriesTable
        stories={[
          {
            id: "s1",
            title: "Build detail tabs",
            status: "todo",
            dependencies: ["s0"],
            tracker_url: "https://multica.local/issues/PAN-1",
          },
        ]}
      />,
    );

    expect(screen.getByText("Build detail tabs")).toBeInTheDocument();
    expect(screen.getByTestId("story-status-badge")).toHaveTextContent("todo");
    expect(screen.getByText("s0")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("href", "https://multica.local/issues/PAN-1");
  });
});
