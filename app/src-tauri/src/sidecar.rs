//! Spawns Consus's own compiled Node entrypoint (`dist-server/index.js`) as
//! a plain OS process (no bundled Node runtime -- this app targets one
//! already-provisioned machine, not portable distribution, same tradeoff
//! Heimdall's own sidecar.rs makes deliberately) and waits for it to answer
//! `/health` before the window is allowed to point at it.
//!
//! Two real risks this module exists to handle explicitly, ported unchanged
//! from Heimdall's already-solved sidecar.rs: a GUI-launched process on
//! macOS gets a near-empty PATH, so the sidecar's own `node` process could
//! fail to resolve anything that depends on a real PATH unless we capture
//! and forward the operator's actual login-shell PATH; and a hardcoded port
//! can collide with something else already running (this session's own
//! verification work hit exactly this, a stale process squatting on 8722),
//! so we always bind a fresh OS-assigned free port instead.
//!
//! Correction from Heimdall's own pattern: Consus's health route is
//! `GET /health`, not `/healthz` -- confirmed directly against
//! server/index.ts's `app.get("/health", ...)` registration, not copied
//! from Heimdall's endpoint name.

use std::env;
use std::fs;
use std::io::Read;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use tauri::{AppHandle, Manager};
use wait_timeout::ChildExt;

const PATH_CAPTURE_TIMEOUT: Duration = Duration::from_secs(5);
const HEALTH_POLL_TIMEOUT: Duration = Duration::from_secs(30);
const HEALTH_POLL_INTERVAL: Duration = Duration::from_millis(200);

/// A conservative fallback PATH used only if capturing the user's real login
/// shell PATH fails outright (unusual shell config, timeout) -- covers the
/// common install locations for Homebrew's `node`, so the app degrades
/// rather than hanging forever. Ported verbatim from Heimdall's sidecar.rs.
fn fallback_path() -> String {
    let home = env::var("HOME").unwrap_or_default();
    format!("/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:{home}/.local/bin")
}

/// Runs the user's own login shell non-interactively to capture the *real*
/// PATH (GUI-launched apps on macOS do not source .zshrc/.zprofile, so
/// `std::env::var("PATH")` inside a Tauri app is near-empty -- a confirmed,
/// not hypothetical, gotcha, already solved once by Heimdall's own
/// sidecar.rs). Bounded by a timeout so a hung/unusual shell config can
/// never block app launch indefinitely.
pub fn capture_login_shell_path() -> String {
    let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut child = match Command::new(&shell)
        .args(["-ilc", "echo -n \"$PATH\""])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(c) => c,
        Err(_) => return fallback_path(),
    };

    match child.wait_timeout(PATH_CAPTURE_TIMEOUT) {
        Ok(Some(status)) if status.success() => {
            let mut out = String::new();
            if let Some(mut stdout) = child.stdout.take() {
                let _ = stdout.read_to_string(&mut out);
            }
            let out = out.trim().to_string();
            if out.is_empty() {
                fallback_path()
            } else {
                out
            }
        }
        Ok(Some(_)) => fallback_path(),
        Ok(None) => {
            let _ = child.kill();
            let _ = child.wait();
            fallback_path()
        }
        Err(_) => fallback_path(),
    }
}

/// Binds port 0 to get a free OS-assigned port, then immediately releases it.
/// A small TOCTOU race exists between release and the sidecar's own bind --
/// acceptable for a single-user local app (same accepted tradeoff Heimdall's
/// own sidecar makes).
pub fn pick_free_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("failed to bind an ephemeral port");
    listener.local_addr().expect("listener has no local addr").port()
}

/// Relative path (from the Consus repo/resource root) to the compiled
/// server entrypoint. `server/tsconfig.json` sets `rootDir: "."` with
/// `outDir: "../dist-server"`, so `server/index.ts` compiles straight to
/// `dist-server/index.js` -- no nested `dist-server/server/index.js`
/// mirroring like Heimdall's own `dist/src/main.js` quirk. Confirmed via a
/// real `npm run build` from the repo root.
pub const MAIN_JS_RELATIVE: &str = "dist-server/index.js";

/// Resolves the Consus root directory that contains `dist-server/` (and,
/// once built, `dist-web/`). Prefers the bundled Tauri resource dir (the
/// real installed-app path, once a later unit of work -- s5 -- stages
/// dist-server/dist-web into `resources/consus/` at build time). Falls back
/// to the live repo checkout for `cargo tauri dev`/`cargo tauri build
/// --debug` iteration, where no resources are staged at all yet: this
/// crate's own `CARGO_MANIFEST_DIR` is `<repo>/app/src-tauri`, so two
/// `..` components land back at the repo root, where a developer's own
/// `npm run build` already produced `dist-server/index.js`.
pub fn resolve_consus_root(app: &AppHandle) -> PathBuf {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("consus");
        if bundled.join(MAIN_JS_RELATIVE).exists() {
            return bundled;
        }
    }
    // Dev fallback only -- CARGO_MANIFEST_DIR is app/src-tauri, so ../..
    // is the repo root, matching how a developer running
    // `cargo tauri dev`/`cargo tauri build --debug` from app/src-tauri/
    // expects this to work against this repo's own `npm run build` output.
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    manifest_dir.join("..").join("..")
}

pub struct SidecarHandle {
    pub child: Child,
    pub port: u16,
}

/// Spawns `node dist-server/index.js` with PORT=<freshly picked free port>,
/// the captured real login-shell PATH, and CONSUS_DB_PATH /
/// CONSUS_PROJECTS_CONFIG / CONSUS_ATTACHMENTS_DIR all pointed at subpaths
/// of s1's `app_data_dir()` -- so the desktop app gets its own fresh,
/// first-run-clean state, never this checkout's own `.pHive/consus.sqlite`
/// (see s1-desktop-app-scaffold-and-state.yaml's design_decisions).
/// HOST is intentionally left unset so server/index.ts's own default
/// (127.0.0.1) applies -- HOST=0.0.0.0 exists for containerized deploys,
/// not this app.
///
/// cwd is set to the resolved Consus root (the staged resource dir once
/// bundled, or the repo root in dev) -- NOT app_data_dir -- per this
/// story's spec; every stateful path the server itself needs is passed
/// explicitly via the absolute env vars above, so cwd only matters for
/// where `node` resolves the `dist-server/index.js` argument from.
///
/// Does not wait for readiness -- call `wait_until_healthy` separately so
/// the caller can show a loading UI in the meantime.
pub fn spawn_sidecar(app: &AppHandle) -> SidecarHandle {
    let consus_root = resolve_consus_root(app);
    let main_js = consus_root.join(MAIN_JS_RELATIVE);

    let app_data_dir = crate::app_data_dir().unwrap_or_else(|e| {
        log::warn!("failed to resolve app data dir, falling back to temp dir: {e}");
        let dir = env::temp_dir().join("consus-app-data");
        let _ = fs::create_dir_all(&dir);
        dir
    });

    let db_path = app_data_dir.join("consus.sqlite");
    let projects_config_path = app_data_dir.join("consus-projects.json");
    let attachments_dir = app_data_dir.join("attachments");
    fs::create_dir_all(&attachments_dir).unwrap_or_else(|e| {
        log::warn!(
            "failed to create attachments dir {}: {e}",
            attachments_dir.display()
        );
    });

    // server/config/project-registry.ts's loadProjectRegistry() falls back
    // to a single hardcoded `{ consus: cwd }` project whenever
    // CONSUS_PROJECTS_CONFIG doesn't exist yet (its own v1-compat default,
    // predating desktop packaging). Since this sidecar always runs with
    // cwd set to consus_root (the bundled resources/consus dir in a
    // release build), an untouched first run would silently self-register
    // "consus" pointing at the app bundle's own Resources directory --
    // discovered via a genuine from-scratch packaged-build test, not
    // theoretical. Pre-seeding an empty registry here (only if one doesn't
    // already exist, so a returning user's real projects are never
    // touched) keeps s1's fresh-app-local-state decision true all the way
    // through a release build, not just the dev loop.
    if !projects_config_path.exists() {
        if let Err(e) = fs::write(&projects_config_path, "{}\n") {
            log::warn!(
                "failed to pre-seed empty projects config {}: {e}",
                projects_config_path.display()
            );
        }
    }

    let port = pick_free_port();
    let path = capture_login_shell_path();

    log::info!(
        "spawning sidecar: node {} (cwd={}, port={port}, db={})",
        main_js.display(),
        consus_root.display(),
        db_path.display()
    );

    let child = Command::new("node")
        .arg(&main_js)
        .current_dir(&consus_root)
        .env("PORT", port.to_string())
        .env("PATH", path)
        .env("CONSUS_DB_PATH", db_path.to_string_lossy().to_string())
        .env(
            "CONSUS_PROJECTS_CONFIG",
            projects_config_path.to_string_lossy().to_string(),
        )
        .env(
            "CONSUS_ATTACHMENTS_DIR",
            attachments_dir.to_string_lossy().to_string(),
        )
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap_or_else(|e| panic!("failed to spawn sidecar (node {}): {e}", main_js.display()));

    SidecarHandle { child, port }
}

/// Polls http://127.0.0.1:<port>/health until it returns 200, or gives up
/// after HEALTH_POLL_TIMEOUT. Returns true if the sidecar became healthy.
/// Matches Heimdall's own approach of not over-parsing the JSON body --
/// presence of a 200 response is sufficient.
pub fn wait_until_healthy(port: u16) -> bool {
    let url = format!("http://127.0.0.1:{port}/health");
    let deadline = std::time::Instant::now() + HEALTH_POLL_TIMEOUT;
    while std::time::Instant::now() < deadline {
        if let Ok(resp) = ureq::get(&url).timeout(Duration::from_secs(2)).call() {
            if resp.status() == 200 {
                return true;
            }
        }
        std::thread::sleep(HEALTH_POLL_INTERVAL);
    }
    false
}
