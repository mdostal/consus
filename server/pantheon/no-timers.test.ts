/**
 * @vitest-environment node
 *
 * PANT-807 guard: the Pantheon integration must not grow new polling. Answer
 * delivery retries run at startup and on POST /api/questions/redeliver only,
 * so no module under server/pantheon/ may call setInterval/setTimeout except
 * the pre-existing question puller (the CONSUS_HARNESS=pantheon feed poll).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PANTHEON_DIR = dirname(fileURLToPath(import.meta.url));

// file → number of timer calls it is allowed to contain.
const ALLOWED: Record<string, number> = {
  "question-puller.ts": 1,
};

const TIMER_RE = /\bset(Interval|Timeout)\s*\(/g;

describe("server/pantheon/ timer guard", () => {
  it("adds no setInterval/setTimeout outside the allowlisted question puller", () => {
    const offenders = readdirSync(PANTHEON_DIR)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => ({ file: f, count: (readFileSync(join(PANTHEON_DIR, f), "utf8").match(TIMER_RE) ?? []).length }))
      .filter(({ file, count }) => count > (ALLOWED[file] ?? 0));
    expect(offenders).toEqual([]);
  });

  it("the pattern catches a timer call (sanity check)", () => {
    expect("x = setTimeout(() => {}, 1)".match(TIMER_RE)).toHaveLength(1);
    expect("setInterval (fn, 5)".match(TIMER_RE)).toHaveLength(1);
  });
});
