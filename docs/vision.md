# Consus Vision

## Current State

Consus already has the core product spine:

- A React web UI for decisions, epics, questions, generated docs, diagrams, and
  fire history.
- A Fastify server with SQLite persistence.
- Pantheon adapters for Multica, Minerva, Auriga, Vesta, and doc scanning.
- Living-doc and KB plumbing for retaining accepted context.
- A static GitHub Pages site for public orientation.

The immediate user value is readability. Pantheon output that used to be hard to
review in a terminal can now be surfaced as rendered docs and decision queues.

## Near-Term Goals

- Make generated planning artifacts easy to browse by repo, epic, and phase.
- Keep decision cards fast to scan and precise to answer.
- Preserve every accepted decision as durable KB rather than transient chat.
- Show parked questions clearly enough that a human can unblock agents quickly.
- Keep adapters replaceable so Consus can follow Pantheon service boundaries as
  the stack evolves.

## Long-Term Direction

Consus should become the default human control room for the Pantheon planning
and sign-off loop. A healthy future version makes three things obvious:

- What work is waiting on a human decision.
- Which document or artifact explains the tradeoff.
- What happens after the operator approves, rejects, or asks for iteration.

The long-term product should feel like a quiet operations surface: dense enough
for repeated use, legible enough for difficult decisions, and durable enough to
become institutional memory.

## Non-Goals

- Replacing Multica as the issue system.
- Replacing Minerva as the planner.
- Turning every Pantheon service into a Consus plugin boundary.
- Hiding uncertainty behind a polished screen when the underlying state is not
  ready for sign-off.
