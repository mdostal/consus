/**
 * Maps the currently-resolved --consus-* custom properties to Mermaid's own
 * `themeVariables` shape, so the rendered diagram SVG (DiagramView.tsx,
 * ArchitectureDiagramView.tsx) actually re-skins along with the rest of the
 * app instead of always rendering Mermaid's fixed default light palette
 * regardless of the active skin/theme (s1, consus-phase18). Read fresh on
 * every render call (not cached) since the active skin/theme can change
 * between renders without a page reload.
 */
export interface MermaidThemeVariables {
  background: string;
  primaryColor: string;
  primaryTextColor: string;
  primaryBorderColor: string;
  lineColor: string;
  secondaryColor: string;
  tertiaryColor: string;
  clusterBkg: string;
  clusterBorder: string;
  edgeLabelBackground: string;
  fontFamily: string;
}

function readToken(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = styles.getPropertyValue(name).trim();
  return value || fallback;
}

export function getMermaidThemeVariables(): MermaidThemeVariables {
  const styles = getComputedStyle(document.documentElement);

  const bg = readToken(styles, "--consus-bg", "#ffffff");
  const bgSubtle = readToken(styles, "--consus-bg-subtle", "#f2f2f2");
  const ink = readToken(styles, "--consus-ink", "#1a1a1a");
  const line = readToken(styles, "--consus-line", "#cccccc");
  const fontUi = readToken(styles, "--consus-font-ui", "ui-sans-serif, system-ui, sans-serif");

  return {
    background: bg,
    primaryColor: bgSubtle,
    primaryTextColor: ink,
    primaryBorderColor: line,
    lineColor: line,
    secondaryColor: bgSubtle,
    tertiaryColor: bg,
    clusterBkg: bgSubtle,
    clusterBorder: line,
    edgeLabelBackground: bg,
    fontFamily: fontUi,
  };
}
