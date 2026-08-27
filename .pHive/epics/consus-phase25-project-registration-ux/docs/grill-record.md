# Grill Record — consus-phase25-project-registration-ux

**Source draft:** .pHive/epics/consus-phase25-project-registration-ux/docs/design-discussion.md
**CONTEXT.md substrate:** present
**inconsistency_risk_signals:** absent (no research-brief.md — researcher was dispatched directly; heuristic pass)
**round_number:** 1
**unresolved_count:** 4

## Summary

- Vocabulary mismatches: clean
- Hidden assumptions: 2 findings
- Unresolved tensions: 1 finding
- Convention violations: clean
- Posture mismatches: 1 finding

## Vocabulary mismatches

No findings. CONTEXT.md does not define "project" vs. "repo" distinctly, and the draft uses them
consistently with existing route naming (`/api/projects/:project`) throughout. Clean.

## Hidden assumptions

- **H1** — §5.3's recommendation ("one level deep, not recursive") is grounded in "matches the
  sibling-repo problem" but the operator's actual complaint ("i don't know where the ... shit lives
  off of memory") reads as genuine uncertainty about location, not necessarily "it's a sibling I
  forgot the name of." The draft doesn't establish that the operator's real repos are one level deep
  from a discoverable root — it's an assumption based on this session's own test (`heimdall` was a
  direct sibling of `consus`), not a verified general case.
  - Draft location: §5, item 3 ("Recommendation: scan candidate roots exactly one level deep...")
  - Why this matters: if real repos commonly live two+ levels deep (e.g.
    `~/work/clients/acme/repo`), the discovery feature ships and still doesn't solve the stated
    problem for those repos — the operator falls back to free-text entry exactly as often as today.
  - Question for planner: is one-level-deep confirmed sufficient, or should this be presented to the
    operator as a real open question (it already is, at §5.3) with the risk of under-delivering made
    explicit rather than soft-recommended?

- **H2** — §3.1 proposes changing `GET /api/projects`'s response shape, but
  `docs/api-reference.md:30` documents the current shape (`{ "projects": string[] }`) as an exact,
  literal contract — the doc's own header states "a harness author should be able to use Consus from
  this doc alone, without reading source." The draft's proposed approach doesn't mention updating
  this documented contract as part of the work, only the runtime behavior change.
  - Draft location: §3, item 1 ("Extend `GET /api/projects`'s response to include...")
  - Why this matters: this is the same contract `skills/consus/SKILL.md`-driven agent harnesses are
    told to rely on. An additive field is JSON-safe for normal consumers, but the documented contract
    itself goes stale the moment this ships, and a strict-schema-validating harness could reject the
    new shape.
  - Question for planner: should the story that touches this route also require a
    `docs/api-reference.md` update as an explicit acceptance criterion (matching how the phase24 doc
    changes handled new/changed routes)?

## Unresolved tensions

- **U1** — §5.2 recommends "plain token-styled text... rather than a title-block-style treatment"
  for the repo-path display, on the grounds that it's "informational chrome, not a diagram artifact."
  But the operator's complaint #2 in §0 is specifically that the add-project form "didn't map to the
  rest of the application" — i.e., a *complaint about things looking bare/generic*. A bare line of
  plain text next to the project name risks reading as the same category of problem the operator
  already flagged, even though it's a different component.
  - Draft location: §3 item 1 vs. §0 (prelude, complaint #2) vs. §5 item 2
  - Tension: "keep it minimal / don't over-engineer" (draft's own stated bias, consistent with §3
    item 2's "not a full form redesign") vs. "make it look like it belongs" (the operator's literal
    ask, which was specifically about a bare-looking element)
  - Question for planner: does "plain text using `--consus-*` tokens" concretely satisfy "looks like
    it belongs," or does the repo path need at minimum a labeled field (e.g. the same
    label-wraps-value pattern already used everywhere else in this app, not just token-colored raw
    text) to actually read as intentional rather than another loose string?

## Convention violations

No findings. The proposed `CONSUS_DISCOVERY_ROOTS` env var matches this codebase's existing
env-driven config convention exactly (`CONSUS_PROJECTS_CONFIG`, `CONSUS_DB_PATH`,
`CONSUS_ATTACHMENTS_DIR`, `CONSUS_HARNESS_COMMAND` — all optional, all documented in
`docs/api-reference.md`/`README.md`). Clean.

## Posture mismatches

- **P1** — Consus's stated architecture (README.md) is "zero live coupling to any other system... it
  binds to `127.0.0.1` by default — no network exposure unless you explicitly opt in via `HOST`
  (e.g. for a containerized deploy)." The draft's §6 risks section addresses *path disclosure of
  already-registered projects* but does not address that the new discovery endpoint scans and returns
  *arbitrary directory names the operator has never registered* — a meaningfully different exposure
  category. In the README's own documented containerized-deploy case (`HOST=0.0.0.0`), a discovery
  scan would return a listing of the container's local directory structure to any network caller that
  can reach the API, not just metadata about repos the operator explicitly opted into registering.
  - Draft location: §6 (Risks) — "Path disclosure" bullet, and §3 item 3 (discovery endpoint)
  - Posture reference: `README.md` — "Consus is fully standalone... binds to 127.0.0.1 by default"
  - Question for planner: should the discovery endpoint be explicitly gated (e.g. a no-op / 404 when
    `HOST` is set to a non-loopback value, or simply documented as a loopback-only feature with a
    one-line callout), or is this an accepted deviation on the grounds that a containerized Consus
    deploy is already a deliberate, explicit operator choice and out of this epic's practical scope?

## Notes

The draft is otherwise well-grounded — every claim in §2 traces to a specific file:line from the
research pass, and the three open questions in §5 already anticipate two of this record's four
findings (H1 overlaps §5.3, and this record's job is to make the risk of under-delivering on H1
explicit rather than soft-pedaled as a "confirm this is sufficient" ask). U1 and P1 are new findings
not previously surfaced.

## Out of scope (this pass)

Grill does not propose solutions, score quality, gate work, or prioritize findings. Each finding
ends with a question for the planner; the planner's job is to revise the draft (or document accepted
deviations) before stories are written.
