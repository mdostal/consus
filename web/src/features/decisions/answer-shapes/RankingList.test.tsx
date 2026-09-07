import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RankingList } from "./RankingList";
import type { RankingPayload } from "./types";

const PAYLOAD: RankingPayload = {
  version: "dostal:ranking/v1",
  title: "Rank these launch priorities",
  context: "Order matters for the roadmap.",
  prompt: "Drag to rank from most to least important",
  items: [
    { id: "perf", label: "Performance" },
    { id: "a11y", label: "Accessibility" },
    { id: "i18n", label: "Internationalization" },
  ],
};

describe("RankingList", () => {
  it("renders items in their original order with rank numbers", () => {
    render(<RankingList payload={PAYLOAD} onVerdict={vi.fn()} />);

    const list = screen.getByTestId("ranking-list");
    const labels = Array.from(list.querySelectorAll(".ranking-list__item-label")).map((el) => el.textContent);
    expect(labels).toEqual(["Performance", "Accessibility", "Internationalization"]);
  });

  it("submitting without reordering fires a 'ranked' verdict with the original item-id order", () => {
    const onVerdict = vi.fn();
    render(<RankingList payload={PAYLOAD} onVerdict={onVerdict} />);

    fireEvent.click(screen.getByRole("button", { name: /submit ranking/i }));
    expect(onVerdict).toHaveBeenCalledWith({ kind: "ranked", order: ["perf", "a11y", "i18n"] });
  });

  it("the up/down button fallback reorders items and the submitted order reflects it", () => {
    const onVerdict = vi.fn();
    render(<RankingList payload={PAYLOAD} onVerdict={onVerdict} />);

    // Move Accessibility (currently 2nd) up to 1st.
    fireEvent.click(screen.getByRole("button", { name: /move accessibility up/i }));

    const list = screen.getByTestId("ranking-list");
    const labelsAfterMove = Array.from(list.querySelectorAll(".ranking-list__item-label")).map((el) => el.textContent);
    expect(labelsAfterMove).toEqual(["Accessibility", "Performance", "Internationalization"]);

    fireEvent.click(screen.getByRole("button", { name: /submit ranking/i }));
    expect(onVerdict).toHaveBeenCalledWith({ kind: "ranked", order: ["a11y", "perf", "i18n"] });
  });

  it("the topmost item's up button and the bottommost item's down button are disabled", () => {
    render(<RankingList payload={PAYLOAD} onVerdict={vi.fn()} />);

    expect(screen.getByRole("button", { name: /move performance up/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /move internationalization down/i })).toBeDisabled();
  });

  it("a real HTML5 drag-and-drop gesture (dragstart -> dragover -> drop) reorders items, not just the button fallback", () => {
    const onVerdict = vi.fn();
    render(<RankingList payload={PAYLOAD} onVerdict={onVerdict} />);

    const dragSource = screen.getByTestId("ranking-item-i18n"); // 3rd item
    const dropTarget = screen.getByTestId("ranking-item-perf"); // 1st item

    fireEvent.dragStart(dragSource);
    fireEvent.dragOver(dropTarget);
    fireEvent.drop(dropTarget);

    const list = screen.getByTestId("ranking-list");
    const labelsAfterDrag = Array.from(list.querySelectorAll(".ranking-list__item-label")).map((el) => el.textContent);
    expect(labelsAfterDrag).toEqual(["Internationalization", "Performance", "Accessibility"]);

    fireEvent.click(screen.getByRole("button", { name: /submit ranking/i }));
    expect(onVerdict).toHaveBeenCalledWith({ kind: "ranked", order: ["i18n", "perf", "a11y"] });
  });
});
