import { useCallback, useEffect, useMemo, useState } from "react";
import { marked } from "marked";
import { AnswerControl } from "./features/decisions/answer-shapes/AnswerControl";
import { CommentThread, type Comment } from "./features/comments/CommentThread";
import { QAQueue, type QueuedQuestion } from "./features/minerva/QAQueue";
import { GlobalView, type KbEntrySummary } from "./features/projects/GlobalView";
import { ProjectView } from "./features/projects/ProjectView";
import { BacklogBrowser, type BacklogEntry } from "./features/kb/BacklogBrowser";
import { DocBrowser, type GroupedDocs } from "./features/docs/DocBrowser";
import { DocRenderer } from "./features/docs/DocRenderer";
import type { DecisionPayload, Verdict } from "./features/decisions/answer-shapes/types";
import "./theme/tokens.css";
import "./app.css";

/* ---------------------------------------------------------------- */
/* Types + shared helpers                                           */
/* ---------------------------------------------------------------- */

/** A decision as returned by GET /api/decisions (payload parsed server-side). */
interface DecisionItem {
  id: string;
  type: string;
  title: string;
  status: string;
  source_repo: string | null;
  decided_at: string | null;
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

async function postVerdict(itemId: string, verdict: Verdict): Promise<void> {
  const res = await fetch(`/api/decisions/${itemId}/verdict`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ verdict, actor: "Mathew" }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/* ---------------------------------------------------------------- */
/* Decision surface — the rich renderer (previews + context +       */
/* verdict + discussion). This is the CADEX admin-layout decision's */
/* home, restyled entirely in Consus's own warm theme.              */
/* ---------------------------------------------------------------- */

function DecisionView({ item, onDecided }: { item: DecisionItem; onDecided: () => void }) {
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
      await postVerdict(item.id, verdict);
      setRecorded(verdict);
      loadComments();
      onDecided();
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
  const isDecided = Boolean(item.decided_at);

  return (
    <article className={`dv ${isDecided ? "dv--decided" : ""}`}>
      <header className="dv__head">
        <div className="dv__pills">
          <span className={`dv__pill ${isDecided ? "dv__pill--done" : ""}`}>{item.status}</span>
          {item.source_repo ? <span className="dv__pill">{item.source_repo}</span> : null}
        </div>
        <h2>{item.title}</h2>
      </header>

      <div className="dv__context" dangerouslySetInnerHTML={{ __html: contextHtml }} />

      {payload.previews ? (
        <section>
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

      <section>
        <h3 className="dv__section-title">Your decision</h3>
        {isDecided && !recorded ? (
          <p className="dv__decided-note">
            Decided {new Date(item.decided_at as string).toLocaleString()}. You can revise the call below — a new
            verdict re-records it.
          </p>
        ) : null}
        <p className="dv__hint">
          Recommended: <b>{payload.recommended}</b> — {recommendedTitle}. Click <b>Choose</b> under an option to
          pick it, <b>Accept</b> to take the recommendation, <b>Mix</b> to combine, or <b>Reject</b> to send it
          back with notes.
        </p>
        {recorded ? (
          <div className="dv__recorded">✓ Recorded: {verdictLabel(recorded)}</div>
        ) : (
          <AnswerControl payload={payload} onVerdict={submitVerdict} />
        )}
        {err ? <p className="dv__err">{err}</p> : null}
      </section>

      <section>
        <h3 className="dv__section-title">Discussion</h3>
        <CommentThread comments={comments} onSubmit={submitComment} />
      </section>
    </article>
  );
}

/* ---------------------------------------------------------------- */
/* Section: Decisions (the "Needs you" queue + Decided history)     */
/* ---------------------------------------------------------------- */

function DecisionsSection({
  decisions,
  reload,
}: {
  decisions: DecisionItem[] | null;
  reload: () => void;
}) {
  if (!decisions) return <p className="state">Loading decisions…</p>;

  const open = decisions.filter((d) => !d.decided_at);
  const decided = decisions.filter((d) => d.decided_at);

  return (
    <div>
      <div className="consus__section-lead">
        <h1>Decisions</h1>
        <p>The go / no-go queue — a question, a recommendation, and a real verdict for each.</p>
      </div>

      <p className="group-heading">Needs you ({open.length})</p>
      {open.length === 0 ? (
        <div className="empty">
          <strong>Nothing waiting on you</strong>
          Every open decision has been answered. New decisions land here as agents surface them.
        </div>
      ) : (
        open.map((d) => <DecisionView key={d.id} item={d} onDecided={reload} />)
      )}

      {decided.length > 0 ? (
        <>
          <p className="group-heading">Decided ({decided.length})</p>
          {decided.map((d) => (
            <DecisionView key={d.id} item={d} onDecided={reload} />
          ))}
        </>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Section: Minerva Q&A (human-request items + surveys)             */
/* ---------------------------------------------------------------- */

function MinervaSection({
  decisions,
  reload,
}: {
  decisions: DecisionItem[] | null;
  reload: () => void;
}) {
  if (!decisions) return <p className="state">Loading Minerva questions…</p>;

  const questions: QueuedQuestion[] = decisions
    .filter((d) => d.type === "human_request" && !d.decided_at)
    .map((d) => ({
      minervaQuestionId: d.id,
      text: d.title,
      ticketId: d.source_repo,
      decisionPayload: d.decision_payload,
    }));

  async function onAnswer(id: string, verdict: Verdict) {
    await postVerdict(id, verdict);
    reload();
  }

  return (
    <div>
      <div className="consus__section-lead">
        <h1>Minerva Q&amp;A</h1>
        <p>Escalated questions and surveys from Minerva, answerable async and linked to their ticket.</p>
      </div>
      {questions.length === 0 ? (
        <div className="empty">
          <strong>No open Minerva questions</strong>
          When Minerva escalates a question or a survey through the bridge, it appears here. Answered items move
          to the Decisions history.
        </div>
      ) : (
        <QAQueue questions={questions} onAnswer={onAnswer} />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Section: Projects (cross-project + per-project KB views)         */
/* ---------------------------------------------------------------- */

function ProjectsSection() {
  const [entries, setEntries] = useState<KbEntrySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [project, setProject] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/kb-entries")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setEntries)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="state state--err">Could not load projects: {error}</p>;
  if (!entries) return <p className="state">Loading projects…</p>;

  const projects = [...new Set(entries.map((e) => e.source_repo ?? "unassigned"))];

  return (
    <div>
      <div className="consus__section-lead">
        <h1>Projects</h1>
        <p>Every project's shared-truth KB — scope to one project or see the shape of things across all.</p>
      </div>

      {entries.length === 0 ? (
        <div className="empty">
          <strong>No KB entries yet</strong>
          Approved decisions and CBAs become durable, versioned KB entries here — grouped by project. Nothing has
          been promoted to the KB store yet.
        </div>
      ) : (
        <>
          <div className="consus__nav" style={{ marginBottom: 18, marginLeft: 0 }}>
            <button
              className={`consus__nav-btn ${project === null ? "consus__nav-btn--active" : ""}`}
              onClick={() => setProject(null)}
            >
              All projects
            </button>
            {projects.map((p) => (
              <button
                key={p}
                className={`consus__nav-btn ${project === p ? "consus__nav-btn--active" : ""}`}
                onClick={() => setProject(p)}
              >
                {p}
              </button>
            ))}
          </div>
          {project === null ? (
            <GlobalView entries={entries} onSelect={() => {}} />
          ) : (
            <ProjectView
              project={project}
              entries={entries.filter((e) => (e.source_repo ?? "unassigned") === project)}
              onSelect={() => {}}
            />
          )}
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Section: KB backlog (search across all entries)                  */
/* ---------------------------------------------------------------- */

function KbSection() {
  const [entries, setEntries] = useState<BacklogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((query: string) => {
    const url = query ? `/api/kb-entries?q=${encodeURIComponent(query)}` : "/api/kb-entries";
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setEntries)
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load("");
  }, [load]);

  return (
    <div>
      <div className="consus__section-lead">
        <h1>Knowledge base</h1>
        <p>Browse and search every KB entry — the durable, versioned record of what's been decided.</p>
      </div>
      {error ? <p className="state state--err">Could not load the KB: {error}</p> : null}
      <BacklogBrowser entries={entries ?? []} onSearch={load} onSelect={() => {}} />
      {entries && entries.length === 0 ? (
        <div className="empty">
          <strong>The backlog is empty</strong>
          Once decisions are promoted to the KB store, they're searchable here with full version history.
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Section: Docs (browse repo -> epic -> phase, render in-app)      */
/* ---------------------------------------------------------------- */

function DocsSection() {
  const [grouped, setGrouped] = useState<GroupedDocs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openDoc, setOpenDoc] = useState<{ format: "md" | "html"; content: string; path: string } | null>(null);

  useEffect(() => {
    fetch("/api/docs")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setGrouped)
      .catch((e) => setError(e.message));
  }, []);

  async function open(repo: string, filePath: string) {
    const res = await fetch(`/api/docs/content?repo=${encodeURIComponent(repo)}&path=${encodeURIComponent(filePath)}`);
    if (res.ok) {
      const data = await res.json();
      setOpenDoc({ format: data.format, content: data.content, path: filePath });
    }
  }

  if (error) return <p className="state state--err">Could not load docs: {error}</p>;
  if (!grouped) return <p className="state">Loading docs…</p>;

  const empty = Object.keys(grouped).length === 0;

  if (openDoc) {
    return (
      <div>
        <div className="consus__section-lead">
          <button className="doc-back" onClick={() => setOpenDoc(null)}>
            ← Back to docs
          </button>
        </div>
        <DocRenderer format={openDoc.format} content={openDoc.content} />
      </div>
    );
  }

  return (
    <div>
      <div className="consus__section-lead">
        <h1>Docs</h1>
        <p>Generated briefs, PRDs, architecture, and plans — browsed by repo, epic, and phase, rendered in-app.</p>
      </div>
      {empty ? (
        <div className="empty">
          <strong>No docs indexed yet</strong>
          The doc scanner indexes each configured repo's <code>.pHive/planning</code> and <code>docs/</code>
          output. Run a scan or add a project to populate this.
        </div>
      ) : (
        <DocBrowser grouped={grouped} onOpen={open} />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* App shell                                                        */
/* ---------------------------------------------------------------- */

type Tab = "decisions" | "minerva" | "projects" | "kb" | "docs";

const TABS: { id: Tab; label: string }[] = [
  { id: "decisions", label: "Decisions" },
  { id: "minerva", label: "Minerva" },
  { id: "projects", label: "Projects" },
  { id: "kb", label: "KB" },
  { id: "docs", label: "Docs" },
];

export function App() {
  const [tab, setTab] = useState<Tab>("decisions");
  const [decisions, setDecisions] = useState<DecisionItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    fetch("/api/decisions?all=1")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setDecisions)
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const openCount = decisions?.filter((d) => !d.decided_at).length ?? 0;

  return (
    <div className="consus">
      <header className="consus__masthead">
        <div className="consus__brand">
          <span className="consus__brand-mark">◈</span>
          Consus
          <span className="consus__brand-sub">decision &amp; knowledge surface</span>
        </div>
        <nav className="consus__nav">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`consus__nav-btn ${tab === t.id ? "consus__nav-btn--active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.id === "decisions" && openCount > 0 ? <span className="consus__nav-count">{openCount}</span> : null}
            </button>
          ))}
        </nav>
      </header>

      <main className="consus__main">
        {error ? <p className="state state--err">Could not load decisions: {error}</p> : null}
        {tab === "decisions" ? <DecisionsSection decisions={decisions} reload={reload} /> : null}
        {tab === "minerva" ? <MinervaSection decisions={decisions} reload={reload} /> : null}
        {tab === "projects" ? <ProjectsSection /> : null}
        {tab === "kb" ? <KbSection /> : null}
        {tab === "docs" ? <DocsSection /> : null}
      </main>
    </div>
  );
}
