import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { RankingList } from "../features/decisions/answer-shapes/RankingList";
import { RatingScale } from "../features/decisions/answer-shapes/RatingScale";
import { SurveyCreateForm } from "../features/decisions/surveys/SurveyCreateForm";
import { SurveyView, type SurveyDecisionItem } from "../features/decisions/SurveyView";
import type { RankingPayload, RatingPayload } from "../features/decisions/answer-shapes/types";

/**
 * PANT-812: keyboard-only walkthroughs (Tab / Enter / Space, no clicks) for
 * the ranking control, the rating scale, survey creation and the survey
 * stepper, plus the focus moves each of them now makes.
 */

/** Presses Tab until the focused element has `name` (exact accessible name
 *  via its aria-label or text), failing if it is never reached. */
async function tabTo(user: UserEvent, name: string | RegExp, maxTabs = 80) {
  const matches = (el: Element | null) => {
    if (!el || el === document.body) return false;
    const label = el.getAttribute("aria-label") ?? el.textContent ?? "";
    return typeof name === "string" ? label.trim() === name : name.test(label);
  };
  for (let i = 0; i < maxTabs && !matches(document.activeElement); i += 1) {
    await user.tab();
  }
  expect(matches(document.activeElement), `never reached ${String(name)} by Tab`).toBe(true);
}

function labelsInOrder(): string[] {
  return Array.from(document.querySelectorAll(".ranking-list__item-label")).map((el) => el.textContent ?? "");
}

const RANKING: RankingPayload = {
  version: "dostal:ranking/v1",
  title: "Rank",
  context: "ctx",
  prompt: "Rank from most to least important",
  items: [
    { id: "perf", label: "Performance" },
    { id: "a11y", label: "Accessibility" },
    { id: "i18n", label: "Internationalization" },
  ],
};

const RATING: RatingPayload = {
  version: "dostal:rating/v1",
  title: "Rate",
  context: "ctx",
  prompt: "How confident are you?",
  scale: { min: 1, max: 5, labels: { 1: "Poor", 5: "Excellent" } },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("keyboard — RankingList", () => {
  it("reorders and submits by keyboard alone, keeping focus on the moved item", async () => {
    const user = userEvent.setup();
    const onVerdict = vi.fn();
    render(<RankingList payload={RANKING} onVerdict={onVerdict} />);

    await tabTo(user, "Move Internationalization up");
    await user.keyboard("{Enter}");
    expect(labelsInOrder()).toEqual(["Performance", "Internationalization", "Accessibility"]);
    expect(screen.getByRole("button", { name: "Move Internationalization up" })).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(labelsInOrder()).toEqual(["Internationalization", "Performance", "Accessibility"]);
    // Reaching the top disables the pressed button; focus moves to the same
    // row's other button rather than dropping to <body>.
    expect(screen.getByRole("button", { name: "Move Internationalization up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Internationalization down" })).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Internationalization moved to position 1 of 3.");

    await tabTo(user, "Submit ranking");
    await user.keyboard("{Enter}");
    expect(onVerdict).toHaveBeenCalledWith({ kind: "ranked", order: ["i18n", "perf", "a11y"] });
  });
});

describe("keyboard — RatingScale", () => {
  it("selects a value with Space and submits with Enter", async () => {
    const user = userEvent.setup();
    const onVerdict = vi.fn();
    render(<RatingScale payload={RATING} onVerdict={onVerdict} />);

    await tabTo(user, "4");
    await user.keyboard(" ");
    expect(screen.getByRole("button", { name: "4" })).toHaveAttribute("aria-pressed", "true");

    await tabTo(user, "Submit rating");
    await user.keyboard("{Enter}");
    expect(onVerdict).toHaveBeenCalledWith({ kind: "rated", value: 4 });
  });
});

describe("keyboard — SurveyCreateForm", () => {
  it("opening moves focus to the title field and Enter creates the survey", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, status: 201, json: async () => ({ id: "s-new", title: "Q3" }) })),
    );
    const user = userEvent.setup();
    const onCreated = vi.fn();
    render(<SurveyCreateForm availableDecisions={[{ id: "d-1", title: "Ship v1?" }]} onCreated={onCreated} />);

    await tabTo(user, "+ New survey");
    await user.keyboard("{Enter}");
    expect(screen.getByLabelText("Survey title")).toHaveFocus();

    await user.keyboard("Q3{Enter}");
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: "s-new", title: "Q3" }));
  });

  it("cancelling returns focus to the '+ New survey' trigger", async () => {
    const user = userEvent.setup();
    render(<SurveyCreateForm availableDecisions={[]} onCreated={vi.fn()} />);

    await tabTo(user, "+ New survey");
    await user.keyboard("{Enter}");
    await tabTo(user, "Cancel");
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: /new survey/i })).toHaveFocus();
  });
});

describe("keyboard — SurveyView stepper", () => {
  const members: SurveyDecisionItem[] = [
    {
      id: "m-rank",
      title: "Rank the priorities",
      status: "open",
      decided_at: null,
      decision_payload: RANKING as unknown as SurveyDecisionItem["decision_payload"],
      source_repo: null,
    },
    {
      id: "m-ship",
      title: "Ship now or wait?",
      status: "open",
      decided_at: null,
      decision_payload: {
        version: "dostal:decision-request/v1",
        title: "Ship now or wait?",
        context: "ctx",
        options: [
          { id: "A", title: "Ship", tradeoffs: "fast" },
          { id: "B", title: "Wait", tradeoffs: "safe" },
        ],
        recommended: "A",
      },
      source_repo: null,
    },
  ];

  function stubSurveyFetch() {
    const verdicts: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.startsWith("/api/decisions?survey=")) return Promise.resolve({ ok: true, json: async () => members });
        if (init?.method === "POST") verdicts.push({ url, body: JSON.parse(init.body as string) });
        return Promise.resolve({ ok: true, json: async () => [] });
      }),
    );
    return verdicts;
  }

  it("focuses the survey heading on mount when asked to (right after creation)", async () => {
    stubSurveyFetch();
    render(<SurveyView surveyId="s-1" surveyTitle="Q3 planning" focusHeadingOnMount />);
    expect(screen.getByRole("heading", { name: "Q3 planning" })).toHaveFocus();
    // Focus survives the loading -> loaded transition.
    await screen.findByText("Ship now or wait?");
    expect(screen.getByRole("heading", { name: "Q3 planning" })).toHaveFocus();
  });

  it("does not steal focus when opened normally", async () => {
    stubSurveyFetch();
    render(<SurveyView surveyId="s-1" surveyTitle="Q3 planning" />);
    await screen.findByText("Ship now or wait?");
    expect(document.body).toHaveFocus();
  });

  it("answers every member by keyboard alone, and focus follows each recorded answer", async () => {
    const verdicts = stubSurveyFetch();
    const user = userEvent.setup();
    render(<SurveyView surveyId="s-1" surveyTitle="Q3 planning" focusHeadingOnMount />);
    await screen.findByText("Ship now or wait?");

    // Member 1: ranking.
    await tabTo(user, "Move Accessibility up");
    await user.keyboard("{Enter}");
    await tabTo(user, "Submit ranking");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByText("1 of 2 answered")).toBeInTheDocument());
    expect(screen.getByTestId("verdict-recorded-m-rank")).toHaveFocus();
    expect(verdicts[0]).toMatchObject({
      url: "/api/decisions/m-rank/verdict",
      body: { verdict: { kind: "ranked", order: ["a11y", "perf", "i18n"] } },
    });

    // Member 2: Tab carries on from the recorded note to the next question.
    await tabTo(user, "Accept");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByText("2 of 2 answered")).toBeInTheDocument());
    expect(screen.getByTestId("verdict-recorded-m-ship")).toHaveFocus();
    expect(screen.getByTestId("survey-complete")).toBeInTheDocument();
  });
});
