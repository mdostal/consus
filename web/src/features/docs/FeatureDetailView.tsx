import { useCallback, useEffect, useState } from "react";
import { DocRenderer } from "./DocRenderer";
import { DocDiffCheck } from "./DocDiffCheck";
import type { AuditTrailEntry } from "../audit/AuditPanel";
import type { FeatureDoc } from "./FeatureBrowser";

type DocLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; format: "md" | "html"; content: string; itemId: string };

/** Per-doc review state (s4) — everything the approve/deny/request-change
 *  controls need, keyed the same way `loaded` is (`${repo} ${file_path}`).
 *  Deliberately separate from DocLoadState: this survives independently of
 *  a doc's own content load/error state, and is reset only when a doc's
 *  own key disappears (a different feature is opened). */
interface DocReviewState {
  /** id of the most recently fired proposal, while it's still pending — the
   *  same "fire, then reflect the immediate result" contract
   *  ProjectDiagram/ProjectArchitectureDiagram (App.tsx) already use. Mapped
   *  straight into DocRenderer's own `pendingProposal` pill, unchanged. */
  pendingProposalId: string | null;
  /** Set when the just-fired proposal came back already failed (harness
   *  dispatch itself failed) — mapped into DocRenderer's own
   *  `proposalFailureReason` pill, unchanged. */
  proposalFailureReason: string | null;
  /** This doc's full proposal/audit history (s5's GET
   *  /api/items/:id/audit-trail, the same generic route ProjectDiagram
   *  already polls) — rendered via DocRenderer's own `auditEntries` ->
   *  AuditPanel wiring, unchanged. This is what makes a proposal's
   *  pending/applied/failed status survive a re-open of the doc even after
   *  this component (and its local pendingProposalId) has remounted from
   *  scratch. */
  auditEntries: AuditTrailEntry[];
  /** Whether the Deny reason composer is open for this doc. */
  denyComposerOpen: boolean;
  denyText: string;
  /** A propose-a-change POST that itself failed to reach the server at all
   *  (network/HTTP error, not a harness-side dispatch failure) — shown
   *  inline, same "state state--err" convention used throughout this app,
   *  never silently swallowed. */
  reviewError: string | null;
}

const DEFAULT_REVIEW: DocReviewState = {
  pendingProposalId: null,
  proposalFailureReason: null,
  auditEntries: [],
  denyComposerOpen: false,
  denyText: "",
  reviewError: null,
};

function reviewFor(map: Record<string, DocReviewState>, key: string): DocReviewState {
  return map[key] ?? DEFAULT_REVIEW;
}

export interface FeatureDetailViewProps {
  epic: string;
  docs: FeatureDoc[];
  onBack: () => void;
  /** s4 (consus-phase24-branch-level-surfacing) parity: when set (a branch
   *  other than "(default)" is picked), every doc in this feature gets its
   *  own "view diff vs default branch" action — the same DocDiffCheck
   *  ProjectDocs already wired for its single-open-doc view before this
   *  story. Omit to keep read-only, unbranched rendering (DocsSection's
   *  global tab has no branch concept). */
  branch?: string | null;
}

/**
 * s3 (consus-phase27-feature-doc-review-ui): given one feature (an epic
 * name plus its docs array straight from s2's GET /api/docs/features),
 * fetches and renders every doc belonging to that epic together on one
 * screen — reusing DocRenderer.tsx per-doc, completely unchanged.
 *
 * s4: this is the epic's central deliverable — every doc rendered here now
 * gets real approve/deny/request-change controls, wired to the exact same
 * POST /api/proposals mechanism ArchitectureDiagramView (App.tsx's
 * ProjectDiagram/ProjectArchitectureDiagram) and EventProposeComposer
 * already use, targeting each doc's existing docItemIdFor item id (already
 * returned as `itemId` on every GET /api/docs/content response, s5). No new
 * backend route was needed: "request change" is DocRenderer's own, already-
 * built per-section Edit -> compute-a-diff -> Fire-to-harness flow (simply
 * wired on here via onProposeChange, exactly as ProjectDiagram wires it for
 * diagrams); "approve" and "deny" are two additional buttons above the doc
 * that fire the identical POST /api/proposals shape with a fixed
 * diff/description marker (there is no separate "verdict" column on
 * proposals — target_type stays "doc" for all three actions, matching the
 * store's explicit "never branched on here" design, server/proposals/
 * store.ts). All three actions share one pending/failed status, shown via
 * DocRenderer's existing pill UI, and one history, via DocRenderer's
 * existing AuditPanel wiring fed from GET /api/items/:id/audit-trail — the
 * same generic route ProjectDiagram already polls after firing.
 */
export function FeatureDetailView({ epic, docs, onBack, branch }: FeatureDetailViewProps) {
  const [loaded, setLoaded] = useState<Record<string, DocLoadState>>({});
  const [review, setReview] = useState<Record<string, DocReviewState>>({});

  const loadAuditTrail = useCallback((key: string, itemId: string) => {
    fetch(`/api/items/${encodeURIComponent(itemId)}/audit-trail`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((entries: AuditTrailEntry[]) => {
        setReview((prev) => ({ ...prev, [key]: { ...reviewFor(prev, key), auditEntries: entries } }));
      })
      .catch(() => {
        // history is best-effort — same convention as ProjectDiagram's own
        // loadAuditTrail (App.tsx), must never block the doc's own render.
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoaded(
      Object.fromEntries(docs.map((doc) => [`${doc.repo} ${doc.file_path}`, { status: "loading" as const }])),
    );
    setReview({});

    docs.forEach((doc) => {
      const key = `${doc.repo} ${doc.file_path}`;
      fetch(`/api/docs/content?repo=${encodeURIComponent(doc.repo)}&path=${encodeURIComponent(doc.file_path)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((data: { format: "md" | "html"; content: string; itemId: string }) => {
          if (cancelled) return;
          setLoaded((prev) => ({
            ...prev,
            [key]: { status: "done", format: data.format, content: data.content, itemId: data.itemId },
          }));
          loadAuditTrail(key, data.itemId);
        })
        .catch((e: Error) => {
          if (cancelled) return;
          setLoaded((prev) => ({ ...prev, [key]: { status: "error", message: e.message } }));
        });
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epic]);

  /** Fires the shared POST /api/proposals call — the exact same payload
   *  shape (itemId, targetType, diff, description, requestedBy) and fetch
   *  pattern ProjectArchitectureDiagram's proposeChange (App.tsx) already
   *  uses, unchanged. Used by approve, deny, and request-change alike; the
   *  action's identity lives entirely in the diff/description text passed
   *  in, never in a separate code path. */
  const submitProposal = useCallback(
    (key: string, itemId: string, input: { diff: string; description: string }) => {
      setReview((prev) => ({ ...prev, [key]: { ...reviewFor(prev, key), reviewError: null } }));
      fetch("/api/proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          itemId,
          targetType: "doc",
          diff: input.diff,
          description: input.description,
          requestedBy: "Mathew",
        }),
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((proposal: { id: string; status: string; failure_reason: string | null }) => {
          setReview((prev) => ({
            ...prev,
            [key]: {
              ...reviewFor(prev, key),
              pendingProposalId: proposal.status === "pending" ? proposal.id : null,
              proposalFailureReason: proposal.status === "failed" ? proposal.failure_reason : null,
            },
          }));
          loadAuditTrail(key, itemId);
        })
        .catch((e: Error) => {
          setReview((prev) => ({ ...prev, [key]: { ...reviewFor(prev, key), reviewError: e.message } }));
        });
    },
    [loadAuditTrail],
  );

  const approve = useCallback(
    (key: string, itemId: string) => {
      submitProposal(key, itemId, { diff: "(no changes — approved as-is)", description: "Approved" });
    },
    [submitProposal],
  );

  const openDenyComposer = (key: string) =>
    setReview((prev) => ({ ...prev, [key]: { ...reviewFor(prev, key), denyComposerOpen: true, denyText: "" } }));

  const cancelDenyComposer = (key: string) =>
    setReview((prev) => ({ ...prev, [key]: { ...reviewFor(prev, key), denyComposerOpen: false, denyText: "" } }));

  const setDenyText = (key: string, text: string) =>
    setReview((prev) => ({ ...prev, [key]: { ...reviewFor(prev, key), denyText: text } }));

  const submitDeny = useCallback(
    (key: string, itemId: string) => {
      const text = reviewFor(review, key).denyText.trim();
      if (!text) return;
      submitProposal(key, itemId, { diff: "(no changes — denied)", description: `Denied: ${text}` });
      setReview((prev) => ({ ...prev, [key]: { ...reviewFor(prev, key), denyComposerOpen: false, denyText: "" } }));
    },
    [review, submitProposal],
  );

  return (
    <div className="feature-detail-view">
      <div className="consus__section-lead">
        <button className="doc-back" type="button" onClick={onBack}>
          ← Back to features
        </button>
        <h2 className="feature-detail-view__title">{epic}</h2>
        <p className="feature-detail-view__count">
          {docs.length} {docs.length === 1 ? "doc" : "docs"}
        </p>
      </div>

      {docs.map((doc) => {
        const key = `${doc.repo} ${doc.file_path}`;
        const state = loaded[key];
        const rev = reviewFor(review, key);
        return (
          <section key={key} className="feature-detail-view__doc" data-testid={`feature-doc-${doc.file_path}`}>
            <div className="feature-detail-view__doc-head">
              <h3 className="feature-detail-view__doc-path">{doc.file_path}</h3>
              {state && state.status === "done" ? (
                <div className="feature-detail-view__doc-review-actions">
                  <button type="button" onClick={() => approve(key, state.itemId)}>
                    Approve
                  </button>
                  <button type="button" onClick={() => openDenyComposer(key)}>
                    Deny
                  </button>
                </div>
              ) : null}
            </div>

            {state && state.status === "done" && rev.denyComposerOpen ? (
              <div className="feature-detail-view__deny-composer">
                <label>
                  Reason
                  <input
                    type="text"
                    value={rev.denyText}
                    onChange={(e) => setDenyText(key, e.target.value)}
                    placeholder="Describe why this doc is being denied"
                  />
                </label>
                <div className="feature-detail-view__deny-actions">
                  <button type="button" onClick={() => cancelDenyComposer(key)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => submitDeny(key, state.itemId)}
                    disabled={!rev.denyText.trim()}
                  >
                    Deny
                  </button>
                </div>
              </div>
            ) : null}

            {rev.reviewError ? <p className="state state--err">{rev.reviewError}</p> : null}

            {branch ? <DocDiffCheck repo={doc.repo} path={doc.file_path} branch={branch} /> : null}
            {!state || state.status === "loading" ? (
              <p className="state">Loading…</p>
            ) : state.status === "error" ? (
              <p className="state state--err">
                Could not load {doc.file_path}: {state.message}
              </p>
            ) : (
              <DocRenderer
                format={state.format}
                content={state.content}
                onProposeChange={(input) => submitProposal(key, state.itemId, input)}
                pendingProposal={rev.pendingProposalId !== null}
                proposalFailureReason={rev.proposalFailureReason}
                auditEntries={rev.auditEntries}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}
