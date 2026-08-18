import { useEffect, useState } from "react";

/**
 * Resolves edge rendering (curve style) from the active skin (s1) — s2,
 * consus-phase18, design-discussion.md resolved decision #8: Case Board
 * renders edges as organic, sagging "string" curves; Drafting Table and
 * Harness render precise straight/orthogonal lines. Read from the
 * `--consus-edge-style` custom property tokens.css already sets per skin
 * (same getComputedStyle-on-documentElement technique as
 * theme/mermaidTheme.ts's getMermaidThemeVariables, so this stays a single
 * source of truth with the rest of the skin system rather than a second,
 * hardcoded per-diagram-type switch).
 */

export type EdgeCurveStyle = "straight" | "organic";

function isEdgeCurveStyle(value: string): value is EdgeCurveStyle {
  return value === "straight" || value === "organic";
}

/** Reads the currently-resolved --consus-edge-style token. Defaults to
 *  "straight" (Drafting Table's own value) if the token is somehow unset —
 *  never throws, never renders nothing. */
export function resolveEdgeStyle(): EdgeCurveStyle {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--consus-edge-style").trim();
  return isEdgeCurveStyle(raw) ? raw : "straight";
}

/**
 * Live-updating version of resolveEdgeStyle() for components that stay
 * mounted across a skin change (DiagramCanvas.tsx) — useSkinPreference
 * applies [data-skin] as a direct DOM attribute mutation outside React's
 * render cycle, so a plain useState(resolveEdgeStyle()) would go stale the
 * moment the operator switches skins without navigating away. A
 * MutationObserver on the attribute is the correct way to notice that.
 */
export function useEdgeCurveStyle(): EdgeCurveStyle {
  const [style, setStyle] = useState<EdgeCurveStyle>(() => resolveEdgeStyle());

  useEffect(() => {
    setStyle(resolveEdgeStyle());
    const observer = new MutationObserver(() => setStyle(resolveEdgeStyle()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-skin", "data-theme"] });
    return () => observer.disconnect();
  }, []);

  return style;
}

export interface EdgeGeometry {
  /** SVG path `d` attribute. */
  path: string;
  /** Where an edge label (if any) should be centered. */
  labelX: number;
  labelY: number;
}

/**
 * Pure: builds the SVG path for one edge between two points, per curve
 * style. "straight" draws a right-angle (orthogonal) elbow through the
 * vertical midpoint — precise, drafting-table-appropriate lines. "organic"
 * draws a single quadratic bezier whose control point is pulled below the
 * straight-line midpoint, so the curve visibly sags like a pinned string
 * under gravity rather than a taut geometric arc.
 */
export function buildEdgePath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  style: EdgeCurveStyle,
): EdgeGeometry {
  const midX = (sourceX + targetX) / 2;
  const midY = (sourceY + targetY) / 2;

  if (style === "organic") {
    const distance = Math.hypot(targetX - sourceX, targetY - sourceY);
    // Sag grows with distance (a longer pinned string sags more) but is
    // capped so short edges don't loop absurdly.
    const sag = Math.min(60, Math.max(16, distance * 0.18));
    const controlY = midY + sag;
    return {
      path: `M ${sourceX} ${sourceY} Q ${midX} ${controlY} ${targetX} ${targetY}`,
      labelX: midX,
      labelY: controlY,
    };
  }

  // Orthogonal elbow: down from source to the vertical midpoint, across,
  // then down into target — precise right angles, no curve commands.
  return {
    path: `M ${sourceX} ${sourceY} L ${sourceX} ${midY} L ${targetX} ${midY} L ${targetX} ${targetY}`,
    labelX: midX,
    labelY: midY,
  };
}
