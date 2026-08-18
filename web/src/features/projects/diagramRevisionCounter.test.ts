import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  incrementDiagramRevision,
  getDiagramRevisionSnapshot,
  subscribeDiagramRevision,
  useDiagramRevisionCount,
  __resetDiagramRevisionForTests,
} from "./diagramRevisionCounter";

afterEach(() => {
  __resetDiagramRevisionForTests();
});

/**
 * The shared "N times fired to harness" revision counter (s5,
 * consus-phase18) — one module-level count, read live by DiagramMetadataStrip
 * regardless of which diagram (or how many mounted instances) actually fired.
 */
describe("diagramRevisionCounter", () => {
  it("starts at 0", () => {
    expect(getDiagramRevisionSnapshot()).toBe(0);
  });

  it("increments by exactly 1 per call", () => {
    incrementDiagramRevision();
    expect(getDiagramRevisionSnapshot()).toBe(1);
    incrementDiagramRevision();
    expect(getDiagramRevisionSnapshot()).toBe(2);
  });

  it("notifies subscribers on every increment", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDiagramRevision(listener);

    incrementDiagramRevision();
    expect(listener).toHaveBeenCalledTimes(1);

    incrementDiagramRevision();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
  });

  it("stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDiagramRevision(listener);
    unsubscribe();

    incrementDiagramRevision();
    expect(listener).not.toHaveBeenCalled();
  });

  it("useDiagramRevisionCount reflects the live shared count across independent hook instances", () => {
    const a = renderHook(() => useDiagramRevisionCount());
    const b = renderHook(() => useDiagramRevisionCount());

    expect(a.result.current).toBe(0);
    expect(b.result.current).toBe(0);

    act(() => incrementDiagramRevision());

    expect(a.result.current).toBe(1);
    expect(b.result.current).toBe(1);
  });

  it("__resetDiagramRevisionForTests brings the count back to 0 and clears subscribers", () => {
    incrementDiagramRevision();
    incrementDiagramRevision();
    const listener = vi.fn();
    subscribeDiagramRevision(listener);

    __resetDiagramRevisionForTests();

    expect(getDiagramRevisionSnapshot()).toBe(0);
    incrementDiagramRevision();
    expect(listener).not.toHaveBeenCalled();
  });
});
