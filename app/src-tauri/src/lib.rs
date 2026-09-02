mod sidecar;
mod tray;

use std::path::PathBuf;
use std::process::Child;
use std::sync::Mutex;

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

/// Resolves (and creates if absent) this app's app-local state directory:
/// `~/Library/Application Support/com.mdostal.consus/`.
///
/// This is INTENTIONALLY independent of this git checkout's own `.pHive/`
/// directory -- the desktop app ships as a fresh, first-run-clean install
/// with its own empty consus.sqlite / project registry, not a viewer
/// bolted onto one developer's live decisions DB (explicit operator
/// decision -- see s1-desktop-app-scaffold-and-state.yaml's
/// design_decisions).
///
/// This is computed directly from `$HOME` rather than via Tauri's own
/// `app.path().app_data_dir()` resolver so it can be called (and unit
/// tested) before an `AppHandle` exists, and so sidecar.rs (s2) can call
/// it to compute the CONSUS_DB_PATH / CONSUS_PROJECTS_CONFIG /
/// CONSUS_ATTACHMENTS_DIR env vars it sets before spawning the sidecar --
/// see server/index.ts's own env-var contract.
pub fn app_data_dir() -> std::io::Result<PathBuf> {
    let home = std::env::var("HOME").map_err(|_| {
        std::io::Error::new(std::io::ErrorKind::NotFound, "HOME env var not set")
    })?;
    let dir = PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join("com.mdostal.consus");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Holds the spawned sidecar so it isn't silently orphaned by a dropped
/// handle -- Quit (any path: Cmd+Q, Dock, tray menu) kills it explicitly
/// via the RunEvent handler below. Ported from Heimdall's own
/// SidecarState: kill_sidecar() is idempotent (guards on `guard.take()`),
/// so it's safe to call from both RunEvent variants below regardless of
/// which one (or both) actually fires for a given quit path.
pub struct SidecarState {
    pub child: Mutex<Option<Child>>,
    pub port: u16,
}

fn kill_sidecar(app: &tauri::AppHandle) {
    let Some(state) = app.try_state::<SidecarState>() else {
        log::warn!("kill_sidecar: no SidecarState found on app handle");
        return;
    };
    let Ok(mut guard) = state.child.lock() else {
        log::error!("kill_sidecar: failed to lock sidecar state mutex");
        return;
    };
    let Some(mut child) = guard.take() else {
        return; // already killed by the other RunEvent variant
    };
    if let Err(e) = child.kill() {
        log::error!("kill_sidecar: kill() failed for pid={}: {e}", child.id());
    }
    let _ = child.wait();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        // Must be registered first (documented Tauri requirement) -- a
        // second launch focuses the existing window instead of spawning a
        // second sidecar and colliding on s1's shared app-local sqlite
        // file.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            tray::show_main_window(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            match app_data_dir() {
                Ok(dir) => log::info!("app-local state dir resolved: {}", dir.display()),
                Err(e) => log::warn!("failed to resolve app-local state dir: {e}"),
            }

            let handle = sidecar::spawn_sidecar(app.handle());
            let port = handle.port;
            log::info!("sidecar spawned on picked free port {port}");
            app.manage(SidecarState {
                child: Mutex::new(Some(handle.child)),
                port,
            });

            tray::build_tray(app.handle())?;

            // Show the loading placeholder immediately; swap to the real
            // sidecar URL (or show an error state) once health-checked --
            // never a browser connection-refused page.
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Consus")
                .inner_size(1280.0, 860.0)
                .visible(true)
                .build()?;

            // Close-to-tray: the window hides, the sidecar keeps running,
            // the tray icon stays -- standard menu-bar-app UX. Only the
            // explicit Quit path (tray menu / Cmd+Q / Dock) actually
            // terminates, handled once in the RunEvent handler below.
            let window_for_close = window.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window_for_close.hide();
                }
            });

            let window_for_thread = window.clone();
            std::thread::spawn(move || {
                if sidecar::wait_until_healthy(port) {
                    log::info!("sidecar healthy on port {port}, navigating window");
                    let url = format!("http://127.0.0.1:{port}");
                    if let Ok(parsed) = tauri::Url::parse(&url) {
                        let _ = window_for_thread.navigate(parsed);
                    }
                } else {
                    log::error!("sidecar did not become healthy within the poll timeout");
                    let _ = window_for_thread.eval(
                        "document.getElementById('spinner').style.display='none';\
                         document.getElementById('status').style.display='none';\
                         var e=document.getElementById('err');\
                         e.style.display='block';\
                         e.textContent='Consus did not start in time. \
                         Check that node is installed and on PATH, then relaunch.';",
                    );
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building consus application");

    builder.run(|app_handle, event| {
        // The one place sidecar cleanup is guaranteed to run, regardless of
        // which quit path triggered it (Cmd+Q, Dock menu, or the tray
        // "Quit" item, which calls app.exit(0)). Confirmed live on
        // Heimdall's own build (same platform,
        // same Tauri version) that Cmd+Q delivers RunEvent::Exit directly,
        // WITHOUT a preceding ExitRequested -- so cleanup must run on both.
        // kill_sidecar() is idempotent (guards on `guard.take()`), so
        // handling both is safe regardless of which one (or both) actually
        // fires for a given quit path.
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            kill_sidecar(app_handle);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_under_application_support_not_this_checkout() {
        let dir = app_data_dir().expect("app_data_dir() should succeed");
        let dir_str = dir.to_string_lossy();

        assert!(
            dir_str.ends_with("Library/Application Support/com.mdostal.consus"),
            "unexpected path: {dir_str}"
        );
        assert!(
            !dir_str.contains(".pHive"),
            "app_data_dir() must never resolve inside this checkout's .pHive/: {dir_str}"
        );

        // The repo checkout this test runs from should never appear as a
        // prefix of the resolved app-local state dir.
        if let Ok(cwd) = std::env::current_dir() {
            assert!(
                !dir.starts_with(&cwd),
                "app_data_dir() resolved inside the git checkout ({}): {dir_str}",
                cwd.display()
            );
        }

        assert!(dir.exists(), "app_data_dir() should create the directory");
    }
}
