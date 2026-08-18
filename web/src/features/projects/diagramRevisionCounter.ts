import { useSyncExternalStore } from "react";

/**
 * The shared "how many times has anything actually been fired to harness"
 * revision counter (s5, consus-phase18, design-discussion.md resolved
 * decision #9) — one module-level count, incremented by every successful
 * "Fire to harness" from either DiagramView.tsx or ArchitectureDiagramView.tsx.
 * "Successful" means the fire actually had pending changes and actually
 * called onProposeChange — a fire attempt with zero pending changes never
 * reaches incrementDiagramRevision at all, since neither component's own
 * `fire` callback calls onProposeChange in that case either.
 *
 * Session-scoped only, by design (the story's own explicit scope: no
 * requirement to persist this across a page reload) — module state, not
 * localStorage.
 *
 * Same registry-module shape as diagramActionRegistry.ts (module state +
 * subscribe/notify + useSyncExternalStore + a test-only reset) — reused
 * here rather than inventing a different state-sharing mechanism for what
 * is structurally the same problem this codebase already solved once: one
 * shared, live value read by multiple independently-mounted components
 * (there DiagramView/ArchitectureDiagramView's action sets feeding the
 * command palette; here both components' fires feeding the shared
 * DiagramMetadataStrip, mounted once per diagram, both reflecting the same
 * number).
 */

let revision = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Records one successful fire. Never call this for a no-op fire attempt
 *  (zero pending changes) — callers already guard that before calling
 *  onProposeChange at all, so this only ever fires alongside a real one. */
export function incrementDiagramRevision(): void {
  revision += 1;
  notify();
}

export function getDiagramRevisionSnapshot(): number {
  return revision;
}

export function subscribeDiagramRevision(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React hook: the live, shared revision count — identical regardless of
 *  which component renders it (DiagramView's own strip, or
 *  ArchitectureDiagramView's), and regardless of active skin, since
 *  presentation (DiagramMetadataStrip) is a pure function of this one
 *  number. */
export function useDiagramRevisionCount(): number {
  return useSyncExternalStore(subscribeDiagramRevision, getDiagramRevisionSnapshot, getDiagramRevisionSnapshot);
}

/** Test-only: resets the shared counter and clears subscribers so one
 *  test's fires never leak into the next — same defensive-reset role
 *  __resetDiagramActionRegistryForTests plays for the action registry. */
export function __resetDiagramRevisionForTests(): void {
  revision = 0;
  listeners.clear();
}
