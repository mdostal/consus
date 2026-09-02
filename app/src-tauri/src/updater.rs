//! gh-CLI-backed update *check* -- not Tauri's built-in updater plugin. A
//! public signed-feed updater would need an embedded GitHub token in the
//! shipped app, which is exactly the credential-in-a-binary anti-pattern
//! this whole project avoids elsewhere too. Instead this shells out to
//! `gh`, which already holds the user's own credential -- same pattern as
//! Heimdall's own updater.rs (app/src-tauri/src/updater.rs), which this
//! module is ported from.
//!
//! Scope note (deviation from Heimdall's updater.rs): Heimdall's version
//! additionally downloads the matching release asset and relaunches itself
//! in place via a bundled `relauncher.sh` resource. That download/swap
//! machinery (resource bundling, asset naming convention, relauncher
//! script) isn't part of this story (s6-background-updater) -- the story's
//! files_to_modify only calls for updater.rs + tray.rs. So this version
//! checks and *surfaces* an available update (same dialog-based UX
//! Heimdall uses to announce one) but "Update Now" opens the GitHub
//! release page in the browser rather than silently downloading and
//! swapping the running app bundle.
//!
//! "Auto-update" here means auto-*checked*, one-click-to-the-release-page
//! -- never a silent unattended swap.

use std::process::Command;
use std::time::Duration;

use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

const REPO: &str = "mdostal/consus";
const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

/// Pure, testable: is `latest_tag` (e.g. "v0.16.0") newer than the running
/// app's own `current` version (e.g. "0.15.0", no `v` prefix -- matches
/// CARGO_PKG_VERSION's format)? Errors on either failing to parse as
/// semver -- never silently treats malformed input as "not newer".
pub fn is_newer(current: &str, latest_tag: &str) -> Result<bool, String> {
    let latest = latest_tag.trim_start_matches('v');
    let current_v = semver::Version::parse(current)
        .map_err(|e| format!("bad current version {current:?}: {e}"))?;
    let latest_v = semver::Version::parse(latest)
        .map_err(|e| format!("bad latest tag {latest_tag:?}: {e}"))?;
    Ok(latest_v > current_v)
}

/// `gh release view --repo <repo> latest --json tagName --jq .tagName` --
/// the user's own already-authenticated gh CLI, never a token this app
/// holds itself.
fn check_latest_release_tag() -> Result<String, String> {
    // `gh release view --repo <repo> latest` returns "release not found" on
    // this machine's gh 2.96.0 even for repos with real releases (confirmed
    // live against both mdostal/consus and mdostal/heimdall) -- `gh api
    // repos/<repo>/releases/latest` resolves the same data correctly, so use
    // the REST endpoint directly rather than the `release view` subcommand.
    let output = Command::new("gh")
        .args([
            "api", &format!("repos/{REPO}/releases/latest"),
            "--jq", ".tag_name",
        ])
        .output()
        .map_err(|e| format!("failed to run gh: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "gh api releases/latest failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let tag = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if tag.is_empty() {
        return Err("gh api releases/latest returned an empty tag".to_string());
    }
    Ok(tag)
}

fn release_url(tag: &str) -> String {
    format!("https://github.com/{REPO}/releases/tag/{tag}")
}

fn prompt_update_available(app: &AppHandle, tag: String) {
    let url = release_url(&tag);
    app.dialog()
        .message(format!(
            "Consus {tag} is available (you're running {}). Open the release page?",
            app.package_info().version
        ))
        .title("Consus Update Available")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Open Release Page".into(),
            "Later".into(),
        ))
        .show(move |confirmed| {
            if !confirmed {
                return;
            }
            if let Err(e) = Command::new("open").arg(&url).status() {
                log::error!("failed to open release page {url}: {e}");
            }
        });
}

/// One check: compares the latest release tag against the running app's
/// own version. `notify_if_none` controls whether a "no update"
/// confirmation is shown -- true for the manual tray item (a click should
/// always get feedback), false for the silent background timer (a no-op
/// on every 6h tick would be noisy).
fn run_check(app: &AppHandle, notify_if_none: bool) {
    let current = app.package_info().version.to_string();
    match check_latest_release_tag() {
        Ok(tag) => match is_newer(&current, &tag) {
            Ok(true) => {
                log::info!("update check: {tag} is newer than running v{current}");
                prompt_update_available(app, tag);
            }
            Ok(false) => {
                log::info!("update check: up to date (v{current}, latest {tag})");
                if notify_if_none {
                    app.dialog()
                        .message(format!("You're up to date (v{current})."))
                        .title("Consus")
                        .kind(MessageDialogKind::Info)
                        .buttons(MessageDialogButtons::Ok)
                        .show(|_| {});
                }
            }
            Err(e) => log::warn!("version comparison failed: {e}"),
        },
        Err(e) => {
            log::warn!("update check failed: {e}");
            if notify_if_none {
                app.dialog()
                    .message(format!("Couldn't check for updates: {e}"))
                    .title("Consus")
                    .kind(MessageDialogKind::Error)
                    .buttons(MessageDialogButtons::Ok)
                    .show(|_| {});
            }
        }
    }
}

/// Manual "Check for Updates…" tray item -- always gives feedback.
pub fn check_now(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || run_check(&app, true));
}

/// Background timer -- silent unless an update is actually found.
pub fn spawn_background_checker(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(CHECK_INTERVAL);
        run_check(&app, false);
    });
}

#[cfg(test)]
mod tests {
    use super::is_newer;

    #[test]
    fn newer_tag_is_newer() {
        assert_eq!(is_newer("0.12.0", "v0.13.0"), Ok(true));
    }

    #[test]
    fn equal_tag_is_not_newer() {
        assert_eq!(is_newer("0.12.0", "v0.12.0"), Ok(false));
    }

    #[test]
    fn older_tag_is_not_newer() {
        assert_eq!(is_newer("0.12.0", "v0.11.0"), Ok(false));
    }

    #[test]
    fn malformed_current_is_an_error() {
        assert!(is_newer("not-a-version", "v0.12.0").is_err());
    }

    #[test]
    fn malformed_tag_is_an_error() {
        assert!(is_newer("0.12.0", "not-a-version").is_err());
    }

    #[test]
    fn tag_without_v_prefix_still_parses() {
        assert_eq!(is_newer("0.12.0", "0.13.0"), Ok(true));
    }
}
