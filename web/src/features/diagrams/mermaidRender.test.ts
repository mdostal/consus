import { describe, it, expect, vi } from "vitest";

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (_id: string, source: string) => {
    if (source.startsWith("bad")) throw new Error("Parse error on line 1");
    return { svg: `<svg>${source}</svg>` };
  }),
}));

vi.mock("mermaid", () => ({ default: mermaidMock }));

import { renderMermaid } from "./mermaidRender";

describe("renderMermaid", () => {
  it("returns the rendered svg", async () => {
    expect(await renderMermaid("flowchart LR")).toEqual({ ok: true, svg: "<svg>flowchart LR</svg>" });
  });

  it("returns a syntax error as a result instead of throwing", async () => {
    expect(await renderMermaid("bad source")).toEqual({ ok: false, error: "Parse error on line 1" });
  });

  it("reports an empty diagram without calling mermaid", async () => {
    mermaidMock.render.mockClear();
    expect(await renderMermaid("   ")).toEqual({ ok: false, error: "The diagram is empty." });
    expect(mermaidMock.render).not.toHaveBeenCalled();
  });

  it("initializes mermaid once, in strict mode, without injecting its own error graphic", async () => {
    await renderMermaid("flowchart LR");
    expect(mermaidMock.initialize).toHaveBeenCalledTimes(1);
    expect(mermaidMock.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true }),
    );
  });
});
