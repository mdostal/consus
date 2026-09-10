import { useCallback } from "react";

export interface FullPageDocViewerProps {
  /** The doc's raw content — a genuine self-contained HTML page (its own
   *  <!DOCTYPE>, <head> with <style>/<link> tags, <body>), fetched from the
   *  same GET /api/docs/content endpoint DocRenderer's callers already use.
   *  Rendered via <iframe srcDoc>, never dangerouslySetInnerHTML — real
   *  browser-level document isolation, so the page's own <head> (fonts,
   *  styles) and structure survive exactly as authored instead of being
   *  silently stripped/normalized as children of a host <div>. */
  content: string;
  /** Shown in the toolbar and used as the iframe's accessible title.
   *  Typically the doc's file_path (e.g. ".pHive/brand/brand-guide.html"). */
  title?: string;
}

/**
 * s3 (consus-phase29-brand-decision-review): the new rendering path for a
 * full-page HTML doc (currently: any phase='brand' doc, e.g.
 * .pHive/brand/brand-guide.html) — a sibling to DocRenderer's existing
 * marked.parse + dangerouslySetInnerHTML path, selected by the caller
 * *before* DocRenderer is reached, never a change to DocRenderer itself.
 *
 * Deliberately an <iframe srcDoc>, not a new file-serving route: the doc's
 * raw text is already served by GET /api/docs/content (same as any other
 * indexed doc) — srcDoc consumes that string directly. See
 * design-discussion.md's "iframe srcdoc, not a new file-serving route"
 * decision.
 *
 * Gets a dedicated full-height slot (via full-page-doc-viewer's CSS, not
 * the cramped default doc-renderer card) plus an explicit "Open in new tab"
 * fallback affordance, per design-discussion.md's risk mitigation for a
 * full page looking cramped inside a card-shaped UI slot: the button builds
 * a same-content Blob URL and opens it directly, so the page is always one
 * click away from a real, unconstrained browser tab.
 */
export function FullPageDocViewer({ content, title }: FullPageDocViewerProps) {
  const openInNewTab = useCallback(() => {
    const blob = new Blob([content], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    // The new tab needs the blob URL to still be valid once it navigates —
    // revoke it after a short delay rather than immediately, and immediately
    // if the popup never actually opened (e.g. blocked) so it isn't leaked.
    if (opened) {
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } else {
      URL.revokeObjectURL(url);
    }
  }, [content]);

  return (
    <div className="full-page-doc-viewer">
      <div className="full-page-doc-viewer__toolbar">
        {title ? <span className="full-page-doc-viewer__title">{title}</span> : null}
        <button type="button" className="full-page-doc-viewer__open-tab" onClick={openInNewTab}>
          Open in new tab ↗
        </button>
      </div>
      <iframe
        data-testid="full-page-doc-frame"
        title={title ?? "Full-page document"}
        className="full-page-doc-viewer__frame"
        srcDoc={content}
        sandbox="allow-same-origin"
      />
    </div>
  );
}
