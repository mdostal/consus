import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeSkinPicker } from "./ThemeSkinPicker";

describe("ThemeSkinPicker", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-skin");
  });

  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-skin");
  });

  it("renders a theme control offering all three options: light, dark, system", () => {
    render(<ThemeSkinPicker />);
    const themeControl = screen.getByLabelText(/theme/i);
    expect(themeControl).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /light/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /dark/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /system/i })).toBeInTheDocument();
  });

  it("renders a skin control offering all three skins: Drafting Table, Case Board, Harness", () => {
    render(<ThemeSkinPicker />);
    expect(screen.getByLabelText(/skin/i)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /drafting table/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /case board/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /harness/i })).toBeInTheDocument();
  });

  it("selecting a theme option applies data-theme to the document root", () => {
    render(<ThemeSkinPicker />);
    fireEvent.change(screen.getByLabelText(/theme/i), { target: { value: "dark" } });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("selecting 'system' for theme removes the data-theme attribute", () => {
    render(<ThemeSkinPicker />);
    fireEvent.change(screen.getByLabelText(/theme/i), { target: { value: "dark" } });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    fireEvent.change(screen.getByLabelText(/theme/i), { target: { value: "system" } });
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("selecting a skin option applies data-skin to the document root", () => {
    render(<ThemeSkinPicker />);
    fireEvent.change(screen.getByLabelText(/skin/i), { target: { value: "case-board" } });
    expect(document.documentElement.getAttribute("data-skin")).toBe("case-board");
  });

  it("reflects the currently-applied skin and theme as the controls' selected values", () => {
    window.localStorage.setItem("consus:theme-preference", "light");
    window.localStorage.setItem("consus:skin-preference", "harness");
    render(<ThemeSkinPicker />);
    expect((screen.getByLabelText(/theme/i) as HTMLSelectElement).value).toBe("light");
    expect((screen.getByLabelText(/skin/i) as HTMLSelectElement).value).toBe("harness");
  });
});
