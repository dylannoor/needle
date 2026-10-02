//! Extension host: loads extension folders, checks every host call against the
//! manifest's permissions, and forwards app events to the frontend runtime.
//! Owned by the extensions work; the rest of the app only calls `init`,
//! `dispatch` and registers the commands below.

mod host;
mod perms;

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use needle_core::api::{ExtensionEvent, ExtensionInfo};
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager};

use host::Host;

type State = Mutex<Host>;

/// Load installed and built-in extensions and put the host in managed state.
pub fn init(app: &AppHandle) -> Result<(), String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let mut host = Host::new(home, data, builtin_dir(app));
    host.load();
    app.manage::<State>(Mutex::new(host));
    Ok(())
}

/// Deliver an app event ("download.verified", ...) to every enabled extension
/// that holds `events:<name>`. Never blocks and never fails the caller.
pub fn dispatch(app: &AppHandle, event: ExtensionEvent) {
    let Some(state) = app.try_state::<State>() else {
        return;
    };
    let ids = lock(&state).subscribers(&event.name);
    for id in ids {
        if let Err(e) = app.emit("ext:event", json!({ "id": id, "event": &event })) {
            eprintln!("extensions: emit ext:event for {id} failed: {e}");
        }
    }
}

#[tauri::command]
pub async fn extensions_list(app: AppHandle) -> Result<Vec<ExtensionInfo>, String> {
    Ok(with_host(&app)?.list())
}

#[tauri::command]
pub async fn extension_set_enabled(
    app: AppHandle,
    id: String,
    enabled: bool,
) -> Result<Vec<ExtensionInfo>, String> {
    with_host(&app)?.set_enabled(&id, enabled)
}

#[tauri::command]
pub async fn extension_install(app: AppHandle, dir: String) -> Result<Vec<ExtensionInfo>, String> {
    with_host(&app)?.install(Path::new(&dir))
}

#[tauri::command]
pub async fn extension_uninstall(app: AppHandle, id: String) -> Result<Vec<ExtensionInfo>, String> {
    with_host(&app)?.uninstall(&id)
}

#[tauri::command]
pub async fn extension_source(app: AppHandle, id: String, file: String) -> Result<String, String> {
    with_host(&app)?.source(&id, &file)
}

#[tauri::command]
pub async fn extension_call(
    app: AppHandle,
    id: String,
    method: String,
    args: Value,
) -> Result<Value, String> {
    if method == "notify" {
        let (title, body) = with_host(&app)?.notify_args(&id, &args)?;
        return notify(&app, &title, &body).map(|_| Value::Null);
    }
    with_host(&app)?.call(&id, &method, &args)
}

fn notify(app: &AppHandle, title: &str, body: &str) -> Result<(), String> {
    use tauri_plugin_notification::{Notification, NotificationExt};
    if app.try_state::<Notification<tauri::Wry>>().is_none() {
        return Err("notifications are not available".into());
    }
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| e.to_string())
}

fn with_host(app: &AppHandle) -> Result<MutexGuard<'_, Host>, String> {
    let state = app
        .try_state::<State>()
        .ok_or("extension host is not initialized")?;
    Ok(lock(state.inner()))
}

// One lock around all extension I/O. Per-extension locks if calls ever pile up.
fn lock(state: &State) -> MutexGuard<'_, Host> {
    state.lock().unwrap_or_else(|e| e.into_inner())
}

/// The repo's extensions/ folder in debug builds (so edits show up live), the
/// bundled resources otherwise.
fn builtin_dir(app: &AppHandle) -> Option<PathBuf> {
    let dev = Path::new(env!("CARGO_MANIFEST_DIR")).join("../extensions");
    if cfg!(debug_assertions)
        && let Ok(dev) = dev.canonicalize()
    {
        return Some(dev);
    }
    app.path()
        .resource_dir()
        .ok()
        .map(|d| d.join("extensions"))
        .filter(|d| d.is_dir())
}
