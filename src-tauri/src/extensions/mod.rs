//! Extension host: loads extension folders, checks every host call against the
//! manifest's permissions, and forwards app events to the frontend runtime.
//! Owned by the extensions work; the rest of the app only calls `init`,
//! `dispatch` and registers the commands below.

use needle_core::api::{ExtensionEvent, ExtensionInfo};
use tauri::AppHandle;

/// Load installed and built-in extensions and put the host in managed state.
pub fn init(_app: &AppHandle) -> Result<(), String> {
    Ok(())
}

/// Deliver an app event ("download.verified", ...) to every enabled extension
/// that holds `events:<name>`. Never blocks and never fails the caller.
pub fn dispatch(_app: &AppHandle, _event: ExtensionEvent) {}

#[tauri::command]
pub fn extensions_list() -> Result<Vec<ExtensionInfo>, String> {
    Ok(vec![])
}

#[tauri::command]
pub fn extension_set_enabled(_id: String, _enabled: bool) -> Result<Vec<ExtensionInfo>, String> {
    Err("not implemented".into())
}

#[tauri::command]
pub fn extension_install(_dir: String) -> Result<Vec<ExtensionInfo>, String> {
    Err("not implemented".into())
}

#[tauri::command]
pub fn extension_uninstall(_id: String) -> Result<Vec<ExtensionInfo>, String> {
    Err("not implemented".into())
}

#[tauri::command]
pub fn extension_source(_id: String, _file: String) -> Result<String, String> {
    Err("not implemented".into())
}

#[tauri::command]
pub fn extension_call(
    _id: String,
    _method: String,
    _args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    Err("not implemented".into())
}
