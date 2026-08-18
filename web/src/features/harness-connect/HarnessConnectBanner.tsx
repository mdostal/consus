import { useHarnessBannerCollapsed } from "./useHarnessBannerCollapsed";

/**
 * A prominent, collapsible panel surfacing `npm run agent:init` — the real
 * install action for skills/consus/SKILL.md (s1, consus-phase19). Mounted
 * once in App.tsx directly below the masthead, above <main>, so it's
 * visible regardless of which tab or skin is active — the same
 * "mounted once, universal across skins/tabs" discipline ThemeSkinPicker/
 * CommandPalette already follow (design-discussion.md).
 *
 * "Collapse it after the first time" (design-discussion.md, operator's own
 * framing) is explicit: dismissing never removes this from the DOM
 * entirely. It swaps to a small, always-visible, reopenable affordance,
 * persisted via useHarnessBannerCollapsed (consus:harness-banner-collapsed)
 * so the collapse survives a real reload, not just the current session.
 *
 * Styled entirely through the shared --consus-* token system (app.css) —
 * no new, parallel per-skin mechanism; it renders identically (structure)
 * across all 3 skins and both themes, like command-palette-trigger does.
 */
export function HarnessConnectBanner() {
  const { collapsed, setCollapsed } = useHarnessBannerCollapsed();

  if (collapsed) {
    return (
      <div className="harness-connect-banner harness-connect-banner--collapsed">
        <button
          type="button"
          className="harness-connect-banner__reopen"
          onClick={() => setCollapsed(false)}
          aria-label="Show the Claude Code connect banner"
          title="Connect a Claude Code agent to this repo"
        >
          <span aria-hidden="true">◈</span> Connect an agent
        </button>
      </div>
    );
  }

  return (
    <div className="harness-connect-banner" role="region" aria-label="Connect a Claude Code agent">
      <div className="harness-connect-banner__body">
        <p className="harness-connect-banner__lead">
          Connect a Claude Code agent to this repo: <code className="harness-connect-banner__command">npm run agent:init</code>
        </p>
        <p className="harness-connect-banner__detail">
          Installs Consus's agent-facing skill so Claude Code can read and act on this repo's
          decision queue directly. See <code>skills/consus/SKILL.md</code> and{" "}
          <code>docs/api-reference.md</code> for the full contract.
        </p>
      </div>
      <button
        type="button"
        className="harness-connect-banner__dismiss"
        onClick={() => setCollapsed(true)}
        aria-label="Collapse the Claude Code connect banner"
        title="Collapse (you can reopen it any time)"
      >
        ✕
      </button>
    </div>
  );
}
