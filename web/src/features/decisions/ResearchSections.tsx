import type { DecisionPayload } from "./answer-shapes/types";

/**
 * A payload's research findings, one collapsible section each. Shared by
 * DecisionCard (survey members) and the single-decision view, so a question
 * opened on its own through `?selected=` shows the same research it does
 * inside its survey.
 */
export function ResearchSections({ research }: { research: DecisionPayload["research"] }) {
  if (!research || research.length === 0) return null;
  return (
    <div className="decision-card__research" aria-label="Research findings">
      {research.map((section, i) => (
        <details key={i} className="decision-card__research-section" aria-label={section.title}>
          <summary className="decision-card__research-title">{section.title}</summary>
          <div className="decision-card__research-body">{section.body}</div>
          {section.sources && section.sources.length > 0 ? (
            <ul className="decision-card__research-sources" aria-label="Sources">
              {section.sources.map((src, j) => (
                <li key={j}>{src}</li>
              ))}
            </ul>
          ) : null}
        </details>
      ))}
    </div>
  );
}
