import { useEffect, useState } from "react";
import { DocRenderer } from "./DocRenderer";
import { DocDiffCheck } from "./DocDiffCheck";
import type { FeatureDoc } from "./FeatureBrowser";

type DocLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; format: "md" | "html"; content: string };

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
 * This story deliberately does NOT add approve/deny/change controls here
 * (that's s4, layered on top of this view once it exists) — each doc
 * renders read-only, with no onProposeChange wired into DocRenderer.
 */
export function FeatureDetailView({ epic, docs, onBack, branch }: FeatureDetailViewProps) {
  const [loaded, setLoaded] = useState<Record<string, DocLoadState>>({});

  useEffect(() => {
    let cancelled = false;
    setLoaded(
      Object.fromEntries(docs.map((doc) => [`${doc.repo} ${doc.file_path}`, { status: "loading" as const }])),
    );

    docs.forEach((doc) => {
      const key = `${doc.repo} ${doc.file_path}`;
      fetch(`/api/docs/content?repo=${encodeURIComponent(doc.repo)}&path=${encodeURIComponent(doc.file_path)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((data: { format: "md" | "html"; content: string }) => {
          if (cancelled) return;
          setLoaded((prev) => ({ ...prev, [key]: { status: "done", format: data.format, content: data.content } }));
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
        return (
          <section key={key} className="feature-detail-view__doc" data-testid={`feature-doc-${doc.file_path}`}>
            <h3 className="feature-detail-view__doc-path">{doc.file_path}</h3>
            {branch ? <DocDiffCheck repo={doc.repo} path={doc.file_path} branch={branch} /> : null}
            {!state || state.status === "loading" ? (
              <p className="state">Loading…</p>
            ) : state.status === "error" ? (
              <p className="state state--err">
                Could not load {doc.file_path}: {state.message}
              </p>
            ) : (
              <DocRenderer format={state.format} content={state.content} />
            )}
          </section>
        );
      })}
    </div>
  );
}
