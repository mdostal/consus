/**
 * Harness's decorative touch beyond CSS color tokens: the three
 * red/yellow/green "traffic light" window-control dots familiar from a
 * terminal/IDE title bar, meant to sit inline at the front of the masthead
 * when [data-skin="harness"] is active — part of the "command-prompt-style
 * header treatment" called for in this story (s1, consus-phase18).
 * Decorative only (aria-hidden) — the real nav/tabs beside it remain the
 * one real navigation surface.
 */
export function HarnessWindowDots() {
  return (
    <span className="harness-window-dots" data-testid="harness-window-dots" aria-hidden="true">
      <span className="harness-window-dots__dot harness-window-dots__dot--red" />
      <span className="harness-window-dots__dot harness-window-dots__dot--yellow" />
      <span className="harness-window-dots__dot harness-window-dots__dot--green" />
    </span>
  );
}
