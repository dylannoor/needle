//! Uploads: a view over the library's upload table, re-emitted when it changes.
//! Bans are enforced here by cancelling any upload a banned user gets.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use needle_core::api::{UploadState, UploadView, UploadsView};
use soulseek_rs::{Client, UploadInfo, UploadStatus};

use crate::state::{Shared, lock};

static LAST: Mutex<Option<(Instant, Vec<UploadView>)>> = Mutex::new(None);

fn upload_view(state: &Shared, u: &UploadInfo) -> UploadView {
    UploadView {
        username: u.username.clone(),
        path: u.filename.clone(),
        size: u.size,
        bytes: u.bytes_sent,
        speed: u.speed_bytes_per_sec,
        state: match &u.status {
            UploadStatus::Queued(position) => UploadState::Queued {
                position: *position,
            },
            UploadStatus::InProgress => UploadState::Uploading,
            UploadStatus::Completed => UploadState::Done,
            UploadStatus::Cancelled => UploadState::Cancelled,
            UploadStatus::Failed(reason) => UploadState::Failed {
                reason: reason.clone(),
            },
        },
        buddy: state.is_buddy(&u.username),
    }
}

pub fn view(state: &Shared) -> UploadsView {
    let uploads: Vec<UploadView> = state
        .client()
        .map(|c| c.uploads().iter().map(|u| upload_view(state, u)).collect())
        .unwrap_or_default();
    UploadsView {
        slots: state.settings().upload_slots,
        slots_used: uploads
            .iter()
            .filter(|u| u.state == UploadState::Uploading)
            .count() as u32,
        waiting: uploads
            .iter()
            .filter(|u| matches!(u.state, UploadState::Queued { .. }))
            .count() as u32,
        uploads,
    }
}

/// Called by the session poller.
pub fn drain(state: &Shared, client: &Client) {
    let events = client.take_upload_events();
    for u in client.uploads().iter().chain(&events) {
        if u.status == UploadStatus::InProgress && state.is_banned(&u.username) {
            let _ = client.cancel_upload(&u.username, &u.filename);
        }
    }
    let view = view(state);
    let mut last = lock(&LAST);
    let changed = last.as_ref().is_none_or(|(_, prev)| *prev != view.uploads);
    let due = last
        .as_ref()
        .is_none_or(|(at, _)| at.elapsed() >= Duration::from_millis(250));
    if (changed || !events.is_empty()) && due {
        *last = Some((Instant::now(), view.uploads.clone()));
        drop(last);
        state.emit("uploads:update", view);
    }
}
