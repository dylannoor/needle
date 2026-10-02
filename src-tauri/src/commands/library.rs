//! Search, downloads, uploads and shares.

use needle_core::api::{OwnedQuery, SharesView, UploadsView, Visibility};
use needle_core::model::{FileInfo, JobEvent, JobView, SearchView};
use tauri::State;

use super::blocking;
use crate::search::Kind;
use crate::state::{Shared, err, lock};
use crate::transfers;

// search -------------------------------------------------------------------------

#[tauri::command]
pub fn search_start(
    state: State<'_, Shared>,
    query: String,
    profile_id: Option<String>,
) -> Result<String, String> {
    crate::search::start(&state, query, profile_id, Kind::Network)
}

#[tauri::command]
pub fn search_user(
    state: State<'_, Shared>,
    username: String,
    query: String,
) -> Result<String, String> {
    crate::search::start(&state, query, None, Kind::User(username))
}

#[tauri::command]
pub fn search_room(
    state: State<'_, Shared>,
    room: String,
    query: String,
) -> Result<String, String> {
    crate::search::start(&state, query, None, Kind::Room(room))
}

#[tauri::command]
pub async fn search_view(
    state: State<'_, Shared>,
    search_id: String,
    profile_id: Option<String>,
    include_hidden: bool,
) -> Result<SearchView, String> {
    blocking(&state, move |s| {
        let snapshot = crate::search::snapshot(s, &search_id)
            .ok_or("That search has expired, run it again")?;
        let profile = s.profile(profile_id.as_deref().or(snapshot.profile_id.as_deref()));
        Ok(snapshot.view(&search_id, &profile, include_hidden))
    })
    .await
}

#[tauri::command]
pub fn search_cancel(state: State<'_, Shared>, search_id: String) {
    crate::search::cancel(&state, &search_id);
}

#[tauri::command]
pub fn search_history(state: State<'_, Shared>) -> Result<Vec<String>, String> {
    lock(&state.store).history().map_err(err)
}

// downloads ----------------------------------------------------------------------

#[tauri::command]
pub async fn download_release(
    state: State<'_, Shared>,
    search_id: String,
    release_id: String,
    files: Option<Vec<String>>,
) -> Result<JobView, String> {
    blocking(&state, move |s| {
        let snapshot = crate::search::snapshot(s, &search_id)
            .ok_or("That search has expired, run it again")?;
        let profile = s.profile(snapshot.profile_id.as_deref());
        let view = snapshot.view(&search_id, &profile, true);
        let release = view
            .releases
            .into_iter()
            .chain(view.hidden_releases)
            .find(|r| r.id == release_id)
            .ok_or("That release is no longer in the results")?;
        transfers::create(s, &release, files, &profile)
    })
    .await
}

#[tauri::command]
pub fn download_files(
    state: State<'_, Shared>,
    username: String,
    folder: String,
    files: Vec<FileInfo>,
) -> Result<JobView, String> {
    if files.is_empty() {
        return Err("Pick at least one file".into());
    }
    let profile = state.profile(None);
    let release = transfers::browse_release(&username, &folder, files, &profile);
    transfers::create(&state, &release, None, &profile)
}

#[tauri::command]
pub fn jobs_list(state: State<'_, Shared>) -> Vec<JobView> {
    transfers::list(&state)
}

fn job_event(state: &Shared, id: &str, event: JobEvent) -> Result<JobView, String> {
    transfers::view(state, id)?;
    transfers::feed(state, id, event);
    transfers::view(state, id)
}

#[tauri::command]
pub fn job_pause(state: State<'_, Shared>, job_id: String) -> Result<JobView, String> {
    job_event(&state, &job_id, JobEvent::Pause)
}

#[tauri::command]
pub fn job_resume(state: State<'_, Shared>, job_id: String) -> Result<JobView, String> {
    job_event(&state, &job_id, JobEvent::Resume)
}

#[tauri::command]
pub fn job_cancel(state: State<'_, Shared>, job_id: String) -> Result<JobView, String> {
    job_event(&state, &job_id, JobEvent::Cancel)
}

#[tauri::command]
pub fn job_retry(state: State<'_, Shared>, job_id: String) -> Result<JobView, String> {
    job_event(&state, &job_id, JobEvent::Retry)
}

#[tauri::command]
pub fn job_keep_file(
    state: State<'_, Shared>,
    job_id: String,
    name: String,
) -> Result<JobView, String> {
    transfers::keep(&state, &job_id, &name)
}

#[tauri::command]
pub fn job_remove(state: State<'_, Shared>, job_id: String) -> Result<(), String> {
    transfers::remove(&state, &job_id)
}

#[tauri::command]
pub fn jobs_clear_finished(state: State<'_, Shared>) {
    transfers::clear_finished(&state);
}

#[tauri::command]
pub fn job_reveal(state: State<'_, Shared>, job_id: String) -> Result<(), String> {
    transfers::reveal(&state, &job_id)
}

// uploads ------------------------------------------------------------------------

#[tauri::command]
pub fn uploads_view(state: State<'_, Shared>) -> UploadsView {
    crate::uploads::view(&state)
}

#[tauri::command]
pub fn upload_cancel(
    state: State<'_, Shared>,
    username: String,
    path: String,
) -> Result<(), String> {
    if state.client()?.cancel_upload(&username, &path) {
        Ok(())
    } else {
        Err("That upload is not running".into())
    }
}

// shares -------------------------------------------------------------------------

#[tauri::command]
pub fn shares_view(state: State<'_, Shared>) -> SharesView {
    crate::shares::view(&state)
}

#[tauri::command]
pub fn share_add(
    state: State<'_, Shared>,
    path: String,
    visibility: Visibility,
) -> Result<SharesView, String> {
    crate::shares::add(&state, &path, visibility)
}

#[tauri::command]
pub fn share_remove(state: State<'_, Shared>, path: String) -> Result<SharesView, String> {
    crate::shares::remove(&state, &path)
}

#[tauri::command]
pub fn share_set_visibility(
    state: State<'_, Shared>,
    path: String,
    visibility: Visibility,
) -> Result<SharesView, String> {
    crate::shares::set_visibility(&state, &path, visibility)
}

#[tauri::command]
pub fn shares_rescan(state: State<'_, Shared>) -> SharesView {
    crate::shares::rescan(&state)
}

#[tauri::command]
pub async fn pick_folder(state: State<'_, Shared>) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    blocking(&state, |s| {
        Ok(s.app
            .dialog()
            .file()
            .blocking_pick_folder()
            .map(|p| p.to_string()))
    })
    .await
}

#[tauri::command]
pub fn owned_check(state: State<'_, Shared>, files: Vec<OwnedQuery>) -> Vec<bool> {
    crate::shares::owned_check(&state, &files)
}
