/**
 * s3 (consus-phase28-interaction-completeness): shared helpers for
 * surfacing `.pHive/design/<topic>/` docs (scanned by
 * server/adapters/doc-scanner/index.ts's DESIGN_ROOT walk, tagged
 * phase: "design") inside FeatureBrowser/FeatureDetailView, and for
 * resolving a design doc's markdown image references (wireframe PNGs) to
 * the new GET /api/design-assets route (server/routes/design-assets.ts).
 *
 * A design doc is identified purely by its file_path prefix — the
 * GET /api/docs/features FeatureDoc shape carries no `phase` field (it
 * never needed one before this story), and adding one would be a wider,
 * riskier change than this prefix check for a value ("design/wireframe") no
 * other consumer of that route needs yet.
 */
export const DESIGN_DOC_PREFIX = ".pHive/design/";

export function isDesignDoc(filePath: string): boolean {
  return filePath.startsWith(DESIGN_DOC_PREFIX);
}

function isExternalSrc(src: string): boolean {
  return /^([a-z][a-z0-9+.-]*:)?\/\//i.test(src) || src.startsWith("data:");
}

/**
 * Resolves a markdown image `src` found inside a design doc (e.g. `v1.png`,
 * `./v1.png`, or an already-repo-relative `.pHive/design/<topic>/v1.png`)
 * to the repo-relative path GET /api/design-assets expects, relative to the
 * doc's own directory — the same resolution a browser would apply to a
 * relative URL, done here explicitly since these docs are rendered from
 * fetched markdown text, not served as static files with a real base URL.
 * Absolute (http(s)/data) sources are returned unchanged.
 */
export function resolveDesignImageSrc(docFilePath: string, src: string): string {
  if (isExternalSrc(src)) return src;

  const cleaned = src.replace(/^\.\//, "");
  if (cleaned.startsWith(DESIGN_DOC_PREFIX)) return cleaned;

  const lastSlash = docFilePath.lastIndexOf("/");
  const dir = lastSlash === -1 ? "" : docFilePath.slice(0, lastSlash + 1);
  return `${dir}${cleaned}`;
}

/** Builds the GET /api/design-assets URL for a resolved repo-relative path. */
export function designAssetUrl(repo: string, path: string): string {
  return `/api/design-assets?repo=${encodeURIComponent(repo)}&path=${encodeURIComponent(path)}`;
}
