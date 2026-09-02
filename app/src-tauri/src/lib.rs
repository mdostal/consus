use std::path::PathBuf;

use tauri::{WebviewUrl, WebviewWindowBuilder};

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
/// tested) before an `AppHandle` exists, and so a later story (s2) can
/// call it to compute the env vars it sets before spawning the sidecar --
/// see server/index.ts's CONSUS_DB_PATH / CONSUS_PROJECTS_CONFIG /
/// CONSUS_ATTACHMENTS_DIR contract.
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be registered first (documented Tauri requirement) -- a
        // second launch should focus the existing window rather than
        // spawning a second copy that collides on the same app-local
        // state directory. The actual "focus existing window" wiring
        // (tray, etc.) lands in a later story; the callback is a no-op
        // for now.
        .plugin(tauri_plugin_single_instance::init(|_app, _argv, _cwd| {}))
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

            // Sidecar spawn (s2) and tray wiring (s3) are separate, later
            // units of work -- for now just show the static loading
            // placeholder so the window isn't blank. Once the sidecar
            // exists, s2 will health-check it and navigate this window to
            // its real URL, same pattern as Heimdall's app_lib::run().
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Consus")
                .inner_size(1280.0, 860.0)
                .visible(true)
                .build()?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running consus application");
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
