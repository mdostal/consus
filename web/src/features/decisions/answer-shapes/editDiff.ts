/**
 * s4-edit-and-cba-answer-shapes: a small, dependency-free line diff for
 * EditProposalView. Same LCS-over-lines algorithm as
 * web/src/features/docs/textDiff.ts's computeLineDiff and server/events/
 * diff.ts's independent copy — kept as its own scoped copy here rather than
 * an import across feature boundaries, matching this codebase's existing
 * precedent of small independent copies of this exact utility (see
 * server/events/diff.ts's own comment on why client/server each keep one).
 *
 * Unlike computeLineDiff (which returns a single "+ "/"- "/"  "-prefixed
 * string), this returns structured lines so the renderer can style each one
 * without re-parsing prefixes.
 */
export type EditDiffLineKind = "context" | "added" | "removed";

export interface EditDiffLine {
  kind: EditDiffLineKind;
  text: string;
}

export function computeEditDiffLines(original: string, proposed: string): EditDiffLine[] {
  const a = original.split("\n");
  const b = proposed.split("\n");
  const m = a.length;
  const n = b.length;

  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const lines: EditDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      lines.push({ kind: "context", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      lines.push({ kind: "removed", text: a[i] });
      i++;
    } else {
      lines.push({ kind: "added", text: b[j] });
      j++;
    }
  }
  while (i < m) {
    lines.push({ kind: "removed", text: a[i] });
    i++;
  }
  while (j < n) {
    lines.push({ kind: "added", text: b[j] });
    j++;
  }

  return lines;
}
