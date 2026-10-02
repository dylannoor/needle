//! Payloads for Tauri commands and events that are not engine types. Listed in
//! docs/ipc.md. Like model.rs, change additively.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::FileInfo;

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, TS, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum SessionState {
    Offline,
    Connecting,
    Online,
    Error,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SessionStatus {
    pub state: SessionState,
    pub username: Option<String>,
    pub error: Option<String>,
    pub listen_port: u16,
    /// Whether peers can reach us directly (UPnP/NAT-PMP mapped or tested open).
    pub port_open: Option<bool>,
    pub away: bool,
    /// Whether credentials are stored, so the app can log in on start.
    pub remembered: bool,
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Settings {
    pub download_dir: String,
    /// Where files go while downloading; defaults inside `download_dir`.
    pub incomplete_dir: String,
    pub rejected_dir: String,
    pub listen_port: u16,
    pub port_mapping: bool,
    pub upload_slots: u32,
    /// 0 = unlimited.
    pub upload_limit_kbps: u32,
    pub download_limit_kbps: u32,
    pub buddies_first: bool,
    pub active_profile_id: String,
    /// Search terms appended as exclusions to every search (e.g. "-live").
    pub search_exclusions: Vec<String>,
    pub auto_join_rooms: Vec<String>,
    pub notify_private_messages: bool,
    pub notify_wishlist_hits: bool,
}

// ---------------------------------------------------------------------------
// Shares and uploads
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, TS, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Visibility {
    Everyone,
    Buddies,
    Nobody,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum ScanStatus {
    Scanned {
        #[ts(type = "number")]
        at_ms: u64,
    },
    Scanning { percent: u8 },
    Error { message: String },
    NotShared,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ShareFolder {
    pub path: String,
    pub visibility: Visibility,
    pub files: u32,
    #[ts(type = "number")]
    pub bytes: u64,
    pub status: ScanStatus,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SharesView {
    pub folders: Vec<ShareFolder>,
    pub shared_files: u32,
    pub shared_folders: u32,
    /// Files in the local library used for "you have this" in search.
    pub owned_files: u32,
    /// Files the scanner could not read.
    pub unreadable: Vec<String>,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum UploadState {
    Queued { position: u32 },
    Uploading,
    Done,
    Failed { reason: String },
    Cancelled,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UploadView {
    pub username: String,
    /// Path relative to the share root, for display.
    pub path: String,
    #[ts(type = "number")]
    pub size: u64,
    #[ts(type = "number")]
    pub bytes: u64,
    pub speed: f64,
    pub state: UploadState,
    pub buddy: bool,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UploadsView {
    pub uploads: Vec<UploadView>,
    pub slots: u32,
    pub slots_used: u32,
    pub waiting: u32,
}

// ---------------------------------------------------------------------------
// Users, buddies, browse
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, TS, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Presence {
    Online,
    Away,
    Offline,
    Unknown,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UserProfile {
    pub username: String,
    pub presence: Presence,
    pub avg_speed: Option<u32>,
    pub files: Option<u32>,
    pub folders: Option<u32>,
    pub free_slot: Option<bool>,
    pub queue_len: Option<u32>,
    pub description: Option<String>,
    /// data: URL of the user's picture, if they set one.
    pub picture: Option<String>,
    pub likes: Vec<String>,
    pub dislikes: Vec<String>,
    pub buddy: bool,
    pub banned: bool,
    pub ignored: bool,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Buddy {
    pub username: String,
    pub presence: Presence,
    pub note: String,
    #[ts(type = "number | null")]
    pub last_seen_ms: Option<u64>,
    pub files: Option<u32>,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SharedDir {
    pub path: String,
    pub files: Vec<FileInfo>,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BrowseResult {
    pub username: String,
    pub dirs: Vec<SharedDir>,
    /// Folders only buddies of that user can download from.
    pub locked_dirs: Vec<SharedDir>,
    pub error: Option<String>,
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ChatMessage {
    /// Room name, or the other user for private messages.
    pub channel: String,
    pub username: String,
    pub text: String,
    #[ts(type = "number")]
    pub at_ms: u64,
    pub own: bool,
    /// "/me" style action.
    pub action: bool,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RoomSummary {
    pub name: String,
    pub users: u32,
    pub private: bool,
    pub joined: bool,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RoomMember {
    pub username: String,
    pub presence: Presence,
    pub files: Option<u32>,
    pub avg_speed: Option<u32>,
    pub operator: bool,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RoomView {
    pub name: String,
    pub members: Vec<RoomMember>,
    pub messages: Vec<ChatMessage>,
    /// Ticker lines set by members: (username, text).
    pub tickers: Vec<(String, String)>,
    pub private: bool,
    pub owner: Option<String>,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum RoomEventPayload {
    Message { message: ChatMessage },
    Joined { room: String, member: RoomMember },
    Left { room: String, username: String },
    Ticker { room: String, username: String, text: String },
    ListChanged,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Conversation {
    pub username: String,
    pub last: Option<ChatMessage>,
    pub unread: u32,
    pub presence: Presence,
}

// ---------------------------------------------------------------------------
// Interests and wishlist
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Interests {
    pub likes: Vec<String>,
    pub dislikes: Vec<String>,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Recommendation {
    pub item: String,
    pub score: i32,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct WishItem {
    pub query: String,
    #[ts(type = "number")]
    pub added_ms: u64,
    #[ts(type = "number | null")]
    pub last_run_ms: Option<u64>,
    /// Releases that matched the active profile on the last run.
    pub matches: u32,
    /// Search id holding the last run's results, to open them.
    pub search_id: Option<String>,
}

// ---------------------------------------------------------------------------
// Extensions
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ExtensionManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: Option<String>,
    /// Worker script, relative to the extension folder.
    pub main: String,
    /// Optional settings/panel page, rendered in a sandboxed iframe.
    pub panel: Option<String>,
    /// e.g. "events:download.verified", "fs:write:~/Music/rekordbox", "notify".
    pub permissions: Vec<String>,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ExtensionInfo {
    pub manifest: ExtensionManifest,
    pub enabled: bool,
    /// Absolute folder the extension was loaded from.
    pub dir: String,
    pub error: Option<String>,
    pub builtin: bool,
}

/// Delivered to extension workers that hold `events:<name>`.
#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ExtensionEvent {
    /// "download.verified", "download.completed", "search.completed", "pm.received".
    pub name: String,
    pub payload: serde_json::Value,
}

/// Payload of `download.verified` / `download.completed`.
#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DownloadedFile {
    pub job_id: String,
    pub local_path: String,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub track_number: Option<u32>,
    pub duration_secs: Option<u32>,
    pub codec: crate::model::Codec,
    pub sample_rate: Option<u32>,
    pub bit_depth: Option<u32>,
    pub bitrate_kbps: Option<u32>,
    #[ts(type = "number")]
    pub size: u64,
}
