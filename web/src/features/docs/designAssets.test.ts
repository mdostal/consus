import { describe, it, expect } from "vitest";
import { designAssetUrl, isDesignDoc, resolveDesignImageSrc } from "./designAssets";

describe("isDesignDoc", () => {
  it("is true for a doc under .pHive/design/", () => {
    expect(isDesignDoc(".pHive/design/my-topic/brief.md")).toBe(true);
  });

  it("is false for a code doc under .pHive/epics/", () => {
    expect(isDesignDoc(".pHive/epics/my-epic/docs/architecture.md")).toBe(false);
  });

  it("is false for an overview doc", () => {
    expect(isDesignDoc("README.md")).toBe(false);
  });
});

describe("resolveDesignImageSrc", () => {
  it("resolves a bare relative filename against the doc's own directory", () => {
    expect(resolveDesignImageSrc(".pHive/design/my-topic/brief.md", "v1.png")).toBe(
      ".pHive/design/my-topic/v1.png",
    );
  });

  it("resolves a ./-prefixed relative filename the same way", () => {
    expect(resolveDesignImageSrc(".pHive/design/my-topic/brief.md", "./v1.png")).toBe(
      ".pHive/design/my-topic/v1.png",
    );
  });

  it("leaves an already-repo-relative .pHive/design/ path unchanged", () => {
    expect(resolveDesignImageSrc(".pHive/design/my-topic/brief.md", ".pHive/design/my-topic/v2.png")).toBe(
      ".pHive/design/my-topic/v2.png",
    );
  });

  it("leaves an absolute http(s) URL unchanged", () => {
    expect(resolveDesignImageSrc(".pHive/design/my-topic/brief.md", "https://example.com/x.png")).toBe(
      "https://example.com/x.png",
    );
  });

  it("leaves a data: URI unchanged", () => {
    const dataUri = "data:image/png;base64,AAAA";
    expect(resolveDesignImageSrc(".pHive/design/my-topic/brief.md", dataUri)).toBe(dataUri);
  });
});

describe("designAssetUrl", () => {
  it("builds a GET /api/design-assets URL with repo and path query-encoded", () => {
    expect(designAssetUrl("consus", ".pHive/design/my topic/v1.png")).toBe(
      "/api/design-assets?repo=consus&path=" + encodeURIComponent(".pHive/design/my topic/v1.png"),
    );
  });
});
