//! Tauri commands, one per row of docs/ipc.md. Thin: the work lives in the
//! domain modules. Anything that waits on the network runs on a blocking thread.

mod library;
mod social;

pub use library::*;
pub use social::*;

use needle_core::api::{SessionStatus, Settings};
use needle_core::model::QualityProfile;
use needle_core::releases::build_view;
use tauri::State;

use crate::state::{Shared, err, lock};

pub(crate) async fn blocking<T: Send + 'static>(
    state: &Shared,
    f: impl FnOnce(&Shared) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let state = state.clone();
    tauri::async_runtime::spawn_blocking(move || f(&state))
        .await
        .map_err(err)?
}

// session ----------------------------------------------------------------------

#[tauri::command]
pub fn session_status(state: State<'_, Shared>) -> SessionStatus {
    crate::session::status(&state)
}

#[tauri::command]
pub async fn login(
    state: State<'_, Shared>,
    username: String,
    password: String,
    remember: bool,
) -> Result<SessionStatus, String> {
    if username.trim().is_empty() || password.is_empty() {
        return Err("Enter a username and a password".into());
    }
    blocking(&state, move |s| {
        Ok(crate::session::login(
            s,
            username.trim().to_string(),
            password,
            remember,
        ))
    })
    .await
}

#[tauri::command]
pub fn logout(state: State<'_, Shared>) -> SessionStatus {
    crate::session::logout(&state)
}

#[tauri::command]
pub fn set_away(state: State<'_, Shared>, away: bool) -> Result<SessionStatus, String> {
    crate::session::set_away(&state, away)
}

// settings and profiles ----------------------------------------------------------

#[tauri::command]
pub fn settings_get(state: State<'_, Shared>) -> Settings {
    state.settings()
}

#[tauri::command]
pub fn settings_set(state: State<'_, Shared>, settings: Settings) -> Result<Settings, String> {
    for (label, dir) in [
        ("download", &settings.download_dir),
        ("incomplete", &settings.incomplete_dir),
        ("rejected", &settings.rejected_dir),
    ] {
        if dir.trim().is_empty() {
            return Err(format!("Choose a {label} folder"));
        }
    }
    if settings.upload_slots == 0 {
        return Err("Allow at least one upload slot".into());
    }
    let old = state.settings();
    lock(&state.store).set("settings", &settings).map_err(err)?;
    *state
        .settings
        .write()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = settings.clone();
    if let Ok(client) = state.client() {
        crate::transfers::apply_settings(&client, &settings);
    }
    if old.download_dir != settings.download_dir {
        crate::shares::rescan(&state);
    }
    Ok(settings)
}

#[tauri::command]
pub fn profiles_list(state: State<'_, Shared>) -> Vec<QualityProfile> {
    state.profiles()
}

#[tauri::command]
pub fn profile_save(
    state: State<'_, Shared>,
    mut profile: QualityProfile,
) -> Result<Vec<QualityProfile>, String> {
    if profile.name.trim().is_empty() {
        return Err("Give the profile a name".into());
    }
    if profile.tiers.is_empty() {
        return Err("A profile needs at least one tier".into());
    }
    if profile.id.trim().is_empty() {
        profile.id = format!("p{:x}", crate::state::now_ms());
    }
    lock(&state.store).save_profile(&profile).map_err(err)?;
    Ok(state.profiles())
}

#[tauri::command]
pub fn profile_delete(state: State<'_, Shared>, id: String) -> Result<Vec<QualityProfile>, String> {
    if id == QualityProfile::lossless_first().id {
        return Err("The built-in profile cannot be deleted".into());
    }
    lock(&state.store).delete_profile(&id).map_err(err)?;
    let mut settings = state.settings();
    if settings.active_profile_id == id {
        settings.active_profile_id = QualityProfile::lossless_first().id;
        lock(&state.store).set("settings", &settings).map_err(err)?;
        *state
            .settings
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = settings;
    }
    Ok(state.profiles())
}

#[tauri::command]
pub async fn profile_preview(
    state: State<'_, Shared>,
    profile: QualityProfile,
) -> Result<Option<(usize, usize)>, String> {
    blocking(&state, move |s| {
        let last = lock(&s.searches)
            .last()
            .map(|e| (e.query.clone(), e.results.clone()));
        Ok(last.map(|(query, results)| {
            let v = build_view("preview", &query, &results, &profile, true);
            (v.releases.len(), v.releases.len() + v.hidden_releases.len())
        }))
    })
    .await
}
