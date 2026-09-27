# Agent Integration Examples

Worked examples for common harness tasks. All examples assume Consus is running at `http://localhost:8722`.

---

## Example 1: Read the decision queue and submit a verdict

```bash
#!/usr/bin/env bash
# Read open decisions and accept the recommended option for each one.

BASE=http://localhost:8722

# 1. Read the open queue
decisions=$(curl -s "$BASE/api/decisions")

# 2. For each decision, accept the recommended option
echo "$decisions" | python3 -c "
import json, sys, urllib.request

base = 'http://localhost:8722'
decisions = json.load(sys.stdin)

for item in decisions:
    item_id = item['id']
    payload = item.get('decision_payload', {})
    recommended = payload.get('recommended')
    if not recommended:
        continue

    # Submit verdict: accept recommendation
    body = json.dumps({'actor': 'my-harness', 'newStatus': 'approved'}).encode()
    req = urllib.request.Request(
        f'{base}/api/items/{urllib.parse.quote(item_id, safe=\"\")}/decide',
        data=body,
        headers={'Content-Type': 'application/json'},
        method='POST'
    )
    with urllib.request.urlopen(req) as resp:
        result = json.load(resp)
        print(f'Decided {item_id}: {result}')
"
```

---

## Example 2: Push a new decision from a harness

```bash
curl -X POST http://localhost:8722/api/decisions \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "my-repo:auth-strategy-2026-09",
    "title": "Choose authentication strategy for v2",
    "source_repo": "my-repo",
    "decision_payload": {
      "version": "dostal:decision-request/v1",
      "title": "Choose authentication strategy for v2",
      "context": "We are migrating to a new auth layer for v2. Two options are in contention.",
      "options": [
        {
          "id": "A",
          "title": "JWT with short expiry",
          "tradeoffs": "Stateless, scales well. Revocation requires a denylist or short TTL."
        },
        {
          "id": "B",
          "title": "Session cookies with Redis",
          "tradeoffs": "Instant revocation, centralized session store. Adds a Redis dependency."
        }
      ],
      "recommended": "A"
    }
  }'
```

On success, the decision appears in `GET /api/decisions` and in the Consus UI. A duplicate `id` returns 409.

---

## Example 3: Push a CBA

A CBA (cost-benefit analysis) is a `dostal:decision-request/v1` — the same shape. Options are the alternatives being compared; `tradeoffs` describes cost and benefit; `recommended` is the analyst's pick.

```bash
curl -X POST http://localhost:8722/api/decisions \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "my-repo:cba-postgres-vs-sqlite-2026",
    "title": "CBA: PostgreSQL vs SQLite for the new audit store",
    "decision_payload": {
      "version": "dostal:decision-request/v1",
      "title": "CBA: PostgreSQL vs SQLite for the new audit store",
      "context": "Audit store needs to handle 10k writes/day, no cross-machine sync required.",
      "options": [
        {
          "id": "A",
          "title": "SQLite",
          "tradeoffs": "Zero infra overhead, fast for single-process writes, already in stack. Limit: no concurrent multi-process writes."
        },
        {
          "id": "B",
          "title": "PostgreSQL",
          "tradeoffs": "Full ACID, concurrent access, operational overhead. Adds a Postgres dependency and a connection pool."
        }
      ],
      "recommended": "A"
    }
  }'
```

---

## Example 4: Browse docs for a project

```bash
# List all indexed docs for a project
curl http://localhost:8722/api/docs?project=my-repo

# Get the rendered content of a specific doc
curl "http://localhost:8722/api/docs/content?repo=my-repo&path=.pHive/planning/prd.md"

# Search docs across all projects
curl "http://localhost:8722/api/docs/search?q=authentication"
```

---

## Example 5: Check which projects are registered

```bash
curl http://localhost:8722/api/projects
# → { "projects": ["consus", "my-repo"], "paths": { "consus": "/...", "my-repo": "/..." } }
```

Discover unregistered repos:

```bash
curl http://localhost:8722/api/projects/discover
# → { "candidates": [{ "name": "another-repo", "path": "/Users/you/repos/another-repo" }] }
```

---

## Example 6: Use the structured verdict endpoint

The structured verdict endpoint (`POST /api/decisions/:id/verdict`) is the UI's path — it understands the four verdict shapes directly and reopens a rejected item:

```bash
# Accept the recommendation
curl -X POST "http://localhost:8722/api/decisions/my-decision-id/verdict" \
  -H 'Content-Type: application/json' \
  -d '{"verdict": {"kind": "accepted"}, "actor": "my-harness"}'

# Choose a specific option
curl -X POST "http://localhost:8722/api/decisions/my-decision-id/verdict" \
  -H 'Content-Type: application/json' \
  -d '{"verdict": {"kind": "option_chosen", "optionId": "B"}, "actor": "my-harness"}'

# Request iteration (reopens the item)
curl -X POST "http://localhost:8722/api/decisions/my-decision-id/verdict" \
  -H 'Content-Type: application/json' \
  -d '{"verdict": {"kind": "rejected_iteration_requested", "commentary": "Need more context on the security implications."}, "actor": "my-harness"}'
```
