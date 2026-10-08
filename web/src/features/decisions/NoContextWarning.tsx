/**
 * PANT-919: a decision (or survey member) shipped with no attachments and no
 * artifact links gives the reviewer nothing to decide from — the flayr nav
 * survey went out exactly like that and was closed as done. Surface it loudly
 * instead of leaving an empty "Supporting material" section for the reader to
 * discover. `count` comes from GET /api/decisions' supporting_material_count;
 * undefined (an older server that doesn't report it) renders nothing rather
 * than a false alarm.
 *
 * PANT-938: `requestedAt` (needs_context_requested_at) is when Consus asked
 * Pantheon to fill the context in via `decision:needs-context`. The warning
 * still disappears as soon as material arrives (count > 0); it never blocks
 * answering.
 */
export function NoContextWarning({ count, requestedAt }: { count: number | undefined; requestedAt?: string | null }) {
  if (count !== 0) return null;
  return (
    <p className="no-context-warning" role="alert" data-testid="no-context-warning">
      <b>No context attached.</b> This decision has no attachments, artifact links, sourced research or doc —
      ask for the supporting research before answering.
      {requestedAt ? (
        <span className="no-context-warning__requested" data-testid="no-context-requested">
          {" "}
          Research requested {new Date(requestedAt).toLocaleString()}.
        </span>
      ) : null}
    </p>
  );
}
