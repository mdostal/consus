import { useEffect, useMemo, useState, useCallback } from "react";
import { marked } from "marked";
import { AnswerControl } from "./features/decisions/answer-shapes/AnswerControl";
import { CommentThread, type Comment } from "./features/comments/CommentThread";
import type { DecisionPayload, Verdict } from "./features/decisions/answer-shapes/types";
import "./theme/tokens.css";
import "./app.css";

/** A decision as returned by GET /api/decisions (payload already parsed server-side). */
interface DecisionItem {
  id: string;
  type: string;
  title: string;
  status: string;
  decision_payload: DecisionPayload & { previews?: Record<string, string> };
}

function verdictLabel(v: Verdict): string {
  switch (v.kind) {
    case "accepted":
      return "Accepted the recommended option";
    case "option_chosen":
      return `Chose option ${v.optionId}`;
    case "mix":
      return `Mixed options ${v.optionIds.join(" + ")} — ${v.why}`;
    case "rejected_iteration_requested":
      return `Requested another round — ${v.commentary}`;
  }
}

/**
 * The rendered decision surface. For each open decision it shows: the context
 * (markdown), a live preview gallery of each option (when the payload carries
 * `previews`), the real decision-request/v1 answer control (Accept / Choose /
 * Mix / Reject), and a comment thread. Verdicts and comments persist via the
 * Consus API.
 */
function DecisionView({ item }: { item: DecisionItem }) {
  const payload = item.decision_payload;
  const contextHtml = useMemo(
    () => marked.parse(payload.context ?? "", { async: false }) as string,
    [payload.context],
  );
  const [comments, setComments] = useState<Comment[]>([]);
  const [recorded, setRecorded] = useState<Verdict | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadComments = useCallback(async () => {
    try {
      const res = await fetch(`/api/items/${item.id}/comments`);
      if (res.ok) setComments(await res.json());
    } catch {
      /* comments are best-effort */
    }
  }, [item.id]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  async function submitVerdict(verdict: Verdict) {
    setErr(null);
    try {
      const res = await fetch(`/api/decisions/${item.id}/verdict`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ verdict, actor: "Mathew" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRecorded(verdict);
      loadComments();
    } catch (e) {
      setErr(`Could not record decision: ${(e as Error).message}`);
    }
  }

  async function submitComment(body: string) {
    try {
      await fetch(`/api/items/${item.id}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ author: "Mathew", body }),
      });
      loadComments();
    } catch {
      setErr("Could not post comment.");
    }
  }

  const recommendedTitle = payload.options.find((o) => o.id === payload.recommended)?.title;

  return (
    <article className="dv">
      <header className="dv__head">
        <span className="dv__pill">{item.status}</span>
        <h2>{item.title}</h2>
      </header>

      <div className="dv__context" dangerouslySetInnerHTML={{ __html: contextHtml }} />

      {payload.previews ? (
        <section className="dv__previews">
          <h3 className="dv__section-title">Previews — the {payload.options.length} directions</h3>
          <div className="dv__gallery">
            {payload.options.map((o) => {
              const url = payload.previews?.[o.id];
              const isRec = o.id === payload.recommended;
              return (
                <figure key={o.id} className={`pv ${isRec ? "pv--rec" : ""}`}>
                  <figcaption className="pv__cap">
                    <span className="pv__badge">{o.id}</span>
                    <span className="pv__title">{o.title}</span>
                    {isRec ? <span className="pv__rec">recommended</span> : null}
                  </figcaption>
                  {url ? (
                    <div className="pv__frame">
                      <iframe title={`Preview ${o.id}`} src={url} loading="lazy" />
                    </div>
                  ) : null}
                  <p className="pv__trade">{o.tradeoffs}</p>
                  {url ? (
                    <a className="pv__open" href={url} target="_blank" rel="noreferrer">
                      Open full wireframe ↗
                    </a>
                  ) : null}
                </figure>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="dv__answer">
        <h3 className="dv__section-title">Your decision</h3>
        <p className="dv__hint">
          Recommended: <b>{payload.recommended}</b> — {recommendedTitle}. Click <b>Choose</b> under an option
          to pick it, <b>Accept</b> to take the recommendation, <b>Mix</b> to combine, or <b>Reject</b> to send it
          back with notes.
        </p>
        {recorded ? (
          <div className="dv__recorded">✓ Recorded: {verdictLabel(recorded)}</div>
        ) : (
          <AnswerControl payload={payload} onVerdict={submitVerdict} />
        )}
        {err ? <p className="dv__err">{err}</p> : null}
      </section>

      <section className="dv__comments">
        <h3 className="dv__section-title">Discussion</h3>
        <CommentThread comments={comments} onSubmit={submitComment} />
      </section>
    </article>
  );
}

export function App() {
  const [decisions, setDecisions] = useState<DecisionItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/decisions")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setDecisions)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <main className="shell">
      <header className="masthead">
        <div className="masthead__brand">
          Consus<span className="masthead__dot">·</span>
          <span className="masthead__sub">decision surface</span>
        </div>
      </header>

      {error ? <p className="state state--err">Could not load decisions: {error}</p> : null}
      {!decisions && !error ? <p className="state">Loading open decisions…</p> : null}
      {decisions && decisions.length === 0 ? (
        <p className="state">No open decisions right now.</p>
      ) : null}

      {decisions?.map((d) => (
        <DecisionView key={d.id} item={d} />
      ))}
    </main>
  );
}
