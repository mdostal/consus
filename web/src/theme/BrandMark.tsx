import { useActiveSkin } from "./useSkinPreference";

/**
 * The real Consus brand mark (consus-phase30-brand-theme-integration, s2;
 * corrected same-day, consus-phase30 hotfix) — the "Monogram" concept from
 * .pHive/brand/logo-concepts.yaml: an open "C" arc (the granary door,
 * standing ajar) wrapped around the grain-kernel glyph.
 *
 * THIS IS THE CONCEPT THE OPERATOR ACTUALLY SELECTED — a real, recorded
 * verdict in Consus's own decision UI ({"kind":"concept_selected",
 * "conceptId":"monogram"}, audit_log id 3, 2026-09-10T21:02:01.823Z). The
 * epic's original design-discussion picked "Abstract Mark" instead for
 * small-size UI use, reasoning from a sub-recommendation in logo-
 * concepts.yaml's own text ("holds up at 16px... candidate for the dock
 * icon, tray icon, and favicon") — but that overrode the operator's actual,
 * already-recorded choice without asking, which is exactly backwards. Found
 * live when the operator opened the shipped app and didn't see the mark
 * they'd picked. Fixed by using the real selected concept everywhere a
 * brand mark appears (masthead, favicon, app icon).
 *
 * Geometry is byte-identical to logo-concepts.yaml's SVG path data for
 * "monogram"; only the fills are live --consus-* tokens instead of that
 * file's hardcoded static hexes, so the mark stays legible under BOTH
 * themes (the same fix already proven necessary for Abstract Mark — a
 * static #362B6B ring has ~1.4:1 contrast against Granary's dark
 * background, effectively invisible). Ring = --consus-accent (indigo),
 * kernel fill = --consus-accent-secondary (gold, falls back to accent for
 * skins that don't define it), crease/eye cutout = --consus-bg (always
 * matches whatever surface the mark sits on).
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
      <path
        d="M 101.57,36 A 48,48 0 1 0 101.57,84"
        fill="none"
        stroke="var(--consus-accent)"
        strokeWidth="9"
        strokeLinecap="round"
      />
      <g transform="translate(60,60) scale(0.62) translate(-60,-60)">
        <path
          d="M60,14 C76,14 86,38 86,60 C86,82 76,106 60,106 C44,106 34,82 34,60 C34,38 44,14 60,14 Z"
          fill="var(--consus-accent-secondary, var(--consus-accent))"
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
      </g>
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
