import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// RTL's automatic cleanup relies on detecting a global `afterEach`, which
// isn't present unless `test.globals: true`. This project imports
// describe/it/expect explicitly instead of using globals, so cleanup is
// wired up explicitly here.
afterEach(() => {
  cleanup();
});

// jsdom has no ResizeObserver. @xyflow/react (s2, consus-phase18) guards
// `typeof ResizeObserver === "undefined"` so it never hard-crashes without
// one, but its EdgeWrapper *unconditionally* returns null (skipping any
// custom edge component entirely, including DiagramCanvas.tsx's own) until
// each endpoint node's handle position has been resolved at least once —
// and that resolution only ever happens from inside a real ResizeObserver
// notification. A real browser's ResizeObserver always fires this
// asynchronously (after the current paint), so DiagramCanvas.test.tsx (and
// friends) await one tick after render for exactly the same reason a real
// user's browser would already have painted by the time they can interact
// with a rendered diagram. Firing synchronously inside observe() would
// actually fire *too early* here — before sibling effects elsewhere in the
// tree (e.g. the one that registers the flow's own DOM node) have run,
// which a real, later-than-commit ResizeObserver tick never races.
class ResizeObserverStub {
  #callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
  }
  observe(target: Element) {
    queueMicrotask(() => {
      this.#callback(
        [{ target, contentRect: target.getBoundingClientRect() } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    });
  }
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

// jsdom also has no DOMMatrixReadOnly — @xyflow/system reads a node's
// current zoom scale via `new DOMMatrixReadOnly(style.transform).m22` while
// resolving handle positions (part of the same ResizeObserver-driven path
// above). A minimal parser covering the `matrix(...)` form CSS transforms
// actually serialize to (and "none" -> identity) is enough here.
class DOMMatrixReadOnlyStub {
  m22: number;
  constructor(transform?: string) {
    const match = typeof transform === "string" ? transform.match(/matrix\(([^)]+)\)/) : null;
    const values = match ? match[1].split(",").map((v) => parseFloat(v.trim())) : [];
    this.m22 = Number.isFinite(values[3]) ? values[3] : 1;
  }
}
if (typeof globalThis.DOMMatrixReadOnly === "undefined") {
  globalThis.DOMMatrixReadOnly = DOMMatrixReadOnlyStub as unknown as typeof DOMMatrixReadOnly;
}

// jsdom never runs real layout, so offsetWidth/offsetHeight/
// getBoundingClientRect are hardcoded to zero on every element —
// @xyflow/system's own dimension/handle-position measurement reads exactly
// those, so without this every node stays permanently "unmeasured" and no
// edge would ever resolve a path, independent of anything DiagramCanvas
// itself does. Falling back to each element's own inline style width/height
// (DiagramCanvas always sets one explicitly, on nodes at least) keeps this
// close to real rather than one magic constant everywhere.
function readInlinePixelSize(el: Element, prop: "width" | "height", fallback: number): number {
  const raw = (el as HTMLElement).style?.[prop];
  const parsed = raw ? parseFloat(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}
Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
  configurable: true,
  get(this: HTMLElement) {
    return readInlinePixelSize(this, "width", this.classList.contains("react-flow__handle") ? 6 : 120);
  },
});
Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
  configurable: true,
  get(this: HTMLElement) {
    return readInlinePixelSize(this, "height", this.classList.contains("react-flow__handle") ? 6 : 40);
  },
});
HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement): DOMRect {
  const width = readInlinePixelSize(this, "width", this.classList.contains("react-flow__handle") ? 6 : 120);
  const height = readInlinePixelSize(this, "height", this.classList.contains("react-flow__handle") ? 6 : 40);
  return {
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON() {
      return this;
    },
  } as DOMRect;
};

// jsdom has no Pointer Events implementation at all (no global
// PointerEvent constructor, no setPointerCapture/releasePointerCapture) —
// @xyflow/system's own node-drag implementation (XYDrag) is pointer-event
// based and calls element.setPointerCapture() unconditionally when a drag
// starts, so without these two, DiagramCanvas.test.tsx's drag-by-handle
// test would fail to even begin a drag, for a jsdom-API-completeness
// reason with nothing to do with DiagramCanvas's own drag-handle wiring.
if (typeof globalThis.PointerEvent === "undefined") {
  class PointerEventStub extends MouseEvent {
    pointerId: number;
    pointerType: string;
    isPrimary: boolean;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 1;
      this.pointerType = params.pointerType ?? "mouse";
      this.isPrimary = params.isPrimary ?? true;
    }
  }
  globalThis.PointerEvent = PointerEventStub as unknown as typeof PointerEvent;
}
if (!HTMLElement.prototype.setPointerCapture) {
  HTMLElement.prototype.setPointerCapture = () => {};
}
if (!HTMLElement.prototype.releasePointerCapture) {
  HTMLElement.prototype.releasePointerCapture = () => {};
}
if (!HTMLElement.prototype.hasPointerCapture) {
  HTMLElement.prototype.hasPointerCapture = () => false;
}
