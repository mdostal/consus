import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { EpicListView } from "./EpicListView";
import * as epicsApi from "../../api/epics";

describe("EpicListView", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows loading skeleton initially", () => {
    vi.spyOn(epicsApi, "fetchEpics").mockReturnValue(new Promise(() => {}));
    render(<MemoryRouter><EpicListView /></MemoryRouter>);
    expect(screen.getByTestId("epic-list-loading")).toBeInTheDocument();
  });

  it("shows error state", async () => {
    vi.spyOn(epicsApi, "fetchEpics").mockRejectedValue(new Error("Network Error"));
    render(<MemoryRouter><EpicListView /></MemoryRouter>);
    
    await waitFor(() => {
      expect(screen.getByTestId("epic-list-error")).toHaveTextContent("Couldn't load epics right now. Network Error");
    });
  });

  it("shows empty state", async () => {
    vi.spyOn(epicsApi, "fetchEpics").mockResolvedValue([]);
    render(<MemoryRouter><EpicListView /></MemoryRouter>);
    
    await waitFor(() => {
      expect(screen.getByTestId("epic-list-empty")).toHaveTextContent("No epics yet");
    });
  });

  it("shows epic list", async () => {
    vi.spyOn(epicsApi, "fetchEpics").mockResolvedValue([
      { id: "e1", title: "Epic 1", status: "todo", story_count: 2, last_updated: "2026-08-10T12:00:00.000Z" }
    ]);
    render(<MemoryRouter><EpicListView /></MemoryRouter>);
    
    await waitFor(() => {
      expect(screen.getByTestId("epic-list")).toBeInTheDocument();
      expect(screen.getByText("Epic 1")).toBeInTheDocument();
    });
  });
});
