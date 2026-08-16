/**
 * p8-02: a minimal, dependency-free line diff.
 *
 * server/proposals/store.ts and server/harness/transport.ts both treat the
 * `diff` field as opaque text — it's stored as-is and forwarded to whatever
 * HarnessTransport is configured (`invoke("proposeChange", { diff, ... })`)
 * without being parsed or validated against any specific format (e.g. unified
 * diff). So this utility only needs to produce a reasonable, readable
 * representation of what changed between two strings — not conform to any
 * particular diff standard.
 *
 * Implementation: a classic LCS-over-lines diff. Doc sizes in Consus are
 * small enough that the O(lines_a * lines_b) DP table is not a concern (see
 * the story's risk notes — revisit only if this becomes a measured problem).
 */
export function computeLineDiff(original: string, edited: string): string {
  const a = original.split("\n");
  const b = edited.split("\n");
  const m = a.length;
  const n = b.length;

  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const lines: string[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      lines.push(`  ${a[i]}`);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      lines.push(`- ${a[i]}`);
      i++;
    } else {
      lines.push(`+ ${b[j]}`);
      j++;
    }
  }
  while (i < m) {
    lines.push(`- ${a[i]}`);
    i++;
  }
  while (j < n) {
    lines.push(`+ ${b[j]}`);
    j++;
  }

  return lines.join("\n");
}
