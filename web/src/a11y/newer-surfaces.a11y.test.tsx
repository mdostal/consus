import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "./axe";
import { SurveyCreateForm } from "../features/decisions/surveys/SurveyCreateForm";
import { SurveyView, type SurveyDecisionItem } from "../features/decisions/SurveyView";
import { ArtifactLinksPanel } from "../features/artifact-links/ArtifactLinksPanel";
import { CommentsPanel } from "../features/comments/CommentsPanel";
import { AttachmentsPanel } from "../features/decisions/attachments/AttachmentsPanel";
import { AnswerControl, type AnswerControlProps } from "../features/decisions/answer-shapes/AnswerControl";

/**
 * PANT-812: axe (vitest-axe, jsdom) coverage for the surfaces that shipped
 * after the last two accessibility passes (consus-phase20 diagram editor +
 * command palette, consus-phase28 attachments + visual diffs) -- the survey
 * creation form, SurveyView's member cards with their mounted supporting
 * panels, the standalone ArtifactLinksPanel, and all eight answer shapes.
 *
 * color-contrast is not checked here (see ./axe.ts) -- it stays a
 * real-browser check.
 */

function jsonRes(status: number, body: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
}

/** Routes every GET the supporting panels fire; anything unknown is an empty list. */
function panelsFetchMock(members: SurveyDecisionItem[] = []) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.startsWith("/api/decisions?survey=")) return jsonRes(200, members);
    if (url.endsWith("/comments")) {
      return jsonRes(200, [{ id: 1, author: "Mathew", body: "Looks right", createdAt: "2026-09-01T00:00:00Z" }]);
    }
    if (url.endsWith("/artifact-links")) return jsonRes(200, [{ id: 1, url: "https://claude.ai/artifact/abc", label: "CBA" }]);
    if (url.endsWith("/attachments")) {
      return jsonRes(200, [
        {
          id: "att-1",
          item_id: "m-1",
          file_name: "notes.txt",
          mime_type: "text/plain",
          size: 12,
          actor: "Mathew",
          created_at: "2026-09-01T00:00:00Z",
        },
      ]);
    }
    return jsonRes(200, []);
  });
}

const PAYLOADS: Record<string, AnswerControlProps["payload"]> = {
  "decision request": {
    version: "dostal:decision-request/v1",
    title: "Ship v1?",
    context: "ctx",
    options: [
      { id: "A", title: "Yes", tradeoffs: "fast" },
      { id: "B", title: "No", tradeoffs: "safe" },
    ],
    recommended: "A",
  },
  "feature checklist": {
    version: "dostal:feature-selection/v1",
    title: "Which features?",
    context: "ctx",
    features: [
      { id: "f1", name: "Search", description: "Full-text search", default: true },
      { id: "f2", name: "Export", description: "CSV export" },
    ],
  },
  rating: {
    version: "dostal:rating/v1",
    title: "Rate it",
    context: "ctx",
    prompt: "How confident are you?",
    scale: { min: 1, max: 5, labels: { 1: "Poor", 5: "Excellent" } },
  },
  ranking: {
    version: "dostal:ranking/v1",
    title: "Rank",
    context: "ctx",
    prompt: "Rank from most to least important",
    items: [
      { id: "perf", label: "Performance" },
      { id: "a11y", label: "Accessibility" },
      { id: "i18n", label: "Internationalization" },
    ],
  },
  "concept selection": {
    version: "dostal:concept-selection/v1",
    title: "Pick a mark",
    context: "ctx",
    concepts: [
      {
        id: "c1",
        name: "Keystone",
        description: "A keystone arch",
        preview: { kind: "svg", markup: '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>' },
      },
      {
        id: "c2",
        name: "Ledger",
        description: "Ruled lines",
        preview: { kind: "svg", markup: '<svg viewBox="0 0 10 10"><line x1="0" y1="5" x2="10" y2="5"/></svg>' },
      },
    ],
  },
  "free text": {
    version: "dostal:free-text/v1",
    title: "Thoughts?",
    context: "ctx",
    prompt: "What would you change?",
  },
  "edit proposal": {
    version: "dostal:edit-proposal/v1",
    title: "Edit",
    context: "ctx",
    original: "one\ntwo",
    proposed: "one\nthree",
  },
  CBA: {
    version: "dostal:cba/v1",
    title: "CBA",
    context: "ctx",
    options: [
      { option: "Build", cost: "High", benefit: "Control" },
      { option: "Buy", cost: "Low", benefit: "Speed", notes: "Vendor lock-in" },
    ],
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a11y (axe) — answer-shape controls", () => {
  it("covers all eight answer shapes", () => {
    expect(Object.keys(PAYLOADS)).toHaveLength(8);
  });

  for (const [name, payload] of Object.entries(PAYLOADS)) {
    it(`${name} has no axe violations`, async () => {
      const { container } = render(<AnswerControl payload={payload} onVerdict={vi.fn()} />);
      expect(await axe(container)).toHaveNoViolations();
    });
  }

  it("two free-text controls on one page (e.g. two survey members) have no axe violations", async () => {
    const { container } = render(
      <>
        <AnswerControl payload={PAYLOADS["free text"]} onVerdict={vi.fn()} />
        <AnswerControl payload={PAYLOADS["free text"]} onVerdict={vi.fn()} />
      </>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("a11y (axe) — survey creation form", () => {
  it("collapsed trigger has no axe violations", async () => {
    const { container } = render(<SurveyCreateForm availableDecisions={[]} onCreated={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("open form, with decisions and an error, has no axe violations", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonRes(500, { error: "boom" })));
    const user = userEvent.setup();
    const { container } = render(
      <SurveyCreateForm
        availableDecisions={[
          { id: "d-1", title: "Ship v1?" },
          { id: "d-2", title: "Which DAG engine?" },
        ]}
        onCreated={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /new survey/i }));
    await user.type(screen.getByLabelText(/survey title/i), "Q3");
    await user.click(screen.getByRole("button", { name: /create survey/i }));
    await screen.findByText(/could not create survey/i);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("a11y (axe) — supporting panels", () => {
  it("ArtifactLinksPanel (as mounted in DecisionView) has no axe violations", async () => {
    vi.stubGlobal("fetch", panelsFetchMock());
    const { container } = render(<ArtifactLinksPanel itemId="m-1" />);
    await screen.findByRole("link", { name: /CBA/ });
    expect(await axe(container)).toHaveNoViolations();
  });

  it("CommentsPanel has no axe violations", async () => {
    vi.stubGlobal("fetch", panelsFetchMock());
    const { container } = render(<CommentsPanel itemId="m-1" />);
    await screen.findByText("Looks right");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("AttachmentsPanel has no axe violations", async () => {
    vi.stubGlobal("fetch", panelsFetchMock());
    const { container } = render(<AttachmentsPanel itemId="m-1" />);
    await screen.findByText("notes.txt");
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("a11y (axe) — SurveyView member cards", () => {
  const members: SurveyDecisionItem[] = [
    {
      id: "m-1",
      title: "Ship now or wait?",
      status: "open",
      decided_at: null,
      decision_payload: PAYLOADS["decision request"] as SurveyDecisionItem["decision_payload"],
      source_repo: null,
    },
    {
      id: "m-2",
      title: "Rank these",
      status: "open",
      decided_at: null,
      decision_payload: PAYLOADS.ranking as SurveyDecisionItem["decision_payload"],
      source_repo: null,
    },
    {
      id: "m-3",
      title: "Your thoughts",
      status: "open",
      decided_at: null,
      decision_payload: PAYLOADS["free text"] as SurveyDecisionItem["decision_payload"],
      source_repo: null,
    },
  ];

  it("with every member's supporting material expanded, has no axe violations", async () => {
    vi.stubGlobal("fetch", panelsFetchMock(members));
    const { container } = render(<SurveyView surveyId="s-1" surveyTitle="Q3 planning" />);
    await screen.findByText("Ship now or wait?");
    for (const details of Array.from(container.querySelectorAll("details"))) details.open = true;
    await waitFor(() => expect(screen.getAllByText("notes.txt")).toHaveLength(members.length));
    expect(await axe(container)).toHaveNoViolations();
  });
});
