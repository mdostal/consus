import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DocRenderer } from "./DocRenderer";

describe("DocRenderer", () => {
  it("renders markdown as formatted content, not raw markup", () => {
    render(<DocRenderer format="md" content={"# Heading\n\nSome **bold** text."} />);

    expect(screen.getByRole("heading", { name: "Heading" })).toBeInTheDocument();
    expect(screen.queryByText("# Heading")).not.toBeInTheDocument();
  });

  it("renders html content inside an isolated container, not raw markup", () => {
    render(<DocRenderer format="html" content={"<p>hello <strong>world</strong></p>"} />);

    expect(screen.getByTestId("doc-html")).toBeInTheDocument();
    expect(screen.getByText("world")).toBeInTheDocument();
  });
});
