import { useCallback, useEffect, useState } from "react";

// Same single local operator every other write path uses (no auth layer).
const ACTOR = "Mathew";

export type ThreadState = "awaiting_agent" | "delivery_failed" | "answered";
export type ThreadAnchor = Record<string, unknown>;

export interface ThreadMessage {
  id: number;
  threadId: string;
  role: "operator" | "agent";
  author: string;
  body: string;
  proposalId: string | null;
  proposalUrl: string | null;
  proposal: { id: string; status: string; description: string; targetType: string } | null;
  delivery: { status: "pending" | "delivered" | "failed"; error: string | null; target: string | null; attemptedAt: string | null } | null;
  createdAt: string;
}

export interface Thread {
  id: string;
  itemType: string;
  itemId: string;
  anchor: ThreadAnchor | null;
  state: ThreadState;
  createdAt: string;
  updatedAt: string;
  messages: ThreadMessage[];
}

/** One choice in the "about" picker, e.g. a doc section. */
export interface AnchorOption {
  label: string;
  anchor: ThreadAnchor;
}

export interface ThreadsPanelProps {
  itemType: string;
  itemId: string;
  /** Optional finer-grained targets (doc sections, ...). The whole item is always offered. */
  anchors?: AnchorOption[];
}

export function anchorLabel(anchor: ThreadAnchor | null): string | null {
  if (!anchor) return null;
  const parts: string[] = [];
  if (typeof anchor.section === "string") parts.push(`§ ${anchor.section}`);
  if (typeof anchor.line === "number") {
    parts.push(typeof anchor.lineEnd === "number" ? `lines ${anchor.line}–${anchor.lineEnd}` : `line ${anchor.line}`);
  }
  if (typeof anchor.nodeId === "string") parts.push(`node ${anchor.nodeId}`);
  if (typeof anchor.quote === "string") parts.push(`“${anchor.quote}”`);
  return parts.length ? parts.join(", ") : JSON.stringify(anchor);
}

function upsert(list: Thread[], thread: Thread): Thread[] {
  const i = list.findIndex((t) => t.id === thread.id);
  if (i === -1) return [...list, thread];
  // A POST response and the SSE stream race on separate connections; never
  // let an older snapshot drop a message that already arrived.
  if (thread.messages.length < list[i].messages.length) return list;
  const next = list.slice();
  next[i] = thread;
  return next;
}

async function postJson(url: string, body: unknown): Promise<Thread> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Thread;
}

/**
 * PANT-962: comment threads an outside agent answers. Posting sends the
 * message out (webhook or harness, server-side); the agent's reply arrives
 * over the item's SSE stream (GET /api/threads/stream), so it shows up
 * without a reload. Contract: docs/agent-integration/threads.md.
 */
export function ThreadsPanel({ itemType, itemId, anchors = [] }: ThreadsPanelProps) {
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [draft, setDraft] = useState("");
  const [anchorIndex, setAnchorIndex] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const query = `itemType=${encodeURIComponent(itemType)}&itemId=${encodeURIComponent(itemId)}`;

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/threads?${query}`);
      setThreads(res.ok ? ((await res.json()) as Thread[]) : []);
    } catch {
      setThreads([]);
    }
  }, [query]);

  useEffect(() => {
    setThreads(null);
    void load();
    if (typeof EventSource === "undefined") return;
    const source = new EventSource(`/api/threads/stream?${query}`);
    source.addEventListener("thread", (e) => {
      const thread = JSON.parse((e as MessageEvent).data) as Thread;
      setThreads((prev) => upsert(prev ?? [], thread));
    });
    return () => source.close();
  }, [load, query]);

  const apply = (thread: Thread) => setThreads((prev) => upsert(prev ?? [], thread));

  async function startThread() {
    const body = draft.trim();
    if (!body) return;
    setError(null);
    try {
      const anchor = anchorIndex >= 0 ? anchors[anchorIndex]?.anchor : undefined;
      apply(await postJson("/api/threads", { itemType, itemId, body, author: ACTOR, ...(anchor ? { anchor } : {}) }));
      setDraft("");
    } catch {
      setError("Could not start the thread.");
    }
  }

  if (threads === null) return <p className="state">Loading threads…</p>;

  return (
    <div className="agent-threads">
      {threads.length === 0 ? <p className="agent-threads__empty">No threads yet. Ask an agent about this {itemType}.</p> : null}
      {threads.map((thread) => (
        <ThreadView key={thread.id} thread={thread} onChange={apply} onError={setError} />
      ))}

      <div className="agent-threads__new">
        {anchors.length > 0 ? (
          <label className="agent-threads__about">
            About
            <select value={anchorIndex} onChange={(e) => setAnchorIndex(Number(e.target.value))}>
              <option value={-1}>the whole {itemType}</option>
              {anchors.map((a, i) => (
                <option key={`${i}-${a.label}`} value={i}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="comment-thread__compose">
          <textarea aria-label="Ask an agent" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button type="button" onClick={startThread}>
            Ask agent
          </button>
        </div>
      </div>
      {error ? (
        <p className="state state--err" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ThreadView({
  thread,
  onChange,
  onError,
}: {
  thread: Thread;
  onChange: (t: Thread) => void;
  onError: (msg: string | null) => void;
}) {
  const [draft, setDraft] = useState("");
  const last = thread.messages[thread.messages.length - 1];
  const about = anchorLabel(thread.anchor);

  async function send() {
    const body = draft.trim();
    if (!body) return;
    onError(null);
    try {
      onChange(await postJson(`/api/threads/${encodeURIComponent(thread.id)}/messages`, { body, author: ACTOR }));
      setDraft("");
    } catch {
      onError("Could not send the message.");
    }
  }

  async function retry() {
    onError(null);
    try {
      onChange(await postJson(`/api/threads/${encodeURIComponent(thread.id)}/redeliver`, {}));
    } catch {
      onError("Retry failed.");
    }
  }

  return (
    <section className="agent-thread" data-state={thread.state} aria-label={about ? `Thread about ${about}` : "Thread"}>
      {about ? <p className="agent-thread__anchor">{about}</p> : null}
      <ul className="comment-thread__list">
        {thread.messages.map((m) => (
          <li key={m.id} className={`comment-thread__item agent-thread__msg agent-thread__msg--${m.role}`}>
            <span className="comment-thread__author">{m.author}</span>
            {m.role === "agent" ? <span className="agent-thread__badge">agent</span> : null}
            <time className="comment-thread__time" dateTime={m.createdAt}>
              {new Date(m.createdAt).toLocaleString()}
            </time>
            <p className="comment-thread__body">{m.body}</p>
            {m.proposalId || m.proposalUrl ? <LinkedChange message={m} /> : null}
          </li>
        ))}
      </ul>

      {thread.state === "awaiting_agent" ? (
        <p className="agent-thread__waiting" role="status">
          {last?.delivery?.status === "pending" ? "Sending to agent…" : "Waiting for agent…"}
        </p>
      ) : null}
      {thread.state === "delivery_failed" ? (
        <p className="agent-thread__failed" role="alert">
          Not delivered: {last?.delivery?.error ?? "unknown error"}{" "}
          <button type="button" onClick={retry}>
            Retry
          </button>
        </p>
      ) : null}

      <div className="comment-thread__compose">
        <textarea aria-label="Reply in thread" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button type="button" onClick={send}>
          Send
        </button>
      </div>
    </section>
  );
}

interface ProposalRow {
  id: string;
  status: string;
  description: string;
  diff: string;
  applied_diff: string | null;
}

/** "View change": expands the linked Consus proposal's diff inline; an
 *  external proposalUrl is a plain link. */
function LinkedChange({ message }: { message: ThreadMessage }) {
  const [open, setOpen] = useState(false);
  const [proposal, setProposal] = useState<ProposalRow | null>(null);
  const [failed, setFailed] = useState(false);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || proposal || !message.proposalId) return;
    try {
      const res = await fetch(`/api/proposals/${encodeURIComponent(message.proposalId)}`);
      if (!res.ok) throw new Error(String(res.status));
      setProposal((await res.json()) as ProposalRow);
    } catch {
      setFailed(true);
    }
  }

  return (
    <div className="agent-thread__change">
      {message.proposal ? (
        <>
          <span className="agent-thread__change-label">
            Proposed change ({message.proposal.status}): {message.proposal.description}
          </span>{" "}
          <button type="button" className="agent-thread__view" aria-expanded={open} onClick={toggle}>
            {open ? "Hide change" : "View change"}
          </button>
        </>
      ) : message.proposalId ? (
        <span className="agent-thread__change-label">Change {message.proposalId}</span>
      ) : null}
      {message.proposalUrl ? (
        <>
          {" "}
          <a href={message.proposalUrl} target="_blank" rel="noreferrer">
            {message.proposal ? "Open externally ↗" : "View change ↗"}
          </a>
        </>
      ) : null}
      {open && message.proposal ? (
        failed ? (
          <p className="state state--err">Could not load the change.</p>
        ) : proposal ? (
          <pre className="agent-thread__diff">{proposal.applied_diff ?? proposal.diff}</pre>
        ) : (
          <p className="state">Loading change…</p>
        )
      ) : null}
    </div>
  );
}

/** The "Discuss with an agent" block each item view mounts. */
export function AgentThreadsSection(props: ThreadsPanelProps) {
  return (
    <section className="agent-threads-section">
      <h3 className="dv__section-title">Discuss with an agent</h3>
      <ThreadsPanel {...props} />
    </section>
  );
}
