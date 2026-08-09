import { useMemo } from "react";
import { diffText } from "../../utils/textDiff";
import "../../theme/tokens.css";

export interface SectionDiffProps {
  /** The human's draft text for this section. */
  humanText: string;
  /** The agent-generated (published) text for this section. */
  agentText: string;
  /** Take the agent's version, discarding the human edit for this section. */
  onAccept: () => void;
  /** Keep the human's edit as-is; reject the agent's regenerated section. */
  onSendBack: () => void;
}

/**
 * Renders a per-section comparison of a human draft against the
 * agent-generated version, with explicit accept/send-back controls.
 * Diffing happens client-side (per section, on small text) to keep the
 * backend lean.
 */
export function SectionDiff({ humanText, agentText, onAccept, onSendBack }: SectionDiffProps) {
  const parts = useMemo(() => diffText(agentText, humanText), [agentText, humanText]);

  return (
    <div data-testid="section-diff" className="section-diff" style={{ border: "1px solid var(--consus-accent)", padding: "1rem" }}>
      <div style={{ fontSize: "0.85rem", color: "var(--consus-ink-muted)", marginBottom: "0.5rem" }}>
        Human edits differ from the agent's version
      </div>
      <div data-testid="section-diff-content" style={{ whiteSpace: "pre-wrap", fontFamily: "monospace" }}>
        {parts.map((part, idx) => {
          if (part.type === "equal") {
            return <span key={idx}>{part.value}</span>;
          }
          if (part.type === "added") {
            return (
              <ins key={idx} style={{ backgroundColor: "var(--consus-good)", textDecoration: "none" }}>
                {part.value}
              </ins>
            );
          }
          return (
            <del key={idx} style={{ backgroundColor: "var(--consus-bad)" }}>
              {part.value}
            </del>
          );
        })}
      </div>
      <div style={{ marginTop: "0.75rem", textAlign: "right", display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
        <button onClick={onSendBack}>Send Back</button>
        <button onClick={onAccept}>Accept Agent Changes</button>
      </div>
    </div>
  );
}
