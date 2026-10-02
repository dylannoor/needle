//! Types shared by the engine, the Tauri backend and (through ts-rs) the
//! frontend. This file is the contract: change it additively and regenerate the
//! bindings with `cargo test -p needle-core`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ---------------------------------------------------------------------------
// Files and search results
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, TS, Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Codec {
    Flac,
    Alac,
    Wav,
    Aiff,
    Mp3,
    Aac,
    Ogg,
    Opus,
    Other,
}

/// One file as a peer advertises it. `path` is the full remote path with
/// Soulseek's `\` separators, exactly as needed to request the file.
#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FileInfo {
    pub path: String,
    #[ts(type = "number")]
    pub size: u64,
    pub codec: Codec,
    pub bitrate_kbps: Option<u32>,
    pub vbr: Option<bool>,
    pub sample_rate: Option<u32>,
    pub bit_depth: Option<u32>,
    pub duration_secs: Option<u32>,
}

/// A peer that answered a search, decoupled from soulseek-rs-lib's types.
#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Source {
    pub username: String,
    pub free_slot: bool,
    /// Average upload speed in bytes per second, as reported by the peer.
    pub avg_speed: u32,
    /// Unknown when the library does not report it.
    pub queue_len: Option<u32>,
}

/// One peer's raw answer to a search: what the backend feeds the engine.
#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RawResult {
    pub source: Source,
    pub files: Vec<FileInfo>,
}

/// One folder at one peer.
#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Candidate {
    /// Stable within a search: `username` + folder.
    pub id: String,
    pub source: Source,
    /// Remote folder path (without trailing separator).
    pub folder: String,
    pub files: Vec<FileInfo>,
    #[ts(type = "number")]
    pub total_size: u64,
}

/// A folder that looks like one release, with every peer that holds an
/// identical copy (same file names and sizes) as fallbacks.
#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Release {
    pub id: String,
    pub title: String,
    pub artist: Option<String>,
    pub year: Option<u16>,
    pub best: Candidate,
    /// Identical copies at other peers, best first.
    pub alternates: Vec<Candidate>,
    /// Index into the profile's tiers this release satisfies.
    pub tier: usize,
    /// e.g. "FLAC 16/44.1", "MP3 320", "FLAC 24/96".
    pub format_label: String,
    /// Audio files in `best`.
    pub track_count: usize,
    /// Most audio files seen for this release across all peers; more than
    /// `track_count` means this copy is incomplete.
    pub expected_tracks: usize,
    pub score: f64,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct HiddenCounts {
    pub below_profile: usize,
    pub queue_too_long: usize,
    pub not_audio: usize,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SearchView {
    pub search_id: String,
    pub query: String,
    pub releases: Vec<Release>,
    /// Folders that failed the profile, only filled when the caller asks for them.
    pub hidden_releases: Vec<Release>,
    pub hidden: HiddenCounts,
    pub total_files: usize,
    pub total_peers: usize,
    pub done: bool,
}

// ---------------------------------------------------------------------------
// Quality profiles
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Tier {
    pub label: String,
    /// "FLAC 16-bit", "MP3 320 kbps": the codecs this tier accepts.
    pub codecs: Vec<Codec>,
    pub min_bit_depth: Option<u32>,
    pub min_sample_rate: Option<u32>,
    pub min_bitrate_kbps: Option<u32>,
    /// Accept VBR files whose average meets `min_bitrate_kbps` (V0).
    pub allow_vbr: bool,
}

#[derive(Serialize, Deserialize, TS, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Strictness {
    Relaxed,
    Normal,
    Strict,
}

#[derive(Serialize, Deserialize, TS, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum OnFail {
    Delete,
    MoveToRejected,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct VerifySettings {
    pub enabled: bool,
    pub strictness: Strictness,
    pub on_fail: OnFail,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StuckRules {
    /// Switch source after this long without receiving data.
    pub no_data_secs: u32,
    /// Switch source after waiting in a remote queue this long.
    pub queue_wait_secs: u32,
    /// Sources to try before searching again.
    pub max_sources: u32,
    pub wishlist_when_exhausted: bool,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct QualityProfile {
    pub id: String,
    pub name: String,
    /// Best first.
    pub tiers: Vec<Tier>,
    /// Skip peers whose queue is longer than this (when known).
    pub max_queue: u32,
    pub prefer_complete: bool,
    pub verify: VerifySettings,
    pub stuck: StuckRules,
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Verdict {
    pub ok: bool,
    pub codec: Codec,
    pub sample_rate: Option<u32>,
    pub bit_depth: Option<u32>,
    pub bitrate_kbps: Option<u32>,
    /// Where the spectrum falls off a cliff, if it does.
    pub cutoff_hz: Option<f32>,
    pub nyquist_hz: f32,
    /// Plain-language reason when `ok` is false ("stops at 16 kHz, typical of
    /// a 128-192 kbps MP3 saved as FLAC").
    pub reason: Option<String>,
    /// Average power per band from 0 Hz to Nyquist, in dB, 64 bands. For the UI.
    pub spectrum: Vec<f32>,
}

// ---------------------------------------------------------------------------
// Download jobs (the fallback engine)
// ---------------------------------------------------------------------------

/// What the backend reports about one requested file.
#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum TransferStatus {
    Queued {
        position: Option<u32>,
    },
    Progress {
        #[ts(type = "number")]
        bytes: u64,
        #[ts(type = "number")]
        total: u64,
        speed: f64,
    },
    Completed {
        local_path: String,
    },
    Failed {
        reason: String,
    },
    TimedOut,
    Cancelled,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum ItemState {
    Pending,
    Queued { position: Option<u32> },
    Downloading,
    Verifying,
    Verified,
    Rejected,
    KeptAnyway,
    Failed { reason: String },
}

#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ItemView {
    /// File name without the folder, the key the UI and events use.
    pub name: String,
    #[ts(type = "number")]
    pub size: u64,
    #[ts(type = "number")]
    pub bytes: u64,
    pub state: ItemState,
    pub local_path: Option<String>,
    pub verdict: Option<Verdict>,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum JobStatus {
    Waiting,
    Queued {
        position: Option<u32>,
    },
    Downloading,
    /// Something went wrong and Needle is handling it (switching source,
    /// replacing a rejected file).
    Recovering {
        reason: String,
    },
    Verifying,
    Done,
    Failed {
        reason: String,
    },
    Paused,
    Cancelled,
}

#[derive(Serialize, Deserialize, TS, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Tone {
    Info,
    Ok,
    Warn,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LogEntry {
    #[ts(type = "number")]
    pub at_ms: u64,
    pub text: String,
    pub tone: Tone,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct JobView {
    pub id: String,
    pub title: String,
    pub artist: Option<String>,
    pub format_label: String,
    pub status: JobStatus,
    /// A short line under the status ("from deepcrates", "failed the lossless check").
    pub detail: String,
    pub current_user: Option<String>,
    /// 1-based position of the current source, and how many there are.
    pub source_index: usize,
    pub source_count: usize,
    pub items: Vec<ItemView>,
    #[ts(type = "number")]
    pub bytes: u64,
    #[ts(type = "number")]
    pub total: u64,
    pub speed: f64,
    /// Seconds until the stuck rule switches source, while waiting in a queue.
    pub switch_in_secs: Option<u32>,
    pub log: Vec<LogEntry>,
    pub output_dir: String,
    #[ts(type = "number")]
    pub created_ms: u64,
    #[ts(type = "number | null")]
    pub finished_ms: Option<u64>,
}

/// Input to `Job::handle`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub enum JobEvent {
    /// Kick the job off (or resume it after a restart).
    Start,
    /// Time passes; the engine checks the stuck rules.
    Tick,
    Transfer {
        name: String,
        status: TransferStatus,
    },
    Verified {
        name: String,
        verdict: Verdict,
    },
    /// The verifier could not read the file at all.
    VerifyError {
        name: String,
        error: String,
    },
    /// The user overrides a rejection.
    KeepAnyway {
        name: String,
    },
    /// Fresh sources from a re-search (already grouped and ranked).
    NewSources {
        candidates: Vec<Candidate>,
    },
    Pause,
    Resume,
    Cancel,
    Retry,
}

/// Output of `Job::handle`: side effects for the backend to perform.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub enum JobAction {
    Request {
        username: String,
        remote_path: String,
        size: u64,
        dest_dir: String,
    },
    CancelTransfer {
        username: String,
        remote_path: String,
    },
    Verify {
        name: String,
        local_path: String,
        tier: Tier,
        strictness: Strictness,
    },
    Delete {
        local_path: String,
    },
    MoveToRejected {
        local_path: String,
    },
    Research {
        query: String,
    },
    AddToWishlist {
        query: String,
    },
    /// The job finished with every item verified or kept.
    Finished,
}
