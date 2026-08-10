import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FiredHistoryView } from "./FiredHistoryView";
import * as firedApi from "../../api/fired";

describe("FiredHistoryView", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows loading state initially", () => {
    vi.spyOn(firedApi, "fetchFiredTickets").mockReturnValue(new Promise(() => {}));
    render(<FiredHistoryView />);
    expect(screen.getByTestId("fired-history-loading")).toBeInTheDocument();
  });

  it("shows error state", async () => {
    vi.spyOn(firedApi, "fetchFiredTickets").mockRejectedValue(new Error("Network Error"));
    render(<FiredHistoryView />);

    await waitFor(() => {
      expect(screen.getByTestId("fired-history-error")).toHaveTextContent(
        "Couldn't load fire history right now. Network Error",
      );
    });
  });

  it("shows empty state when no tickets have been fired", async () => {
    vi.spyOn(firedApi, "fetchFiredTickets").mockResolvedValue([]);
    render(<FiredHistoryView />);

    await waitFor(() => {
      expect(screen.getByTestId("fired-history-empty")).toHaveTextContent("No tickets fired yet");
    });
  });

  it("fetches from GET /api/fired on mount and displays a table with doc, ticket, fired-by, fired-at", async () => {
    const fetchSpy = vi.spyOn(firedApi, "fetchFiredTickets").mockResolvedValue([
      {
        id: "ft-1",
        multica_issue_id: "PAN-1",
        target_repo: "consus",
        fired_by: "operator",
        fired_at: "2026-08-02T12:00:00.000Z",
        repo: "consus",
        file_path: "docs/a.md",
      },
    ]);
    render(<FiredHistoryView />);

    await waitFor(() => {
      expect(screen.getByTestId("fired-history-table")).toBeInTheDocument();
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText("consus:docs/a.md")).toBeInTheDocument();
    expect(screen.getByText("PAN-1")).toBeInTheDocument();
    expect(screen.getByText("operator")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "PAN-1" })).toHaveAttribute(
      "href",
      "/multica/issues/PAN-1",
    );
  });
});
