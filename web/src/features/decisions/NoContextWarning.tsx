/**
 * PANT-919: a decision (or survey member) shipped with no attachments and no
 * artifact links gives the reviewer nothing to decide from — the flayr nav
 * survey went out exactly like that and was closed as done. Surface it loudly
 * instead of leaving an empty "Supporting material" section for the reader to
 * discover. `count` comes from GET /api/decisions' supporting_material_count;
 * undefined (an older server that doesn't report it) renders nothing rather
 * than a false alarm.
 */
export function NoContextWarning({ count }: { count: number | undefined }) {
  if (count !== 0) return null;
  return (
    <p className="no-context-warning" role="alert" data-testid="no-context-warning">
      <b>No context attached.</b> This decision has no attachments or artifact links — ask for the supporting
      research before answering.
    </p>
  );
}
