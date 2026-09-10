import { isDesignDoc } from "./designAssets";

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
  /** s3 (consus-phase29-brand-decision-review): the .pHive/brand/** bucket
   *  (phase='brand' rows, epic=null, GET /api/docs/features's new `brand`
   *  field). Rendered as its own sibling section, NOT folded into Overview
   *  — Overview is pure-read docs, Brand carries an active pending decision
   *  once s4 ships, and design-discussion.md's open question 1 flags
   *  conflating the two as a risk of burying that decision. Optional and
   *  defaulted to [] so every existing caller (and every existing test)
   *  that doesn't yet pass it keeps working unchanged. */
  brand?: FeatureDoc[];
  /** Fires with the full Feature (epic, docCount, and its docs) when a
   *  feature row is clicked — the caller navigates to FeatureDetailView
   *  with it, matching this app's existing "hold the selection in local
   *  state, no router" navigation pattern (see ProjectDocs/DocsSection's
   *  pre-existing openDoc state). */
  onSelectFeature: (feature: Feature) => void;
  /** Opens a single overview (or brand) doc directly — the same
   *  (repo, filePath) callback shape DocBrowser's onOpen and DocSearch's
   *  onOpen already use, reused unchanged here. The caller decides how to
   *  render what comes back (DocRenderer vs. s3's FullPageDocViewer) based
   *  on the opened doc's phase, which GET /api/docs/content now returns —
   *  this component doesn't need to know or care which viewer is used. */
  onOpenDoc: (repo: string, filePath: string) => void;
}

export function FeatureBrowser({ features, overview, brand = [], onSelectFeature, onOpenDoc }: FeatureBrowserProps) {
  return (
    <div className="feature-browser">
      <section className="feature-browser__features">
        <h2>Features</h2>
        {features.length === 0 ? (
          <p className="feature-browser__empty">No feature docs indexed yet.</p>
        ) : (
          <ul>
            {features.map((feature) => {
              // s3 (consus-phase28-interaction-completeness): a design topic
              // whose name matches this feature's epic already lands in
              // feature.docs (GET /api/docs/features groups by epic
              // regardless of phase) — surfaced here as a small badge so a
              // feature with wireframes is visible from the list itself,
              // folded in rather than broken out as a separate nav item.
              const hasDesignDocs = feature.docs.some((doc) => isDesignDoc(doc.file_path));
              return (
                <li key={feature.epic}>
                  <button type="button" onClick={() => onSelectFeature(feature)}>
                    <span className="feature-browser__epic">{feature.epic}</span>
                    {hasDesignDocs ? (
                      <span className="feature-browser__design-badge" title="Has .pHive/design/ wireframes">
                        Design
                      </span>
                    ) : null}
                    <span className="feature-browser__count">
                      {feature.docCount} {feature.docCount === 1 ? "doc" : "docs"}
                    </span>
                  </button>
                </li>
              );
            })}
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

      {/* s3 (consus-phase29-brand-decision-review): a sibling to Overview,
          not nested inside it — see the `brand` prop doc comment above. */}
      <section className="feature-browser__brand">
        <h2>Brand</h2>
        {brand.length === 0 ? (
          <p className="feature-browser__empty">No brand docs indexed yet.</p>
        ) : (
          <ul>
            {brand.map((doc) => (
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
