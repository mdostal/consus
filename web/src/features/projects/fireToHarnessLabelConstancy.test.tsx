import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen, act } from "@testing-library/react";
import { DiagramView } from "./DiagramView";
import { ArchitectureDiagramView } from "./ArchitectureDiagramView";

const here = dirname(fileURLToPath(import.meta.url));

/** Finds the single <button>...</button> block (source text) whose own
 *  rendered content mentions "harness" — tolerant of surrounding attributes/
 *  whitespace/indentation, but not of a different label being used. */
function extractFireButtonText(source: string): string | undefined {
  const buttonBlocks = source.match(/<button[^>]*>[\s\S]*?<\/button>/gi) ?? [];
  const fireBlock = buttonBlocks.find((block) => /harness/i.test(block));
  if (!fireBlock) return undefined;
  const inner = fireBlock.replace(/^<button[^>]*>/i, "").replace(/<\/button>$/i, "");
  return inner.replace(/\s+/g, " ").trim();
}

const EPICS = [
  {
    id: "epic-a",
    title: "Epic A",
    stories: [{ id: "s1", title: "Story One", complexity: "low", dependsOn: [] }],
  },
];
const TOP_LEVEL = 'graph TD\n  root["consus"]\n  root --> src["src"]';
const FULL_COMPONENT = TOP_LEVEL;

function setSkin(skin: string | null) {
  if (skin === null) document.documentElement.removeAttribute("data-skin");
  else document.documentElement.setAttribute("data-skin", skin);
}

afterEach(() => {
  setSkin(null);
});

/**
 * design-discussion.md resolved decision #3: skins may reflavor the
 * changeset log's verb vocabulary, but "the underlying event types and the
 * 'Fire to harness' action label itself are constant across skins." s5's
 * own job is to verify that constancy held through s2-s4's work with a
 * real, source-level check — not eyeball it.
 */
describe("'Fire to harness' action label — constant across all 3 skins, source-level check", () => {
  it("DiagramView.tsx's on-screen button literally reads 'Fire to harness', character for character (whitespace-normalized source check)", () => {
    const source = readFileSync(join(here, "DiagramView.tsx"), "utf-8");
    expect(extractFireButtonText(source)).toBe("Fire to harness");
  });

  it("ArchitectureDiagramView.tsx's on-screen button literally reads 'Fire to harness', character for character (whitespace-normalized source check)", () => {
    const source = readFileSync(join(here, "ArchitectureDiagramView.tsx"), "utf-8");
    expect(extractFireButtonText(source)).toBe("Fire to harness");
  });

  it("every <button> in either file whose text mentions 'harness' reads exactly 'Fire to harness' — no differently-worded variant (e.g. a per-skin-conditional label) exists anywhere in either file", () => {
    for (const file of ["DiagramView.tsx", "ArchitectureDiagramView.tsx"]) {
      const source = readFileSync(join(here, file), "utf-8");
      const buttonBlocks = source.match(/<button[^>]*>[\s\S]*?<\/button>/gi) ?? [];
      const harnessButtons = buttonBlocks.filter((block) => /harness/i.test(block));
      expect(harnessButtons.length).toBeGreaterThan(0); // sanity: the button really is present
      for (const block of harnessButtons) {
        const inner = block
          .replace(/^<button[^>]*>/i, "")
          .replace(/<\/button>$/i, "")
          .replace(/\s+/g, " ")
          .trim();
        expect(inner).toBe("Fire to harness");
      }
    }
  });

  it("renders the exact same button text, character for character, across all 3 skins — DiagramView", async () => {
    for (const skin of ["drafting", "case-board", "harness"] as const) {
      setSkin(skin);
      const onProposeChange = vi.fn();
      let unmount!: () => void;
      await act(async () => {
        const utils = render(<DiagramView repo="consus" epics={EPICS} onProposeChange={onProposeChange} />);
        unmount = utils.unmount;
        await Promise.resolve();
        await Promise.resolve();
      });

      const button = screen.getByRole("button", { name: /fire to harness/i });
      expect(button.textContent?.trim()).toBe("Fire to harness");

      unmount();
    }
  });

  it("renders the exact same button text, character for character, across all 3 skins — ArchitectureDiagramView", async () => {
    for (const skin of ["drafting", "case-board", "harness"] as const) {
      setSkin(skin);
      const onProposeChange = vi.fn();
      let unmount!: () => void;
      await act(async () => {
        const utils = render(
          <ArchitectureDiagramView
            repo="consus"
            topLevel={TOP_LEVEL}
            fullComponent={FULL_COMPONENT}
            onProposeChange={onProposeChange}
          />,
        );
        unmount = utils.unmount;
        await Promise.resolve();
        await Promise.resolve();
      });

      const button = screen.getByRole("button", { name: /fire to harness/i });
      expect(button.textContent?.trim()).toBe("Fire to harness");

      unmount();
    }
  });
});
