import { useCallback, useEffect, useMemo, useState } from "react";
import { marked } from "marked";
import { AnswerControl } from "./features/decisions/answer-shapes/AnswerControl";
import { CommentThread, type Comment } from "./features/comments/CommentThread";
import { GlobalView, type KbEntrySummary } from "./features/projects/GlobalView";
import { ProjectView } from "./features/projects/ProjectView";
import { DiagramView, type DiagramEpic } from "./features/projects/DiagramView";
import { ArchitectureDiagramView } from "./features/projects/ArchitectureDiagramView";
import { DiagramPendingCount } from "./features/projects/DiagramChangeset";
import { AuditPanel, type AuditTrailEntry } from "./features/audit/AuditPanel";
import { BacklogBrowser, type BacklogEntry, type KbCollection } from "./features/kb/BacklogBrowser";
import { DocBrowser, type GroupedDocs } from "./features/docs/DocBrowser";
import { DocSearch, type DocSearchResult } from "./features/docs/DocSearch";
import { DocRenderer } from "./features/docs/DocRenderer";
import { EventsList, type EventRow, type EventStatus } from "./features/events/EventsList";
import { EventProposeComposer } from "./features/events/EventProposeComposer";
import type { DecisionPayload, Verdict } from "./features/decisions/answer-shapes/types";
import { useSelectedDecisionId } from "./features/decisions/useSelectedDecisionId";
import { DecisionListPane } from "./features/decisions/DecisionListPane";
import { useSkinPreference } from "./theme/useSkinPreference";
import { ThemeSkinPicker } from "./theme/ThemeSkinPicker";
import { SkinBackdrop } from "./theme/skins/SkinBackdrop";
import { HarnessWindowDots } from "./theme/skins/HarnessWindowDots";
import { CommandPalette } from "./features/command-palette/CommandPalette";
import { HarnessConnectBanner } from "./features/harness-connect/HarnessConnectBanner";
import "./theme/tokens.css";
import "./app.css";
import "./features/decisions/decisions-two-pane.css";

/* ---------------------------------------------------------------- */
/* Types + shared helpers                                           */
/* ---------------------------------------------------------------- */

/** GET /api/docs (and its ?project= scoped form) always includes an entry
 *  for every registered repo, even with zero docs indexed — e.g. `{consus:
 *  {}}`, never a bare `{}`. So "any docs at all" means every repo's grouped
 *  phase map is itself empty, not that the top-level object has no keys. */
function docsAreEmpty(grouped: GroupedDocs): boolean {
  return Object.values(grouped).every((byPhase) => Object.keys(byPhase).length === 0);
}

/** A decision as returned by GET /api/decisions (payload parsed server-side).
 *  decision_payload is null for an item with no fenced decision-request
 *  block — not every item carries one. */
interface DecisionItem {
  id: string;
  type: string;
  title: string;
  status: string;
  source_repo: string | null;
  source_body?: string | null;
  decision_type?: string | null;
  triage_bucket?: string | null;
  decided_at: string | null;
  decision_payload: (DecisionPayload & { previews?: Record<string, string> }) | null;
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
    () => marked.parse(payload?.context ?? "", { async: false }) as string,
    [payload?.context],
  );
  const [comments, setComments] = useState<Comment[]>([]);
  const [recorded, setRecorded] = useState<Verdict | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [auditEntries, setAuditEntries] = useState<AuditTrailEntry[]>([]);

  const loadComments = useCallback(async () => {
    try {
      const res = await fetch(`/api/items/${item.id}/comments`);
      if (res.ok) setComments(await res.json());
    } catch {
      /* comments are best-effort */
    }
  }, [item.id]);

  const loadAuditTrail = useCallback(async () => {
    try {
      const res = await fetch(`/api/items/${item.id}/audit-trail`);
      if (res.ok) setAuditEntries(await res.json());
    } catch {
      /* history is best-effort */
    }
  }, [item.id]);

  useEffect(() => {
    loadComments();
    loadAuditTrail();
  }, [loadComments, loadAuditTrail]);

  async function submitVerdict(verdict: Verdict) {
    setErr(null);
    try {
      await postVerdict(item.id, verdict);
      setRecorded(verdict);
      loadComments();
      loadAuditTrail();
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

  const recommendedTitle = payload?.options.find((o) => o.id === payload.recommended)?.title;
  const isDecided = Boolean(item.decided_at);

  return (
    <article className={`dv ${isDecided ? "dv--decided" : ""}`}>
      <header className="dv__head">
        <div className="dv__pills">
          <span className={`dv__pill ${isDecided ? "dv__pill--done" : ""}`}>{item.status}</span>
          {item.source_repo ? <span className="dv__pill">{item.source_repo}</span> : null}
          {!payload && item.decision_type ? <span className="dv__pill">{item.decision_type}</span> : null}
          {!payload && item.triage_bucket ? <span className="dv__pill">{item.triage_bucket}</span> : null}
        </div>
        <h2>{item.title}</h2>
      </header>

      {payload ? (
        <div className="dv__context" dangerouslySetInnerHTML={{ __html: contextHtml }} />
      ) : item.source_body ? (
        <p className="dv__context">{item.source_body}</p>
      ) : null}

      {payload?.previews ? (
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
        {payload ? (
          <>
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
          </>
        ) : (
          <>
            <p className="dv__hint">
              No structured decision-request on this item. Accept to mark it reviewed, or use Discussion below.
            </p>
            {recorded ? (
              <div className="dv__recorded">✓ Recorded: {verdictLabel(recorded)}</div>
            ) : (
              <button type="button" onClick={() => submitVerdict({ kind: "accepted" })}>
                Accept
              </button>
            )}
          </>
        )}
        {err ? <p className="dv__err">{err}</p> : null}
      </section>

      <section>
        <h3 className="dv__section-title">Discussion</h3>
        <CommentThread comments={comments} onSubmit={submitComment} />
      </section>

      <section>
        <h3 className="dv__section-title">History</h3>
        <AuditPanel entries={auditEntries} />
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
  // Hooks run unconditionally, before the `!decisions` early return below,
  // so the hook order stays stable across the loading -> loaded transition.
  const [selectedId, select] = useSelectedDecisionId();

  if (!decisions) return <p className="state">Loading decisions…</p>;

  const open = decisions.filter((d) => !d.decided_at);
  const decided = decisions.filter((d) => d.decided_at);

  // Fallback applies identically whether ?selected= is absent or names an
  // id not in the fetched set: first open, else first decided, else null.
  // This is derived on every render, not written back to the URL — only an
  // explicit row click (via `select`) ever rewrites ?selected=.
  const effectiveId =
    selectedId !== null && decisions.some((d) => d.id === selectedId)
      ? selectedId
      : (open[0]?.id ?? decided[0]?.id ?? null);

  const selected = effectiveId !== null ? (decisions.find((d) => d.id === effectiveId) ?? null) : null;

  return (
    <div>
      <div className="consus__section-lead">
        <h1>Decisions</h1>
        <p>The go / no-go queue — a question, a recommendation, and a real verdict for each.</p>
      </div>

      <div className="decisions-two-pane">
        <div className="decisions-two-pane__list">
          <DecisionListPane items={decisions} selectedId={effectiveId} onSelect={select} />
        </div>
        <div className="decisions-two-pane__detail">
          {selected ? (
            <DecisionView key={selected.id} item={selected} onDecided={reload} />
          ) : (
            <div className="empty">
              <strong>Select a decision to see its details</strong>
              Choose a decision from the list on the left.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Section: Projects (cross-project + per-project KB views)         */
/* ---------------------------------------------------------------- */

function ProjectsSection() {
  const [entries, setEntries] = useState<KbEntrySummary[] | null>(null);
  const [projects, setProjects] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [project, setProject] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [ingesting, setIngesting] = useState(false);
  const [ingestError, setIngestError] = useState<string | null>(null);
  // s2 (consus-phase18): the two diagram kinds (epic/story cascade,
  // architecture) each report their own pending-change count so this
  // section can show one accurate global "N pending changes" total
  // alongside each diagram's own per-tab dirty dot — see design-
  // discussion.md decision #3.
  const [cascadePendingChanges, setCascadePendingChanges] = useState(0);
  const [architecturePendingChanges, setArchitecturePendingChanges] = useState(0);

  const loadEntries = useCallback(() => {
    fetch("/api/kb-entries")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setEntries)
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((body) => setProjects(body.projects))
      .catch((e) => setError(e.message));
  }, []);

  async function ingestRepo(repoName: string) {
    setIngesting(true);
    setIngestError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(repoName)}/ingest`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      loadEntries();
      setRefreshToken((t) => t + 1);
    } catch (e) {
      setIngestError((e as Error).message);
    } finally {
      setIngesting(false);
    }
  }

  if (error) return <p className="state state--err">Could not load projects: {error}</p>;
  if (!entries || !projects) return <p className="state">Loading projects…</p>;

  return (
    <div>
      <div className="consus__section-lead">
        <h1>Projects</h1>
        <p>Every registered project — scope to one to see its diagrams, docs, and KB entries, or see the shape of things across all.</p>
      </div>

      {projects.length === 0 ? (
        <div className="empty">
          <strong>No projects registered</strong>
          Configure at least one project (see .pHive/consus-projects.json) so there's a repo to select and ingest.
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
            entries.length === 0 ? (
              <div className="empty">
                <strong>No KB entries yet</strong>
                Approved decisions and CBAs become durable, versioned KB entries here — grouped by project. Select a
                project above to see its docs and diagrams even before anything's been approved.
              </div>
            ) : (
              <GlobalView entries={entries} onSelect={() => {}} />
            )
          ) : (
            <>
              <div className="project-actions">
                <button type="button" onClick={() => ingestRepo(project)} disabled={ingesting}>
                  {ingesting ? "Ingesting…" : "Ingest repo"}
                </button>
                {ingestError ? <p className="dv__err">{ingestError}</p> : null}
              </div>
              <ProjectView
                project={project}
                entries={entries.filter((e) => (e.source_repo ?? "unassigned") === project)}
                onSelect={() => {}}
              />
              <DiagramPendingCount count={cascadePendingChanges + architecturePendingChanges} />
              <ProjectDiagram repo={project} refreshToken={refreshToken} onPendingChangesChange={setCascadePendingChanges} />
              <ProjectArchitectureDiagram
                repo={project}
                refreshToken={refreshToken}
                onPendingChangesChange={setArchitecturePendingChanges}
              />
              <ProjectDocs repo={project} refreshToken={refreshToken} />
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Same `diagram:${repo}` item-id convention server/routes/diagrams.ts's
 *  own diagramItemIdFor uses (s2, consus-phase18) — reconstructed
 *  client-side rather than duplicating a server import, since the
 *  architecture endpoint's response has no itemId field of its own (see
 *  ProjectArchitectureDiagram below). Safe because ProjectDiagram's own
 *  GET /api/diagrams fetch (always rendered alongside this one, see
 *  ProjectsSection) already upserts that exact item row on every load. */
function diagramItemIdFor(repo: string): string {
  return `diagram:${repo}`;
}

/**
 * s4: fetches a repo's epic/story diagram and wires the propose-a-change
 * action through POST /api/proposals (s3) — fire, then poll once for a
 * result so "pending" doesn't hang silently forever in the UI. s2
 * (consus-phase18) adds onPendingChangesChange, forwarded straight through
 * to DiagramView so ProjectsSection can show a global pending-changes count
 * alongside this diagram's own per-tab dirty dot.
 */
function ProjectDiagram({
  repo,
  refreshToken,
  onPendingChangesChange,
}: {
  repo: string;
  refreshToken?: number;
  onPendingChangesChange?: (count: number) => void;
}) {
  const [data, setData] = useState<{ itemId: string; epics: DiagramEpic[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingProposalId, setPendingProposalId] = useState<string | null>(null);
  const [auditEntries, setAuditEntries] = useState<AuditTrailEntry[]>([]);

  const loadAuditTrail = useCallback((itemId: string) => {
    fetch(`/api/items/${encodeURIComponent(itemId)}/audit-trail`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setAuditEntries)
      .catch(() => {
        /* history is best-effort */
      });
  }, []);

  useEffect(() => {
    setData(null);
    fetch(`/api/diagrams?repo=${encodeURIComponent(repo)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((body) => {
        setData(body);
        loadAuditTrail(body.itemId);
      })
      .catch((e) => setError(e.message));
  }, [repo, refreshToken, loadAuditTrail]);

  const proposeChange = useCallback(
    ({ diff, description }: { diff: string; description: string }) => {
      if (!data) return;
      fetch("/api/proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          itemId: data.itemId,
          targetType: "diagram",
          diff,
          description,
          requestedBy: "Mathew",
        }),
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((proposal) => {
          setPendingProposalId(proposal.status === "pending" ? proposal.id : null);
          loadAuditTrail(data.itemId);
        })
        .catch((e) => setError(e.message));
    },
    [data, loadAuditTrail],
  );

  if (error) return <p className="state state--err">Could not load the diagram: {error}</p>;
  if (!data) return <p className="state">Loading diagram…</p>;

  return (
    <DiagramView
      repo={repo}
      epics={data.epics}
      pendingProposal={pendingProposalId !== null}
      onProposeChange={proposeChange}
      auditEntries={auditEntries}
      onPendingChangesChange={onPendingChangesChange}
    />
  );
}

/**
 * consus-phase17-architecture-diagram-endpoint: fetches a repo's real
 * directory-structure architecture diagram (a second, independent diagram
 * kind from the epic/story cascade above) and renders it via
 * ArchitectureDiagramView. s2 (consus-phase18) adds real propose-a-change
 * wiring here too (this endpoint's own response still has no itemId of its
 * own, so diagramItemIdFor() above reconstructs the same id
 * GET /api/diagrams already upserts) plus onPendingChangesChange, the same
 * contract ProjectDiagram uses.
 */
function ProjectArchitectureDiagram({
  repo,
  refreshToken,
  onPendingChangesChange,
}: {
  repo: string;
  refreshToken?: number;
  onPendingChangesChange?: (count: number) => void;
}) {
  const [data, setData] = useState<{ topLevel: string; fullComponent: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingProposalId, setPendingProposalId] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    fetch(`/api/diagrams/${encodeURIComponent(repo)}/architecture`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((e) => setError(e.message));
  }, [repo, refreshToken]);

  const proposeChange = useCallback(
    ({ diff, description }: { diff: string; description: string }) => {
      fetch("/api/proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          itemId: diagramItemIdFor(repo),
          targetType: "diagram",
          diff,
          description,
          requestedBy: "Mathew",
        }),
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((proposal) => {
          setPendingProposalId(proposal.status === "pending" ? proposal.id : null);
        })
        .catch((e) => setError(e.message));
    },
    [repo],
  );

  if (error) return <p className="state state--err">Could not load the architecture diagram: {error}</p>;
  if (!data) return <p className="state">Loading architecture diagram…</p>;

  return (
    <ArchitectureDiagramView
      repo={repo}
      topLevel={data.topLevel}
      fullComponent={data.fullComponent}
      onProposeChange={proposeChange}
      pendingProposal={pendingProposalId !== null}
      onPendingChangesChange={onPendingChangesChange}
    />
  );
}

/**
 * s2 (phase6): this project's generated docs, alongside its diagram + KB
 * entries — folding the previously-separate global Docs tab's data into
 * the per-project view too. Read-only here (no propose-change wiring);
 * the global Docs tab remains the full-featured surface for that.
 */
function ProjectDocs({ repo, refreshToken }: { repo: string; refreshToken?: number }) {
  const [grouped, setGrouped] = useState<GroupedDocs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openDoc, setOpenDoc] = useState<{ format: "md" | "html"; content: string; path: string } | null>(null);

  useEffect(() => {
    setGrouped(null);
    setOpenDoc(null);
    fetch(`/api/docs?project=${encodeURIComponent(repo)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setGrouped)
      .catch((e) => setError(e.message));
  }, [repo, refreshToken]);

  async function open(docRepo: string, filePath: string) {
    const res = await fetch(
      `/api/docs/content?repo=${encodeURIComponent(docRepo)}&path=${encodeURIComponent(filePath)}`,
    );
    if (res.ok) {
      const data = await res.json();
      setOpenDoc({ format: data.format, content: data.content, path: filePath });
    }
  }

  if (error) return <p className="state state--err">Could not load docs: {error}</p>;
  if (!grouped) return <p className="state">Loading docs…</p>;

  const empty = docsAreEmpty(grouped);

  if (openDoc) {
    return (
      <div>
        <button className="doc-back" onClick={() => setOpenDoc(null)}>
          ← Back to docs
        </button>
        <DocRenderer format={openDoc.format} content={openDoc.content} />
      </div>
    );
  }

  return (
    <div>
      <h3 className="dv__section-title">Docs</h3>
      {empty ? (
        <div className="empty">
          <strong>No docs indexed yet</strong>
          Click "Ingest repo" above to pull this project's generated docs into Consus.
        </div>
      ) : (
        <DocBrowser grouped={grouped} onOpen={open} />
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
  const [query, setQuery] = useState("");
  const [collection, setCollection] = useState<KbCollection | null>(null);

  const load = useCallback((nextQuery: string, nextCollection: KbCollection | null) => {
    const params = new URLSearchParams();
    if (nextQuery) params.set("q", nextQuery);
    if (nextCollection) params.set("collection", nextCollection);
    const url = params.toString() ? `/api/kb-entries?${params.toString()}` : "/api/kb-entries";
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setEntries)
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load(query, collection);
  }, [load, query, collection]);

  return (
    <div>
      <div className="consus__section-lead">
        <h1>Knowledge base</h1>
        <p>Browse and search every KB entry — the durable, versioned record of what's been decided.</p>
      </div>
      {error ? <p className="state state--err">Could not load the KB: {error}</p> : null}
      <BacklogBrowser
        entries={entries ?? []}
        onSearch={setQuery}
        onSelect={() => {}}
        activeCollection={collection}
        onSelectCollection={setCollection}
      />
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
  const [openDoc, setOpenDoc] = useState<
    { format: "md" | "html"; content: string; path: string; repo: string; itemId: string } | null
  >(null);
  const [pendingProposalId, setPendingProposalId] = useState<string | null>(null);
  const [proposalFailureReason, setProposalFailureReason] = useState<string | null>(null);
  const [auditEntries, setAuditEntries] = useState<AuditTrailEntry[]>([]);

  // p14-6: search state — searchResults null means no search performed yet
  // (or the query was cleared), so the plain DocBrowser tree stays the
  // default view; [] means searched with zero matches.
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<DocSearchResult[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/docs")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setGrouped)
      .catch((e) => setError(e.message));
  }, []);

  function handleSearch(query: string) {
    setSearchQuery(query);
    setSearchError(null);
    if (!query) {
      // An empty query never hits the network — just drop back to the tree.
      setSearchResults(null);
      return;
    }
    fetch(`/api/docs/search?q=${encodeURIComponent(query)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((body: { query: string; results: DocSearchResult[] }) => setSearchResults(body.results))
      .catch((e) => setSearchError(e.message));
  }

  const loadAuditTrail = useCallback((itemId: string) => {
    fetch(`/api/items/${encodeURIComponent(itemId)}/audit-trail`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setAuditEntries)
      .catch(() => {
        /* history is best-effort */
      });
  }, []);

  async function open(repo: string, filePath: string) {
    const res = await fetch(`/api/docs/content?repo=${encodeURIComponent(repo)}&path=${encodeURIComponent(filePath)}`);
    if (res.ok) {
      const data = await res.json();
      setPendingProposalId(null);
      setProposalFailureReason(null);
      setOpenDoc({ format: data.format, content: data.content, path: filePath, repo, itemId: data.itemId });
      loadAuditTrail(data.itemId);
    }
  }

  const proposeChange = useCallback(
    ({ diff, description }: { diff: string; description: string }) => {
      if (!openDoc) return;
      fetch("/api/proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          itemId: openDoc.itemId,
          targetType: "doc",
          diff,
          description,
          requestedBy: "Mathew",
        }),
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((proposal) => {
          if (proposal.status === "pending") {
            setPendingProposalId(proposal.id);
            setProposalFailureReason(null);
          } else {
            setPendingProposalId(null);
            setProposalFailureReason(proposal.failure_reason ?? null);
          }
          loadAuditTrail(openDoc.itemId);
        })
        .catch((e) => setProposalFailureReason(e.message));
    },
    [openDoc, loadAuditTrail],
  );

  if (error) return <p className="state state--err">Could not load docs: {error}</p>;
  if (!grouped) return <p className="state">Loading docs…</p>;

  const empty = docsAreEmpty(grouped);

  if (openDoc) {
    return (
      <div>
        <div className="consus__section-lead">
          <button className="doc-back" onClick={() => setOpenDoc(null)}>
            ← Back to docs
          </button>
        </div>
        <DocRenderer
          format={openDoc.format}
          content={openDoc.content}
          onProposeChange={proposeChange}
          pendingProposal={pendingProposalId !== null}
          proposalFailureReason={proposalFailureReason}
          auditEntries={auditEntries}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="consus__section-lead">
        <h1>Docs</h1>
        <p>Generated briefs, PRDs, architecture, and plans — browsed by repo, epic, and phase, rendered in-app.</p>
      </div>
      <DocSearch onSearch={handleSearch} results={searchResults} onOpen={open} error={searchError} />
      {searchResults === null ? (
        empty ? (
          <div className="empty">
            <strong>No docs indexed yet</strong>
            The doc scanner indexes each configured repo's <code>.pHive/planning</code> and <code>docs/</code>
            output. Run a scan or add a project to populate this.
          </div>
        ) : (
          <DocBrowser grouped={grouped} onOpen={open} />
        )
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Section: Events (p14-5) — the UI over p14-3's event routes       */
/* ---------------------------------------------------------------- */

type EventSort = "detected_at" | "status" | "project";
type EventOrder = "asc" | "desc";
type EventViewMode = "active" | "archived";

const EVENT_STATUSES: EventStatus[] = ["new", "in_progress", "done", "dismissed"];

/**
 * p14-5: EventsSection owns the current project/status/sort/order filter
 * state, the active-vs-archived view mode, the fetched event list, the
 * scan-all trigger + its in-flight/error state, and which event (if any)
 * has its propose-composer open — matching ProjectsSection/DocsSection's
 * shape (local fetch state, a useCallback load function, filter-driven
 * re-fetch via useEffect). Filters default to unset (null) so the initial
 * load hits GET /api/events with no query params at all — a value only
 * joins the querystring once the operator has actually picked it.
 */
function EventsSection() {
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<string[] | null>(null);

  const [project, setProject] = useState<string | null>(null);
  const [status, setStatus] = useState<EventStatus | null>(null);
  const [sort, setSort] = useState<EventSort | null>(null);
  const [order, setOrder] = useState<EventOrder | null>(null);
  const [viewMode, setViewMode] = useState<EventViewMode>("active");

  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanWarning, setScanWarning] = useState<string | null>(null);

  const [statusError, setStatusError] = useState<string | null>(null);

  const [proposingEvent, setProposingEvent] = useState<EventRow | null>(null);
  const [proposeError, setProposeError] = useState<string | null>(null);

  // Reuses the existing GET /api/projects fetch pattern already in
  // ProjectsSection — a second independent fetch, matching how DocsSection
  // and ProjectsSection already each fetch overlapping data with no shared
  // cache (this story's own accepted low-severity risk).
  useEffect(() => {
    fetch("/api/projects")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((body) => setProjects(body.projects))
      .catch(() => {
        // best-effort — the project filter just degrades to "All projects
        // only" if this fails; it must never block the events list itself.
      });
  }, []);

  const load = useCallback(() => {
    setError(null);
    const params = new URLSearchParams();
    if (project) params.set("project", project);
    if (status) params.set("status", status);
    if (sort) params.set("sort", sort);
    if (order) params.set("order", order);
    const base = viewMode === "archived" ? "/api/events/history" : "/api/events";
    const qs = params.toString();

    fetch(qs ? `${base}?${qs}` : base)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setEvents)
      .catch((e) => setError(e.message));
  }, [project, status, sort, order, viewMode]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleStatusChange(id: string, nextStatus: EventStatus) {
    setStatusError(null);
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(id)}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const updated: EventRow = await res.json();
      // The row's own state updates in place with no full re-fetch required
      // — unless the status change moved it out of the view currently
      // showing (active -> archived, or archived -> active), in which case
      // it's optimistically removed so the operator doesn't have to
      // manually refresh to see it leave the queue.
      setEvents((prev) => {
        if (!prev) return prev;
        const stillBelongs = viewMode === "archived" ? updated.archived_at !== null : updated.archived_at === null;
        if (!stillBelongs) {
          return prev.filter((e) => e.id !== id);
        }
        return prev.map((e) => (e.id === id ? updated : e));
      });
    } catch (e) {
      setStatusError((e as Error).message);
    }
  }

  async function scanAll() {
    setScanning(true);
    setScanError(null);
    setScanWarning(null);
    try {
      const res = await fetch("/api/projects/scan-all", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const body: { results: Array<{ project: string; ok: boolean; error?: string }> } = await res.json();
      const failures = body.results.filter((r) => !r.ok);
      if (failures.length > 0) {
        setScanWarning(
          `Some projects failed to scan: ${failures
            .map((f) => `${f.project} (${f.error ?? "unknown error"})`)
            .join(", ")}`,
        );
      }
      load();
    } catch (e) {
      setScanError((e as Error).message);
    } finally {
      setScanning(false);
    }
  }

  function openPropose(event: EventRow) {
    setProposeError(null);
    setProposingEvent(event);
  }

  async function submitPropose(description: string) {
    if (!proposingEvent) return;
    setProposeError(null);
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(proposingEvent.id)}/propose`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description, requestedBy: "Mathew" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setProposingEvent(null);
      load();
    } catch (e) {
      setProposeError((e as Error).message);
    }
  }

  if (error) return <p className="state state--err">Could not load events: {error}</p>;

  return (
    <div>
      <div className="consus__section-lead">
        <h1>Events</h1>
        <p>Detected doc changes and decisions needing review — scan a project, or wait for one to land here.</p>
      </div>

      <div className="project-actions">
        <button type="button" onClick={scanAll} disabled={scanning}>
          {scanning ? "Scanning…" : "Scan all projects"}
        </button>
        {scanError ? <p className="dv__err">{scanError}</p> : null}
        {scanWarning ? <p className="dv__warn">{scanWarning}</p> : null}
      </div>

      <div className="consus__nav" style={{ marginBottom: 18, marginLeft: 0 }}>
        <button
          className={`consus__nav-btn ${viewMode === "active" ? "consus__nav-btn--active" : ""}`}
          onClick={() => setViewMode("active")}
        >
          Active
        </button>
        <button
          className={`consus__nav-btn ${viewMode === "archived" ? "consus__nav-btn--active" : ""}`}
          onClick={() => setViewMode("archived")}
        >
          Archived
        </button>
      </div>

      <div className="events-filters">
        <label>
          Project
          <select
            aria-label="Filter by project"
            value={project ?? ""}
            onChange={(e) => setProject(e.target.value || null)}
          >
            <option value="">All projects</option>
            {(projects ?? []).map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select
            aria-label="Filter by status"
            value={status ?? ""}
            onChange={(e) => setStatus((e.target.value || null) as EventStatus | null)}
          >
            <option value="">All statuses</option>
            {EVENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sort by
          <select
            aria-label="Sort by"
            value={sort ?? ""}
            onChange={(e) => setSort((e.target.value || null) as EventSort | null)}
          >
            <option value="">Default (detected_at)</option>
            <option value="detected_at">Detected at</option>
            <option value="status">Status</option>
            <option value="project">Project</option>
          </select>
        </label>
        <label>
          Order
          <select
            aria-label="Sort order"
            value={order ?? ""}
            onChange={(e) => setOrder((e.target.value || null) as EventOrder | null)}
          >
            <option value="">Default (desc)</option>
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </label>
      </div>

      {statusError ? <p className="dv__err">{statusError}</p> : null}

      {events === null ? (
        <p className="state">Loading events…</p>
      ) : (
        <EventsList events={events} viewMode={viewMode} onStatusChange={handleStatusChange} onPropose={openPropose} />
      )}

      {proposingEvent ? (
        <EventProposeComposer
          event={proposingEvent}
          onCancel={() => {
            setProposingEvent(null);
            setProposeError(null);
          }}
          onSubmit={submitPropose}
          error={proposeError}
        />
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* First-run onboarding (s3, phase6)                                */
/* ---------------------------------------------------------------- */

/**
 * s3 (phase6): shown instead of the normal tab shell when there's nothing
 * ingested anywhere yet (no docs, no KB entries, no decisions) — a fresh
 * install otherwise just shows empty tabs with no explanation.
 */
function OnboardingScreen({ onIngested }: { onIngested: () => void }) {
  const [ingesting, setIngesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ingest() {
    setIngesting(true);
    setError(null);
    try {
      const res = await fetch("/api/projects/consus/ingest", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      onIngested();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIngesting(false);
    }
  }

  return (
    <div className="onboarding">
      <span className="onboarding__mark">◈</span>
      <h1>Consus</h1>
      <p className="onboarding__lede">
        A knowledgebase, graph, and file editor for this repo's own decisions, docs, and
        architecture — plus a surface to work through them with an agent harness.
      </p>

      <section className="onboarding__step">
        <h2>Ingest repo</h2>
        <p>Pull this repo's generated docs, architecture, and diagrams into Consus's own store.</p>
        <button type="button" onClick={ingest} disabled={ingesting}>
          {ingesting ? "Ingesting…" : "Ingest repo to create initial knowledge base"}
        </button>
        {error ? <p className="dv__err">{error}</p> : null}
      </section>

      <section className="onboarding__step">
        <h2>Install into harness</h2>
        <p>
          Run <code>npm run agent:init</code> to install Consus's agent-facing skill into both
          Claude Code (<code>~/.claude/skills/</code>) and Codex CLI (<code>~/.codex/skills/</code>,
          or <code>$CODEX_HOME/skills/</code> when set) — any Claude Code or Codex CLI session on
          this machine can then read Consus's open-decision queue and submit verdicts directly. An
          operator with only one harness installed sees that one updated and the other reported as
          not detected, not an error; pass <code>--harness claude</code> or{" "}
          <code>--harness codex</code> to install into just one. See{" "}
          <code>skills/consus/SKILL.md</code> for the full contract. Idempotent, safe to re-run
          any time (<code>npm run agent:status</code> checks without installing).
        </p>
      </section>

      <section className="onboarding__step">
        <h2>Interact with plugin-hive</h2>
        <p>
          Deeper integration with plugin-hive's own planning and execution loop is on the
          roadmap — for now, Consus stands entirely on its own.
        </p>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* App shell                                                        */
/* ---------------------------------------------------------------- */

type Tab = "decisions" | "projects" | "kb" | "docs" | "events";

const TABS: { id: Tab; label: string }[] = [
  { id: "decisions", label: "Decisions" },
  { id: "projects", label: "Projects" },
  { id: "kb", label: "KB" },
  { id: "docs", label: "Docs" },
  { id: "events", label: "Events" },
];

export function App() {
  const [tab, setTab] = useState<Tab>("decisions");
  const [decisions, setDecisions] = useState<DecisionItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onboardingCheck, setOnboardingCheck] = useState<{ docsEmpty: boolean; kbEmpty: boolean } | null>(null);
  // s1 (consus-phase18): resolves/persists the operator's skin choice and
  // applies [data-skin] to the document root — mounted once, here, so the
  // skin backdrop/chrome below and the picker in the masthead always agree.
  const { skin } = useSkinPreference();

  const reload = useCallback(() => {
    fetch("/api/decisions?all=1")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setDecisions)
      .catch((e) => setError(e.message));
  }, []);

  const checkOnboarding = useCallback(() => {
    Promise.all([
      fetch("/api/docs").then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
      fetch("/api/kb-entries").then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
    ])
      .then(([docs, kbEntries]) => {
        setOnboardingCheck({
          docsEmpty: docsAreEmpty(docs as GroupedDocs),
          kbEmpty: Array.isArray(kbEntries) ? kbEntries.length === 0 : true,
        });
      })
      .catch(() => {
        // best-effort — a failed check must never block the app; assume not first-run
        setOnboardingCheck({ docsEmpty: false, kbEmpty: false });
      });
  }, []);

  useEffect(() => {
    reload();
    checkOnboarding();
  }, [reload, checkOnboarding]);

  const openCount = decisions?.filter((d) => !d.decided_at).length ?? 0;

  const isFirstRun =
    onboardingCheck !== null &&
    decisions !== null &&
    onboardingCheck.docsEmpty &&
    onboardingCheck.kbEmpty &&
    decisions.length === 0;

  if (!error && (onboardingCheck === null || decisions === null)) {
    return (
      <div className="consus">
        <SkinBackdrop skin={skin} />
        <p className="state">Loading…</p>
      </div>
    );
  }

  if (isFirstRun) {
    return (
      <div className="consus">
        <SkinBackdrop skin={skin} />
        <OnboardingScreen
          onIngested={() => {
            reload();
            checkOnboarding();
          }}
        />
      </div>
    );
  }

  return (
    <div className="consus">
      <SkinBackdrop skin={skin} />
      <header className="consus__masthead">
        <div className="consus__brand">
          {skin === "harness" ? <HarnessWindowDots /> : null}
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
        <ThemeSkinPicker />
        {/* s4 (consus-phase18): universal across all 3 skins, not decoration
            exclusive to Harness — mounted once, here, so ⌘K/Ctrl+K works
            regardless of which tab or skin is active. */}
        <CommandPalette />
      </header>

      {/* s1 (consus-phase19): visible on every tab regardless of which is
          active, same as the masthead itself — see design-discussion.md. */}
      <HarnessConnectBanner />

      <main className="consus__main">
        {error ? <p className="state state--err">Could not load decisions: {error}</p> : null}
        {tab === "decisions" ? <DecisionsSection decisions={decisions} reload={reload} /> : null}
        {tab === "projects" ? <ProjectsSection /> : null}
        {tab === "kb" ? <KbSection /> : null}
        {tab === "docs" ? <DocsSection /> : null}
        {tab === "events" ? <EventsSection /> : null}
      </main>
    </div>
  );
}
