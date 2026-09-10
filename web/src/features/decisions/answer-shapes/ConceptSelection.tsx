import type { ConceptSelectionPayload, Verdict } from "./types";

export interface ConceptSelectionProps {
  payload: ConceptSelectionPayload;
  onVerdict: (verdict: Verdict) => void;
}

/**
 * dostal:concept-selection/v1 renderer — each concept's name, description,
 * and rendered SVG preview shown side by side, with a "Select" action per
 * concept that fires a `concept_selected` verdict carrying that concept's
 * id. Deliberately generalized (not logo-specific): any future "pick one
 * of N named options, each with a visual preview" decision reuses this
 * component rather than a new payload type/renderer being added.
 *
 * SECURITY: `preview.markup` is rendered via dangerouslySetInnerHTML. This
 * is safe only because the field is scoped to trusted, server/operator-
 * authored content (see ConceptSelectionPayload's doc comment in
 * ./types.ts) — it must never carry end-user-supplied markup.
 */
export function ConceptSelection({ payload, onVerdict }: ConceptSelectionProps) {
  return (
    <div className="concept-selection">
      <p className="concept-selection__context">{payload.context}</p>

      <ul className="concept-selection__concepts" data-testid="concept-selection-list">
        {payload.concepts.map((concept) => (
          <li key={concept.id} className="concept-selection__concept" data-testid={`concept-${concept.id}`}>
            <div
              className="concept-selection__preview"
              data-testid={`concept-preview-${concept.id}`}
              // Trusted, server/operator-authored SVG markup only — see the
              // SECURITY note on ConceptSelectionPayload in ./types.ts.
              dangerouslySetInnerHTML={{ __html: concept.preview.markup }}
            />
            <span className="concept-selection__concept-name">{concept.name}</span>
            <p className="concept-selection__concept-description">{concept.description}</p>
            <button type="button" onClick={() => onVerdict({ kind: "concept_selected", conceptId: concept.id })}>
              Select {concept.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
