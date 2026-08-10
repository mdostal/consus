import { useState } from "react";
import { approveEpic } from "../../api/epics";
import { tokens } from "../../theme/tokens";
import "../../theme/tokens.css";

export interface DecisionActionsProps {
  epicId: string;
  status: string;
  onApproved(status: string): void;
  compact?: boolean;
}

const styles = {
  shell: { display: "grid", gap: 8 },
  button: {
    background: tokens.color.accent,
    border: `1px solid ${tokens.color.accent}`,
    borderRadius: 6,
    color: tokens.color.bg,
    cursor: "pointer",
    fontWeight: 700,
    padding: "9px 12px",
  },
  secondary: {
    background: tokens.color.bg,
    color: tokens.color.accent,
  },
  message: { color: tokens.color.inkMuted, margin: 0 },
  error: { color: tokens.color.bad, margin: 0 },
} as const;

export function DecisionActions({ epicId, status, onApproved, compact = false }: DecisionActionsProps) {
  const [state, setState] = useState<"idle" | "saving" | "approved" | "error">("idle");
  const [message, setMessage] = useState<string>("");

  async function handleApprove() {
    setState("saving");
    setMessage("");
    try {
      const result = await approveEpic(epicId);
      setState("approved");
      setMessage("Approved.");
      onApproved(result.status);
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "Failed to approve epic.");
    }
  }

  return (
    <div data-testid="decision-actions" style={styles.shell}>
      {!compact ? <p style={styles.message}>Current status: {status}</p> : null}
      <button
        disabled={state === "saving"}
        onClick={handleApprove}
        style={{ ...styles.button, ...(compact ? styles.secondary : {}) }}
        type="button"
      >
        {state === "saving" ? "Approving..." : "Approve"}
      </button>
      {message ? (
        <p role={state === "error" ? "alert" : "status"} style={state === "error" ? styles.error : styles.message}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
