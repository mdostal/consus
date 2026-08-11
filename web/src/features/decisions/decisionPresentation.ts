import type { DecisionListItem } from "../../api/decisions";

/**
 * Shared between DecisionList (list rows) and DecisionDetailPanel (detail
 * view) so the two panes never drift on how a decision_type badge or
 * recommendation line is worded.
 */
export const DECISION_TYPE_LABELS: Record<string, string> = {
  cba: "Architecture",
  choose: "Choose",
  survey: "Survey",
  edit: "Edit",
  quorum: "Quorum",
  doc: "Doc",
  default: "General",
};

export function recommendationFor(item: DecisionListItem): string | undefined {
  if (!item.decision_payload) return undefined;
  const recommended = item.decision_payload.options.find((o) => o.id === item.decision_payload!.recommended);
  return recommended ? `Recommend: ${recommended.title}` : undefined;
}
