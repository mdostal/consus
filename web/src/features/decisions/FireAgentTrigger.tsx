import { useState } from "react";

export interface FireAgentInput {
  prompt: string;
  agentId?: string;
  agentName?: string;
  scope?: { section?: string; diagram?: string };
  setInProgress?: boolean;
}

export interface FireAgentResult {
  log_id: string;
  comment_id: string;
}

export interface FireAgentTriggerProps {
  onFire: (input: FireAgentInput) => void;
  /** Loud and specific on failure — this repo's "never silence" convention
   *  (see write-comment.ts). Never a generic toast with no detail. */
  error?: string | null;
  result?: FireAgentResult | null;
}

/** REQ-16 frontend: fire an agent to redo/extend a decision item's work.
 *  Agent is optional per the backend contract — a prompt alone still
 *  submits successfully. */
export function FireAgentTrigger({ onFire, error, result }: FireAgentTriggerProps) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [agentId, setAgentId] = useState("");
  const [agentName, setAgentName] = useState("");
  const [section, setSection] = useState("");

  const submit = () => {
    if (!prompt.trim()) return;
    const hasAgent = agentId.trim() && agentName.trim();
    onFire({
      prompt: prompt.trim(),
      ...(hasAgent ? { agentId: agentId.trim(), agentName: agentName.trim() } : {}),
      ...(section.trim() ? { scope: { section: section.trim() } } : {}),
    });
    setPrompt("");
    setAgentId("");
    setAgentName("");
    setSection("");
    setOpen(false);
  };

  return (
    <div className="fire-agent-trigger">
      <button type="button" onClick={() => setOpen((o) => !o)}>
        {open ? "Cancel" : "Fire agent to iterate"}
      </button>

      {open ? (
        <div className="fire-agent-trigger__form">
          <label>
            Prompt
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="What should the agent redo or extend?" />
          </label>
          <label>
            Agent name (optional)
            <input type="text" value={agentName} onChange={(e) => setAgentName(e.target.value)} placeholder="e.g. researcher" />
          </label>
          <label>
            Agent id (optional)
            <input type="text" value={agentId} onChange={(e) => setAgentId(e.target.value)} placeholder="agent uuid" />
          </label>
          <label>
            Section (optional)
            <input type="text" value={section} onChange={(e) => setSection(e.target.value)} placeholder="e.g. risks" />
          </label>
          <button type="button" onClick={submit} disabled={!prompt.trim()}>
            Fire
          </button>
        </div>
      ) : null}

      {error ? <p className="fire-agent-trigger__error" role="alert">Fire failed: {error}</p> : null}
      {result ? (
        <p className="fire-agent-trigger__success">
          Fired — log <code>{result.log_id}</code>, comment <code>{result.comment_id}</code>
        </p>
      ) : null}
    </div>
  );
}
