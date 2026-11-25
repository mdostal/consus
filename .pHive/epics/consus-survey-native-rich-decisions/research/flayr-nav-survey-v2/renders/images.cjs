const { render } = require("./render.cjs");

const RESEARCH = ["Tier Margin Analysis", "Competitor Pricing", "Credit Research", "Reward Economics"];
const TIERS = ["Tiers", "Reward Tiers", "Tier Margin Analysis"];
const REVIEWS = ["Reviews", "Review Moderation"];
const TOGGLES = ["Feature Toggles", "Feature Flags"];
const NEW_SINCE_PROTOTYPES = ["Money", "Trouble", "Funnels", "Watermarks", "Zernio Accounts", "Case Studies"];

const OVERVIEW = ["Command Center", "Insights", "Money", "Trouble", "Funnels", "Activity Feed", "Product Velocity", "Audit Log"];
const USERS = ["Users", "↳ Migrations", "Trial Grants", "Grace Period Config"];
const ENGINEERING = ["Feature Toggles", "Feature Flags", "Integrations", "Provider Keys", "Zernio Accounts", "Zernio Profiles", "Model Catalogue", "Incidents", "Dictation Limits"];

const full = (groups) => groups.map((g) => ({ ...g, full: true }));

const OPTION_A = full([
  { name: "Overview & Insights", items: OVERVIEW },
  { name: "Comms & Community", items: ["Feedback", "Announcements", "Polls", "Challenges", "Leaderboards"] },
  { name: "Users & Access", items: USERS },
  { name: "Billing & Credits", items: ["Credit Drift", "Credit Rollover", "Grant Embers", "Promo Codes", "Post Recovery"] },
  { name: "Tiers, Rewards & Pricing", items: ["Tiers", "Reward Tiers", "Tier Margin Analysis", "Rewards & Locks", "Reward Economics", "Competitor Pricing", "Credit Research", "Pricing Promotions"] },
  { name: "Growth & Referral", items: ["Ambassadors", "Virality", "Partner Affiliations", "Case Studies", "Marketing Assets"] },
  { name: "Content & Moderation", items: ["Reviews", "Review Moderation", "Watermarks"] },
  { name: "Engineering & Integrations", items: ENGINEERING },
]);

const OPTION_B = full([
  { name: "Overview", items: OVERVIEW },
  { name: "Users", items: USERS },
  { name: "Content & Community", items: ["Feedback", "Polls", "Challenges", "Leaderboards", "Reviews", "Review Moderation", "Case Studies"] },
  { name: "Growth", items: ["Ambassadors", "Virality", "Partner Affiliations", "Promo Codes"] },
  { name: "Comms & Marketing", items: ["Announcements", "Marketing Assets", "Watermarks"] },
  { name: "Platform & Engineering", items: ENGINEERING },
  { name: "Billing & Pricing", items: ["Tiers", "Tier Margin Analysis", "Competitor Pricing", "Pricing Promotions", "Credit Research"] },
  { name: "Credits & Rewards Economy", items: ["Credit Drift", "Credit Rollover", "Grant Embers", "Post Recovery", "Rewards & Locks", "Reward Economics", "Reward Tiers"] },
]);

const C_GROUPS = [
  { name: "Overview", items: OVERVIEW },
  { name: "Users", items: USERS },
  { name: "Community", items: ["Feedback", "Polls", "Challenges", "Leaderboards", "Reviews", "Review Moderation"] },
  { name: "Growth & Marketing", items: ["Ambassadors", "Virality", "Partner Affiliations", "Promo Codes", "Announcements", "Marketing Assets", "Case Studies", "Watermarks"] },
  { name: "Engineering", items: ENGINEERING },
  { name: "Billing", items: ["Tiers", "Pricing Promotions", "Credit Drift", "Credit Rollover", "Post Recovery"] },
  { name: "Rewards", items: ["Rewards & Locks", "Reward Tiers", "Grant Embers"] },
];
const OPTION_C = full([...C_GROUPS, { name: "Pricing Intelligence", items: RESEARCH, accent: true }]);
const OPTION_D = full([...C_GROUPS, { name: "Pricing & Economics Research", items: RESEARCH, tabs: true, accent: true }]);

const OPT_NOTE =
  "Group names come from the option's own description. Placement of each item is a reconstruction (the claude.ai prototypes return 403 and placed 37-38 items); the 6 items added since then are placed by the same rule. Every one of the 47 items is placed exactly once (checked by the render script).";

render("00-current-nav.png", {
  title: "Current state: super-admin sidebar",
  subtitle: "One flat <ul> of 47 links (layout.tsx NAV_ITEMS, lines 15-62), rendered at lines 121-130. No groups, no collapsing, no tabs. Highlighted: the 6 links added after the four prototypes were built.",
  highlight: NEW_SINCE_PROTOTYPES,
  notes: ["At the real row height (py-2 plus a 20px icon, about 40px a row) the list is roughly 1,900px tall, so it scrolls on any normal screen."],
});

render("10-option-A-accordion.png", { title: "Option A: accordion groups", subtitle: "8 collapsible sidebar groups and a search box. Collapsed, the sidebar shows 8 rows.", afterTitle: "After: sidebar groups (all shown expanded)", afterNote: OPT_NOTE, groups: OPTION_A });
render("11-option-B-sidebar-top-tabs.png", { title: "Option B: minimal sidebar + top tabs", subtitle: "The sidebar keeps 8 section buttons only. Each section opens a page with a tab bar of its items.", afterTitle: "After: 8 sections, each a tabbed page", afterNote: OPT_NOTE, groups: OPTION_B });
render("12-option-C-dashboard-command-palette.png", { title: "Option C: dashboard-first + command palette", subtitle: "Home is a grid of 8 category cards, the sidebar becomes an icon strip, and Cmd+K fuzzy-searches all 47 items. Read-only research splits into its own category.", afterTitle: "After: 8 category cards (Cmd+K reaches any item)", afterNote: OPT_NOTE, groups: OPTION_C });
render("13-option-D-icon-rail-panel.png", { title: "Option D: icon rail + contextual panel", subtitle: "A 56px rail of 8 icons opens a second panel with that category's items. The 4 read-only research pages merge into one tabbed page.", afterTitle: "After: rail categories and their panels", afterNote: OPT_NOTE, groups: OPTION_D });

const RESEARCH_NOTE = "All four research pages render static data from src/lib (no Convex query or mutation). Credit Research is chat credit-confirmation UX research (FIR-1855), not pricing. Money (live revenue and AI spend) is operational, not one of these four.";
render("20-research-A-colocated.png", {
  title: "Q1 option A: keep research co-located",
  subtitle: "The 4 read-only research pages stay inside the operational groups they relate to.",
  highlight: RESEARCH,
  afterTitle: "After (using option A's groups)",
  groups: [
    { name: "Tiers, Rewards & Pricing", items: ["Tiers", "Reward Tiers", "Tier Margin Analysis", "Rewards & Locks", "Reward Economics", "Competitor Pricing", "Credit Research", "Pricing Promotions"] },
    { name: "Overview & Insights", items: OVERVIEW },
  ],
  cols: 2,
  notes: [RESEARCH_NOTE],
});
render("21-research-B-split.png", {
  title: "Q1 option B: split research into its own category",
  subtitle: "The 4 read-only research pages get one category. Named neutrally ('Research'), because Credit Research is UX research, not pricing.",
  highlight: RESEARCH,
  afterTitle: "After",
  groups: [
    { name: "Research", items: RESEARCH, accent: true },
    { name: "Tiers, Rewards & Pricing", items: ["Tiers", "Reward Tiers", "Rewards & Locks", "Pricing Promotions"] },
  ],
  cols: 2,
  notes: [RESEARCH_NOTE],
});

const TIERS_NOTE = "Tiers = subscription Tier Feature Matrix (Convex admin.getTierConfigs / updateTierConfig). Reward Tiers = gift-card Reward Tier Ladder with its own Tiers/Gating tabs (Convex rewardTiers, rewardGating). Tier Margin Analysis = static revenue-vs-COGS table from lib/tier-margin-analysis.ts; its 'cost bucket' breakdown is a section of this page, not a separate page.";
render("30-tiers-A-3way-tabs.png", {
  title: "Q2 option A: full 3-way tab merge", subtitle: "Tiers, Reward Tiers and Tier Margin Analysis become one page with three tabs.", highlight: TIERS, afterTitle: "After",
  groups: [{ name: "Tiers", items: TIERS, tabs: true, accent: true }], cols: 1,
  notes: [TIERS_NOTE, "Reward Tiers already has its own Tiers/Gating tab bar, so this nests tabs inside a tab."],
});
render("31-tiers-B-subscription-merge.png", {
  title: "Q2 option B: merge subscription tiers with their margins", subtitle: "Tiers + Tier Margin Analysis become one page (both cover the same subscription tiers). Reward Tiers moves to the rewards pages.", highlight: TIERS, afterTitle: "After",
  groups: [
    { name: "Subscription tiers", items: ["Tiers", "Tier Margin Analysis"], tabs: true, accent: true },
    { name: "Rewards", items: ["Rewards & Locks", "Reward Tiers", "Grant Embers"] },
  ], cols: 2, notes: [TIERS_NOTE],
});
render("32-tiers-C-no-merge.png", {
  title: "Q2 option C: no merge, group by data model", subtitle: "Three separate pages: Tiers with billing, Reward Tiers with rewards, Tier Margin Analysis wherever Q1 puts research.", highlight: TIERS, afterTitle: "After",
  groups: [
    { name: "Billing", items: ["Tiers", "Pricing Promotions", "Credit Drift", "Credit Rollover", "Post Recovery"] },
    { name: "Rewards", items: ["Rewards & Locks", "Reward Tiers", "Grant Embers"] },
    { name: "Research (per Q1)", items: RESEARCH },
  ], cols: 2, notes: [TIERS_NOTE],
});

const REVIEWS_NOTE = "Reviews = 'Review Submissions': users' G2 / Product Hunt / Capterra / Trustpilot URLs (Convex reviewSubmissions); approving one grants a one-time reward. Review Moderation = 'In-App Review Moderation' (Convex reviews): approve, reject or flag in-app reviews; approved ones appear on /pricing and /community. Both are moderation queues over different tables.";
render("40-reviews-A-tabs.png", {
  title: "Q3 option A: one Reviews page with two tabs", subtitle: "One nav entry; each tab keeps its existing component and data source.", highlight: REVIEWS, afterTitle: "After",
  groups: [{ name: "Reviews", items: ["External submissions", "In-app reviews"], tabs: true, accent: true }], cols: 1, notes: [REVIEWS_NOTE],
});
render("41-reviews-B-separate.png", {
  title: "Q3 option B: same group, separate pages", subtitle: "Two nav entries next to each other, relabelled so the difference is visible.", highlight: REVIEWS, afterTitle: "After",
  groups: [{ name: "Community", items: ["Feedback", "Polls", "Challenges", "Leaderboards", "Reviews", "Review Moderation"], accent: true }], cols: 1, notes: [REVIEWS_NOTE],
});

const TOGGLES_NOTE = "Feature Toggles = editable rows in the Convex featureToggles table (Coming Soon gates and staged-rollout access; 'Changes take effect immediately'). Feature Flags = read-only view of the static, build-time FEATURE_FLAGS registry (config/feature-registry.ts). Neither page is scoped per tenant.";
render("50-toggles-flags-A-separate.png", {
  title: "Q4 option A: keep separate (the 4-way consensus)", subtitle: "Adjacent pages in one group, each with an inline note: 'editable, takes effect now' vs 'read-only registry, changes need a deploy'.", highlight: TOGGLES, afterTitle: "After",
  groups: [{ name: "Engineering", items: ENGINEERING, accent: true }], cols: 1, notes: [TOGGLES_NOTE],
});
render("51-toggles-flags-B-merged.png", {
  title: "Q4 option B: merge into one page", subtitle: "One 'Features' page with two tabs: live toggles (editable) and the registry (read-only).", highlight: TOGGLES, afterTitle: "After",
  groups: [{ name: "Features", items: ["Live toggles", "Registry (read-only)"], tabs: true, accent: true }], cols: 1, notes: [TOGGLES_NOTE],
});
