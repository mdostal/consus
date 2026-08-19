import { useState } from "react";

export interface DocDiffCheckProps {
  repo: string;
  path: string;
  /** The branch to diff against the project's default branch (s3's
   *  GET /api/docs/diff, `?base=` omitted so the server resolves it). */
  branch: string;
}

interface DiffResponse {
  diff: string | null;
}

type CheckState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; diff: string | null };

/**
 * s4 (consus-phase24-branch-level-surfacing): the "view diff vs <default
 * branch>" action for a doc, wired to GET /api/docs/diff (s3). Deliberately
 * on-demand — a button click, checked only for the one doc currently open —
 * not an eager per-doc check fired for every doc in a project on every
 * render (see the story's own judgment-call note in the story YAML on
 * avoiding an N-requests-per-render diff check).
 *
 * Renders the diff using the exact same plain <pre> convention
 * EventProposeComposer.tsx already established (see its own
 * data-testid="event-diff") — the one existing diff-rendering precedent in
 * this codebase; this is deliberately not a new diff-rendering component
 * style.
 */
export function DocDiffCheck({ repo, path, branch }: DocDiffCheckProps) {
  const [state, setState] = useState<CheckState>({ status: "idle" });

  async function check() {
    setState({ status: "loading" });
    try {
      const res = await fetch(
        `/api/docs/diff?repo=${encodeURIComponent(repo)}&path=${encodeURIComponent(path)}&ref=${encodeURIComponent(branch)}`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        setState({ status: "error", message: body.error ?? `HTTP ${res.status}` });
        return;
      }
      const body: DiffResponse = await res.json();
      setState({ status: "done", diff: body.diff });
    } catch (e) {
      setState({ status: "error", message: (e as Error).message });
    }
  }

  return (
    <div className="doc-diff-check">
      <button type="button" onClick={check} disabled={state.status === "loading"}>
        {state.status === "loading" ? "Checking…" : `View diff vs default branch`}
      </button>

      {state.status === "error" ? <p className="dv__err">Could not load diff: {state.message}</p> : null}

      {state.status === "done" && state.diff !== null ? (
        <pre data-testid="doc-diff" className="doc-diff-check__diff">
          {state.diff}
        </pre>
      ) : null}

      {state.status === "done" && state.diff === null ? (
        <p className="doc-diff-check__no-changes" data-testid="doc-diff-none">
          No changes on "{branch}" vs the default branch.
        </p>
      ) : null}
    </div>
  );
}
