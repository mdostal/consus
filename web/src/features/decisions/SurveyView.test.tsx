import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
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
  return buildSurveyFetchMock(members).fn;
}

/**
 * URL-aware fetch mock (s3): once AttachmentsPanel/ArtifactLinksPanel mount
 * per member, each member fires two more GETs (/api/items/:id/attachments,
 * /api/items/:id/artifact-links) alongside the members load and any verdict
 * POST. A call-order-based mock (mockResolvedValueOnce chains) breaks the
 * moment those extra calls land -- this routes by method+URL instead, same
 * pattern as App.test.tsx's buildDecisionsFetchMock.
 */
function buildSurveyFetchMock(members: SurveyDecisionItem[], opts: { verdict?: { ok: boolean; status?: number } } = {}) {
  const calls: { method: string; url: string }[] = [];

  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    calls.push({ method, url });

    if (method === "GET" && url.startsWith("/api/decisions?survey=")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(members) });
    }
    if (method === "POST" && /^\/api\/decisions\/[^/]+\/verdict$/.test(url)) {
      const v = opts.verdict ?? { ok: true };
      return Promise.resolve({ ok: v.ok, status: v.status ?? (v.ok ? 200 : 500), json: () => Promise.resolve({}) });
    }
    // AttachmentsPanel / ArtifactLinksPanel per-member fetches (s3) -- a
    // real empty state for every test here that isn't specifically about
    // supporting material.
    return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
  });

  return { fn, calls };
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
    globalThis.fetch = buildSurveyFetchMock([MEMBER_OPEN, MEMBER_OPEN_2]).fn;

    render(<SurveyView surveyId="s-1" surveyTitle="Progress Test" />);
    await waitFor(() => screen.getAllByRole("button", { name: /accept/i }));

    const acceptBtns = screen.getAllByRole("button", { name: /accept/i });
    fireEvent.click(acceptBtns[0]);

    await waitFor(() => expect(screen.getByText("1 of 2 answered")).toBeInTheDocument());
    expect(screen.getByTestId("verdict-recorded-m-1")).toBeInTheDocument();
  });

  it("shows 'Survey complete' and verdict summary when all members are answered", async () => {
    globalThis.fetch = buildSurveyFetchMock([MEMBER_OPEN]).fn;

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
    globalThis.fetch = buildSurveyFetchMock([MEMBER_OPEN]).fn;

    render(<SurveyView surveyId="s-1" surveyTitle="Callback Test" onVerdictRecorded={onVerdictRecorded} />);
    await waitFor(() => screen.getByRole("button", { name: /accept/i }));

    fireEvent.click(screen.getByRole("button", { name: /accept/i }));

    await waitFor(() => expect(onVerdictRecorded).toHaveBeenCalledOnce());
  });

  // consus-phase28 follow-up: found live against a real repo. Every real
  // decision id is shaped `decision:<repo>:<file_path>` (server/routes/
  // decisions.ts) and a file_path almost always contains `/` — e.g.
  // "decision:my-repo:docs/interview-prep/resignation-playbook.md". Posting
  // a verdict with that id interpolated RAW into the URL template breaks
  // Fastify's single-segment `/api/decisions/:id/verdict` route into extra
  // path segments, 404ing on literally every decision derived from a doc
  // in a subdirectory (i.e. nearly all of them). Reproduced directly via
  // curl against a live server before fixing. This test locks in the fix
  // (encodeURIComponent(itemId)) by asserting the exact URL fetched.
  it("consus-phase28 follow-up: URL-encodes a decision id containing '/' and ':' before POSTing its verdict", async () => {
    const memberWithRealisticId: SurveyDecisionItem = {
      ...MEMBER_OPEN,
      id: "decision:my-repo:docs/interview-prep/resignation-playbook.md",
    };
    const { fn: fetchMock, calls } = buildSurveyFetchMock([memberWithRealisticId]);
    globalThis.fetch = fetchMock;

    render(<SurveyView surveyId="s-1" surveyTitle="Encoding Test" />);
    await waitFor(() => screen.getByRole("button", { name: /accept/i }));

    fireEvent.click(screen.getByRole("button", { name: /accept/i }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    const verdictCall = calls.find((c) => c.method === "POST");
    expect(verdictCall?.url).toBe(
      "/api/decisions/decision%3Amy-repo%3Adocs%2Finterview-prep%2Fresignation-playbook.md/verdict",
    );
  });

  it("shows an error message when verdict submission fails", async () => {
    globalThis.fetch = buildSurveyFetchMock([MEMBER_OPEN], { verdict: { ok: false, status: 500 } }).fn;

    render(<SurveyView surveyId="s-1" surveyTitle="Error Test" />);
    await waitFor(() => screen.getByRole("button", { name: /accept/i }));

    fireEvent.click(screen.getByRole("button", { name: /accept/i }));

    await waitFor(() => expect(screen.getByTestId("submit-error-m-1")).toBeInTheDocument());
    expect(screen.getByText(/could not record decision/i)).toBeInTheDocument();
  });

  it("scopes supporting-material panels to each member -- no cross-member bleed (s3)", async () => {
    const { fn } = (() => {
      const base = buildSurveyFetchMock([MEMBER_OPEN, MEMBER_OPEN_2]);
      const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/items/m-1/attachments") {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve([
                { id: "att-1", item_id: "m-1", file_name: "m1-only.png", mime_type: "image/png", size: 10, actor: "Mathew", created_at: "2026-08-12T00:00:00Z" },
              ]),
          });
        }
        if (url === "/api/items/m-2/attachments") {
          return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        }
        return base.fn(input, init);
      });
      return { fn };
    })();
    globalThis.fetch = fn;

    render(<SurveyView surveyId="s-1" surveyTitle="Scoping Test" />);
    await waitFor(() => expect(screen.queryByText(/loading survey/i)).not.toBeInTheDocument());

    const member1 = screen.getByTestId("survey-member-m-1");
    const member2 = screen.getByTestId("survey-member-m-2");

    fireEvent.click(within(member1).getByText(/supporting material/i));
    fireEvent.click(within(member2).getByText(/supporting material/i));

    await waitFor(() => expect(within(member1).getByText("m1-only.png")).toBeInTheDocument());
    expect(within(member2).queryByText("m1-only.png")).not.toBeInTheDocument();
    expect(within(member2).getByText(/no attachments/i)).toBeInTheDocument();
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
      features: [
        { id: "alpha", name: "Feature Alpha", description: "First feature" },
        { id: "beta", name: "Feature Beta", description: "Second feature" },
      ],
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
