# Consus Brand

Consus's brand identity — colors, typography, personality, and logo concepts — built for
the product's own name mythology (Consus, the Roman god of the granary and of secret
counsel, worshipped via a buried altar unearthed only for the harvest festival).

- **Colors:** Granary Indigo `#362B6B`, Threshing Gold `#9C6316`, Quern Charcoal `#46414F`,
  Parchment `#FAF7F0`.
- **Typography:** Fraunces (display) / IBM Plex Sans (body).
- **Logo direction:** **Monogram** — an open "C" arc (the granary door, standing ajar)
  wrapped around a grain-kernel glyph. Approved 2026-09-10, decided in Consus itself.

Open [`brand-guide.html`](./brand-guide.html) for the full guide (palette, type scale,
spacing, all five logo concepts, and brand-in-context mockups) — the Monogram card is
marked Approved.

## What's here vs. what's live

This folder is a curated, human-facing copy for browsing the repo. The files Consus
actually scans and synthesizes decisions from live at `.pHive/brand/` (same three
files) — that's Hive/Consus's own state directory, not meant for casual browsing. If
the brand system changes (a new logo pass, a palette tweak), update `.pHive/brand/`
first since that's what drives the in-app decision flow, then re-copy the finalized
files here.

| File | Purpose |
|---|---|
| `brand-guide.html` | Full visual brand guide — open directly in a browser. |
| `brand-system.yaml` | Structured tokens (colors, type, personality, concept directions). |
| `logo-concepts.yaml` | The five logo concepts in Consus's `concept-selection/v1` decision shape. |
