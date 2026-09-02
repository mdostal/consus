/**
 * s3 (consus-phase27-feature-doc-review-ui): the feature list this story
 * replaces DocBrowser.tsx's flat repo -> phase -> <doc rows> tree with.
 *
 * s2's GET /api/docs/features (server/routes/docs.ts) returns per-doc
 * entries without a `repo` field — a doc's repo is implied by the
 * `?project=` scope of the request that fetched it. Callers (App.tsx's
 * ProjectDocs and DocsSection) always attach `repo` to each doc
 * client-side before handing data to this component, so FeatureDoc here
 * carries it as a required field — the one deliberate shape difference
 * from the server's raw response.
 */
export interface FeatureDoc {
  file_path: string;
  content_hash: string;
  last_scanned_at: string;
  repo: string;
}

export interface Feature {
  epic: string;
  docCount: number;
  docs: FeatureDoc[];
}

export interface FeatureBrowserProps {
  features: Feature[];
  /** The repo-root README/VISION/docs/** bucket (s1/s2's phase='overview'
   *  rows, epic=null) — kept visually distinct from the per-epic feature
   *  list below, per this story's acceptance criteria. */
  overview: FeatureDoc[];
  /** Fires with the full Feature (epic, docCount, and its docs) when a
   *  feature row is clicked — the caller navigates to FeatureDetailView
   *  with it, matching this app's existing "hold the selection in local
   *  state, no router" navigation pattern (see ProjectDocs/DocsSection's
   *  pre-existing openDoc state). */
  onSelectFeature: (feature: Feature) => void;
  /** Opens a single overview doc directly — the same (repo, filePath)
   *  callback shape DocBrowser's onOpen and DocSearch's onOpen already
   *  use, reused unchanged here. */
  onOpenDoc: (repo: string, filePath: string) => void;
}

export function FeatureBrowser({ features, overview, onSelectFeature, onOpenDoc }: FeatureBrowserProps) {
  return (
    <div className="feature-browser">
      <section className="feature-browser__features">
        <h2>Features</h2>
        {features.length === 0 ? (
          <p className="feature-browser__empty">No feature docs indexed yet.</p>
        ) : (
          <ul>
            {features.map((feature) => (
              <li key={feature.epic}>
                <button type="button" onClick={() => onSelectFeature(feature)}>
                  <span className="feature-browser__epic">{feature.epic}</span>
                  <span className="feature-browser__count">
                    {feature.docCount} {feature.docCount === 1 ? "doc" : "docs"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="feature-browser__overview">
        <h2>Overview</h2>
        {overview.length === 0 ? (
          <p className="feature-browser__empty">No overview docs indexed yet.</p>
        ) : (
          <ul>
            {overview.map((doc) => (
              <li key={`${doc.repo} ${doc.file_path}`}>
                <button type="button" onClick={() => onOpenDoc(doc.repo, doc.file_path)}>
                  {doc.file_path}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
