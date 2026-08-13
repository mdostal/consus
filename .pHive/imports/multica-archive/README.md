# Multica archive — preserved historical data

Source: `dostal@hive:~/.multica/` (host thes-mac-studio.lan). Copied
2026-08-12 as part of `consus-phase5-live-and-interactive` / story
`s0-preserve-historical-data`. Originals were **not** modified or deleted
at the source.

| File | Entries | SHA-256 |
|---|---|---|
| `delphi-audit.jsonl` | 45 | `daded57902419d14a151acd1f519197e66a259b19aab66ea1fd5012abf5231b1` |
| `delphi-knowledgebase.jsonl` | 12 | `4782b9522bc421bd3694b79171aff03d1a8613abcd5dd634b0debd0b2d96459b` |

Both checksums verified against the hive originals at copy time — exact
match. This is the entire surviving decision/KB history from the old
Claud-ometer `/delphi` surface; not derivable from any git repo.

Consumed by story `s2-historical-backfill-importer` for count-parity
verification (45 audit rows, 12 KB rows) during import into this build's
SQLite store.
