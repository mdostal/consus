import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CommentThread } from "./CommentThread";

describe("CommentThread", () => {
  it("renders existing comments with author and timestamp, regardless of origin", () => {
    render(
      <CommentThread
        comments={[
          { id: 1, author: "mathew", body: "looks good", createdAt: "2026-07-25T10:00:00Z" },
          { id: 2, author: "agent:reviewer", body: "confirmed", createdAt: "2026-07-25T10:05:00Z" },
        ]}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText("looks good")).toBeInTheDocument();
    expect(screen.getByText("mathew")).toBeInTheDocument();
    expect(screen.getByText("confirmed")).toBeInTheDocument();
    expect(screen.getByText("agent:reviewer")).toBeInTheDocument();
  });

  it("submits a new comment via onSubmit and clears the input", () => {
    const onSubmit = vi.fn();
    render(<CommentThread comments={[]} onSubmit={onSubmit} />);

    const textbox = screen.getByRole("textbox", { name: /add a comment/i });
    fireEvent.change(textbox, { target: { value: "new comment" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(onSubmit).toHaveBeenCalledWith("new comment");
    expect(textbox).toHaveValue("");
  });

  it("does not submit an empty comment", () => {
    const onSubmit = vi.fn();
    render(<CommentThread comments={[]} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
