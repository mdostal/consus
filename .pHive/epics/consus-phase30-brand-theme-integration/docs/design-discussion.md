# Design Discussion — consus-phase30-brand-theme-integration

## Goal

Wire Consus's now-approved brand (`.pHive/brand/brand-system.yaml` + `logo-concepts.yaml`,
decided live in-app via `consus-phase29-brand-decision-review`, Monogram selected as the logo
direction) into the actual running product: a new default skin built from the real palette and
typography, a real desktop app icon set, a web favicon, and a real brand mark replacing the
placeholder `◈` character in the masthead.

This closes the gap the operator named directly: the brand work so far produced approved
*artifacts* (a decided decision, a brand guide, a `branding/` folder) but none of it is actually
*applied* anywhere in the product's own UI or app bundle.

## Grounding (from direct code research, not assumption)

- `web/src/theme/tokens.css` — one file, three skins (`drafting` / `case-board` / `harness`), each
  a `[data-skin="..."]` block repeated three ways (bare block, `@media (prefers-color-scheme:
  dark)` guarded, explicit `[data-theme="dark"]`) over a fixed 9-token palette
  (`--consus-bg`, `--consus-bg-subtle`, `--consus-ink`, `--consus-ink-muted`, `--consus-accent`,
  `--consus-good`, `--consus-warn`, `--consus-bad`, `--consus-line`) plus 3 font tokens
  (`--consus-font-body`, `--consus-font-ui`, `--consus-font-mono`) and 2 shape tokens
  (`--consus-radius-scale`, `--consus-edge-style`).
- Skin registration touches exactly 4 files: `web/src/theme/useSkinPreference.ts` (the
  `SkinPreference` union, `isSkinPreference` guard, `DEFAULT_SKIN`, localStorage persistence under
  `SKIN_STORAGE_KEY`), `web/src/theme/ThemeSkinPicker.tsx` (hardcoded `SKIN_OPTIONS` array feeding
  a `<select>`), `tokens.css` (new rule block), and `web/index.html`'s inline bootstrap `<script>`
  (hardcodes the `"case-board"||"harness"` fallback-to-`"drafting"` check — this must be extended
  or the pre-hydration flash-of-wrong-skin logic silently drops Granary).
- No webfont loading exists anywhere in this codebase today — confirmed via direct grep (zero
  `@font-face`, zero `<link>` tags, pure system-font-stack CSS vars). Fraunces and IBM Plex Sans
  are both SIL Open Font License — safe to bundle as static assets and self-host via `@font-face`,
  consistent with Consus's own stated "local-first, no network dependency by default" policy
  (VISION.md's Fixed Boundaries) — no Google Fonts CDN fetch.
- The masthead mark (`◈`) is a literal Unicode character at exactly 3 call sites:
  `web/src/App.tsx:1794` (main masthead), `web/src/App.tsx:1640` (onboarding screen),
  `web/src/features/harness-connect/HarnessConnectBanner.tsx:42`.
- The desktop icon set (`app/src-tauri/icons/{32x32.png,128x128.png,128x128@2x.png,icon.icns,
  icon.ico}`) currently renders the OLD placeholder mark — a generic hub-and-spoke graph on
  indigo (commit `70042e9`, story `consus-phase26-desktop-app/s4-app-icons.yaml`) — which
  `branding/brand-guide.html`'s own text explicitly names as a placeholder to replace. No
  generation script is checked in; the confirmed prior mechanism was a Python/Pillow-generated
  source mark (supersampled, downsampled) piped through `cargo tauri icon` to derive every
  platform size. This epic reuses that exact mechanism.
- `web/index.html` has zero `<link rel="icon">` — no favicon exists today.

## Proposed approach

### 1. Granary skin — new 4th option, default for fresh installs only

Add `[data-skin="granary"]` to `tokens.css` following the established 3-state pattern exactly.
Palette derived from `brand-system.yaml`:

- Light: `--consus-bg: #FAF7F0` (Parchment), `--consus-accent: #362B6B` (Granary Indigo),
  secondary/badge emphasis uses Threshing Gold `#9C6316`, `--consus-ink` a Granary-Indigo-tinted
  near-black (not pure Quern Charcoal `#46414F` directly as ink — that hex is documented for body
  text/borders at *reduced* weight; full-strength body ink should read slightly darker for AA
  contrast against Parchment — verify contrast ratio during build, adjust if under 4.5:1).
- Dark: not a literal color-inversion (brand-system.yaml defines one palette only) — derive a true
  companion following the same relationship the other 3 skins use (dark bg is a near-black tint of
  the *accent* hue, not a generic dark grey). Proposed: bg a very dark indigo (`~#1a1530`), ink a
  warm parchment-tinted off-white, accent brightened for dark-background contrast, Threshing Gold
  kept close to its light value (gold reads fine on dark). Exact hexes finalized during build via
  real contrast-ratio checks, not guessed here.
- Typography: `--consus-font-body: "IBM Plex Sans", ...system fallback`, display/heading weight
  uses Fraunces (introduced via a new `--consus-font-display` token consumed by heading-level
  selectors — the existing token set has no display/body split today since no skin needed one;
  adding this token is additive, the other 3 skins simply never set it and keep using
  `--consus-font-body` for everything as today).
- Shape: `--consus-radius-scale` and `--consus-edge-style` — a value distinct from all 3 existing
  skins (avoid accidentally reusing Drafting's sharp 0.2 or Case Board's organic 1.3) — propose a
  moderate, confident radius (~0.6-0.8) with `straight` edges (the brand personality is "precise,
  trustworthy, unshowy" — not organic/sketchy like Case Board).
- Decorative component: propose Granary does **not** get a bespoke `SkinBackdrop`-style texture
  component initially — "quietly mythic... confidence through clarity, not decoration" (brand
  personality statement) argues against an ornamental layer competing with the other 3 skins'
  distinct textures. Ship clean/minimal; a decorative pass can follow later if the operator wants
  one after seeing it live.

**Default-for-fresh-installs-only.** `DEFAULT_SKIN` changes to `"granary"`, but this constant is
only ever consulted when `useSkinPreference` finds nothing in `localStorage` — an existing
install's stored preference (whatever skin they're already on) is read first and always wins, so
nobody's current skin silently changes underneath them. Verified via existing hook logic during
research; a regression test asserting this exact behavior is part of the story.

### 2. Typography — self-hosted, Granary-scoped only

Bundle Fraunces + IBM Plex Sans (both OFL) as static font files under `web/public/fonts/` (or
equivalent Vite static-asset path), loaded via `@font-face` declarations scoped inside
`[data-skin="granary"]`'s own CSS (or a small dedicated `fonts.css` imported once, with the
`@font-face` blocks themselves unconditional — `@font-face` can't be scoped to a selector, but the
font only gets *referenced* by Granary's tokens, so the files simply go unused/unfetched by a
browser when another skin is active, since nothing else's `font-family` names them). Keep the
bundled weight subset minimal (400/500/600/700 per brand-system.yaml's documented weight usage) to
avoid bloating the build.

### 3. Masthead mark — resolving the open question

**Decision for this epic: Granary-only, not all 4 skins.** The other 3 skins (Drafting Table, Case
Board, Harness) each have their own fully-realized, pre-existing decorative identity — forcing a
literal brand-mark SVG into their masthead is a visual intrusion that wasn't part of what was
approved (the brand decision was "pick a logo direction for Consus," not "replace every skin's
existing masthead treatment"). `◈` already functions fine as a neutral placeholder glyph in the
other 3 skins' own visual languages. Only Granary's masthead renders the real mark — this also
sidesteps having to load the mark's SVG unconditionally on every skin, and keeps the blast radius
of this epic contained to the skin actually being introduced. `HarnessConnectBanner.tsx`'s own
`◈` stays literal (it's a connect-banner icon shown identically across skins, not masthead
branding) — out of scope for this epic.

The mark used: **Abstract Mark** (the grain-kernel glyph alone), not Monogram. Both are approved
concepts from the same decided brand system, but `logo-concepts.yaml`'s own description explicitly
recommends Abstract Mark for exactly this use — "holds up at 16px... candidate for the dock icon,
tray icon, and favicon" — a masthead mark sits at a comparably small size next to the wordmark text,
same constraint. Monogram remains the primary *logo direction* (used in `branding/`'s own
brand-guide presentation, README, etc.) but isn't the right choice for a ~16-20px inline UI glyph.

### 4. Desktop app icon + web favicon

Regenerate `app/src-tauri/icons/*` from the Abstract Mark SVG using the same confirmed mechanism
(source mark → Pillow supersample/downsample → `cargo tauri icon`), replacing the old hub-and-spoke
placeholder. Add a real `<link rel="icon">` favicon to `web/index.html`, same mark.

### 5. Settings-level icon/mark picker — explicitly descoped

The operator raised wanting icon flexibility "tacked to settings" if multiple real candidates
exist. The desktop `.app` bundle icon is baked in at build time (Tauri bundles the `.icns`/`.ico`
into the app package) — it cannot be a live, in-app runtime setting without a full rebuild and
reinstall, so there is no web-settings control that could actually change it. The web favicon and
masthead mark technically *could* be a runtime pick, but there is currently only one real,
brand-guide-recommended candidate for each surface (Abstract Mark for both) — building a variant
picker UI for a choice of one option is speculative scope with no real alternative to offer yet.
**Descoped from this epic.** If a second real icon concept materializes later (the operator
mentioned recalling "another pass" — nothing beyond the 5 documented `logo-concepts.yaml` concepts
was found in `.pHive/` or `branding/` during this epic's research), a settings picker becomes a
real, well-bounded follow-up story then.

## Risks

- **Contrast/accessibility regression** — brand-system.yaml's raw hexes weren't authored against
  WCAG contrast ratios. Mitigation: verify computed contrast (ink-on-bg, accent-on-bg) during
  build; adjust tints if under 4.5:1 for body text.
- **Visual drift from "done well"** — a mechanical CSS-token swap alone risks looking unfinished
  next to 3 fully-realized skins. Mitigation: explicit story for full-surface visual verification
  (buttons, inputs, badges, decision detail view, diagram canvas, command palette) via Playwright
  screenshots against the real running app, iterated until it reads as complete — not just "the
  background changed color."
- **Font bundle size** — self-hosting 2 typefaces × up to 4 weights adds real bytes to the build.
  Mitigation: subset to the 4 weights brand-system.yaml actually documents using, woff2 only (no
  legacy formats needed for a modern Tauri webview / this repo's supported browser range).

## Scale assessment

**Medium** — multi-file, cross-stack (web CSS/TS + a Python icon-generation step + Rust-side Tauri
bundle config), but bounded and well-understood after direct research; no new architectural layer,
no backend change. Proceeding directly to story decomposition (research already complete; H/V
slicing folded directly into the story boundaries below rather than run as a separate ceremony).
