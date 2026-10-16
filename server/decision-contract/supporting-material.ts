/**
 * Supporting material that lives in the decision_payload itself: a research
 * section counts when it cites at least one source, and a `doc` pointer counts
 * once. Attachments and artifact links are counted in SQL
 * (SUPPORTING_MATERIAL_COUNT_SQL in server/routes/decisions.ts); the two add up
 * to `supporting_material_count`.
 */
export function nativeContextCount(payload: unknown): number {
  if (!payload || typeof payload !== "object") return 0;
  const p = payload as { research?: unknown; doc?: unknown };
  let n = 0;
  if (Array.isArray(p.research)) {
    n += p.research.filter(
      (section) =>
        !!section &&
        typeof section === "object" &&
        Array.isArray((section as { sources?: unknown }).sources) &&
        (section as { sources: unknown[] }).sources.some((s) => typeof s === "string" && s.trim() !== ""),
    ).length;
  }
  const doc = p.doc as { repo?: unknown; path?: unknown } | undefined;
  if (doc && typeof doc === "object" && typeof doc.repo === "string" && doc.repo && typeof doc.path === "string" && doc.path) {
    n += 1;
  }
  return n;
}
