import { useCallback, useEffect, useState } from "react";

export type SkinPreference = "drafting" | "case-board" | "harness";

/** Namespaced "consus:" prefix, distinct from the theme preference's own
 *  key — the two axes are independent and must never collide. */
export const SKIN_STORAGE_KEY = "consus:skin-preference";

/** Default skin (Drafting Table) — unlike theme's "system" default, skin
 *  always resolves to a concrete value; there's no OS-level "system skin". */
export const DEFAULT_SKIN: SkinPreference = "drafting";

function isSkinPreference(value: unknown): value is SkinPreference {
  return value === "drafting" || value === "case-board" || value === "harness";
}

/** Reads the stored skin, defaulting to Drafting Table for a fresh install
 *  or a corrupt/unrecognized stored value. Never throws. */
function readStored(): SkinPreference {
  try {
    const raw = window.localStorage.getItem(SKIN_STORAGE_KEY);
    return isSkinPreference(raw) ? raw : DEFAULT_SKIN;
  } catch {
    return DEFAULT_SKIN;
  }
}

/** Applies [data-skin] to the document root — always an explicit value
 *  (including the default), so tokens.css's [data-skin="drafting"] rules
 *  are always the ones in effect, never a bare-:root fallback by accident. */
export function applySkinToDocument(skin: SkinPreference): void {
  document.documentElement.setAttribute("data-skin", skin);
}

function persist(skin: SkinPreference): void {
  try {
    window.localStorage.setItem(SKIN_STORAGE_KEY, skin);
  } catch {
    // best-effort — a failed write must never break the app
  }
}

/**
 * Resolves and persists the operator's skin choice (s1, consus-phase18) —
 * Drafting Table (default) / Case Board / Harness. Orthogonal to theme:
 * this hook never reads or writes anything theme-related, by design (see
 * design-discussion.md's "Resolved design decisions" #2 — every skin must
 * work under both themes, so the two axes are kept structurally
 * independent rather than combined into one enum).
 *
 * Same before-first-paint bootstrap story as useThemePreference: an inline
 * script in index.html applies the stored/default skin before React mounts;
 * this hook re-applies it on mount and on every explicit change.
 */
export function useSkinPreference(): { skin: SkinPreference; setSkin: (next: SkinPreference) => void } {
  const [skin, setSkinState] = useState<SkinPreference>(() => readStored());

  useEffect(() => {
    applySkinToDocument(skin);
  }, [skin]);

  const setSkin = useCallback((next: SkinPreference) => {
    setSkinState(next);
    persist(next);
  }, []);

  return { skin, setSkin };
}

/** Reads whatever [data-skin] is actually applied to the document root
 *  right now, defaulting to Drafting Table for a missing/invalid value —
 *  same fallback DEFAULT_SKIN as everywhere else in this file. */
function readActiveSkinAttribute(): SkinPreference {
  const raw = document.documentElement.getAttribute("data-skin");
  return isSkinPreference(raw) ? raw : DEFAULT_SKIN;
}

/**
 * Read-only complement to useSkinPreference (s5, consus-phase18): reflects
 * whatever [data-skin] is *actually* applied to the document root right
 * now, live, without owning or persisting a preference of its own — the
 * same read-only "watch the live attribute" role CaseBoardCorkTexture.tsx's
 * own MutationObserver already plays there for its cork-grain redraw,
 * reused here rather than introducing a second, parallel per-skin
 * mechanism.
 *
 * Meant for presentational components (DiagramMetadataStrip) that must
 * always match whichever skin is genuinely in effect, including under test
 * setups that apply [data-skin] directly to the document root rather than
 * through useSkinPreference's own localStorage-backed state — without
 * themselves becoming another independent preference-owning instance whose
 * own mount effect could clobber a manually-applied attribute (the way a
 * second useSkinPreference() call legitimately would, since that hook's
 * whole job is to assert its own resolved value onto the document).
 */
export function useActiveSkin(): SkinPreference {
  const [skin, setSkin] = useState<SkinPreference>(() => readActiveSkinAttribute());

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setSkin(readActiveSkinAttribute());
    sync(); // covers a change between this component's initial render and this effect running
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["data-skin"] });
    return () => observer.disconnect();
  }, []);

  return skin;
}
