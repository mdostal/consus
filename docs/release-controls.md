# Release Controls, Experiments, and Metrics

Consus is a decision surface, so release controls are mostly about changing the
review experience without confusing the operator or losing auditability.

## Feature Toggles

Use feature toggles for changes that alter core decision flow, adapter behavior,
or generated document rendering.

Good toggle candidates:

- New answer shapes for decision cards.
- Alternative doc-rendering modes.
- New Pantheon adapters.
- Diagram generation and cache behavior.
- Question inbox workflows that write back to Multica.

Avoid toggles for simple copy, docs, or isolated visual cleanup. Those changes
should ship normally with tests.

## A/B Notes

A/B testing applies only when the same underlying decision can be presented in
two safe ways. It does not apply to destructive actions, issue status mutation,
or anything that changes the persisted decision record.

Reasonable A/B candidates:

- Decision-card layout density.
- Empty-state wording.
- Browse order for docs and epics.
- Quick filters in the question inbox.

Every experiment must preserve the same API writes and audit-log shape across
variants.

## Metrics

Track whether Consus is making review faster and less ambiguous:

- Time from parked question created to answered.
- Time from generated artifact detected to first human view.
- Time from human view to decision.
- Decision queue age by type and source.
- Approval, reject, and iterate counts.
- Failed adapter syncs by integration.
- Docs rendered with diagram errors.

Metrics should inform product decisions; they should not become hidden gates
that mutate issue state without an explicit operator action.
