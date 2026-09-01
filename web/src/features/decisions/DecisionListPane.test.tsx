import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DecisionListPane, type DecisionListItem, type SurveyListItem } from "./DecisionListPane";

const OPEN_ITEM: DecisionListItem = {
  id: "item-1",
  title: "Ship v1?",
  status: "open",
  decided_at: null,
  decision_type: "go_no_go",
};

const OPEN_ITEM_2: DecisionListItem = {
  id: "item-2",
  title: "Pick a DAG engine",
  status: "open",
  decided_at: null,
  decision_type: null,
};

const DECIDED_ITEM: DecisionListItem = {
  id: "item-3",
  title: "Adopt the warm theme",
  status: "closed",
  decided_at: "2026-08-01T00:00:00Z",
  decision_type: "go_no_go",
};

const SURVEY_INCOMPLETE: SurveyListItem = {
  id: "survey-1",
  title: "Design Sprint Q&A",
  answered: 1,
  total: 3,
};

const SURVEY_COMPLETE: SurveyListItem = {
  id: "survey-2",
  title: "Architecture Review",
  answered: 2,
  total: 2,
};

describe("DecisionListPane", () => {
  it("renders grouped open/decided rows under 'Needs you (N)' / 'Decided (N)' headings", () => {
    render(
      <DecisionListPane items={[OPEN_ITEM, OPEN_ITEM_2, DECIDED_ITEM]} selectedId={null} onSelect={vi.fn()} />,
    );

    expect(screen.getByText("Needs you (2)")).toBeInTheDocument();
    expect(screen.getByText("Decided (1)")).toBeInTheDocument();
    expect(screen.getByText("Ship v1?")).toBeInTheDocument();
    expect(screen.getByText("Pick a DAG engine")).toBeInTheDocument();
    expect(screen.getByText("Adopt the warm theme")).toBeInTheDocument();
  });

  it("shows the 'Nothing waiting on you' empty state when there are no open decisions", () => {
    render(<DecisionListPane items={[DECIDED_ITEM]} selectedId={null} onSelect={vi.fn()} />);

    expect(screen.getByText("Needs you (0)")).toBeInTheDocument();
    expect(screen.getByText("Nothing waiting on you")).toBeInTheDocument();
  });

  it("omits the Decided heading entirely when there are no decided items", () => {
    render(<DecisionListPane items={[OPEN_ITEM]} selectedId={null} onSelect={vi.fn()} />);

    expect(screen.queryByText(/^Decided \(/)).not.toBeInTheDocument();
  });

  it("calls onSelect with the row's id on click", () => {
    const onSelect = vi.fn();
    render(<DecisionListPane items={[OPEN_ITEM, DECIDED_ITEM]} selectedId={null} onSelect={onSelect} />);

    fireEvent.click(screen.getByText("Ship v1?"));

    expect(onSelect).toHaveBeenCalledWith("item-1");
  });

  it("calls onSelect on Enter keydown", () => {
    const onSelect = vi.fn();
    render(<DecisionListPane items={[OPEN_ITEM, DECIDED_ITEM]} selectedId={null} onSelect={onSelect} />);

    const row = screen.getByText("Adopt the warm theme").closest('[role="option"]') as HTMLElement;
    fireEvent.keyDown(row, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledWith("item-3");
  });

  it("calls onSelect on Space keydown", () => {
    const onSelect = vi.fn();
    render(<DecisionListPane items={[OPEN_ITEM, DECIDED_ITEM]} selectedId={null} onSelect={onSelect} />);

    const row = screen.getByText("Ship v1?").closest('[role="option"]') as HTMLElement;
    fireEvent.keyDown(row, { key: " " });

    expect(onSelect).toHaveBeenCalledWith("item-1");
  });

  it("rows are keyboard-focusable (tabIndex) and expose role=option", () => {
    render(<DecisionListPane items={[OPEN_ITEM]} selectedId={null} onSelect={vi.fn()} />);

    const row = screen.getByText("Ship v1?").closest('[role="option"]') as HTMLElement;
    expect(row).toHaveAttribute("tabindex", "0");
  });

  it("marks the selected row's aria-selected=true, and other rows aria-selected=false", () => {
    render(
      <DecisionListPane items={[OPEN_ITEM, OPEN_ITEM_2]} selectedId="item-1" onSelect={vi.fn()} />,
    );

    const selectedRow = screen.getByText("Ship v1?").closest('[role="option"]') as HTMLElement;
    const otherRow = screen.getByText("Pick a DAG engine").closest('[role="option"]') as HTMLElement;

    expect(selectedRow).toHaveAttribute("aria-selected", "true");
    expect(otherRow).toHaveAttribute("aria-selected", "false");
  });
});

describe("DecisionListPane — surveys", () => {
  it("shows an incomplete survey at the top of 'Needs you' with (N/M answered) badge", () => {
    render(
      <DecisionListPane
        items={[OPEN_ITEM]}
        selectedId={null}
        onSelect={vi.fn()}
        surveys={[SURVEY_INCOMPLETE]}
        onSelectSurvey={vi.fn()}
      />,
    );

    expect(screen.getByText("Design Sprint Q&A")).toBeInTheDocument();
    expect(screen.getByTestId("survey-badge-survey-1")).toHaveTextContent("1/3 answered");
  });

  it("counts incomplete surveys toward 'Needs you (N)'", () => {
    render(
      <DecisionListPane
        items={[OPEN_ITEM]}
        selectedId={null}
        onSelect={vi.fn()}
        surveys={[SURVEY_INCOMPLETE]}
        onSelectSurvey={vi.fn()}
      />,
    );

    expect(screen.getByText("Needs you (2)")).toBeInTheDocument();
  });

  it("moves a complete survey into the 'Decided' group", () => {
    render(
      <DecisionListPane
        items={[OPEN_ITEM]}
        selectedId={null}
        onSelect={vi.fn()}
        surveys={[SURVEY_COMPLETE]}
        onSelectSurvey={vi.fn()}
      />,
    );

    expect(screen.getByText("Decided (1)")).toBeInTheDocument();
    expect(screen.getByText("Architecture Review")).toBeInTheDocument();
  });

  it("calls onSelectSurvey with the survey id on click", () => {
    const onSelectSurvey = vi.fn();
    render(
      <DecisionListPane
        items={[]}
        selectedId={null}
        onSelect={vi.fn()}
        surveys={[SURVEY_INCOMPLETE]}
        onSelectSurvey={onSelectSurvey}
      />,
    );

    fireEvent.click(screen.getByText("Design Sprint Q&A"));
    expect(onSelectSurvey).toHaveBeenCalledWith("survey-1");
  });

  it("marks the selected survey's row as aria-selected=true", () => {
    render(
      <DecisionListPane
        items={[]}
        selectedId={null}
        onSelect={vi.fn()}
        surveys={[SURVEY_INCOMPLETE]}
        selectedSurveyId="survey-1"
        onSelectSurvey={vi.fn()}
      />,
    );

    const surveyRow = screen.getByTestId("survey-row-survey-1");
    expect(surveyRow).toHaveAttribute("aria-selected", "true");
  });

  it("shows 'Nothing waiting on you' when there are no open decisions and no incomplete surveys", () => {
    render(
      <DecisionListPane
        items={[DECIDED_ITEM]}
        selectedId={null}
        onSelect={vi.fn()}
        surveys={[SURVEY_COMPLETE]}
        onSelectSurvey={vi.fn()}
      />,
    );

    expect(screen.getByText("Nothing waiting on you")).toBeInTheDocument();
  });

  it("survey rows are keyboard-focusable and respond to Enter/Space", () => {
    const onSelectSurvey = vi.fn();
    render(
      <DecisionListPane
        items={[]}
        selectedId={null}
        onSelect={vi.fn()}
        surveys={[SURVEY_INCOMPLETE]}
        onSelectSurvey={onSelectSurvey}
      />,
    );

    const row = screen.getByTestId("survey-row-survey-1");
    expect(row).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(row, { key: "Enter" });
    expect(onSelectSurvey).toHaveBeenCalledWith("survey-1");

    fireEvent.keyDown(row, { key: " " });
    expect(onSelectSurvey).toHaveBeenCalledTimes(2);
  });
});
