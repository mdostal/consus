fn main() {
  // pick_repo_folder (lib.rs) is our own app-defined command, not part of a
  // plugin -- Tauri v2's ACL gates it exactly like a plugin command (found
  // live: invoke() rejected with "pick_repo_folder not allowed. Plugin not
  // found" until this ran). AppManifest::commands() autogenerates
  // allow-pick_repo_folder/deny-pick_repo_folder permissions under the
  // app's own ACL key, referenced bare (no namespace prefix) from
  // capabilities/default.json.
  tauri_build::try_build(
    tauri_build::Attributes::new()
      .app_manifest(tauri_build::AppManifest::new().commands(&["pick_repo_folder"])),
  )
  .expect("failed to run tauri-build");
}
