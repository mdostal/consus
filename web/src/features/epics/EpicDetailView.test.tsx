import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EpicDetailView } from "./EpicDetailView";
import * as epicsApi from "../../api/epics";

vi.mock("../../components/DiagramView", () => ({
  DiagramView: ({ type, repo_id }: { type: string; repo_id?: string }) => (
    <div data-testid={`mock-diagram-${type}`}>{repo_id}</div>
  ),
}));

const epic: epicsApi.EpicDetail = {
  id: "m1",
  title: "slice-2 detail surface",
  status: "in_progress",
  repo_id: "consus",
  last_updated: "2026-08-10T12:00:00.000Z",
  docs: [
    { kind: "design-discussion", title: "Design Discussion", content: "Design notes" },
    { kind: "research-brief", title: "Research Brief", content: "Research notes" },
    { kind: "outline", title: "Outline", content: "Outline notes" },
  ],
  stories: [
    {
      id: "s1",
      title: "Build stories table",
      status: "todo",
      dependencies: ["s0"],
      tracker_url: "https://multica.local/issues/PAN-2",
    },
  ],
};

function renderDetail(path = "/epics/m1") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/epics/:epic_id" element={<EpicDetailView />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("EpicDetailView", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(epicsApi, "fetchEpicDetail").mockResolvedValue(epic);
    vi.spyOn(epicsApi, "approveEpic").mockResolvedValue({ ok: true, status: "todo", comment_id: "c1" });
  });

  it("loads the epic header and renders cascade plus repo architecture diagrams side by side", async () => {
    renderDetail();

    expect(await screen.findByText("slice-2 detail surface")).toBeInTheDocument();
    expect(screen.getByTestId("epic-detail-status")).toHaveTextContent("in_progress");
    expect(screen.getByTestId("mock-diagram-cascade")).toHaveTextContent("consus");
    expect(screen.getByTestId("mock-diagram-repo-architecture")).toHaveTextContent("consus");
  });

  it("switches through Docs and Stories tabs", async () => {
    renderDetail();
    await screen.findByText("slice-2 detail surface");

    fireEvent.click(screen.getByRole("tab", { name: "Docs" }));
    expect(screen.getByTestId("epic-doc-design-discussion")).toHaveTextContent("Design notes");

    fireEvent.click(screen.getByRole("tab", { name: "Stories" }));
    expect(screen.getByText("Build stories table")).toBeInTheDocument();
    expect(screen.getByText("s0")).toBeInTheDocument();
  });

  it("posts approval from the Decisions tab and updates the header status", async () => {
    renderDetail();
    await screen.findByText("slice-2 detail surface");

    fireEvent.click(screen.getByRole("tab", { name: "Decisions" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Approve" })[0]);

    await waitFor(() => expect(epicsApi.approveEpic).toHaveBeenCalledWith("m1"));
    expect(screen.getByTestId("epic-detail-status")).toHaveTextContent("todo");
  });
});
