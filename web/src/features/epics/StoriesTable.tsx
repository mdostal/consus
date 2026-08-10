import type { EpicStory } from "../../api/epics";
import { tokens } from "../../theme/tokens";
import "../../theme/tokens.css";

export interface StoriesTableProps {
  stories: EpicStory[];
}

const styles = {
  table: {
    borderCollapse: "collapse",
    tableLayout: "fixed",
    width: "100%",
  },
  cell: {
    borderBottom: `1px solid ${tokens.color.line}`,
    padding: "10px 8px",
    textAlign: "left",
    verticalAlign: "top",
  },
  badge: {
    border: `1px solid ${tokens.color.line}`,
    borderRadius: 999,
    display: "inline-block",
    fontSize: 12,
    fontWeight: 700,
    padding: "3px 8px",
    whiteSpace: "nowrap",
  },
  muted: { color: tokens.color.inkMuted },
} as const;

export function StoriesTable({ stories }: StoriesTableProps) {
  if (stories.length === 0) {
    return <p data-testid="epic-stories-empty">No stories yet.</p>;
  }

  return (
    <table data-testid="epic-stories-table" style={styles.table}>
      <thead>
        <tr>
          <th style={{ ...styles.cell, width: "42%" }}>Story</th>
          <th style={{ ...styles.cell, width: "18%" }}>Status</th>
          <th style={{ ...styles.cell, width: "25%" }}>Dependencies</th>
          <th style={{ ...styles.cell, width: "15%" }}>Tracker</th>
        </tr>
      </thead>
      <tbody>
        {stories.map((story) => (
          <tr key={story.id}>
            <td style={styles.cell}>{story.title}</td>
            <td style={styles.cell}>
              <span data-testid="story-status-badge" style={styles.badge}>
                {story.status}
              </span>
            </td>
            <td style={styles.cell}>
              {story.dependencies.length > 0 ? story.dependencies.join(", ") : <span style={styles.muted}>None</span>}
            </td>
            <td style={styles.cell}>
              {story.tracker_url ? (
                <a href={story.tracker_url} rel="noreferrer" target="_blank">
                  Open
                </a>
              ) : (
                <span style={styles.muted}>None</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
