# Flayr super-admin nav survey, v2 (PANT-941)

This rebuilds the Consus survey "Flayr super-admin nav redesign" (old survey `6655e722-b234-478d-ab36-196c2c55392a`). The new survey carries native `research[]` sections, corrected facts, and a `doc` pointer to these briefs.

Everything here was read from `firefly-events/flayr`, branch `development`, pinned at **`b6cae430b336fdc47a2a269214019df87620936a`** (2026-10-08). Every source link below is a permalink at that SHA.

| Member | Brief |
|---|---|
| 0. Overall nav structure (concept selection) | [0-overall-structure.md](0-overall-structure.md) |
| 1. Does read-only research get its own category? | [1-research-category.md](1-research-category.md) |
| 2. Subscription tiers, reward tiers and tier margins: merge or not? | [2-tiers.md](2-tiers.md) |
| 3. Review Submissions and In-App Review Moderation: one page or two? | [3-reviews.md](3-reviews.md) |
| 4. Feature Toggles vs Feature Flags: confirm keeping them separate | [4-toggles-flags.md](4-toggles-flags.md) |

## About the images
The PNGs in `renders/` are **mockups built from the real `NAV_ITEMS` labels in their real order**, not screenshots. The super-admin app sits behind Clerk and Convex auth, and no browser on the agent runner can sign in. `render.cjs` and `images.cjs` regenerate them; the script fails if any option's grouping misses an item, duplicates one, or invents one.

PANT-919's renders were built from the 41-item nav at `191db583`. Six links have been added since, so those renders no longer match the code and aren't reused.

## What changed since the old survey's text
- The nav has **47** items at `b6cae430`. The old text said 37 (decisions) and 38 (options). PANT-919 counted 41 at `191db583`. Since then, Money, Trouble, Funnels, Watermarks, Zernio Accounts and Case Studies were added, and "Dashboard" was renamed "Command Center".
- "Tier Cost Buckets" is not a page. It's the "Cost breakdown per tier" section inside Tier Margin Analysis.
- "Reviews" is the queue of external G2 / Product Hunt / Capterra / Trustpilot review submissions. It's not a public review list.
- Feature Toggles vs Feature Flags means editable Convex rows vs a read-only, build-time registry. Nothing in the code is per tenant.
- "Credit Research" is chat credit-confirmation UX research (FIR-1855), not pricing.

## Claims ledger
Base: `https://github.com/firefly-events/flayr/blob/b6cae430b336fdc47a2a269214019df87620936a/apps/dashboard/`

| # | Claim | Backed by |
|---|---|---|
| 1 | The sidebar is one flat `NAV_ITEMS` array of 47 links | `src/app/super-admin/layout.tsx` L15-L63 (entries on L16-L62) |
| 2 | It renders as one `<ul>` with no groups, collapsing or tabs | `src/app/super-admin/layout.tsx` L121-L130 |
| 3 | 50 `page.tsx` files exist under `super-admin/`; 3 aren't nav entries (`case-studies/[slug]`, `flares-grant`, `users/[clerkId]`) | file tree at the SHA (`find src/app/super-admin -name page.tsx`) |
| 4 | Six links were added after `191db583`, and Dashboard was renamed Command Center | `git diff 191db583 b6cae430 -- src/app/super-admin/layout.tsx` |
| 5 | Tiers is the subscription "Tier Feature Matrix", editable through Convex `admin.getTierConfigs` / `updateTierConfig` | `src/app/super-admin/tiers/page.tsx` L30-L32, L102 |
| 6 | Tiers reads the `socialTierConfigs` table | `convex/admin.ts` L55-L60 |
| 7 | Reward Tiers is the gift-card "Reward Tier Ladder" (Convex `rewardTiers`, `rewardGating`), live without a deploy | `src/app/super-admin/reward-tiers/page.tsx` L37-L42, L59-L62 |
| 8 | Reward Tiers already has its own Tiers / Gating tab bar | `src/app/super-admin/reward-tiers/page.tsx` L67-L68 |
| 9 | Tier Margin Analysis is static: computed from `TIER_COST_TABLE`, with no Convex calls | `src/app/super-admin/tier-margin-analysis/page.tsx` L1-L18, L27-L29 |
| 10 | Its per-tier "cost bucket" breakdown is a section of that page, not a page | `src/app/super-admin/tier-margin-analysis/page.tsx` L100-L102; `src/lib/tier-margin-analysis.ts` L101-L102, L120 |
| 11 | Tier Margin Analysis hard-codes its own revenue per subscription tier (`monthlyRevenueUsd`) for the same tier ids | `src/lib/tier-margin-analysis.ts` L90, L111-L116, L140-L147 |
| 12 | Reviews is "Review Submissions": external URLs on G2, Product Hunt, Capterra and Trustpilot | `src/app/super-admin/reviews/page.tsx` L11-L16, L134-L139 |
| 13 | Approving a review submission grants a one-time reward of 500 | `convex/reviewSubmissions.ts` L1-L6, L30, L127-L147 |
| 14 | Review Moderation is "In-App Review Moderation" over a different table (`reviews`), with approve / reject / flag | `src/app/super-admin/review-moderation/page.tsx` L12-L16, L70-L76; `convex/reviews.ts` L1-L5, L162, L189 |
| 15 | Approved in-app reviews appear on /pricing and /community | `src/app/super-admin/review-moderation/page.tsx` L74-L76; `convex/reviews.ts` L127 (`listPublic`) |
| 16 | Feature Toggles are editable Convex rows (Coming Soon gates and staged rollout) that take effect immediately | `src/app/super-admin/feature-toggles/page.tsx` L166-L168, L205-L206; `convex/featureToggles.ts` L1-L6 |
| 17 | Feature Flags is a read-only view of the static, build-time `FEATURE_FLAGS` registry | `src/app/super-admin/feature-flags/page.tsx` L1-L11; `src/config/feature-registry.ts` L81 |
| 18 | Neither toggles nor flags are scoped per tenant | no tenant, org or workspace key in `convex/featureToggles.ts` or `src/app/super-admin/feature-toggles/page.tsx` (grep at the SHA) |
| 19 | Credit Research is chat credit-confirmation UX research (FIR-1855) | `src/app/super-admin/credit-confirmation-research/page.tsx` L1-L14 |
| 20 | Competitor Pricing is a static competitor catalogue for the pricing committee (FIR-1644 / FIR-1517) | `src/app/super-admin/competitor-pricing-analysis/page.tsx` L1-L9 |
| 21 | Reward Economics is a static worst-case burn analysis for the loyalty programme (FIR-1922) | `src/app/super-admin/reward-economics/page.tsx` L1-L8 |
| 22 | The four research pages make no Convex query or mutation | the same four `page.tsx` files: zero matches for `useQuery`, `useMutation`, `fetchQuery` or `convex` |
| 23 | Money is a live, operational page (Stripe/Autumn revenue snapshot, the AI spend ledger, Embers economics) | `src/app/super-admin/money/page.tsx` L1-L8 |
