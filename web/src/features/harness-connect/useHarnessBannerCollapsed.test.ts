import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  useHarnessBannerCollapsed,
  HARNESS_BANNER_COLLAPSED_STORAGE_KEY,
} from "./useHarnessBannerCollapsed";

describe("useHarnessBannerCollapsed", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("defaults to expanded (collapsed=false) when nothing is stored", () => {
    const { result } = renderHook(() => useHarnessBannerCollapsed());
    expect(result.current.collapsed).toBe(false);
  });

  it("reads a previously stored collapsed=true from localStorage on mount", () => {
    window.localStorage.setItem(HARNESS_BANNER_COLLAPSED_STORAGE_KEY, "true");
    const { result } = renderHook(() => useHarnessBannerCollapsed());
    expect(result.current.collapsed).toBe(true);
  });

  it("ignores a corrupt/unrecognized stored value and falls back to expanded", () => {
    window.localStorage.setItem(HARNESS_BANNER_COLLAPSED_STORAGE_KEY, "not-a-real-bool");
    const { result } = renderHook(() => useHarnessBannerCollapsed());
    expect(result.current.collapsed).toBe(false);
  });

  it("persists an explicit collapse to localStorage under a namespaced key", () => {
    const { result } = renderHook(() => useHarnessBannerCollapsed());
    act(() => result.current.setCollapsed(true));
    expect(window.localStorage.getItem(HARNESS_BANNER_COLLAPSED_STORAGE_KEY)).toBe("true");
    expect(HARNESS_BANNER_COLLAPSED_STORAGE_KEY).toMatch(/^consus:/);
    expect(HARNESS_BANNER_COLLAPSED_STORAGE_KEY).not.toBe("consus:theme-preference");
    expect(HARNESS_BANNER_COLLAPSED_STORAGE_KEY).not.toBe("consus:skin-preference");
  });

  it("persists an explicit re-expand to localStorage too", () => {
    const { result } = renderHook(() => useHarnessBannerCollapsed());
    act(() => result.current.setCollapsed(true));
    act(() => result.current.setCollapsed(false));
    expect(window.localStorage.getItem(HARNESS_BANNER_COLLAPSED_STORAGE_KEY)).toBe("false");
  });

  it("persists across a simulated reload (re-mount with the same localStorage, not just an in-memory re-render)", () => {
    const first = renderHook(() => useHarnessBannerCollapsed());
    act(() => first.result.current.setCollapsed(true));
    first.unmount();

    const second = renderHook(() => useHarnessBannerCollapsed());
    expect(second.result.current.collapsed).toBe(true);
  });
});
