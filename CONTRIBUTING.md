# Contributing to Consus

Thanks for taking a look. Consus is a small, standalone project — the bar for contributing is
low, but a few conventions keep it coherent.

## Getting set up

```bash
npm install
npm run dev        # server (:8722) + Vite web, both with hot reload
```

Verify your changes:

```bash
npm test -- --run   # vitest — 700+ tests, should stay green
npm run build       # vite build (web) + tsc (server) — must be clean
```

## Ground rules

- **Standalone stays standalone.** Consus has zero live coupling to any other system — no
  network client, adapter, or dependency on an external service beyond what's in
  `package.json`. If a change would add one, it's out of scope; open an issue to discuss first.
- **Binds to `127.0.0.1` by default.** Any change to network exposure defaults needs a clear
  reason in the PR description.
- **Tests accompany behavior changes.** New routes, UI behavior, or bug fixes should come with
  a test that would have failed before the fix.
- **Keep `docs/api-reference.md` and `README.md` accurate.** If you add or change a route or a
  user-facing capability, update the doc in the same PR — drift between docs and code is the
  single most common thing this project's own review passes catch.

## Making a change

1. Fork and branch from `main`.
2. Make your change, with tests.
3. Run `npm test -- --run` and `npm run build` locally — both must pass.
4. Open a PR describing what changed and why. Link an existing issue if there is one.

## Reporting bugs / requesting features

Open a [GitHub issue](https://github.com/mdostal/consus/issues). For bugs, include repro steps
and what you expected instead. For features, a short description of the use case is more useful
than a full design.

## Security issues

Do not open a public issue for a security vulnerability — see [SECURITY.md](SECURITY.md).
