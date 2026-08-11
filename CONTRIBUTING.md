# Contributing to Consus

Consus is developed against the Pantheon `dev` integration branch. Keep changes
small, tested, and tied to a clear issue or PR description.

## Local setup

```bash
npm ci
npm run build
npm test
```

Use Node.js 24.x to match CI and the package `engines` field.

## Development workflow

1. Branch from `dev`.
2. Make focused changes.
3. Run the narrowest relevant tests, then `npm run build` for app-level changes.
4. Open a PR back to `dev`.

## Documentation standards

Public-facing docs should explain:

- What the feature is.
- Why it exists.
- How to run or use it.
- Where it fits in Pantheon.
- What still needs an operator decision.

Architecture docs should include Mermaid source when a diagram helps future
contributors understand the system.

## Pull request checklist

- Tests or a clear no-test rationale are included.
- README or docs are updated for user-visible behavior.
- No secrets, local paths, or private credentials are committed.
- The change preserves the Pantheon issue and PR linking conventions.

## Community

Bug reports, feature requests, and documentation fixes are welcome through
GitHub issues. Keep reports concrete and include reproduction steps where
possible.
