import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AddProjectForm } from "./AddProjectForm";

describe("AddProjectForm", () => {
  it("submits the trimmed name and path", () => {
    const onSubmit = vi.fn();
    render(<AddProjectForm onSubmit={onSubmit} submitting={false} />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  my-repo  " } });
    fireEvent.change(screen.getByLabelText("Repo path"), { target: { value: "  /repos/my-repo  " } });
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));

    expect(onSubmit).toHaveBeenCalledWith("my-repo", "/repos/my-repo");
  });

  it("disables the submit button until both fields are filled", () => {
    render(<AddProjectForm onSubmit={vi.fn()} submitting={false} />);

    expect(screen.getByRole("button", { name: "Add project" })).toBeDisabled();
  });

  it("shows a submitting state and disables inputs while a request is in flight", () => {
    render(<AddProjectForm onSubmit={vi.fn()} submitting />);

    expect(screen.getByRole("button", { name: "Adding…" })).toBeDisabled();
    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.getByLabelText("Repo path")).toBeDisabled();
  });

  it("surfaces an error message when given one", () => {
    render(<AddProjectForm onSubmit={vi.fn()} submitting={false} error="path does not exist" />);

    expect(screen.getByText("path does not exist")).toBeInTheDocument();
  });
});
