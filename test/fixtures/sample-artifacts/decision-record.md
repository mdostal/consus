---
title: CLI Framework and Template Storage
type: decision-record
author: Hive Planning
date: 2026-08-08
status: accepted
---

# CLI Framework and Template Storage

## Status

Accepted

## Context

The Consus CLI (`consus init/edit/render/validate`) needs a command parser and a place to keep the design-discussion and decision-record templates. We considered rolling a minimal hand-written argument parser to avoid a dependency, and storing templates as JS string constants instead of files.

## Decision

Use [commander.js](https://github.com/tj/commander.js) for argument parsing and keep templates as plain markdown files under `templates/`:

- `commander` is small, widely used, and gives us `--help` and error messages for free — a hand-rolled parser would just reimplement a worse version of it.
- Templates as files, not JS constants, mean adding a new artifact type is a markdown-only change with no string-escaping to review.

## Consequences

- New templates can be contributed without touching `lib/templates.js`, only `templates/*.md` plus one entry in `TEMPLATE_IDS`.
- The CLI's `--force` flag exists because file-based templates make it easy to accidentally clobber an existing artifact; that tradeoff is intentional.
