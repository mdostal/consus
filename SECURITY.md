# Security Policy

## Reporting a vulnerability

Please **do not** open a public GitHub issue for a security vulnerability.

Instead, email **mathew.dostal@gmail.com** with a description of the issue, steps to reproduce,
and its potential impact. You should get a response within a few days.

## Scope

Consus is a standalone, self-hosted tool: it binds to `127.0.0.1` by default and has no live
network coupling to any external system — it reads and writes only local SQLite and the local
filesystem. The most relevant categories of report are:

- Anything that would let a request from outside the host reach the server when it's still
  bound to `127.0.0.1` (or bypass the `HOST` opt-in a deployer explicitly configured).
- Path traversal or arbitrary file read/write through the doc scanner, KB store, or diagram
  routes, including through a symlink inside a registered project (every reader compares real
  paths).
- Registering a project without Pantheon's operator token when Consus runs under Pantheon, or
  registering the shared secrets dir in any mode.
- Under Pantheon, answering, deciding, closing, or getting Consus to relay anything to core-api
  (an answer, a proposal, a thread message) without the operator token: core-api records Consus's
  relays as the operator's (`docs/api-reference.md`, "Operator routes").
- SQL injection against the SQLite layer.
- Any way for the `HarnessTransport` seam to invoke something other than the locally configured
  command.

## Supported versions

Only the latest release on `main` is supported. Please upgrade before reporting if you're on an
older version.
