import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FullPageDocViewer } from "./FullPageDocViewer";

const SIMPLE_PAGE = "<!DOCTYPE html><html><head><style>body{color:red}</style></head><body><p>hi</p></body></html>";

describe("FullPageDocViewer", () => {
  it("renders an <iframe> with srcDoc set to the raw content — not marked.parse + dangerouslySetInnerHTML", () => {
    render(<FullPageDocViewer content={SIMPLE_PAGE} title="doc.html" />);

    const frame = screen.getByTestId("full-page-doc-frame") as HTMLIFrameElement;
    expect(frame.tagName).toBe("IFRAME");
    // srcdoc is set as an attribute (React's srcDoc prop) with the exact,
    // untouched page content — no host-page innerHTML injection at all, so
    // the <head>/<style>/<body> structure can never be silently
    // normalized/stripped the way DocRenderer's dangerouslySetInnerHTML div
    // would (browsers reparent/drop html/head/body when they appear as
    // children of a div; an iframe document has its own, real head/body).
    expect(frame.getAttribute("srcdoc")).toBe(SIMPLE_PAGE);

    // Nothing from DocRenderer's rendering path (marked.parse output, the
    // doc-html div) is present — this is a genuinely separate component.
    expect(screen.queryByTestId("doc-html")).not.toBeInTheDocument();
  });

  it("isolates the doc from host-page styles by using a real iframe document, not an inline element", () => {
    const { container } = render(<FullPageDocViewer content={SIMPLE_PAGE} />);

    // The host page's own DOM tree contains no <style>/<head>/<body> nodes
    // extracted out of the doc — they only exist inside the iframe's own
    // (separate) document, addressed via srcdoc, never parsed into the host
    // document at all.
    expect(container.querySelector("style")).not.toBeInTheDocument();
    expect(container.querySelector("iframe")).toBeInTheDocument();
  });

  it("gives the iframe an accessible title, falling back to a generic one when no title prop is passed", () => {
    render(<FullPageDocViewer content={SIMPLE_PAGE} title=".pHive/brand/brand-guide.html" />);
    expect(screen.getByTitle(".pHive/brand/brand-guide.html")).toBeInTheDocument();
  });

  it("falls back to a generic iframe title when no title prop is given", () => {
    render(<FullPageDocViewer content={SIMPLE_PAGE} />);
    expect(screen.getByTitle("Full-page document")).toBeInTheDocument();
  });

  describe("Open in new tab", () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;

    afterEach(() => {
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
      vi.restoreAllMocks();
    });

    it("provides an explicit 'open in new tab' fallback affordance that opens the same content as a real page, not a squeezed card view", () => {
      URL.createObjectURL = vi.fn(() => "blob:mock-url");
      URL.revokeObjectURL = vi.fn();
      const openSpy = vi.spyOn(window, "open").mockReturnValue({} as Window);

      render(<FullPageDocViewer content={SIMPLE_PAGE} title="doc.html" />);
      fireEvent.click(screen.getByRole("button", { name: /open in new tab/i }));

      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
      const blobArg = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
      expect(blobArg.type).toBe("text/html");
      expect(openSpy).toHaveBeenCalledWith("blob:mock-url", "_blank", "noopener,noreferrer");
    });

    it("revokes the blob URL immediately when the popup is blocked (window.open returns null)", () => {
      URL.createObjectURL = vi.fn(() => "blob:mock-url");
      URL.revokeObjectURL = vi.fn();
      vi.spyOn(window, "open").mockReturnValue(null);

      render(<FullPageDocViewer content={SIMPLE_PAGE} />);
      fireEvent.click(screen.getByRole("button", { name: /open in new tab/i }));

      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    });
  });

  describe("real-render check against the actual .pHive/brand/brand-guide.html artifact", () => {
    // s3's acceptance criteria explicitly call for verifying the REAL
    // artifact already on disk renders correctly (fonts, layout) — not just
    // a synthetic fixture. This reads the genuine file (same bytes GET
    // /api/docs/content would serve) and confirms it survives untouched
    // into the iframe's srcdoc: the Google Fonts <link>, the Fraunces/IBM
    // Plex Sans font-family declarations, and the full <!DOCTYPE html> ...
    // <body> structure are all still present verbatim — nothing stripped,
    // nothing reparented, unlike what DocRenderer's dangerouslySetInnerHTML
    // div would do to the same content.
    const brandGuidePath = join(__dirname, "..", "..", "..", "..", ".pHive", "brand", "brand-guide.html");
    const brandGuideContent = readFileSync(brandGuidePath, "utf-8");

    it("preserves the real brand-guide.html byte-for-byte in the iframe's srcdoc", () => {
      render(<FullPageDocViewer content={brandGuideContent} title=".pHive/brand/brand-guide.html" />);

      const frame = screen.getByTestId("full-page-doc-frame") as HTMLIFrameElement;
      expect(frame.getAttribute("srcdoc")).toBe(brandGuideContent);
    });

    it("carries the real page's Google Fonts link and Fraunces/IBM Plex Sans font-family declarations through untouched", () => {
      expect(brandGuideContent).toContain("fonts.googleapis.com");
      expect(brandGuideContent).toMatch(/Fraunces/);
      expect(brandGuideContent).toMatch(/IBM\+?\s?Plex\s?Sans/);

      render(<FullPageDocViewer content={brandGuideContent} />);
      const frame = screen.getByTestId("full-page-doc-frame") as HTMLIFrameElement;
      const srcdoc = frame.getAttribute("srcdoc") ?? "";
      expect(srcdoc).toContain("fonts.googleapis.com");
      expect(srcdoc).toMatch(/Fraunces/);
      expect(srcdoc).toMatch(/<!DOCTYPE html>/i);
      expect(srcdoc).toMatch(/<\/body>/i);
    });
  });
});
