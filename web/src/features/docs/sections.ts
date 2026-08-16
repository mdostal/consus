/**
 * p12-01: a minimal, dependency-free markdown section splitter.
 *
 * DocRenderer.tsx uses this to give each heading-delimited chunk of a doc its
 * own independent edit/diff/fire state (see the sectional-edit-state story).
 * Like textDiff.ts's computeLineDiff, this is a small scoped utility with no
 * external dependencies — it doesn't need to be a real markdown parser, just
 * good enough to find heading boundaries for splitting purposes.
 *
 * Splits on h1-h3 boundaries only (`#`, `##`, `###` at the start of a line,
 * followed by a space). h4-h6 are intentionally left un-split, matching the
 * one piece of concrete prior art for this codebase's definition of
 * "sectional" (see the story's design decisions).
 *
 * Known limitation (inherited, not introduced here): this is a naive regex
 * split, not a real markdown parser, so a heading-like line inside a fenced
 * code block (e.g. example markdown shown inside a ``` block) will still be
 * treated as a section boundary and over-split the doc. Real .pHive/ docs
 * rarely embed heading-shaped text in code fences, so this is accepted as a
 * known behavior rather than special-cased away.
 */
export function splitIntoSections(content: string): string[] {
  const parts = content.split(/(?=^#{1,3} )/m).filter((part) => part.length > 0);
  return parts.length > 0 ? parts : [content];
}
