export type DiffPartType = "equal" | "added" | "removed";

export interface DiffPart {
  type: DiffPartType;
  value: string;
}

function tokenize(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

/**
 * Word-level diff via LCS. Returns a sequence of equal/added/removed parts
 * describing how `newText` differs from `oldText` (whitespace preserved as
 * its own tokens so reconstructed "equal" runs keep original formatting).
 */
export function diffText(oldText: string, newText: string): DiffPart[] {
  const oldTokens = tokenize(oldText);
  const newTokens = tokenize(newText);
  const n = oldTokens.length;
  const m = newTokens.length;

  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = oldTokens[i] === newTokens[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const parts: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldTokens[i] === newTokens[j]) {
      parts.push({ type: "equal", value: oldTokens[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      parts.push({ type: "removed", value: oldTokens[i] });
      i++;
    } else {
      parts.push({ type: "added", value: newTokens[j] });
      j++;
    }
  }
  while (i < n) {
    parts.push({ type: "removed", value: oldTokens[i] });
    i++;
  }
  while (j < m) {
    parts.push({ type: "added", value: newTokens[j] });
    j++;
  }

  return mergeAdjacent(parts);
}

function mergeAdjacent(parts: DiffPart[]): DiffPart[] {
  const merged: DiffPart[] = [];
  for (const part of parts) {
    const last = merged[merged.length - 1];
    if (last && last.type === part.type) {
      last.value += part.value;
    } else {
      merged.push({ ...part });
    }
  }
  return merged;
}
