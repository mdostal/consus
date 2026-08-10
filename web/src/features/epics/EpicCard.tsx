import type { EpicListItem } from "../../api/epics";
import "../../theme/tokens.css";

export interface EpicCardProps {
  epic: EpicListItem;
}

export function EpicCard({ epic }: EpicCardProps) {
  const dateStr = epic.last_updated
    ? new Date(epic.last_updated).toLocaleDateString()
    : "Unknown date";

  return (
    <article className="decision-card decision-card--summary" data-testid="epic-card">
      <h2 className="decision-card__question">{epic.title}</h2>
      <p className="decision-card__recommendation">
        <span data-testid="epic-status">Status: {epic.status}</span>
        {" | "}
        <span data-testid="epic-stories">Stories: {epic.story_count}</span>
        {" | "}
        <span data-testid="epic-updated">Updated: {dateStr}</span>
      </p>
    </article>
  );
}
