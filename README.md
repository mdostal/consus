# Consus — the ideation & decision surface

> **Consus is the Q&A section of working with the Pantheon — the place where agents bring
> their questions, wireframes, PRDs, and diagrams to the human, the human answers and decides,
> and it goes back. It is ALSO the durable home of those docs and long-term decisions, kept so
> they can be re-opened and re-decided later.** (Formerly "Delphi".)

## What Consus IS

1. **The human↔agent Q&A loop.** When a planning agent (Minerva / hive planning) works an idea,
   it does **not** silently guess or grind straight to code. It produces a real design
   discussion and **surfaces its open questions to Consus**, where the human answers them. The
   answers flow **back** to the agent, which iterates. This back-and-forth is the whole point —
   getting the questions to the human and the answers back is **Minerva's primary purpose**.

2. **The review surface for real design artifacts.** An idea does not go straight to "pure
   work." It first yields **REAL WIREFRAMES, a PRD, and diagrams**, rendered **inline** in Consus
   for the human to react to — approve, comment, send back, or discuss with the agent.

3. **The durable decision record.** Approved decisions, CBAs, PRDs, and diagrams live here as
   long-term, **re-openable** records. A decision made months ago can be pulled back up and
   re-decided; the doc/diagram is the source of truth, versioned with an audit trail.

4. **The knowledge base.** Approved CBAs and design docs become shared truth the whole swarm can
   read.

## What Consus is NOT

- **Not a ship-notification dump.** "X shipped / UAT passed" agent notifications do **not** belong
  in the decision queue — they are noise, not a question or a decision for the human.
- **Not a task board.** The board/tracker (Multica) holds work items; Consus holds **decisions and
  questions**. A board-view must not flood the decision queue with shipped/in-flight work.
- **Not pure status.** Status has its own surfaces (Insights, the command board). Consus is where a
  human is *asked* something or *decides* something.

## The loop (canonical)

```
        idea (fired by human or agent)
                 │
                 ▼
   Minerva / hive planning  ──►  produces: design discussion,
                 │                 REAL wireframes, PRD, diagrams,
                 │                 and its OPEN QUESTIONS
                 ▼
            ┌──────────┐   questions + wireframes + PRD + diagrams
            │  CONSUS   │◄──────────────────────────────────────────
            │           │
            │  human:   │   reviews wireframes/PRD/diagrams,
            │  answers  │   answers questions, decides
            │  + decides│   (approve · choose · send-back · discuss)
            └────┬──────┘
                 │  answers / decision flow BACK
                 ▼
   Minerva / agents iterate  ──►  (loop back to Consus as needed)
                 │
                 ▼  on human sign-off
             BUILD work  ──►  Auriga routes → build → review → merge → done
                 │
                 ▼
     decision persists in Consus as a long-term, re-openable record + KB entry
```

## Decision types (how items are classified)

`cba` · `choose` · `survey` · `edit` · `quorum` · `doc` — driven by the decision payload, never a
hardcoded per-item allowlist. Triage buckets: `open_question` · `your_action` · `agent_task` ·
`research_plan` · `noise` (ship-notifications and board chatter classify as `noise` and stay out of
"needs-you").

## Rendering requirements

Consus MUST render, inline: markdown docs, **PRDs**, **wireframes**, and **diagrams (mermaid)**, plus
attachments (documents, screenshots, images). An agent-produced wireframe or diagram is only useful
if the human can see it in the surface. Agents must likewise be able to **consume** attachments the
human hands them (docs, screenshots, artifacts) — see the ingestion contract below.

## Ingestion contract (agents ⇄ humans hand each other artifacts)

- **Human → agent:** any idea/decision may carry **attachments** (files, screenshots, docs) or
  reference an in-repo artifact path. The working agent MUST read them as context. Artifacts we
  create also live **committed in the repo** (e.g. `docs/…`) so they are version-controlled and
  handed down, not stranded in an external link.
- **Agent → human:** questions, wireframes, PRDs, and diagrams are filed into Consus for review.

## Relationships

- **Minerva** produces the questions + wireframes + PRD + diagrams (the ideation input).
- **Consus** is where the human answers/decides and where the docs/decisions live.
- **Votum** handles voting / quorum decisions surfaced here.
- **Auriga** routes the *approved* work to build.

---
*This vision is canonical. If the implementation diverges from it, the implementation is the bug.*
