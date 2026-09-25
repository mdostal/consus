import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SurveyCreateForm } from "./SurveyCreateForm";

function jsonRes(status: number, body: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

const DECISIONS = [
  { id: "d-1", title: "Ship v1?" },
  { id: "d-2", title: "Which DAG engine?" },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SurveyCreateForm", () => {
  it("starts collapsed behind a '+ New survey' trigger", () => {
    render(<SurveyCreateForm availableDecisions={DECISIONS} onCreated={vi.fn()} />);
    expect(screen.getByRole("button", { name: /new survey/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/survey title/i)).not.toBeInTheDocument();
  });

  it("opens the form and lists every available decision as a checkbox", () => {
    render(<SurveyCreateForm availableDecisions={DECISIONS} onCreated={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /new survey/i }));

    expect(screen.getByLabelText(/survey title/i)).toBeInTheDocument();
    expect(screen.getByText("Ship v1?")).toBeInTheDocument();
    expect(screen.getByText("Which DAG engine?")).toBeInTheDocument();
  });

  it("creates a survey with the selected decisions, no raw API calls needed by the operator", async () => {
    const fn = vi.fn(() => jsonRes(201, { id: "s-new", title: "My Survey" }));
    vi.stubGlobal("fetch", fn);
    const onCreated = vi.fn();

    render(<SurveyCreateForm availableDecisions={DECISIONS} onCreated={onCreated} />);
    fireEvent.click(screen.getByRole("button", { name: /new survey/i }));

    fireEvent.change(screen.getByLabelText(/survey title/i), { target: { value: "My Survey" } });
    fireEvent.click(screen.getByText("Ship v1?"));
    fireEvent.click(screen.getByRole("button", { name: /^create survey$/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: "s-new", title: "My Survey" }));

    const [, init] = fn.mock.calls[0];
    expect(JSON.parse(init.body as string)).toEqual({ title: "My Survey", decision_ids: ["d-1"] });
  });

  it("disables Create until a title is entered", () => {
    render(<SurveyCreateForm availableDecisions={DECISIONS} onCreated={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /new survey/i }));
    expect(screen.getByRole("button", { name: /^create survey$/i })).toBeDisabled();
  });

  it("shows a real error and keeps the form open when creation fails", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonRes(400, { error: "title is required" })));

    render(<SurveyCreateForm availableDecisions={DECISIONS} onCreated={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /new survey/i }));
    fireEvent.change(screen.getByLabelText(/survey title/i), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /^create survey$/i }));

    await waitFor(() => expect(screen.getByText(/could not create survey/i)).toBeInTheDocument());
    expect(screen.getByLabelText(/survey title/i)).toBeInTheDocument();
  });

  it("collapses back to the trigger on Cancel without creating anything", () => {
    render(<SurveyCreateForm availableDecisions={DECISIONS} onCreated={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /new survey/i }));
    fireEvent.change(screen.getByLabelText(/survey title/i), { target: { value: "Draft" } });
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.getByRole("button", { name: /new survey/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/survey title/i)).not.toBeInTheDocument();
  });
});
