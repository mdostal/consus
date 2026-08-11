# Consus

[![CI](https://github.com/mdostal/consus/actions/workflows/ci.yml/badge.svg?branch=dev)](https://github.com/mdostal/consus/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![OSS ready](https://img.shields.io/badge/OSS-ready-2f855a.svg)](CONTRIBUTING.md)
[![Pages](https://img.shields.io/badge/docs-GitHub%20Pages-0f766e.svg)](https://mdostal.github.io/consus/)

Consus is the Pantheon's rendered document and decision surface. It turns swarm output
from planning repos, Multica issues, and generated artifacts into a readable place where
humans can review, answer, approve, and preserve decisions.

## Why it exists

Pantheon agents produce useful artifacts: briefs, PRDs, architecture notes, CBAs,
epic plans, parked questions, and decision requests. Raw markdown in a shell is a
poor review surface for that work. Consus productizes the manual artifact-review
workflow into a browsable app with durable decision records.

The core loop is:

1. Ideate and frame the work.
2. Generate the planning artifacts.
3. Ask and answer blocking questions.
4. Review the decision shape.
5. Approve, reject, or iterate.
6. Write the accepted context back into the shared knowledgebase.

## Where it fits in Pantheon

Consus sits between planning agents, build agents, and the human operator.

- Minerva supplies planning docs, surveys, and parked questions.
- Multica supplies issue state, comments, and agent coordination.
- Auriga and build lanes consume approved work.
- Consus renders the state that humans need to make the next decision.

It is a Pantheon god repo, not a standalone notes app. The standalone server and
web app are still useful locally, but the product boundary is the Pantheon
decision surface.

## What is included

- React/Vite web UI for decisions, epics, questions, docs, and fire history.
- Fastify API server with SQLite-backed storage.
- Adapters for Multica, Minerva, doc scanning, Auriga, and Vesta.
- Markdown and artifact rendering utilities.
- Static OSS documentation site under `docs/` for GitHub Pages.

## Quickstart

Requirements:

- Node.js 24.x
- npm
- A local environment with any Pantheon integration variables you intend to use

Install dependencies:

```bash
npm ci
```

Run the web UI and server together:

```bash
npm run dev
```

Run only the web UI:

```bash
npm run dev:web
```

Run only the server:

```bash
npm run dev:server
```

Build and test:

```bash
npm run build
npm test
```

## Documentation

- [GitHub Pages site](https://mdostal.github.io/consus/)
- [Architecture](docs/architecture.md)
- [Vision](docs/vision.md)
- [Release controls and metrics](docs/release-controls.md)
- [API reference](docs/api-reference.md)
- [UI guide](docs/ui-guide.md)

## GitHub Pages

The static site lives in `docs/` and is designed to publish from GitHub Pages.
The included workflow deploys that directory when Pages is enabled for the repo.

Final human-gated step before public launch: flip `mdostal/consus` to public and
confirm the Pages deployment at `https://mdostal.github.io/consus/`.

## Support

Open a GitHub issue for bugs, documentation gaps, or integration questions. For
security-sensitive reports, avoid public issue details and contact the maintainer
privately first.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Changes should target `dev`; CI gates
build and test before promotion.

## License

MIT. See [LICENSE](LICENSE).
