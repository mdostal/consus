import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SurveyGroup } from "./SurveyGroup";

const PAYLOAD = (title: string) => ({
  version: "dostal:decision-request/v1" as const,
  title,
  context: "",
  options: [
    { id: "A", title: "Yes", tradeoffs: "" },
    { id: "B", title: "No", tradeoffs: "" },
  ],
  recommended: "A",
});

const SURVEY = {
  title: "Client hub feature survey",
  progress: { answered: 1, total: 3, status: "open" as const },
  questions: [
    { minervaQuestionId: "q-1", text: "Include dark mode?", status: "answered", decisionPayload: PAYLOAD("Include dark mode?") },
    { minervaQuestionId: "q-2", text: "Include export-to-PDF?", status: "open", decisionPayload: PAYLOAD("Include export-to-PDF?") },
    { minervaQuestionId: "q-3", text: "Include SSO?", status: "open", decisionPayload: PAYLOAD("Include SSO?") },
  ],
};

describe("SurveyGroup", () => {
  it("groups a survey's sub-questions together, not interleaved with unrelated queue items", () => {
    render(<SurveyGroup survey={SURVEY} onAnswer={vi.fn()} />);

    expect(screen.getByText("Client hub feature survey")).toBeInTheDocument();
    expect(screen.getByText(/Include dark mode\?/)).toBeInTheDocument();
    expect(screen.getByText(/Include export-to-PDF\?/)).toBeInTheDocument();
    expect(screen.getByText(/Include SSO\?/)).toBeInTheDocument();
  });

  it("shows visible batch-completion progress", () => {
    render(<SurveyGroup survey={SURVEY} onAnswer={vi.fn()} />);

    expect(screen.getByText(/1 of 3 answered/i)).toBeInTheDocument();
  });

  it("renders each sub-question through the shared DecisionCard, not a bespoke answer UI", () => {
    render(<SurveyGroup survey={SURVEY} onAnswer={vi.fn()} />);

    const acceptButtons = screen.getAllByRole("button", { name: /accept/i });
    expect(acceptButtons).toHaveLength(3);
  });

  it("calls onAnswer with the question id and verdict", () => {
    const onAnswer = vi.fn();
    render(<SurveyGroup survey={SURVEY} onAnswer={onAnswer} />);

    fireEvent.click(screen.getAllByRole("button", { name: /accept/i })[1]);

    expect(onAnswer).toHaveBeenCalledWith("q-2", { kind: "accepted" });
  });
});
