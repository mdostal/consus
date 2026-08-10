import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { EpicCard } from "./EpicCard";

describe("EpicCard", () => {
  it("renders epic details", () => {
    render(
      <EpicCard
        epic={{
          id: "1",
          title: "My Epic",
          status: "in_progress",
          story_count: 5,
          last_updated: "2026-08-10T12:00:00.000Z",
        }}
      />
    );

    expect(screen.getByText("My Epic")).toBeInTheDocument();
    expect(screen.getByTestId("epic-status")).toHaveTextContent("Status: in_progress");
    expect(screen.getByTestId("epic-stories")).toHaveTextContent("Stories: 5");
    expect(screen.getByTestId("epic-updated")).toHaveTextContent("Updated: 8/10/2026");
  });
});
