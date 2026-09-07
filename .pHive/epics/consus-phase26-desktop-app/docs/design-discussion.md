# Design Discussion: consus-phase26-desktop-app

## 0. Prelude

No `.pHive/CONTEXT.md` or prior KG decisions were queried for this run (this
epic was hand-planned in-session, not routed through the full multi-persona
`/plan` pipeline — see §9 "How this was planned" for why). No `north_star`
block exists in `.pHive/project-profile.yaml` yet.

**Real precedent, read directly, not from memory:** this design is a
line-by-line adaptation of Heimdall's own shipped, working desktop shell at
`/Users/mdostal/Documents/work/pantheon/heimdall/app/src-tauri/` (`lib.rs`,
`sidecar.rs`, `tray.rs`, `build-resources.sh`, `tauri.conf.json`,
`Cargo.toml`), which itself is documented as adapted from Portunus's own
earlier shipped desktop app. Both are real, installed `.app` bundles on this
machine (`/Applications/Heimdall.app`, `/Applications/Portunus.app`).

## 1. Goal

Ship a native macOS desktop app for Consus — `Consus.app` — installable and
runnable the same way Heimdall.app and Portunus.app already are on this
machine: a menu-bar tray app that spawns Consus's own server as a background
process, points a native window at it once healthy, and stays running
quietly in the tray between uses.

This is a **packaging/distribution** epic, not a feature epic. Consus's web
app and API are already complete and shipped (v0.12.0, standalone,
`npm start` boots it in ~1s). Nothing about Consus's own product surface
changes here — this wraps the existing server in a native shell.

## 2. Proposed Approach

### 2.1 Structure

New `app/src-tauri/` directory in this repo, structurally identical to
Heimdall's:

```
app/
  src-tauri/
    Cargo.toml           # crate "consus-desktop", tauri 2.x deps
    tauri.conf.json       # productName "Consus", identifier com.mdostal.consus
    build.rs
    build-resources.sh     # stages dist-server/ + dist-web/ + prod node_modules
    src/
      main.rs
      lib.rs               # setup, window, RunEvent quit handling
      sidecar.rs           # spawn/health-check/kill the Node process
      tray.rs               # Open / Launch at Login / Quit menu
      updater.rs            # background GitHub-release version check
    icons/                 # generated this epic — see §5
    capabilities/
```

### 2.2 Sidecar process

Same tradeoff Heimdall makes deliberately (per its own `sidecar.rs` header
comment): target one already-provisioned machine, spawn the OS's own `node`
via `Command`, do not bundle a Node runtime. `build-resources.sh` stages a
self-contained copy — `npm run build` (produces `dist-server/` +
`dist-web/`), then `npm ci --omit=dev` inside the staging dir — into
`src-tauri/resources/consus/`, bundled into the `.app` via
`tauri.conf.json`'s `bundle.resources`, so the installed app never depends
on this git checkout's path still existing.

The spawned command is `node dist-server/index.js` with cwd set to the
staged resource dir (so `WEB_ROOT`'s `import.meta.url`-relative resolution
in `server/index.ts` finds the sibling `dist-web/` correctly — confirmed by
reading that file this session; it resolves relative to its own compiled
location, not `process.cwd()`, so this is safe regardless of what env vars
set the DB/config paths).

Real env vars, confirmed by reading `server/index.ts` directly this
session (not guessed):

| Env var | Purpose | Desktop-app value |
|---|---|---|
| `PORT` | server bind port | OS-assigned free port (Heimdall's `pick_free_port()` pattern) |
| `HOST` | server bind host | unset → defaults to `127.0.0.1` (correct; never `0.0.0.0`) |
| `CONSUS_DB_PATH` | sqlite file | `~/Library/Application Support/com.mdostal.consus/consus.sqlite` |
| `CONSUS_PROJECTS_CONFIG` | project registry JSON | `~/Library/Application Support/com.mdostal.consus/consus-projects.json` |
| `CONSUS_ATTACHMENTS_DIR` | uploaded attachment files | `~/Library/Application Support/com.mdostal.consus/attachments/` |

**Fresh app-local state (per operator decision this session).** Unlike this
session's manual `npm start` (which pointed those three paths at this git
checkout's own `.pHive/` — real, live decisions data), the desktop app gets
its own empty state on first launch. `runMigration(db)` already runs
unconditionally on every `openDb()` call (confirmed in `server/index.ts`),
so a brand-new sqlite file at the Application Support path gets the full
schema on first boot with zero extra code. The operator registers projects
themselves via the existing `AddProjectForm` / `DirectoryBrowser` UI
(shipped in `consus-phase25-project-registration-ux`, already merged to
`main`) or the `POST /api/projects` API, once the app is running.

Health check hits Consus's real `GET /health` endpoint (confirmed by
reading `server/index.ts`; returns `{status, sqlite}`), not Heimdall's
`/healthz` — the two projects' health endpoints are not the same path,
and this must not be copy-pasted wrong.

PATH capture (GUI-launched macOS processes get a near-empty `PATH`, so a
plain `node` lookup can fail even when Homebrew's `node` is on the
operator's real shell `PATH`) and the ephemeral free-port pick both reuse
Heimdall's `sidecar.rs` logic verbatim — these are generic macOS/Tauri
concerns, not Consus-specific, and Heimdall's implementation is already
real and tested.

### 2.3 Shell chrome (full parity, per operator decision this session)

- **Tray**: "Open Consus" / "Launch at Login" / "Quit" — `tray.rs` ported
  directly, menu item labels changed.
- **Single instance**: `tauri-plugin-single-instance`, second launch
  focuses the existing window rather than spawning a second sidecar (which
  would collide on the sqlite file).
- **Close-to-tray**: window `CloseRequested` is intercepted and hides
  rather than quitting; sidecar keeps running.
- **Quit** (tray menu / Cmd+Q / Dock): kills the sidecar exactly once via
  the `RunEvent::ExitRequested | RunEvent::Exit` double-handler pattern
  Heimdall's `lib.rs` uses (both variants are handled because Heimdall's
  own comment records that Cmd+Q was confirmed, live, to deliver
  `RunEvent::Exit` directly without a preceding `ExitRequested` on this
  platform/build — `kill_sidecar()`'s `guard.take()` idempotency covers
  both firing).
- **Autostart**: `tauri-plugin-autostart`, toggled from the tray menu,
  mirrors Heimdall exactly.
- **Updater**: background checker against GitHub releases. Consus already
  has a real semver tag convention on this repo (`v0.4.0` through the
  current `v0.12.0`, confirmed via `git tag --list`), so Heimdall's
  `updater.rs` semver-comparison approach ports directly — no invented
  convention needed here, unlike the open question this design once had.

### 2.4 Versioning

`app/src-tauri/Cargo.toml` and `tauri.conf.json`'s `version` field track the
root `package.json` version (currently `0.12.0`) — kept in lockstep the same
way Heimdall's `Cargo.toml` version tracks its own `package.json`. This repo
already has `/plugin-hive:ship`'s version-bump verification in its toolchain
(used earlier this session for the 0.12.0 release), so lockstep enforcement
is a checklist item for whichever story wires up packaging, not new
machinery.

## 3. Real Gap: No Existing Icon Asset

Confirmed this session: `web/` has no icon or logo asset anywhere in the
repo (`find web -iname "*icon*" -o -iname "*logo*"` returned nothing), and
there is no `.icns`/`.ico` anywhere outside `node_modules`. Consus has never
had a visual identity beyond its plain browser tab.

This is a real, named gap rather than something to silently paper over by
generating an icon inline as an implementation detail. The desktop app
needs, at minimum, a full Tauri icon set (32x32, 128x128, 128x128@2x,
`.icns`, `.ico`) before `tauri.conf.json`'s `bundle.icon` list can point at
anything real. A dedicated story handles this, sized as "produce a minimal,
intentional mark" rather than "block the whole epic on a full brand
system" — Consus does not need a `/plugin-hive:brand-system` pass for a
tray icon and a Dock icon.

## 4. Risks

| Risk | Mitigation |
|---|---|
| Second sidecar spawned before the first is confirmed dead (double-launch race) | `tauri-plugin-single-instance` registered first, per Heimdall's own comment that this ordering is a documented Tauri requirement |
| Health check hits the wrong path (copy-paste from Heimdall's `/healthz`) | Confirmed directly against `server/index.ts` this session: Consus's real endpoint is `GET /health` |
| GUI-launched process can't find `node` on `PATH` | Reuse Heimdall's login-shell PATH capture verbatim (generic macOS concern, already solved) |
| Fresh app-local DB confuses an operator expecting their existing `.pHive/consus.sqlite` decisions to show up | Explicit operator decision this session (`Fresh app-local state`) — documented here and in the app's own first-run state, not a silent surprise |
| Rust/Tauri toolchain unfamiliar to future maintainers | Not a new risk for this workspace — Heimdall and Portunus already carry this exact toolchain surface; nothing new to the operator's environment |
| Code signing / notarization for distribution outside this machine | Out of scope for this epic — Heimdall's own `tauri.conf.json` uses `"signingIdentity": "-"` (ad-hoc, single-machine signing only); this epic matches that scope, not a public notarized release |

## 5. Open Questions

1. Should the updater's GitHub-release target assume Consus tags follow the
   exact same `v{semver}` convention Heimdall uses? — **Resolved**: yes,
   confirmed via `git tag --list` this session (`v0.4.0`...`v0.12.0` already
   exist).
2. Confirmed operator decisions (via structured question this session):
   fresh app-local state (not this checkout's live `.pHive/` data), and full
   tray/autostart/close-to-tray/updater parity with Heimdall.

## 6. Scale Assessment

**Medium.** Multi-file, multi-layer (Rust + shell scripting + packaging
config), but the pattern is a direct, already-proven adaptation of two
sibling apps in this same workspace — not novel architecture. No new
backend/frontend product code in Consus itself; this is 100% new
`app/src-tauri/` surface plus a handful of env-var reads Consus's server
already supports unchanged.

## 7. Dependencies

- Rust/Cargo/`tauri-cli` (confirmed already installed on this machine:
  `cargo 1.97.1`, `tauri-cli 2.11.4` — used to build Heimdall/Portunus).
- `npm run build` must succeed (already verified working this session,
  produces `dist-server/` + `dist-web/`).

## 8. Non-Goals

- No Linux/Windows build — Heimdall and Portunus are macOS-only .app
  bundles on this machine; this epic matches that scope.
- No notarized/publicly-distributed release — ad-hoc signing only, single
  operator machine, matching Heimdall's own `tauri.conf.json`.
- No changes to Consus's own product surface (web UI, API, DB schema).

## 9. How This Was Planned

This epic was planned in-session by directly reading Heimdall's real,
shipped `app/src-tauri/` implementation end-to-end (not web research, not
memory) and adapting it file-by-file to Consus's own confirmed env vars and
health endpoint (read directly from `server/index.ts`, not assumed). Given
the pattern is a proven, working, same-workspace precedent rather than
novel design space, this ran as a single-pass design discussion plus direct
story decomposition rather than the full multi-persona research → H/V →
structured-outline pipeline — proportionate to a medium-scope, low-novelty
packaging epic.
