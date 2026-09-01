import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SurveyView } from "./SurveyView";
import type { SurveyDecisionItem } from "./SurveyView";

const PAYLOAD_V1 = {
  version: "dostal:decision-request/v1" as const,
  title: "Ship v1?",
  context: "ctx",
  options: [
    { id: "A", title: "Yes", tradeoffs: "fast" },
    { id: "B", title: "No", tradeoffs: "safe" },
  ],
  recommended: "A",
};

const MEMBER_OPEN: SurveyDecisionItem = {
  id: "m-1",
  title: "Ship now or wait?",
  status: "open",
  decided_at: null,
  decision_payload: PAYLOAD_V1,
  source_repo: null,
};

const MEMBER_OPEN_2: SurveyDecisionItem = {
  id: "m-2",
  title: "Which DAG engine?",
  status: "open",
  decided_at: null,
  decision_payload: {
    version: "dostal:decision-request/v1",
    title: "Which DAG engine?",
    context: "ctx",
    options: [
      { id: "A", title: "React Flow", tradeoffs: "+ own JSON" },
      { id: "B", title: "tldraw", tradeoffs: "+ best canvas" },
    ],
    recommended: "A",
  },
  source_repo: null,
};

const MEMBER_DECIDED: SurveyDecisionItem = {
  id: "m-3",
  title: "Already answered?",
  status: "approved",
  decided_at: "2026-08-01T12:00:00Z",
  decision_payload: PAYLOAD_V1,
  source_repo: null,
};

function makeFetch(members: SurveyDecisionItem[]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(members),
  });
}

describe("SurveyView", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("renders the survey title and a loading state before members load", () => {
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<SurveyView surveyId="s-1" surveyTitle="Design Sprint Q&A" />);
    expect(screen.getByText("Design Sprint Q&A")).toBeInTheDocument();
    expect(screen.getByText(/loading survey/i)).toBeInTheDocument();
  });

  it("shows '0 of N answered' progress indicator on load", async () => {
    globalThis.fetch = makeFetch([MEMBER_OPEN, MEMBER_OPEN_2]);
    render(<SurveyView surveyId="s-1" surveyTitle="My Survey" />);
    await waitFor(() => expect(screen.queryByText(/loading survey/i)).not.toBeInTheDocument());
    expect(screen.getByText("0 of 2 answered")).toBeInTheDocument();
  });

  it("renders a DecisionCard for each open member", async () => {
    globalThis.fetch = makeFetch([MEMBER_OPEN, MEMBER_OPEN_2]);
    render(<SurveyView surveyId="s-1" surveyTitle="My Survey" />);
    await waitFor(() => expect(screen.queryByText(/loading survey/i)).not.toBeInTheDocument());
    expect(screen.getByText("Ship now or wait?")).toBeInTheDocument();
    expect(screen.getByText("Which DAG engine?")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /accept/i })).toHaveLength(2);
  });

  it("marks pre-decided members as answered without a decision card", async () => {
    globalThis.fetch = makeFetch([MEMBER_OPEN, MEMBER_DECIDED]);
    render(<SurveyView surveyId="s-1" surveyTitle="Mixed Survey" />);
    await waitFor(() => expect(screen.queryByText(/loading survey/i)).not.toBeInTheDocument());

    expect(screen.getByText("1 of 2 answered")).toBeInTheDocument();
    expect(screen.getByTestId("answered-badge-m-3")).toBeInTheDocument();
  });

  it("updates progress when a verdict is submitted", async () => {
    globalThis.fetch = makeFetch([MEMBER_OPEN, MEMBER_OPEN_2]);
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([MEMBER_OPEN, MEMBER_OPEN_2]) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

    render(<SurveyView surveyId="s-1" surveyTitle="Progress Test" />);
    await waitFor(() => screen.getAllByRole("button", { name: /accept/i }));

    const acceptBtns = screen.getAllByRole("button", { name: /accept/i });
    fireEvent.click(acceptBtns[0]);

    await waitFor(() => expect(screen.getByText("1 of 2 answered")).toBeInTheDocument());
    expect(screen.getByTestId("verdict-recorded-m-1")).toBeInTheDocument();
  });

  it("shows 'Survey complete' and verdict summary when all members are answered", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([MEMBER_OPEN]) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

    render(<SurveyView surveyId="s-1" surveyTitle="Solo Survey" />);
    await waitFor(() => screen.getByRole("button", { name: /accept/i }));

    fireEvent.click(screen.getByRole("button", { name: /accept/i }));

    await waitFor(() => expect(screen.getByTestId("survey-complete")).toBeInTheDocument());
    expect(screen.getByText(/survey complete/i)).toBeInTheDocument();
    // "Accepted the recommended option" appears in both the summary and the recorded badge
    expect(screen.getAllByText(/accepted the recommended option/i).length).toBeGreaterThan(0);
  });

  it("calls onVerdictRecorded after a successful verdict submission", async () => {
    const onVerdictRecorded = vi.fn();
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([MEMBER_OPEN]) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

    render(<SurveyView surveyId="s-1" surveyTitle="Callback Test" onVerdictRecorded={onVerdictRecorded} />);
    await waitFor(() => screen.getByRole("button", { name: /accept/i }));

    fireEvent.click(screen.getByRole("button", { name: /accept/i }));

    await waitFor(() => expect(onVerdictRecorded).toHaveBeenCalledOnce());
  });

  it("shows an error message when verdict submission fails", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([MEMBER_OPEN]) })
      .mockResolvedValueOnce({ ok: false, status: 500 });

    render(<SurveyView surveyId="s-1" surveyTitle="Error Test" />);
    await waitFor(() => screen.getByRole("button", { name: /accept/i }));

    fireEvent.click(screen.getByRole("button", { name: /accept/i }));

    await waitFor(() => expect(screen.getByTestId("submit-error-m-1")).toBeInTheDocument());
    expect(screen.getByText(/could not record decision/i)).toBeInTheDocument();
  });

  it("shows a fetch error when the member load fails", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    render(<SurveyView surveyId="s-bad" surveyTitle="Broken Survey" />);
    await waitFor(() => expect(screen.getByText(/could not load survey members/i)).toBeInTheDocument());
  });

  it("works with both decision-request/v1 and feature-selection/v1 members (duck-typed via DecisionCard)", async () => {
    const featurePayload = {
      version: "dostal:feature-selection/v1" as unknown as "dostal:decision-request/v1",
      title: "Pick features",
      context: "ctx",
      options: [
        { id: "A", title: "Feature Alpha", tradeoffs: "" },
        { id: "B", title: "Feature Beta", tradeoffs: "" },
      ],
      recommended: "A",
    };
    const featureMember: SurveyDecisionItem = {
      id: "m-feature",
      title: "Which features to ship?",
      status: "open",
      decided_at: null,
      decision_payload: featurePayload,
      source_repo: null,
    };

    globalThis.fetch = makeFetch([MEMBER_OPEN, featureMember]);
    render(<SurveyView surveyId="s-1" surveyTitle="Mixed Type Survey" />);
    await waitFor(() => expect(screen.queryByText(/loading survey/i)).not.toBeInTheDocument());

    expect(screen.getByText("Ship now or wait?")).toBeInTheDocument();
    expect(screen.getByText("Which features to ship?")).toBeInTheDocument();
    expect(screen.getByText("0 of 2 answered")).toBeInTheDocument();
  });

  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });
});
