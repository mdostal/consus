/**
 * Drafting Table's decorative touch beyond CSS color tokens: four small
 * blueprint-style registration/crosshair marks pinned to the viewport
 * corners, echoing the corner marks on a real technical drawing sheet.
 * Pure SVG — no canvas needed for straight linework — fixed, pointer-events
 * none, and aria-hidden since it carries no information (s1,
 * consus-phase18). The grid-paper background itself is plain CSS
 * (repeating-linear-gradient) in app.css; this component is only for the
 * part CSS alone renders awkwardly (crisp corner tick marks at a fixed
 * screen position, not tied to any one scrolling element).
 */
function RegistrationMark({ corner }: { corner: "tl" | "tr" | "bl" | "br" }) {
  return (
    <svg
      className={`drafting-registration-marks__mark drafting-registration-marks__mark--${corner}`}
      width="22"
      height="22"
      viewBox="0 0 22 22"
      aria-hidden="true"
    >
      <line x1="11" y1="0" x2="11" y2="22" stroke="var(--consus-accent)" strokeWidth="1" />
      <line x1="0" y1="11" x2="22" y2="11" stroke="var(--consus-accent)" strokeWidth="1" />
      <circle cx="11" cy="11" r="5" fill="none" stroke="var(--consus-accent)" strokeWidth="1" />
    </svg>
  );
}

export function DraftingRegistrationMarks() {
  return (
    <div className="drafting-registration-marks" data-testid="drafting-registration-marks" aria-hidden="true">
      <RegistrationMark corner="tl" />
      <RegistrationMark corner="tr" />
      <RegistrationMark corner="bl" />
      <RegistrationMark corner="br" />
    </div>
  );
}
