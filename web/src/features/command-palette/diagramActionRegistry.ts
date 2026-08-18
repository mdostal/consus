import { useEffect } from "react";

/**
 * The two real diagram kinds this app renders (server/routes/diagrams.ts):
 * the epic/story dependency cascade and the per-repo architecture diagram.
 * Both are mounted simultaneously, stacked on the page, whenever a project
 * is selected — see App.tsx's ProjectsSection (~L395-425). There is no
 * tabbed layout to switch between (the story spec's "switch diagram tab"
 * framing described an exploratory mockup, not the real, now-built app).
 */
export type DiagramKind = "cascade" | "architecture";

/**
 * The live, currently-available action set for one mounted diagram
 * instance — registered by DiagramView.tsx / ArchitectureDiagramView.tsx
 * themselves (see useRegisterDiagramActions below) so the command palette
 * (s4, consus-phase18) and its global shortcuts always reflect reality
 * rather than a hardcoded/placeholder list that could drift from it.
 */
export interface DiagramActions {
  kind: DiagramKind;
  /** Human-readable name for this diagram instance, e.g. "consus epic/story
   *  diagram" — matches the wording of that diagram's own on-screen <h3>
   *  header, used to build palette entry labels like "Focus <label>". */
  label: string;
  /** Scrolls this diagram's section into view and moves real DOM focus onto
   *  it — the adapted form of the story spec's "switch diagram tab" number-
   *  key shortcut for the real stacked (not tabbed) layout. */
  focus: () => void;
  /** Toggles the s3 collapsible Mermaid source panel — identical to
   *  clicking that panel's own on-screen toggle button. */
  toggleSourcePanel: () => void;
  sourcePanelOpen: boolean;
  /** Absent entirely (not just disabled) when this diagram instance has no
   *  propose-a-change wiring at all — mirrors ArchitectureDiagramView's own
   *  optional onProposeChange, whose real on-screen "Fire to harness"
   *  button likewise doesn't render without it. */
  fire?: () => void;
  fireEnabled?: boolean;
}

type Listener = () => void;

const registry = new Map<DiagramKind, DiagramActions>();
const listeners = new Set<Listener>();

let cachedSnapshot: DiagramActions[] = [];
let cachedSnapshotDirty = true;

function invalidateSnapshot(): void {
  cachedSnapshotDirty = true;
}

function notify(): void {
  invalidateSnapshot();
  for (const listener of listeners) listener();
}

/**
 * Registers (or replaces) one diagram instance's current action set.
 * Returns an unregister function, meant to be returned directly from a
 * useEffect cleanup (see useRegisterDiagramActions) — guarded so a stale
 * cleanup from an earlier registration that a newer one has already
 * replaced can never clobber that newer registration (the same
 * register-before-a-later-cleanup-runs race DiagramCanvas.tsx's own onChange
 * ordering comment documents for a different reason).
 */
export function registerDiagramActions(actions: DiagramActions): () => void {
  registry.set(actions.kind, actions);
  notify();
  return () => {
    if (registry.get(actions.kind) === actions) {
      registry.delete(actions.kind);
      notify();
    }
  };
}

export function subscribeDiagramActions(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Stable array identity across calls with no intervening registry change —
 * required by React's useSyncExternalStore, which treats an ever-new array
 * from getSnapshot as "always changed" and can loop/warn as a result.
 */
export function getDiagramActionsSnapshot(): DiagramActions[] {
  if (cachedSnapshotDirty) {
    cachedSnapshot = Array.from(registry.values());
    cachedSnapshotDirty = false;
  }
  return cachedSnapshot;
}

/** React hook: registers `actions` for as long as the calling component is
 *  mounted with this value, re-registering whenever any field actually
 *  changes (not on every unrelated re-render) and unregistering on
 *  unmount. Called from DiagramView.tsx / ArchitectureDiagramView.tsx. */
export function useRegisterDiagramActions(actions: DiagramActions): void {
  useEffect(() => {
    return registerDiagramActions(actions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    actions.kind,
    actions.label,
    actions.focus,
    actions.toggleSourcePanel,
    actions.sourcePanelOpen,
    actions.fire,
    actions.fireEnabled,
  ]);
}

/** Test-only: clears every registration and subscriber so one test's
 *  registered diagram(s) never leak into the next — RTL's automatic
 *  unmount-on-cleanup already unregisters in practice, this is a defensive
 *  belt-and-suspenders reset, the same role afterEach's
 *  --consus-edge-style cleanup plays elsewhere in this test suite. */
export function __resetDiagramActionRegistryForTests(): void {
  registry.clear();
  listeners.clear();
  invalidateSnapshot();
}
