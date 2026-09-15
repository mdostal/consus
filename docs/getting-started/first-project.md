# First Project

This walkthrough takes you through the full core loop: register a project, ingest its docs, browse the result, and submit a decision.

## 1. Start the server

```bash
npm run dev
```

Open `http://localhost:5173` in a browser. On a fresh install you'll see the onboarding screen.

## 2. Register a project

Consus tracks repos as named projects. Register one via the API or the UI.

**Via API:**

```bash
curl -X POST http://localhost:8722/api/projects \
  -H 'Content-Type: application/json' \
  -d '{"name": "my-repo", "path": "/absolute/path/to/my-repo"}'
```

The `name` may only contain letters, numbers, `-` and `_`. The `path` must exist on disk. Consus runs an initial ingest as part of registration.

**Via UI:**

Click "Add project" on the onboarding screen. Enter a name and the absolute path to the repo.

## 3. Ingest docs

If the project was just registered, ingest already ran. To re-scan after new docs land:

```bash
curl -X POST http://localhost:8722/api/projects/my-repo/ingest
# → { "project": "my-repo", "docsScanned": 12, "eventsCreated": 3 }
```

Or scan every configured project at once:

```bash
curl -X POST http://localhost:8722/api/projects/scan-all
```

The scanner walks `.pHive/planning/` and `.pHive/epics/**` for `.md` and `.html` files. Only files in those directories are indexed — not the whole repo.

## 4. Browse docs and diagrams

In the UI, click your project name. The per-project view shows:

- **Diagram cascade** — the epic/story hierarchy as an editable React Flow canvas
- **Architecture diagram** — derived from the repo's directory structure
- **Docs tab** — rendered markdown docs, grouped by type (overview / design / wireframe)
- **KB tab** — the shared-truth knowledge base entries

Docs are rendered in place. Click any section to open the in-place editor.

## 5. Read the decision queue

```bash
curl http://localhost:8722/api/decisions
```

Each item in the queue carries a `decision_payload` in the `dostal:decision-request/v1` shape: a title, context, lettered options (A–Z) with tradeoffs, and a `recommended` letter.

The UI presents these as decision cards in the Decisions tab. Click a card to read the full context and options.

## 6. Submit a verdict

In the UI, click a decision card and choose one of:

- **Accept recommendation** — accept the `recommended` option as-is
- **Choose an option** — pick a different option from the list
- **Mix options** — combine several options with your own rationale
- **Request iteration** — send it back with feedback

Or directly via API:

```bash
curl -X POST http://localhost:8722/api/items/decision:my-repo:planning/my-decision.md/decide \
  -H 'Content-Type: application/json' \
  -d '{"actor": "me", "newStatus": "approved"}'
```

A decided item goes to the append-only audit log and no longer appears in `GET /api/decisions`. It never loses history.

## 7. Propose a doc change

Edit a doc section in the UI and click "Fire to harness." If a harness command is configured (`CONSUS_HARNESS_COMMAND`), the diff is sent to it and the result reported back. Without a configured harness it's a no-op — the diff is recorded but not applied.

See [Harness Transport](../agent-integration/harness-transport.md) for how to wire up a real harness.

## What's next

- [Configuration reference](../configuration.md) — env vars, project config file, harness wiring
- [API Reference](../api/index.md) — full HTTP contract for programmatic access
- [Agent Integration: Claude Code Skill](../agent-integration/skill.md) — one command to wire up a Claude Code harness
