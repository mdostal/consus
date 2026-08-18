import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSelectedDecisionId } from "./useSelectedDecisionId";

function setUrl(url: string) {
  window.history.pushState({}, "", url);
}

afterEach(() => {
  setUrl("/");
});

describe("useSelectedDecisionId", () => {
  it("reads the initial selected id from window.location.search", () => {
    setUrl("/?selected=item-1");

    const { result } = renderHook(() => useSelectedDecisionId());

    expect(result.current[0]).toBe("item-1");
  });

  it("returns null when ?selected= is absent from the URL", () => {
    setUrl("/");

    const { result } = renderHook(() => useSelectedDecisionId());

    expect(result.current[0]).toBeNull();
  });

  it("select() updates the URL's ?selected= param via history.replaceState, not pushState", () => {
    setUrl("/");
    const replaceSpy = vi.spyOn(window.history, "replaceState");
    const pushSpy = vi.spyOn(window.history, "pushState");

    const { result } = renderHook(() => useSelectedDecisionId());

    act(() => {
      result.current[1]("item-2");
    });

    expect(result.current[0]).toBe("item-2");
    expect(window.location.search).toBe("?selected=item-2");
    expect(replaceSpy).toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();

    replaceSpy.mockRestore();
    pushSpy.mockRestore();
  });

  it("select() does not add a new browser history entry (only replaces the current one)", () => {
    setUrl("/");
    const { result } = renderHook(() => useSelectedDecisionId());
    const lengthBefore = window.history.length;

    act(() => {
      result.current[1]("item-a");
    });
    act(() => {
      result.current[1]("item-b");
    });
    act(() => {
      result.current[1]("item-c");
    });

    expect(window.history.length).toBe(lengthBefore);
    expect(window.location.search).toBe("?selected=item-c");
  });

  it("preserves other existing query params when selecting", () => {
    setUrl("/?foo=bar");
    const { result } = renderHook(() => useSelectedDecisionId());

    act(() => {
      result.current[1]("item-1");
    });

    const params = new URLSearchParams(window.location.search);
    expect(params.get("foo")).toBe("bar");
    expect(params.get("selected")).toBe("item-1");
  });

  it("responds to a popstate event by re-reading the URL (back/forward support)", () => {
    setUrl("/?selected=item-1");
    const { result } = renderHook(() => useSelectedDecisionId());
    expect(result.current[0]).toBe("item-1");

    act(() => {
      setUrl("/?selected=item-2");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(result.current[0]).toBe("item-2");
  });
});
