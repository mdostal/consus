import { useActiveSkin } from "./useSkinPreference";

/**
 * The real Consus brand mark (consus-phase30-brand-theme-integration, s2) —
 * the "Abstract Mark" concept from .pHive/brand/logo-concepts.yaml (the
 * grain-kernel glyph alone), explicitly recommended there for small-size UI
 * use ("holds up at 16px... candidate for the dock icon, tray icon, and
 * favicon"). Geometry is byte-identical to logo-concepts.yaml's SVG path
 * data; ONLY the fills are changed from that file's hardcoded static hexes
 * to live --consus-* tokens, so the mark stays legible under BOTH themes —
 * the original static #362B6B-on-transparent fill has just 1.4:1 contrast
 * against Granary's dark-mode background (#1a1530), effectively invisible.
 * Using var(--consus-accent) for the kernel and var(--consus-bg) for the
 * cutout details means the mark always matches whatever background it's
 * actually sitting on, in both themes, with zero hardcoded color literals.
 *
 * Rendered ONLY when the active skin is Granary (design-discussion.md's
 * resolved open question) — the other 3 skins keep their existing literal
 * "◈" placeholder glyph, unchanged, at both call sites in App.tsx.
 */
export function BrandMark({
  size = 22,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      role="img"
      aria-label="Consus"
      className={className}
    >
      <circle cx="60" cy="60" r="54" fill="none" stroke="var(--consus-accent)" strokeWidth="1" opacity="0.15" />
      <path
        d="M60,14 C76,14 86,38 86,60 C86,82 76,106 60,106 C44,106 34,82 34,60 C34,38 44,14 60,14 Z"
        fill="var(--consus-accent)"
      />
      <path
        d="M60,26 Q68,60 60,94"
        fill="none"
        stroke="var(--consus-bg)"
        strokeWidth="5"
        strokeLinecap="round"
        opacity="0.85"
      />
      <circle cx="60" cy="76" r="8" fill="var(--consus-bg)" />
    </svg>
  );
}

/**
 * Skin-conditional masthead glyph — the real BrandMark for Granary, the
 * existing literal "◈" placeholder for the other 3 skins (their own
 * fully-realized decorative identities, unchanged). One shared helper so
 * both App.tsx call sites (main masthead, onboarding screen) stay in sync
 * rather than duplicating the conditional.
 */
export function MastheadMark({ size, className }: { size?: number; className?: string }) {
  const skin = useActiveSkin();
  if (skin === "granary") {
    return <BrandMark size={size} className={className} />;
  }
  return <>◈</>;
}
