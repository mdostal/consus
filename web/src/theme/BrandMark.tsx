import { useActiveSkin } from "./useSkinPreference";

/**
 * The Consus masthead glyph (consus-phase30-brand-theme-integration, s2;
 * corrected twice same-week — see below) — the "Abstract Mark" concept from
 * .pHive/brand/logo-concepts.yaml: the grain-kernel glyph alone.
 *
 * DELIBERATE SPLIT, operator-confirmed: this in-UI masthead glyph uses
 * Abstract Mark (the concept logo-concepts.yaml itself recommends for
 * compact, small-size use — "holds up at 16px"), while the app's *external*
 * representations — the dock icon, app bundle icon, and favicon — use
 * Monogram (BrandExternalMark below / scripts/generate-brand-icon.py /
 * web/public/favicon.{svg,ico}), the concept the operator actually selected
 * as the primary logo direction ({"kind":"concept_selected",
 * "conceptId":"monogram"}, audit_log id 3). Two real course corrections
 * happened here, in order:
 *   1. The epic's original design-discussion put Abstract Mark EVERYWHERE
 *      (masthead + icon + favicon), reasoning only from logo-concepts.yaml's
 *      small-size recommendation — this silently overrode the operator's
 *      actual recorded verdict for the external-facing surfaces.
 *   2. First hotfix over-corrected: swapped ALL surfaces to Monogram,
 *      including this masthead glyph.
 *   3. Operator's own clarification settled it: Abstract Mark in-app
 *      (compact UI use, exactly what it was designed for), Monogram for the
 *      dock/app-icon/favicon (the operator's chosen standalone identity).
 *      This file now reflects that final, confirmed split.
 *
 * Geometry is byte-identical to logo-concepts.yaml's "abstract-mark" SVG
 * path data; only the fills are live --consus-* tokens instead of that
 * file's hardcoded static hexes, so the mark stays legible under BOTH
 * themes — the original static #362B6B fill has just 1.4:1 contrast against
 * Granary's dark-mode background (#1a1530), effectively invisible.
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
 * Skin-conditional masthead glyph — the real BrandMark (Abstract Mark) for
 * Granary, the existing literal "◈" placeholder for the other 3 skins
 * (their own fully-realized decorative identities, unchanged). One shared
 * helper so both App.tsx call sites (main masthead, onboarding screen) stay
 * in sync rather than duplicating the conditional.
 */
export function MastheadMark({ size, className }: { size?: number; className?: string }) {
  const skin = useActiveSkin();
  if (skin === "granary") {
    return <BrandMark size={size} className={className} />;
  }
  return <>◈</>;
}
