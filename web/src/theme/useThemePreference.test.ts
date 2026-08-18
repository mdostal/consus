import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useThemePreference, THEME_STORAGE_KEY } from "./useThemePreference";

function setDocumentThemeAttr(value: string | null) {
  if (value === null) document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", value);
}

describe("useThemePreference", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setDocumentThemeAttr(null);
  });

  afterEach(() => {
    window.localStorage.clear();
    setDocumentThemeAttr(null);
  });

  it("defaults to 'system' when nothing is stored, matching today's prefers-color-scheme behavior", () => {
    const { result } = renderHook(() => useThemePreference());
    expect(result.current.preference).toBe("system");
  });

  it("reads a previously stored preference from localStorage on mount", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    const { result } = renderHook(() => useThemePreference());
    expect(result.current.preference).toBe("dark");
  });

  it("ignores a corrupt/unrecognized stored value and falls back to 'system'", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "not-a-real-theme");
    const { result } = renderHook(() => useThemePreference());
    expect(result.current.preference).toBe("system");
  });

  it("persists an explicit choice to localStorage under a namespaced key", () => {
    const { result } = renderHook(() => useThemePreference());
    act(() => result.current.setPreference("dark"));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(THEME_STORAGE_KEY).toMatch(/^consus:/);
  });

  it("applies data-theme='dark' to the document root when 'dark' is explicitly chosen (explicit choice beats OS default in the dark direction)", () => {
    const { result } = renderHook(() => useThemePreference());
    act(() => result.current.setPreference("dark"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("applies data-theme='light' to the document root when 'light' is explicitly chosen (explicit choice beats OS default in the light direction)", () => {
    const { result } = renderHook(() => useThemePreference());
    act(() => result.current.setPreference("light"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("removes the data-theme attribute when 'system' is chosen, so the bare :root/media-query pattern takes over", () => {
    const { result } = renderHook(() => useThemePreference());
    act(() => result.current.setPreference("dark"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    act(() => result.current.setPreference("system"));
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("applies the stored preference to the document root on mount, not just after a setPreference call", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    renderHook(() => useThemePreference());
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});
