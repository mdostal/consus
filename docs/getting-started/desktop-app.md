# Desktop App

Consus ships as a native macOS app (Tauri v2) — a menu-bar-resident window around the same server, built from the same codebase.

## What's different from the dev server

| | Dev server (`npm run dev`) | Desktop app |
|---|---|---|
| Data location | `.pHive/consus.sqlite` in the repo checkout | `~/Library/Application Support/com.mdostal.consus/` |
| Project list | Inherits from the checkout's config | Empty on first run — always |
| Port | `8722` (fixed) | A freshly picked free port (auto) |
| Menu bar | No | Yes — lives in the tray; close-to-tray, optional launch-at-login |

The two modes share no data — the desktop app starts with an empty project list every time, by design, regardless of what `.pHive/consus.sqlite` holds.

## Build the app

```bash
cd app/src-tauri
cargo tauri build
```

This stages a self-contained copy of `dist-server/` + `dist-web/` via `build-resources.sh`, then bundles everything into a `.app`. Prerequisites: Rust toolchain and the Tauri CLI (`cargo install tauri-cli`).

The built app lands at:

```
app/src-tauri/target/release/bundle/macos/Consus.app
```

Copy it to `/Applications/` to install.

## Run in development

```bash
cargo tauri dev     # falls back to this checkout's own npm run build output
# or
cargo tauri build --debug
```

## How the app starts

1. Picks a free port
2. Starts the sidecar (`node dist-server/index.js`) as a plain OS process against that port
3. Health-checks `GET /health` before showing the window
4. Opens the window pointing at `http://127.0.0.1:<port>`

The sidecar is the same Fastify server as the dev build — no differences in behavior, only in where its data lives.

## First run

On first launch, the app shows the onboarding screen (same as a fresh `npm run dev` with no registered projects). Register your repos the same way: add a name and absolute path.
