import { useActiveSkin } from "../../theme/useSkinPreference";
import { useDiagramRevisionCount } from "./diagramRevisionCounter";

/**
 * The shared diagram-metadata strip (s5, consus-phase18, design-discussion.md
 * resolved decision #9) — ONE component, ONE data source (revision/fire
 * count, operator, date, repo), reskinned per active skin rather than three
 * independently-maintained pieces of chrome:
 *
 *  - Drafting Table: a title-block, matching DraftingRegistrationMarks.tsx's
 *    precise, technical-drawing aesthetic — SHEET/PROJECT/SCALE/REV/DRAWN/
 *    DATE fields.
 *  - Case Board: a "CASE NO." stamp, matching CaseBoardCorkTexture.tsx's
 *    warm case-file aesthetic.
 *  - Harness: a terminal-style footer status line, matching
 *    HarnessWindowDots.tsx's command-prompt aesthetic.
 *
 * Presentation keys off the live [data-skin] attribute via useActiveSkin
 * (theme/useSkinPreference.ts) — the same axis every other skin-aware piece
 * from s1 already resolves off, not a new, parallel mechanism.
 *
 * No new identity system: there is no session/auth mechanism in this app to
 * source a real "operator" from (confirmed against App.tsx — every
 * propose-a-change/comment/verdict call already hardcodes the same literal
 * "Mathew" as requestedBy/actor/author). OPERATOR_NAME below reuses that
 * exact existing convention rather than inventing a new one.
 */
export const OPERATOR_NAME = "Mathew";

export interface DiagramMetadataStripProps {
  repo: string;
  /** Defaults to "now" — overridable for deterministic tests. */
  date?: Date;
}

/** Pure: deterministic YYYY-MM-DD, deliberately not toLocaleDateString
 *  (locale-dependent, would make tests and cross-machine rendering
 *  inconsistent for no real benefit — this is a machine-readable metadata
 *  field, not user-facing prose). */
export function formatMetadataDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

interface FieldsProps {
  repo: string;
  revision: number;
  operator: string;
  date: string;
}

/** One SHEET/PROJECT/SCALE/DRAWN/DATE-style field: a bold label <span>
 *  followed by an em-dash-joined value. Deliberately NOT a bare adjacent
 *  text node after the label (`<span>LABEL</span> {value}`) — Testing
 *  Library's getByText only matches an element's OWN direct text-node
 *  children (nested elements, like the label span, are excluded from that
 *  match), so a field whose only *direct* text were the bare value would
 *  make that field's own wrapping <div> match an exact-text query for the
 *  value alone — a real risk here since a repo can genuinely be named the
 *  same as one of its own diagram's node labels (e.g. "consus"'s
 *  architecture diagram has a root node literally labeled "consus"). The
 *  " — " is folded into the *same* text-node expression as the value so
 *  the field's own direct text is always "— <value>", never "<value>"
 *  alone. */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="diagram-metadata-strip__field">
      <span className="diagram-metadata-strip__label">{label}</span>
      {` — ${value}`}
    </div>
  );
}

/** Drafting Table's title block — SHEET/PROJECT/SCALE/REV/DRAWN/DATE, the
 *  same labeled-field language a real technical drawing sheet uses. */
function DraftingTitleBlock({ repo, revision, operator, date }: FieldsProps) {
  return (
    <div className="diagram-metadata-strip__drafting" data-testid="diagram-metadata-strip-drafting">
      <Field label="SHEET" value="DIAG-1" />
      <Field label="PROJECT" value={repo} />
      <Field label="SCALE" value="N.T.S." />
      <div className="diagram-metadata-strip__field diagram-metadata-strip__field--rev">
        <span className="diagram-metadata-strip__label">REV</span>{" "}
        <span data-testid="diagram-metadata-strip-revision">{revision}</span>
      </div>
      <Field label="DRAWN" value={operator} />
      <Field label="DATE" value={date} />
    </div>
  );
}

/** Case Board's "CASE NO." stamp — a rotated, inked-stamp treatment (CSS
 *  only) evoking a case-file folder tab, matching CaseBoardCorkTexture.tsx's
 *  warm, humanist aesthetic. */
function CaseBoardStamp({ repo, revision, operator, date }: FieldsProps) {
  return (
    <div className="diagram-metadata-strip__case-board" data-testid="diagram-metadata-strip-case-board">
      <span className="diagram-metadata-strip__stamp-label">CASE NO.</span>
      <span className="diagram-metadata-strip__stamp-value">
        {repo}-<span data-testid="diagram-metadata-strip-revision">{revision}</span>
      </span>
      <span className="diagram-metadata-strip__stamp-meta">
        Opened by {operator} &middot; {date}
      </span>
    </div>
  );
}

/** Harness's footer status line — a terminal prompt-style single line,
 *  matching HarnessWindowDots.tsx's command-prompt aesthetic. */
function HarnessStatusLine({ repo, revision, operator, date }: FieldsProps) {
  return (
    <div className="diagram-metadata-strip__harness" data-testid="diagram-metadata-strip-harness">
      <span className="diagram-metadata-strip__harness-prompt" aria-hidden="true">
        $
      </span>
      <span className="diagram-metadata-strip__harness-text">
        {repo} &middot; rev <span data-testid="diagram-metadata-strip-revision">{revision}</span> &middot; {operator}{" "}
        &middot; {date}
      </span>
    </div>
  );
}

export function DiagramMetadataStrip({ repo, date = new Date() }: DiagramMetadataStripProps) {
  const skin = useActiveSkin();
  const revision = useDiagramRevisionCount();
  const formattedDate = formatMetadataDate(date);
  const fields: FieldsProps = { repo, revision, operator: OPERATOR_NAME, date: formattedDate };

  return (
    <div
      className={`diagram-metadata-strip diagram-metadata-strip--${skin}`}
      data-testid="diagram-metadata-strip"
    >
      {skin === "drafting" ? (
        <DraftingTitleBlock {...fields} />
      ) : skin === "case-board" ? (
        <CaseBoardStamp {...fields} />
      ) : (
        <HarnessStatusLine {...fields} />
      )}
    </div>
  );
}
