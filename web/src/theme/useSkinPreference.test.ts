import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSkinPreference, SKIN_STORAGE_KEY } from "./useSkinPreference";

function setDocumentSkinAttr(value: string | null) {
  if (value === null) document.documentElement.removeAttribute("data-skin");
  else document.documentElement.setAttribute("data-skin", value);
}

describe("useSkinPreference", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setDocumentSkinAttr(null);
  });

  afterEach(() => {
    window.localStorage.clear();
    setDocumentSkinAttr(null);
  });

  it("defaults to 'drafting' (Drafting Table) when nothing is stored", () => {
    const { result } = renderHook(() => useSkinPreference());
    expect(result.current.skin).toBe("drafting");
  });

  it("reads a previously stored skin from localStorage on mount", () => {
    window.localStorage.setItem(SKIN_STORAGE_KEY, "case-board");
    const { result } = renderHook(() => useSkinPreference());
    expect(result.current.skin).toBe("case-board");
  });

  it("ignores a corrupt/unrecognized stored value and falls back to 'drafting'", () => {
    window.localStorage.setItem(SKIN_STORAGE_KEY, "not-a-real-skin");
    const { result } = renderHook(() => useSkinPreference());
    expect(result.current.skin).toBe("drafting");
  });

  it("persists a choice to localStorage under a namespaced key distinct from the theme key", () => {
    const { result } = renderHook(() => useSkinPreference());
    act(() => result.current.setSkin("harness"));
    expect(window.localStorage.getItem(SKIN_STORAGE_KEY)).toBe("harness");
    expect(SKIN_STORAGE_KEY).toMatch(/^consus:/);
    expect(SKIN_STORAGE_KEY).not.toBe("consus:theme-preference");
  });

  it("applies data-skin to the document root for each of the three skins", () => {
    const { result } = renderHook(() => useSkinPreference());

    act(() => result.current.setSkin("case-board"));
    expect(document.documentElement.getAttribute("data-skin")).toBe("case-board");

    act(() => result.current.setSkin("harness"));
    expect(document.documentElement.getAttribute("data-skin")).toBe("harness");

    act(() => result.current.setSkin("drafting"));
    expect(document.documentElement.getAttribute("data-skin")).toBe("drafting");
  });

  it("applies the default skin ('drafting') to the document root on mount even with no stored preference", () => {
    renderHook(() => useSkinPreference());
    expect(document.documentElement.getAttribute("data-skin")).toBe("drafting");
  });

  it("applies a stored preference to the document root on mount, not just after a setSkin call", () => {
    window.localStorage.setItem(SKIN_STORAGE_KEY, "harness");
    renderHook(() => useSkinPreference());
    expect(document.documentElement.getAttribute("data-skin")).toBe("harness");
  });
});
